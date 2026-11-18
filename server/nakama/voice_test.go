package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"

	"flickkick/server/rules"
)

const testCommsKey = "sk_test_secret_value"

type commsCall struct {
	Method string
	Path   string
	Auth   string
	Body   map[string]any
}

type fakeComms struct {
	t      *testing.T
	srv    *httptest.Server
	mu     sync.Mutex
	calls  []commsCall
	rooms  map[string]bool
	down   bool
	closed map[string]int
}

func newFakeComms(t *testing.T) *fakeComms {
	t.Helper()
	f := &fakeComms{t: t, rooms: map[string]bool{}, closed: map[string]int{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeComms) serve(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, commsCall{Method: r.Method, Path: r.URL.EscapedPath(), Auth: r.Header.Get("Authorization"), Body: body})
	if f.down {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+testCommsKey {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"unauthenticated","message":"bad key"}}`))
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/server/game-rooms"), "/")
	switch {
	case r.URL.Path == "/v1/server/game-rooms" && r.Method == http.MethodPost:
		match, _ := body["match_id"].(string)
		status := http.StatusCreated
		if f.rooms[match] {
			status = http.StatusOK
		}
		f.rooms[match] = true
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"id":"r1","match_id":"` + match + `","state":"open","players":[]}`))
	case len(parts) == 5 && parts[2] == "players" && parts[4] == "token":
		if !f.rooms[parts[1]] {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":{"code":"room_closed","message":"closed"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"token":"join-` + parts[3] + `","expires_at":"2026-11-07T12:10:00Z"}`))
	case len(parts) == 3 && parts[2] == "close":
		f.closed[parts[1]]++
		if !f.rooms[parts[1]] {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":{"code":"room_closed","message":"closed"}}`))
			return
		}
		delete(f.rooms, parts[1])
		_, _ = w.Write([]byte(`{"id":"r1","state":"closed"}`))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func (f *fakeComms) snapshot() []commsCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]commsCall(nil), f.calls...)
}

func (f *fakeComms) closes(match string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed[match]
}

func (f *fakeComms) service(t *testing.T, logger runtime.Logger) *voiceService {
	t.Helper()
	c, err := newCommsClient(f.srv.URL+"/", testCommsKey, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return newVoiceService(c, "whsec_test", logger)
}

type recordingLogger struct {
	mu     sync.Mutex
	fields map[string]any
	lines  []string
}

func (l *recordingLogger) log(level, msg string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, _ := json.Marshal(l.fields)
	l.lines = append(l.lines, level+" "+msg+" "+string(b))
}
func (l *recordingLogger) Debug(m string, _ ...interface{}) { l.log("debug", m) }
func (l *recordingLogger) Info(m string, _ ...interface{})  { l.log("info", m) }
func (l *recordingLogger) Warn(m string, _ ...interface{})  { l.log("warn", m) }
func (l *recordingLogger) Error(m string, _ ...interface{}) { l.log("error", m) }
func (l *recordingLogger) WithField(k string, v interface{}) runtime.Logger {
	return l.WithFields(map[string]interface{}{k: v})
}
func (l *recordingLogger) WithFields(f map[string]interface{}) runtime.Logger {
	return &scopedLogger{root: l, fields: f}
}
func (l *recordingLogger) Fields() map[string]interface{} { return nil }

func (l *recordingLogger) all() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.lines, "\n")
}

func (l *recordingLogger) count(msg string) int {
	return strings.Count(l.all(), " "+msg+" ")
}

type scopedLogger struct {
	root   *recordingLogger
	fields map[string]interface{}
}

func (s *scopedLogger) emit(level, msg string) {
	s.root.mu.Lock()
	b, _ := json.Marshal(s.fields)
	s.root.lines = append(s.root.lines, level+" "+msg+" "+string(b))
	s.root.mu.Unlock()
}
func (s *scopedLogger) Debug(m string, _ ...interface{}) { s.emit("debug", m) }
func (s *scopedLogger) Info(m string, _ ...interface{})  { s.emit("info", m) }
func (s *scopedLogger) Warn(m string, _ ...interface{})  { s.emit("warn", m) }
func (s *scopedLogger) Error(m string, _ ...interface{}) { s.emit("error", m) }
func (s *scopedLogger) WithField(k string, v interface{}) runtime.Logger {
	return s.WithFields(map[string]interface{}{k: v})
}
func (s *scopedLogger) WithFields(f map[string]interface{}) runtime.Logger {
	merged := map[string]interface{}{}
	for k, v := range s.fields {
		merged[k] = v
	}
	for k, v := range f {
		merged[k] = v
	}
	return &scopedLogger{root: s.root, fields: merged}
}
func (s *scopedLogger) Fields() map[string]interface{} { return s.fields }

func TestCommsClientCallsTheServerAPI(t *testing.T) {
	f := newFakeComms(t)
	c, err := newCommsClient(f.srv.URL, testCommsKey, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := c.OpenRoom(ctx, "m-1.nakama", []voicePlayer{{ID: "u1", Name: "Ada"}, {ID: "u2", Name: "Ben"}}); err != nil {
		t.Fatal(err)
	}
	tok, err := c.Token(ctx, "m-1.nakama", "u1")
	if err != nil || tok.Token != "join-u1" || tok.ExpiresAt == "" {
		t.Fatal(tok, err)
	}
	if err := c.CloseRoom(ctx, "m-1.nakama"); err != nil {
		t.Fatal(err)
	}
	if err := c.CloseRoom(ctx, "m-1.nakama"); err != nil {
		t.Fatal("closing a closed room must succeed", err)
	}
	calls := f.snapshot()
	if len(calls) != 4 {
		t.Fatal(calls)
	}
	create := calls[0]
	if create.Method != http.MethodPost || create.Path != "/v1/server/game-rooms" || create.Auth != "Bearer "+testCommsKey {
		t.Fatal(create)
	}
	if create.Body["match_id"] != "m-1.nakama" || create.Body["video"] != false {
		t.Fatal(create.Body)
	}
	players, _ := create.Body["players"].([]any)
	if len(players) != 2 || players[0].(map[string]any)["name"] != "Ada" {
		t.Fatal(players)
	}
	if calls[1].Path != "/v1/server/game-rooms/m-1.nakama/players/u1/token" || calls[1].Body != nil {
		t.Fatal(calls[1])
	}
	if calls[2].Path != "/v1/server/game-rooms/m-1.nakama/close" {
		t.Fatal(calls[2])
	}
}

func TestCommsClientErrorsNeverCarryTheKey(t *testing.T) {
	f := newFakeComms(t)
	bad, _ := newCommsClient(f.srv.URL, "sk_wrong_key", time.Second)
	err := bad.OpenRoom(context.Background(), "m", nil)
	if err == nil || !strings.Contains(err.Error(), "401") || strings.Contains(err.Error(), "sk_wrong_key") {
		t.Fatal(err)
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
	}))
	defer slow.Close()
	c, _ := newCommsClient(slow.URL, testCommsKey, 50*time.Millisecond)
	err = c.OpenRoom(context.Background(), "m", nil)
	if err == nil || !strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), testCommsKey) {
		t.Fatal(err)
	}
	dead, _ := newCommsClient("http://127.0.0.1:1", testCommsKey, time.Second)
	if err := dead.CloseRoom(context.Background(), "m"); err == nil || strings.Contains(err.Error(), testCommsKey) {
		t.Fatal(err)
	}
}

func TestConfigureVoice(t *testing.T) {
	t.Cleanup(func() { voiceSvc.Store(nil) })
	for _, env := range []map[string]string{
		{},
		{"COMMS_URL": "https://comms.example"},
		{"COMMS_SERVER_KEY": "sk"},
		{"COMMS_URL": "ftp://comms.example", "COMMS_SERVER_KEY": "sk"},
		{"COMMS_URL": "not a url", "COMMS_SERVER_KEY": "sk"},
	} {
		log := &recordingLogger{}
		configureVoice(env, log)
		if currentVoice() != nil {
			t.Fatal("voice enabled with", env)
		}
	}
	log := &recordingLogger{}
	configureVoice(map[string]string{"COMMS_URL": "https://comms.example/", "COMMS_SERVER_KEY": "sk_live_123", "COMMS_WEBHOOK_SECRET": "whsec_x"}, log)
	v := currentVoice()
	if v == nil || v.client.baseURL != "https://comms.example" || v.webhookSecret != "whsec_x" {
		t.Fatal("voice not configured")
	}
	if strings.Contains(log.all(), "sk_live_123") || strings.Contains(log.all(), "whsec_x") {
		t.Fatal("secret logged", log.all())
	}
}

func rankedVoiceMatch(v *voiceService) *matchState {
	players := [2]rules.Player{{ID: "u1", DisplayName: "Ada"}, {ID: "u2", DisplayName: "Ben\x07"}}
	return &matchState{
		mode:         "ranked",
		sides:        map[string]rules.Side{"u1": rules.L, "u2": rules.R},
		presences:    map[string]runtime.Presence{},
		disconnected: map[string]int64{},
		st:           rules.NewMatch("match-1.nakama", "online", players, 7, gd().Rules),
		arena:        gd().Arenas.Arenas[0],
		voice:        v,
		logger:       nopLogger{},
	}
}

type voiceNk struct {
	runtime.NakamaModule
	mu      sync.Mutex
	states  map[string]*matchState
	writes  []*runtime.StorageWrite
	objects []*api.StorageObject
	users   []*api.User
}

func (n *voiceNk) MatchSignal(ctx context.Context, id string, data string) (string, error) {
	n.mu.Lock()
	s, ok := n.states[id]
	n.mu.Unlock()
	if !ok {
		return "", runtime.NewError("match not found", codeNotFound)
	}
	_, out := (&Match{}).MatchSignal(ctx, nopLogger{}, nil, n, &previewDispatcher{}, 0, s, data)
	return out, nil
}

func (n *voiceNk) StorageRead(context.Context, []*runtime.StorageRead) ([]*api.StorageObject, error) {
	return nil, nil
}

func (n *voiceNk) MultiUpdate(context.Context, []*runtime.AccountUpdate, []*runtime.StorageWrite, []*runtime.StorageDelete, []*runtime.WalletUpdate, bool) ([]*api.StorageObjectAck, []*runtime.WalletUpdateResult, error) {
	return nil, nil, nil
}

func (n *voiceNk) StorageWrite(_ context.Context, writes []*runtime.StorageWrite) ([]*api.StorageObjectAck, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.writes = append(n.writes, writes...)
	for _, w := range writes {
		n.objects = append(n.objects, &api.StorageObject{Collection: w.Collection, Key: w.Key, UserId: w.UserID, Value: w.Value})
	}
	return nil, nil
}

func (n *voiceNk) StorageList(_ context.Context, _, userID, collection string, limit int, _ string) ([]*api.StorageObject, string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := []*api.StorageObject{}
	for _, o := range n.objects {
		if o.Collection == collection && o.UserId == userID {
			out = append(out, o)
		}
	}
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j].Key < out[i].Key {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, "", nil
}

func (n *voiceNk) UsersGetId(_ context.Context, ids []string, _ []string) ([]*api.User, error) {
	return n.users, nil
}

func TestRankedMatchOpensTheRoomAtStartAndClosesOnTheEnd(t *testing.T) {
	useDefaultData(t)
	f := newFakeComms(t)
	v := f.service(t, nopLogger{})
	s := rankedVoiceMatch(v)
	s.arena.EntryFee = 0
	m := &Match{}
	d := &previewDispatcher{}
	nk := &voiceNk{}
	m.MatchJoin(context.Background(), nopLogger{}, nil, nk, d, 1, s, []runtime.Presence{presence{"u1"}, presence{"u2"}})
	v.wait()
	if !s.started || !f.rooms["match-1.nakama"] {
		t.Fatal("room not opened when the match started", f.snapshot())
	}
	create := f.snapshot()[0]
	players := create.Body["players"].([]any)
	if len(players) != 2 || players[0].(map[string]any)["id"] != "u1" || players[1].(map[string]any)["name"] != "Ben" {
		t.Fatal(create.Body)
	}
	m.MatchLeave(context.Background(), nopLogger{}, nil, nk, d, 2, s, []runtime.Presence{presence{"u2"}})
	m.MatchLoop(context.Background(), nopLogger{}, nil, nk, d, 2+disconnectGrace*tickRate+1, s, nil)
	if s.st.Phase != "ENDED" || s.st.Result.Reason != "forfeit_disconnect" {
		t.Fatal("disconnect did not end the match", s.st.Phase)
	}
	m.MatchLoop(context.Background(), nopLogger{}, nil, nk, d, 2+disconnectGrace*tickRate+2, s, nil)
	v.wait()
	if f.closes("match-1.nakama") != 1 || f.rooms["match-1.nakama"] {
		t.Fatal("room not closed at the end")
	}
	m.MatchLoop(context.Background(), nopLogger{}, nil, nk, d, 2+(disconnectGrace+endLingerSec)*tickRate+10, s, nil)
	m.MatchTerminate(context.Background(), nopLogger{}, nil, nk, d, 0, s, 0)
	v.wait()
	if f.closes("match-1.nakama") != 1 {
		t.Fatal("room closed more than once", f.closes("match-1.nakama"))
	}
}

func TestEveryEndPathClosesTheRoomOnce(t *testing.T) {
	useDefaultData(t)
	m := &Match{}
	nk := &voiceNk{}
	paths := map[string]func(s *matchState){
		"forfeit": func(s *matchState) {
			s.st.Forfeit(rules.L, "forfeit_quit")
			m.MatchLoop(context.Background(), nopLogger{}, nil, nk, &previewDispatcher{}, 5, s, nil)
		},
		"abort":     func(s *matchState) { s.abort(&previewDispatcher{}, "test") },
		"terminate": func(s *matchState) { m.MatchTerminate(context.Background(), nopLogger{}, nil, nk, nil, 0, s, 0) },
		"cleanup":   func(s *matchState) { s.cleanup() },
	}
	for name, end := range paths {
		t.Run(name, func(t *testing.T) {
			f := newFakeComms(t)
			v := f.service(t, nopLogger{})
			s := rankedVoiceMatch(v)
			s.started = true
			s.createdTick = 1
			s.openVoice()
			end(s)
			s.cleanup()
			v.wait()
			if f.closes("match-1.nakama") != 1 {
				t.Fatalf("%s closed %d times", name, f.closes("match-1.nakama"))
			}
		})
	}
}

func TestBotMatchesAndDisabledVoiceTouchNothing(t *testing.T) {
	useDefaultData(t)
	f := newFakeComms(t)
	v := f.service(t, nopLogger{})
	bot := rankedVoiceMatch(v)
	bot.mode = "bot"
	bot.started = true
	bot.openVoice()
	bot.cleanup()
	off := rankedVoiceMatch(nil)
	off.started = true
	off.openVoice()
	off.cleanup()
	v.wait()
	if len(f.snapshot()) != 0 {
		t.Fatal("comms called", f.snapshot())
	}
}

func TestCommsDownLogsOnceAndTheMatchGoesOn(t *testing.T) {
	useDefaultData(t)
	f := newFakeComms(t)
	f.down = true
	log := &recordingLogger{}
	v := f.service(t, log)
	for i := 0; i < 3; i++ {
		s := rankedVoiceMatch(v)
		s.st.MatchID = "down-" + strconv.Itoa(i)
		s.started = true
		s.openVoice()
		s.cleanup()
	}
	v.wait()
	if n := log.count("voice_unavailable"); n != 1 {
		t.Fatalf("logged %d times:\n%s", n, log.all())
	}
	f.mu.Lock()
	f.down = false
	f.mu.Unlock()
	s := rankedVoiceMatch(v)
	s.started = true
	s.openVoice()
	v.wait()
	if log.count("voice_recovered") != 1 {
		t.Fatal(log.all())
	}
	if strings.Contains(log.all(), testCommsKey) {
		t.Fatal("key in logs")
	}
}

func voiceCtx(uid string) context.Context {
	return context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, uid)
}

func TestVoiceTokenOnlyForPlayersOfALiveMatch(t *testing.T) {
	useDefaultData(t)
	f := newFakeComms(t)
	v := f.service(t, nopLogger{})
	s := rankedVoiceMatch(v)
	s.started = true
	nk := &voiceNk{states: map[string]*matchState{"match-1.nakama": s}}
	now := time.Now()

	if _, err := voiceTokenFor(voiceCtx("stranger"), nk, v, `{"matchId":"match-1.nakama"}`, now); err == nil || !strings.Contains(err.Error(), "not a player") {
		t.Fatal("stranger got a token", err)
	}
	if _, err := voiceTokenFor(voiceCtx("u1"), nk, v, `{"matchId":"other"}`, now); err == nil {
		t.Fatal("unknown match answered")
	}
	if _, err := voiceTokenFor(context.Background(), nk, v, `{"matchId":"match-1.nakama"}`, now); err == nil {
		t.Fatal("anonymous caller answered")
	}
	if _, err := voiceTokenFor(voiceCtx("u1"), nk, v, `{}`, now); err == nil {
		t.Fatal("missing match id accepted")
	}

	out, err := voiceTokenFor(voiceCtx("u1"), nk, v, `{"matchId":"match-1.nakama"}`, now)
	var got struct {
		Enabled   bool   `json:"enabled"`
		Token     string `json:"token"`
		ExpiresAt string `json:"expiresAt"`
	}
	if err != nil || json.Unmarshal([]byte(out), &got) != nil || !got.Enabled || got.Token != "join-u1" {
		t.Fatal(out, err)
	}
	if !s.voiceOpen || !f.rooms["match-1.nakama"] {
		t.Fatal("token request did not open the missing room")
	}
	out, _ = voiceTokenFor(voiceCtx("u2"), nk, v, `{"matchId":"match-1.nakama"}`, now)
	if !strings.Contains(out, "join-u2") {
		t.Fatal(out)
	}

	s.st.Phase = "ENDED"
	out, err = voiceTokenFor(voiceCtx("u1"), nk, v, `{"matchId":"match-1.nakama"}`, now)
	if err != nil || out != `{"enabled":false}` {
		t.Fatal("ended match minted a token", out, err)
	}
	s.st.Phase = "AWAIT_SHOT"
	s.mode = "bot"
	out, _ = voiceTokenFor(voiceCtx("u1"), nk, v, `{"matchId":"match-1.nakama"}`, now)
	if out != `{"enabled":false}` {
		t.Fatal("bot match minted a token", out)
	}
	out, _ = voiceTokenFor(voiceCtx("u1"), nk, nil, `{"matchId":"match-1.nakama"}`, now)
	if out != `{"enabled":false}` {
		t.Fatal("voice without comms", out)
	}
}

func TestVoiceTokenLimitAndOutage(t *testing.T) {
	useDefaultData(t)
	f := newFakeComms(t)
	v := f.service(t, nopLogger{})
	s := rankedVoiceMatch(v)
	s.started = true
	nk := &voiceNk{states: map[string]*matchState{"match-1.nakama": s}}
	now := time.Now()
	for i := 0; i < voiceTokensPerMinute; i++ {
		if _, err := voiceTokenFor(voiceCtx("u1"), nk, v, `{"matchId":"match-1.nakama"}`, now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := voiceTokenFor(voiceCtx("u1"), nk, v, `{"matchId":"match-1.nakama"}`, now); err == nil {
		t.Fatal("no limit")
	}
	if _, err := voiceTokenFor(voiceCtx("u1"), nk, v, `{"matchId":"match-1.nakama"}`, now.Add(61*time.Second)); err != nil {
		t.Fatal("limit did not reset", err)
	}
	f.mu.Lock()
	f.down = true
	f.mu.Unlock()
	out, err := voiceTokenFor(voiceCtx("u2"), nk, v, `{"matchId":"match-1.nakama"}`, now)
	if err != nil || out != `{"enabled":false}` {
		t.Fatal("outage must not be an error for the player", out, err)
	}
}

func signCommsBody(secret string, ts int64, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(ts, 10) + "." + body))
	return "t=" + strconv.FormatInt(ts, 10) + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyCommsSignature(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"type":"x"}`)
	good := signCommsBody("whsec_a", now.Unix(), string(body))
	if err := verifyCommsSignature(good, "whsec_a", body, now, time.Minute); err != nil {
		t.Fatal(err)
	}
	rotated := "t=" + strconv.FormatInt(now.Unix(), 10) + ",v1=" + strings.Repeat("0", 64) + "," + strings.Split(good, ",")[1]
	if err := verifyCommsSignature(rotated, "whsec_a", body, now, time.Minute); err != nil {
		t.Fatal("second signature during rotation refused", err)
	}
	for name, c := range map[string]struct {
		header, secret string
		body           []byte
		at             time.Time
	}{
		"wrong secret":  {good, "whsec_b", body, now},
		"changed body":  {good, "whsec_a", []byte(`{"type":"y"}`), now},
		"too old":       {good, "whsec_a", body, now.Add(2 * time.Minute)},
		"in the future": {good, "whsec_a", body, now.Add(-2 * time.Minute)},
		"empty":         {"", "whsec_a", body, now},
		"no v1":         {"t=" + strconv.FormatInt(now.Unix(), 10), "whsec_a", body, now},
		"bad t":         {"t=abc,v1=00", "whsec_a", body, now},
		"no secret":     {good, "", body, now},
	} {
		if err := verifyCommsSignature(c.header, c.secret, c.body, c.at, time.Minute); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func webhookCtx(signature string) context.Context {
	return context.WithValue(context.Background(), runtime.RUNTIME_CTX_HEADERS, map[string][]string{"Comms-Signature": {signature}})
}

func TestReportWebhookStoresSignedReportsOnly(t *testing.T) {
	useDefaultData(t)
	f := newFakeComms(t)
	v := f.service(t, nopLogger{})
	nk := &voiceNk{users: []*api.User{{Id: "11111111-1111-1111-1111-111111111111", DisplayName: "Ada"}, {Id: "22222222-2222-2222-2222-222222222222", Username: "ben"}}}
	now := time.Now()
	body := `{"id":"ev1","type":"game_room.player_reported","data":{"room_id":"r1","match_id":"match-1.nakama","report":{"id":"rep1","room_id":"r1","match_id":"match-1.nakama","reporter":"11111111-1111-1111-1111-111111111111","reported":"22222222-2222-2222-2222-222222222222","reason":"abuse","note":"shouting\u0007","created_at":"2026-11-07T10:00:00Z"}}}`

	if _, err := handleVoiceWebhook(webhookCtx("t=1,v1=00"), nopLogger{}, nk, v, body, now); err == nil {
		t.Fatal("unsigned webhook accepted")
	}
	if _, err := handleVoiceWebhook(webhookCtx(signCommsBody("whsec_other", now.Unix(), body)), nopLogger{}, nk, v, body, now); err == nil {
		t.Fatal("webhook signed with another secret accepted")
	}
	userCall := context.WithValue(webhookCtx(signCommsBody("whsec_test", now.Unix(), body)), runtime.RUNTIME_CTX_USER_ID, "u1")
	if _, err := handleVoiceWebhook(userCall, nopLogger{}, nk, v, body, now); err == nil {
		t.Fatal("a player session called the webhook")
	}
	if _, err := handleVoiceWebhook(webhookCtx(signCommsBody("whsec_test", now.Unix(), body)), nopLogger{}, nk, nil, body, now); err == nil {
		t.Fatal("webhook answered without voice configured")
	}
	if len(nk.writes) != 0 {
		t.Fatal("rejected webhook stored something")
	}

	if _, err := handleVoiceWebhook(webhookCtx(signCommsBody("whsec_test", now.Unix(), body)), nopLogger{}, nk, v, body, now); err != nil {
		t.Fatal(err)
	}
	other := `{"id":"ev2","type":"game_room.closed","data":{"room_id":"r1","match_id":"match-1.nakama"}}`
	if _, err := handleVoiceWebhook(webhookCtx(signCommsBody("whsec_test", now.Unix(), other)), nopLogger{}, nk, v, other, now); err != nil {
		t.Fatal(err)
	}
	if len(nk.writes) != 1 {
		t.Fatal(len(nk.writes))
	}
	w := nk.writes[0]
	if w.Collection != collectionVoice || w.UserID != systemUserID || w.PermissionRead != permNoRead || w.PermissionWrite != permNoWrite {
		t.Fatal(w)
	}
	var stored voiceReport
	_ = json.Unmarshal([]byte(w.Value), &stored)
	if stored.Reason != "abuse" || stored.Note != "shouting" || stored.Reporter != "11111111-1111-1111-1111-111111111111" {
		t.Fatal(stored)
	}

	later := strings.ReplaceAll(strings.ReplaceAll(body, "rep1", "rep2"), "10:00:00Z", "11:00:00Z")
	if _, err := handleVoiceWebhook(webhookCtx(signCommsBody("whsec_test", now.Unix(), later)), nopLogger{}, nk, v, later, now); err != nil {
		t.Fatal(err)
	}
	withAdmin(t)
	voiceSvc.Store(v)
	t.Cleanup(func() { voiceSvc.Store(nil) })
	token := adminSign(time.Now().Add(time.Hour).Unix())
	out, err := rpcAdminVoiceReports(userCtx(), nopLogger{}, (*sql.DB)(nil), nk, `{"token":"`+token+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var list struct {
		Enabled bool              `json:"enabled"`
		Reports []voiceReportView `json:"reports"`
	}
	if json.Unmarshal([]byte(out), &list) != nil || !list.Enabled || len(list.Reports) != 2 {
		t.Fatal(out)
	}
	if list.Reports[0].ID != "rep2" || list.Reports[0].ReporterName != "Ada" || list.Reports[0].ReportedName != "ben" {
		t.Fatal("newest report first with names", out)
	}
	if _, err := rpcAdminVoiceReports(userCtx(), nopLogger{}, nil, nk, `{"token":"bad"}`); err == nil {
		t.Fatal("reports without admin sign-in")
	}
}
