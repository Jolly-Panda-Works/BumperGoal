package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// Like matchmaking, invitations are scoped to this single Nakama node.
// Pending invitations expire; a code can admit exactly one other user.
type friendInvite struct {
	Code      string `json:"code"`
	Host      string `json:"-"`
	Guest     string `json:"-"`
	MatchID   string `json:"matchId,omitempty"`
	ExpiresAt int64  `json:"expiresAt"`
}

var friendMu sync.Mutex
var friendInvites = map[string]*friendInvite{}
var friendAttempts = map[string][]int64{}

type friendBackend interface {
	MatchCreate(context.Context, string, map[string]interface{}) (string, error)
	MatchSignal(context.Context, string, string) (string, error)
}

func friendRequest(ctx context.Context, payload string) (string, string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", "", err
	}
	var req struct {
		Code string `json:"code"`
	}
	if json.Unmarshal([]byte(payload), &req) != nil {
		return "", "", runtime.NewError("invalid payload", codeInvalidArgument)
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if len(code) != 12 {
		return "", "", runtime.NewError("invalid invitation code", codeInvalidArgument)
	}
	if _, err := hex.DecodeString(code); err != nil {
		return "", "", runtime.NewError("invalid invitation code", codeInvalidArgument)
	}
	return uid, code, nil
}

func purgeFriendInvites(now int64) {
	for code, invite := range friendInvites {
		if invite.ExpiresAt <= now {
			delete(friendInvites, code)
		}
	}
	for uid, attempts := range friendAttempts {
		if len(attempts) == 0 || attempts[len(attempts)-1] < now-60 {
			delete(friendAttempts, uid)
		}
	}
}

func createFriendInvite(uid string, now int64) (string, error) {
	friendMu.Lock()
	defer friendMu.Unlock()
	purgeFriendInvites(now)
	for _, invite := range friendInvites {
		if invite.Host == uid && invite.MatchID == "" {
			return friendJSON(invite), nil
		}
	}
	if len(friendInvites) >= 10000 {
		return "", runtime.NewError("invitation service busy", codeInvalidArgument)
	}
	var random [6]byte
	for {
		if _, err := rand.Read(random[:]); err != nil {
			return "", err
		}
		code := strings.ToUpper(hex.EncodeToString(random[:]))
		if friendInvites[code] != nil {
			continue
		}
		invite := &friendInvite{Code: code, Host: uid, ExpiresAt: now + 600}
		friendInvites[code] = invite
		return friendJSON(invite), nil
	}
}
func friendJSON(invite *friendInvite) string { out, _ := json.Marshal(invite); return string(out) }

func joinFriendInvite(ctx context.Context, nk friendBackend, uid, code string, now int64) (string, error) {
	friendMu.Lock()
	defer friendMu.Unlock()
	purgeFriendInvites(now)
	attempts := friendAttempts[uid][:0]
	for _, at := range friendAttempts[uid] {
		if at > now-60 {
			attempts = append(attempts, at)
		}
	}
	if len(attempts) >= 20 {
		return "", runtime.NewError("too many invitation attempts", codeInvalidArgument)
	}
	friendAttempts[uid] = append(attempts, now)
	invite := friendInvites[code]
	if invite == nil {
		return "", runtime.NewError("invitation not found or expired", codeNotFound)
	}
	if invite.Host == uid {
		return "", runtime.NewError("cannot join your own invitation", codeInvalidArgument)
	}
	if invite.Guest != "" {
		if invite.Guest == uid {
			return friendJSON(invite), nil
		}
		return "", runtime.NewError("invitation already used", codeInvalidArgument)
	}
	// The lock also arbitrates simultaneous joins and cancellation.
	matchID, err := nk.MatchCreate(ctx, matchModule, map[string]interface{}{
		"mode": "friend", "arena": gd().Arenas.Arenas[0].ID, "users": []interface{}{invite.Host, uid},
	})
	if err != nil {
		return "", err
	}
	invite.Guest, invite.MatchID = uid, matchID
	invite.ExpiresAt = now + 600
	return friendJSON(invite), nil
}

func rpcFriendCreate(ctx context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	return createFriendInvite(uid, time.Now().Unix())
}
func rpcFriendJoin(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	uid, code, err := friendRequest(ctx, payload)
	if err != nil {
		return "", err
	}
	return joinFriendInvite(ctx, nk, uid, code, time.Now().Unix())
}
func rpcFriendStatus(ctx context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, payload string) (string, error) {
	uid, code, err := friendRequest(ctx, payload)
	if err != nil {
		return "", err
	}
	friendMu.Lock()
	defer friendMu.Unlock()
	purgeFriendInvites(time.Now().Unix())
	invite := friendInvites[code]
	if invite == nil || (invite.Host != uid && invite.Guest != uid) {
		return "", runtime.NewError("invitation not found", codeNotFound)
	}
	return friendJSON(invite), nil
}
func rpcFriendCancel(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	uid, code, err := friendRequest(ctx, payload)
	if err != nil {
		return "", err
	}
	friendMu.Lock()
	defer friendMu.Unlock()
	invite := friendInvites[code]
	if invite == nil {
		return `{"cancelled":true}`, nil
	}
	if invite.Host != uid {
		return "", runtime.NewError("not the invitation owner", codeInvalidArgument)
	}
	if invite.MatchID != "" {
		signal, _ := json.Marshal(map[string]string{"action": "cancel_waiting", "userId": uid})
		result, err := nk.MatchSignal(ctx, invite.MatchID, string(signal))
		if err != nil {
			return "", err
		}
		var status struct {
			Cancelled bool `json:"cancelled"`
		}
		_ = json.Unmarshal([]byte(result), &status)
		if !status.Cancelled {
			return "", runtime.NewError("match already started", codeInvalidArgument)
		}
	}
	delete(friendInvites, code)
	return `{"cancelled":true}`, nil
}
