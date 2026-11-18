package main

// Matchmaking with a server-measured bot fallback.
//
// mm_start registers a *search* and arms a server timer. The client then adds a
// Nakama matchmaker ticket tagged with the searchId. A MatchmakerOverride and
// the timer share one lock: a pair is formed only if both searches are still
// "searching", and the timer only assigns a bot to a search that is still
// "searching". Each search therefore ends in exactly one match.
//
// Searches live in memory. Nakama OSS runs as a single node, so this is the
// whole registry; a restart drops open searches (clients see an error and retry).

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	searchSearching   = "searching"
	searchMatched     = "matched"
	searchBotAssigned = "bot_assigned"
	searchCancelled   = "cancelled"

	notifyMatchFound = 101 // notification code: {matchId, searchId, opponent}
	searchMaxAge     = 10 * time.Minute
)

type search struct {
	ID      string
	UserID  string
	Arena   string
	State   string
	MatchID string
	Created time.Time
	timer   *time.Timer
}

var (
	mmMu         sync.Mutex
	searches     = map[string]*search{}
	userSearches = map[string]string{}
	botTimeout   = 10 * time.Second
)

func configureMatchmaking(env map[string]string) {
	if v, err := strconv.Atoi(env["MM_BOT_TIMEOUT_MS"]); err == nil && v >= 1000 && v <= 10000 {
		botTimeout = time.Duration(v) * time.Millisecond
	}
	if v, err := strconv.Atoi(env["AI_SERVER_MAX_SIMULATIONS"]); err == nil && v >= 1 {
		serverAIMaxSimulations = v
	}
}

type mmStartRequest struct {
	Arena string `json:"arena"`
}

type mmStartResponse struct {
	SearchID  string            `json:"searchId,omitempty"`
	Query     string            `json:"query,omitempty"`
	Props     map[string]string `json:"props,omitempty"`
	TimeoutMs int64             `json:"timeoutMs,omitempty"`
	Resume    string            `json:"resumeMatchId,omitempty"`
}

func rpcMatchmakingStart(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req mmStartRequest
	if json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid payload", codeInvalidArgument)
	}
	arena, ok := findArena(gd(), req.Arena)
	if !ok {
		return "", runtime.NewError("unknown arena", codeInvalidArgument)
	}
	profile, err := loadProfile(ctx, nk, uid)
	if err != nil {
		return "", err
	}
	if profile.Level < arena.MinLevel {
		return "", runtime.NewError("level too low for this arena", codeInvalidArgument)
	}
	if profile.Wallet["coins"] < arena.EntryFee {
		return "", runtime.NewError("not enough coins", codeInvalidArgument)
	}

	mmMu.Lock()
	defer mmMu.Unlock()
	purgeOldSearches()
	if prevID, ok := userSearches[uid]; ok {
		prev := searches[prevID]
		// An unfinished match from a previous search: offer to resume instead of starting another.
		if prev.MatchID != "" && (prev.State == searchMatched || prev.State == searchBotAssigned) {
			if m, err := nk.MatchGet(ctx, prev.MatchID); err == nil && m != nil {
				out, _ := json.Marshal(mmStartResponse{Resume: prev.MatchID, SearchID: prev.ID})
				return string(out), nil
			}
		}
		if prev.State == searchSearching {
			prev.State = searchCancelled
			prev.timer.Stop()
		}
	}
	s := &search{ID: newID(), UserID: uid, Arena: arena.ID, State: searchSearching, Created: time.Now()}
	searches[s.ID] = s
	userSearches[uid] = s.ID
	s.timer = time.AfterFunc(botTimeout, func() { botFallback(logger, nk, s.ID) })
	logger.WithFields(map[string]any{"user_id": uid, "search_id": s.ID, "arena": arena.ID}).Info("mm_search_started")

	out, _ := json.Marshal(mmStartResponse{
		SearchID:  s.ID,
		Query:     "+properties.arena:" + arena.ID,
		Props:     map[string]string{"arena": arena.ID, "searchId": s.ID},
		TimeoutMs: botTimeout.Milliseconds(),
	})
	return string(out), nil
}

func purgeOldSearches() {
	for id, s := range searches {
		if time.Since(s.Created) > searchMaxAge {
			s.timer.Stop()
			delete(searches, id)
			if userSearches[s.UserID] == id {
				delete(userSearches, s.UserID)
			}
		}
	}
}

// mmNakama is the subset of runtime.NakamaModule the bot fallback needs (fakeable in tests).
type mmNakama interface {
	MatchCreate(ctx context.Context, module string, params map[string]interface{}) (string, error)
	NotificationSend(ctx context.Context, userID, subject string, content map[string]interface{}, code int, sender string, persistent bool) error
}

func botFallback(logger runtime.Logger, nk mmNakama, searchID string) {
	mmMu.Lock()
	s, ok := searches[searchID]
	if !ok || s.State != searchSearching {
		mmMu.Unlock()
		return
	}
	s.State = searchBotAssigned
	mmMu.Unlock()

	ctx := context.Background()
	matchID, err := nk.MatchCreate(ctx, matchModule, map[string]interface{}{"mode": "bot", "arena": s.Arena, "users": []interface{}{s.UserID}})
	if err != nil {
		logger.WithFields(map[string]any{"search_id": searchID, "error": err.Error()}).Error("bot_match_create_failed")
		return
	}
	mmMu.Lock()
	s.MatchID = matchID
	cancelled := s.State == searchCancelled
	mmMu.Unlock()
	if cancelled {
		if signaler, ok := nk.(interface {
			MatchSignal(context.Context, string, string) (string, error)
		}); ok {
			signal, _ := json.Marshal(map[string]string{"action": "cancel_waiting", "userId": s.UserID})
			_, _ = signaler.MatchSignal(ctx, matchID, string(signal))
		}
		return
	}
	logger.WithFields(map[string]any{"user_id": s.UserID, "search_id": searchID, "match_id": matchID, "after_ms": botTimeout.Milliseconds()}).Info("mm_bot_fallback")
	_ = nk.NotificationSend(ctx, s.UserID, "match_found", map[string]interface{}{"matchId": matchID, "searchId": searchID, "opponent": "bot"}, notifyMatchFound, "", false)
}

type searchRequest struct {
	SearchID string `json:"searchId"`
}

func rpcMatchmakingCancel(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req searchRequest
	_ = json.Unmarshal([]byte(payload), &req)
	mmMu.Lock()
	s, ok := searches[req.SearchID]
	if !ok || s.UserID != uid {
		mmMu.Unlock()
		return "", runtime.NewError("search not found", codeNotFound)
	}
	cancelled := s.State == searchSearching || (s.MatchID == "" && (s.State == searchMatched || s.State == searchBotAssigned))
	if cancelled {
		s.State = searchCancelled
		s.timer.Stop()
		logger.Info("mm_search_cancelled: %s", s.ID)
	}
	matchID := s.MatchID
	mmMu.Unlock()
	if !cancelled && matchID != "" {
		signal, _ := json.Marshal(map[string]string{"action": "cancel_waiting", "userId": uid})
		result, err := nk.MatchSignal(ctx, matchID, string(signal))
		var response struct {
			Cancelled bool `json:"cancelled"`
		}
		if err == nil && json.Unmarshal([]byte(result), &response) == nil && response.Cancelled {
			cancelled = true
			mmMu.Lock()
			s.State = searchCancelled
			mmMu.Unlock()
		}
	}
	out, _ := json.Marshal(map[string]any{"cancelled": cancelled, "matchId": matchID})
	return string(out), nil
}

// Preview reads the assigned match without joining or charging entry.
func rpcMatchmakingPreview(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
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
	signal, _ := json.Marshal(map[string]string{"action": "preview", "userId": uid})
	result, err := nk.MatchSignal(ctx, req.MatchID, string(signal))
	if err != nil || result == "" {
		return "", runtime.NewError("match unavailable", codeNotFound)
	}
	return result, nil
}

// rpcMatchmakingStatus lets a client recover a match it may have missed (e.g. a lost notification).
func rpcMatchmakingStatus(ctx context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, payload string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req searchRequest
	_ = json.Unmarshal([]byte(payload), &req)
	mmMu.Lock()
	defer mmMu.Unlock()
	s, ok := searches[req.SearchID]
	if !ok || s.UserID != uid {
		return "", runtime.NewError("search not found", codeNotFound)
	}
	opponent := ""
	if s.State == searchBotAssigned {
		opponent = "bot"
	} else if s.State == searchMatched {
		opponent = "human"
	}
	out, _ := json.Marshal(map[string]any{"state": s.State, "matchId": s.MatchID, "opponent": opponent})
	return string(out), nil
}

// matchmakerOverride only lets pairs through whose searches are both still open.
func matchmakerOverride(_ context.Context, logger runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, candidates [][]runtime.MatchmakerEntry) [][]runtime.MatchmakerEntry {
	mmMu.Lock()
	defer mmMu.Unlock()
	used := map[string]bool{}
	var out [][]runtime.MatchmakerEntry
	for _, c := range candidates {
		if len(c) != 2 {
			continue
		}
		var ids [2]string
		ok := true
		for i, e := range c {
			id, _ := e.GetProperties()["searchId"].(string)
			s, found := searches[id]
			if !found || s.State != searchSearching || s.UserID != e.GetPresence().GetUserId() || used[id] {
				ok = false
				break
			}
			ids[i] = id
		}
		if !ok || searches[ids[0]].UserID == searches[ids[1]].UserID || searches[ids[0]].Arena != searches[ids[1]].Arena {
			continue
		}
		for _, id := range ids {
			searches[id].State = searchMatched
			searches[id].timer.Stop()
			used[id] = true
		}
		out = append(out, c)
	}
	if len(out) > 0 {
		logger.WithField("pairs", len(out)).Info("mm_pairs_accepted")
	}
	return out
}

// matchmakerMatched creates the authoritative match for an accepted pair.
func matchmakerMatched(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error) {
	users := make([]interface{}, 0, len(entries))
	ids := make([]string, 0, len(entries))
	arena := ""
	for _, e := range entries {
		users = append(users, e.GetPresence().GetUserId())
		id, _ := e.GetProperties()["searchId"].(string)
		ids = append(ids, id)
		arena, _ = e.GetProperties()["arena"].(string)
	}
	matchID, err := nk.MatchCreate(ctx, matchModule, map[string]interface{}{"mode": "ranked", "arena": arena, "users": users})
	if err != nil {
		return "", err
	}
	mmMu.Lock()
	cancelledBy := ""
	for _, id := range ids {
		if s, ok := searches[id]; ok {
			s.MatchID = matchID
			if s.State == searchCancelled {
				cancelledBy = s.UserID
			}
		}
	}
	mmMu.Unlock()
	if cancelledBy != "" {
		signal, _ := json.Marshal(map[string]string{"action": "cancel_waiting", "userId": cancelledBy})
		_, _ = nk.MatchSignal(ctx, matchID, string(signal))
	}
	logger.WithFields(map[string]any{"match_id": matchID, "users": users, "arena": arena}).Info("mm_human_match")
	return matchID, nil
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
