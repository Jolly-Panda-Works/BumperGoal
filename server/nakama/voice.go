package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	codePermissionDenied = 7

	voiceTimeout          = 5 * time.Second
	voiceSignatureMaxSkew = 5 * time.Minute
	voiceTokensPerMinute  = 6
	voiceMaxName          = 100
	voiceMaxNote          = 500
	voiceReportsShown     = 100
	voiceWebhookMaxBody   = 64 * 1024
	collectionVoice       = "voice_reports"
)

type commsClient struct {
	baseURL string
	key     string
	http    *http.Client
}

type commsError struct {
	Status int
	Code   string
}

func (e *commsError) Error() string {
	if e.Code == "" {
		return "comms answered " + strconv.Itoa(e.Status)
	}
	return "comms answered " + strconv.Itoa(e.Status) + " " + e.Code
}

type voicePlayer struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type voiceToken struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expires_at"`
}

func newCommsClient(baseURL, key string, timeout time.Duration) (*commsClient, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("COMMS_URL must be an http or https URL")
	}
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("COMMS_SERVER_KEY is empty")
	}
	return &commsClient{baseURL: u.String(), key: strings.TrimSpace(key), http: &http.Client{Timeout: timeout}}, nil
}

func (c *commsClient) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return errors.New("comms request could not be built")
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("comms unreachable: %s", transportReason(err))
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var problem struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(data, &problem)
		return &commsError{Status: resp.StatusCode, Code: problem.Error.Code}
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return errors.New("comms answer is not valid JSON")
		}
	}
	return nil
}

func transportReason(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "Client.Timeout"), strings.Contains(msg, "deadline exceeded"):
		return "timeout"
	case strings.Contains(msg, "connection refused"):
		return "connection refused"
	case strings.Contains(msg, "no such host"):
		return "unknown host"
	}
	return "network error"
}

func roomPath(matchID string) string {
	return "/v1/server/game-rooms/" + url.PathEscape(matchID)
}

func (c *commsClient) OpenRoom(ctx context.Context, matchID string, players []voicePlayer) error {
	return c.do(ctx, http.MethodPost, "/v1/server/game-rooms", map[string]any{"match_id": matchID, "players": players, "video": false}, nil)
}

func (c *commsClient) Token(ctx context.Context, matchID, playerID string) (voiceToken, error) {
	var out voiceToken
	err := c.do(ctx, http.MethodPost, roomPath(matchID)+"/players/"+url.PathEscape(playerID)+"/token", nil, &out)
	if err == nil && out.Token == "" {
		err = errors.New("comms answered without a token")
	}
	return out, err
}

func (c *commsClient) CloseRoom(ctx context.Context, matchID string) error {
	err := c.do(ctx, http.MethodPost, roomPath(matchID)+"/close", nil, nil)
	var ce *commsError
	if errors.As(err, &ce) && (ce.Status == http.StatusNotFound || ce.Code == "room_closed") {
		return nil
	}
	return err
}

type voiceService struct {
	client        *commsClient
	webhookSecret string
	logger        runtime.Logger
	down          atomic.Bool
	pending       sync.WaitGroup

	mu     sync.Mutex
	minted map[string][]time.Time
}

var voiceSvc atomic.Pointer[voiceService]

func currentVoice() *voiceService { return voiceSvc.Load() }

func configureVoice(env map[string]string, logger runtime.Logger) {
	voiceSvc.Store(nil)
	base, key := strings.TrimSpace(env["COMMS_URL"]), env["COMMS_SERVER_KEY"]
	if base == "" && strings.TrimSpace(key) == "" {
		if logger != nil {
			logger.Info("voice chat disabled: COMMS_URL and COMMS_SERVER_KEY are not set")
		}
		return
	}
	client, err := newCommsClient(base, key, voiceTimeout)
	if err != nil {
		if logger != nil {
			logger.WithField("reason", err.Error()).Warn("voice chat disabled")
		}
		return
	}
	voiceSvc.Store(newVoiceService(client, env["COMMS_WEBHOOK_SECRET"], logger))
	if logger != nil {
		logger.WithFields(map[string]any{"comms": client.baseURL, "reports_webhook": env["COMMS_WEBHOOK_SECRET"] != ""}).Info("voice chat enabled")
	}
}

func newVoiceService(client *commsClient, webhookSecret string, logger runtime.Logger) *voiceService {
	if logger == nil {
		logger = discardLogger{}
	}
	return &voiceService{client: client, webhookSecret: strings.TrimSpace(webhookSecret), logger: logger, minted: map[string][]time.Time{}}
}

func (v *voiceService) failed(op, matchID string, err error) {
	if v.down.CompareAndSwap(false, true) {
		v.logger.WithFields(map[string]any{"op": op, "match_id": matchID, "error": err.Error()}).Warn("voice_unavailable")
	}
}

func (v *voiceService) worked() {
	if v.down.CompareAndSwap(true, false) {
		v.logger.Info("voice_recovered")
	}
}

func (v *voiceService) async(fn func(ctx context.Context)) {
	v.pending.Add(1)
	go func() {
		defer v.pending.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 2*voiceTimeout)
		defer cancel()
		fn(ctx)
	}()
}

func (v *voiceService) wait() { v.pending.Wait() }

func (v *voiceService) open(matchID string, players []voicePlayer) {
	v.async(func(ctx context.Context) {
		if err := v.client.OpenRoom(ctx, matchID, players); err != nil {
			v.failed("open", matchID, err)
			return
		}
		v.worked()
		v.logger.WithField("match_id", matchID).Info("voice_room_opened")
	})
}

func (v *voiceService) close(matchID string) {
	v.async(func(ctx context.Context) {
		if err := v.client.CloseRoom(ctx, matchID); err != nil {
			v.failed("close", matchID, err)
			return
		}
		v.worked()
		v.logger.WithField("match_id", matchID).Info("voice_room_closed")
	})
}

func (v *voiceService) allowMint(userID string, now time.Time) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	recent := v.minted[userID][:0]
	for _, t := range v.minted[userID] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if len(recent) >= voiceTokensPerMinute {
		v.minted[userID] = recent
		return false
	}
	v.minted[userID] = append(recent, now)
	for uid, times := range v.minted {
		if len(times) == 0 || now.Sub(times[len(times)-1]) > time.Minute {
			delete(v.minted, uid)
		}
	}
	return true
}

func (v *voiceService) token(ctx context.Context, matchID, userID string, players []voicePlayer) (voiceToken, error) {
	tok, err := v.client.Token(ctx, matchID, userID)
	var ce *commsError
	if errors.As(err, &ce) && (ce.Status == http.StatusNotFound || ce.Code == "room_closed" || ce.Code == "not_listed") {
		if err = v.client.OpenRoom(ctx, matchID, players); err == nil {
			tok, err = v.client.Token(ctx, matchID, userID)
		}
	}
	return tok, err
}

func cleanText(text string, limit int) string {
	text = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, text))
	if utf8.RuneCountInString(text) > limit {
		text = string([]rune(text)[:limit])
	}
	return text
}

type discardLogger struct{}

func (discardLogger) Debug(string, ...interface{})                       {}
func (discardLogger) Info(string, ...interface{})                        {}
func (discardLogger) Warn(string, ...interface{})                        {}
func (discardLogger) Error(string, ...interface{})                       {}
func (l discardLogger) WithField(string, interface{}) runtime.Logger     { return l }
func (l discardLogger) WithFields(map[string]interface{}) runtime.Logger { return l }
func (discardLogger) Fields() map[string]interface{}                     { return nil }

func (s *matchState) voicePlayers() []voicePlayer {
	out := []voicePlayer{}
	for _, p := range s.st.Players {
		if _, human := s.sides[p.ID]; human && !p.IsBot {
			out = append(out, voicePlayer{ID: p.ID, Name: cleanText(p.DisplayName, voiceMaxName)})
		}
	}
	return out
}

func (s *matchState) voiceAllowed() bool {
	return s.voice != nil && s.mode == "ranked" && s.started && !s.aborted && s.st.Phase != "ENDED"
}

func (s *matchState) openVoice() {
	if !s.voiceAllowed() || s.voiceOpen {
		return
	}
	s.voiceOpen = true
	s.voice.open(s.st.MatchID, s.voicePlayers())
}

func (s *matchState) closeVoice() {
	if s.voice == nil || !s.voiceOpen || s.voiceClosed {
		return
	}
	s.voiceClosed = true
	s.voice.close(s.st.MatchID)
}

func (s *matchState) voiceSignal() string {
	if !s.voiceAllowed() {
		return `{"ok":false}`
	}
	s.voiceOpen = true
	out, _ := json.Marshal(map[string]any{"ok": true, "players": s.voicePlayers()})
	return string(out)
}

type voiceSignaler interface {
	MatchSignal(ctx context.Context, id string, data string) (string, error)
}

func rpcVoiceToken(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	return voiceTokenFor(ctx, nk, currentVoice(), payload, time.Now())
}

func voiceTokenFor(ctx context.Context, nk voiceSignaler, v *voiceService, payload string, now time.Time) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req struct {
		MatchID string `json:"matchId"`
	}
	if len(payload) > 512 || json.Unmarshal([]byte(payload), &req) != nil || req.MatchID == "" {
		return "", runtime.NewError("invalid match", codeInvalidArgument)
	}
	if v == nil {
		return `{"enabled":false}`, nil
	}
	signal, _ := json.Marshal(map[string]string{"action": "voice", "userId": uid})
	result, err := nk.MatchSignal(ctx, req.MatchID, string(signal))
	if err != nil || result == "" {
		return "", runtime.NewError("not a player in this match", codePermissionDenied)
	}
	var match struct {
		OK      bool          `json:"ok"`
		Players []voicePlayer `json:"players"`
	}
	if json.Unmarshal([]byte(result), &match) != nil || !match.OK {
		return `{"enabled":false}`, nil
	}
	if !v.allowMint(uid, now) {
		return "", runtime.NewError("too many voice requests, wait a minute", codeInvalidArgument)
	}
	callCtx, cancel := context.WithTimeout(ctx, 2*voiceTimeout)
	defer cancel()
	tok, err := v.token(callCtx, req.MatchID, uid, match.Players)
	if err != nil {
		v.failed("token", req.MatchID, err)
		return `{"enabled":false}`, nil
	}
	v.worked()
	out, _ := json.Marshal(map[string]any{"enabled": true, "token": tok.Token, "expiresAt": tok.ExpiresAt})
	return string(out), nil
}

func verifyCommsSignature(header, secret string, body []byte, now time.Time, tolerance time.Duration) error {
	if secret == "" {
		return errors.New("no webhook secret")
	}
	var ts int64
	var candidates []string
	for _, part := range strings.Split(header, ",") {
		k, val, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			n, err := strconv.ParseInt(val, 10, 64)
			if err != nil {
				return errors.New("bad signature timestamp")
			}
			ts = n
		case "v1":
			candidates = append(candidates, val)
		}
	}
	if ts == 0 || len(candidates) == 0 {
		return errors.New("signature missing")
	}
	if d := now.Sub(time.Unix(ts, 0)); d > tolerance || d < -tolerance {
		return errors.New("signature too old")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(ts, 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	for _, c := range candidates {
		if hmac.Equal([]byte(c), []byte(want)) {
			return nil
		}
	}
	return errors.New("signature does not match")
}

func headerValue(headers map[string][]string, name string) string {
	for k, vals := range headers {
		if strings.EqualFold(k, name) && len(vals) > 0 {
			return vals[0]
		}
	}
	return ""
}

type voiceReport struct {
	ID        string `json:"id"`
	RoomID    string `json:"room_id"`
	MatchID   string `json:"match_id"`
	Reporter  string `json:"reporter"`
	Reported  string `json:"reported"`
	Reason    string `json:"reason"`
	Note      string `json:"note"`
	CreatedAt string `json:"created_at"`
}

func reportKey(r voiceReport) string {
	at, err := time.Parse(time.RFC3339Nano, r.CreatedAt)
	if err != nil {
		at = time.Now()
	}
	return fmt.Sprintf("%019d-%s", (1<<62)-at.UnixMilli(), r.ID)
}

func rpcVoiceWebhook(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	return handleVoiceWebhook(ctx, logger, nk, currentVoice(), payload, time.Now())
}

func handleVoiceWebhook(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, v *voiceService, payload string, now time.Time) (string, error) {
	if v == nil || v.webhookSecret == "" {
		return "", runtime.NewError("voice webhooks are not configured", codeNotFound)
	}
	if uid, _ := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string); uid != "" {
		return "", runtime.NewError("server only", codePermissionDenied)
	}
	if len(payload) > voiceWebhookMaxBody {
		return "", runtime.NewError("payload too large", codeInvalidArgument)
	}
	headers, _ := ctx.Value(runtime.RUNTIME_CTX_HEADERS).(map[string][]string)
	if err := verifyCommsSignature(headerValue(headers, "Comms-Signature"), v.webhookSecret, []byte(payload), now, voiceSignatureMaxSkew); err != nil {
		logger.WithField("reason", err.Error()).Warn("voice_webhook_rejected")
		return "", runtime.NewError("invalid signature", codeUnauthenticated)
	}
	var env struct {
		ID   string          `json:"id"`
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal([]byte(payload), &env) != nil {
		return "", runtime.NewError("invalid event", codeInvalidArgument)
	}
	if env.Type != "game_room.player_reported" {
		logger.WithFields(map[string]any{"event": env.Type, "event_id": env.ID}).Info("voice_event")
		return "", nil
	}
	var data struct {
		Report voiceReport `json:"report"`
	}
	if json.Unmarshal(env.Data, &data) != nil || data.Report.ID == "" {
		return "", runtime.NewError("invalid report", codeInvalidArgument)
	}
	r := data.Report
	r.Note = cleanText(r.Note, voiceMaxNote)
	value, _ := json.Marshal(r)
	_, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionVoice, Key: reportKey(r), UserID: systemUserID, Value: string(value),
		PermissionRead: permNoRead, PermissionWrite: permNoWrite,
	}})
	if err != nil {
		logger.WithFields(map[string]any{"report_id": r.ID, "error": err.Error()}).Error("voice_report_store_failed")
		return "", runtime.NewError("report not stored", codeInternal)
	}
	logger.WithFields(map[string]any{"report_id": r.ID, "match_id": r.MatchID, "reporter": r.Reporter, "reported": r.Reported, "reason": r.Reason}).Info("voice_player_reported")
	return "", nil
}

type voiceReportView struct {
	voiceReport
	ReporterName string `json:"reporterName"`
	ReportedName string `json:"reportedName"`
}

func rpcAdminVoiceReports(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := adminAuthorize(ctx, payload, nil); err != nil {
		return "", err
	}
	objs, _, err := nk.StorageList(ctx, "", systemUserID, collectionVoice, voiceReportsShown, "")
	if err != nil {
		return "", runtime.NewError("reports unavailable", codeInternal)
	}
	reports := []voiceReportView{}
	ids := map[string]bool{}
	for _, o := range objs {
		var r voiceReport
		if json.Unmarshal([]byte(o.GetValue()), &r) == nil {
			reports = append(reports, voiceReportView{voiceReport: r})
			ids[r.Reporter], ids[r.Reported] = true, true
		}
	}
	names := map[string]string{}
	if len(ids) > 0 {
		list := make([]string, 0, len(ids))
		for id := range ids {
			if isUUID(id) {
				list = append(list, id)
			}
		}
		if users, err := nk.UsersGetId(ctx, list, nil); err == nil {
			for _, u := range users {
				name := u.GetDisplayName()
				if name == "" {
					name = u.GetUsername()
				}
				names[u.GetId()] = name
			}
		}
	}
	for i := range reports {
		reports[i].ReporterName = names[reports[i].Reporter]
		reports[i].ReportedName = names[reports[i].Reported]
	}
	out, _ := json.Marshal(map[string]any{"enabled": currentVoice() != nil, "reports": reports})
	return string(out), nil
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if r != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}
