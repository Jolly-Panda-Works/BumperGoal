package main

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"flickkick/server/rules"
	"github.com/heroiclabs/nakama-common/runtime"
)

type friendFake struct {
	calls  int
	fail   bool
	params map[string]interface{}
}

func (f *friendFake) MatchCreate(_ context.Context, _ string, params map[string]interface{}) (string, error) {
	f.calls++
	f.params = params
	if f.fail {
		return "", errors.New("create failed")
	}
	return "friends-match", nil
}
func (f *friendFake) MatchSignal(context.Context, string, string) (string, error) {
	return `{"cancelled":true}`, nil
}
func resetFriends(t *testing.T) {
	t.Helper()
	friendInvites = map[string]*friendInvite{}
	friendAttempts = map[string][]int64{}
	t.Cleanup(func() { friendInvites = map[string]*friendInvite{}; friendAttempts = map[string][]int64{} })
}
func makeInvite(t *testing.T, host string, now int64) friendInvite {
	t.Helper()
	result, err := createFriendInvite(host, now)
	if err != nil {
		t.Fatal(err)
	}
	var invite friendInvite
	if err := json.Unmarshal([]byte(result), &invite); err != nil {
		t.Fatal(err)
	}
	return invite
}
func TestFriendInvitationsArePrivateSingleUseAndRetryable(t *testing.T) {
	useDefaultData(t)
	resetFriends(t)
	now := time.Now().Unix()
	invite := makeInvite(t, "host", now)
	if makeInvite(t, "host", now+1).Code != invite.Code {
		t.Fatal("duplicate pending invitation")
	}
	nk := &friendFake{}
	if _, err := joinFriendInvite(context.Background(), nk, "host", invite.Code, now+2); err == nil {
		t.Fatal("self join")
	}
	if _, err := joinFriendInvite(context.Background(), nk, "guest", invite.Code, now+2); err != nil {
		t.Fatal(err)
	}
	if _, err := joinFriendInvite(context.Background(), nk, "guest", invite.Code, now+3); err != nil {
		t.Fatal("retry", err)
	}
	if _, err := joinFriendInvite(context.Background(), nk, "third", invite.Code, now+3); err == nil {
		t.Fatal("third player admitted")
	}
	if nk.calls != 1 || nk.params["mode"] != "friend" {
		t.Fatal("wrong match creation", nk.calls)
	}
	users := nk.params["users"].([]interface{})
	if users[0] != "host" || users[1] != "guest" {
		t.Fatal(users)
	}
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "stranger")
	payload := `{"code":"` + invite.Code + `"}`
	if _, err := rpcFriendStatus(ctx, nil, nil, nil, payload); err == nil {
		t.Fatal("status leaked")
	}
	if _, err := rpcFriendCancel(ctx, nil, nil, nil, payload); err == nil {
		t.Fatal("stranger cancelled")
	}
}
func TestFriendInvitationExpiryAndCreationFailure(t *testing.T) {
	useDefaultData(t)
	resetFriends(t)
	invite := makeInvite(t, "host", 100)
	nk := &friendFake{fail: true}
	if _, err := joinFriendInvite(context.Background(), nk, "guest", invite.Code, 101); err == nil {
		t.Fatal("expected creation failure")
	}
	if friendInvites[invite.Code].Guest != "" {
		t.Fatal("failed creation consumed invitation")
	}
	nk.fail = false
	if _, err := joinFriendInvite(context.Background(), nk, "guest", invite.Code, 700); err == nil {
		t.Fatal("expired code admitted")
	}
	if _, err := rpcFriendCreate(context.Background(), nil, nil, nil, "{}"); err == nil {
		t.Fatal("anonymous invitation")
	}
}
func TestFriendConcurrentJoinsCreateOneMatch(t *testing.T) {
	useDefaultData(t)
	resetFriends(t)
	invite := makeInvite(t, "host", 100)
	nk := &friendFake{}
	var wg sync.WaitGroup
	for _, uid := range []string{"guest-a", "guest-b"} {
		wg.Add(1)
		go func(uid string) {
			defer wg.Done()
			_, _ = joinFriendInvite(context.Background(), nk, uid, invite.Code, 101)
		}(uid)
	}
	wg.Wait()
	if nk.calls != 1 {
		t.Fatal("multiple matches", nk.calls)
	}
}

func TestFriendHostCanCancelAndCodeCannotBeJoinedAfterwards(t *testing.T) {
	useDefaultData(t)
	resetFriends(t)
	now := time.Now().Unix()
	invite := makeInvite(t, "host", now)
	payload := `{"code":"` + invite.Code + `"}`
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "host")
	if _, err := rpcFriendStatus(ctx, nil, nil, nil, payload); err != nil {
		t.Fatal(err)
	}
	if _, err := rpcFriendCancel(ctx, nil, nil, nil, payload); err != nil {
		t.Fatal(err)
	}
	nk := &friendFake{}
	if _, err := joinFriendInvite(ctx, nk, "guest", invite.Code, now); err == nil || nk.calls != 0 {
		t.Fatal("cancelled code used")
	}
}

func TestFriendGuessingIsRateLimited(t *testing.T) {
	useDefaultData(t)
	resetFriends(t)
	invite := makeInvite(t, "host", 100)
	nk := &friendFake{}
	for i := 0; i < 20; i++ {
		_, _ = joinFriendInvite(context.Background(), nk, "guessing", "not-a-code", 101)
	}
	if _, err := joinFriendInvite(context.Background(), nk, "guessing", invite.Code, 101); err == nil || nk.calls != 0 {
		t.Fatal("unlimited attempts")
	}
	if _, err := joinFriendInvite(context.Background(), nk, "guessing", invite.Code, 162); err != nil {
		t.Fatal("rate limit never reset", err)
	}
}
func TestFriendsDoNotChargeEntryOrGrantRankedRewards(t *testing.T) {
	useDefaultData(t)
	players := [2]rules.Player{{ID: "host", Side: rules.L, TeamID: "team_volt", Level: 1}, {ID: "guest", Side: rules.R, TeamID: "team_coral", Level: 1}}
	s := &matchState{cfg: gd(), mode: "friend", arena: gd().Arenas.Arenas[0], matchRules: gd().Rules,
		st: rules.NewMatch("private", "online", players, 1, gd().Rules), sides: map[string]rules.Side{"host": rules.L, "guest": rules.R}, presences: map[string]runtime.Presence{}}
	// A nil backend would panic if these paths attempted wallet/storage writes.
	s.start(context.Background(), nopLogger{}, nil, &previewDispatcher{}, 0)
	if !s.started || s.prize() != 0 {
		t.Fatal("friend start/prize")
	}
	s.st.Result = &rules.Result{Winner: rules.L, Reason: "goals"}
	s.finalize(context.Background(), nopLogger{}, nil, &previewDispatcher{})
	if !s.finalized {
		t.Fatal("not finalized")
	}
}
