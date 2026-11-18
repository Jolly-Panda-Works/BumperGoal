package main

import (
	"context"
	"encoding/json"
	"flickkick/server/rules"
	"github.com/heroiclabs/nakama-common/runtime"
	"testing"
)

type previewDispatcher struct {
	runtime.MatchDispatcher
	sent int
}

func (d *previewDispatcher) BroadcastMessage(int64, []byte, []runtime.Presence, runtime.Presence, bool) error {
	d.sent++
	return nil
}
func TestMatchPreviewAndCancellation(t *testing.T) {
	useDefaultData(t)
	st := &matchState{sides: map[string]rules.Side{"me": rules.L}, avatars: map[rules.Side]string{rules.R: "avatar_owl"}, arena: gd().Arenas.Arenas[0], st: &rules.State{Phase: "AWAIT_SHOT", Players: [2]rules.Player{{ID: "me", Side: rules.L}, {ID: "opponent", Side: rules.R, DisplayName: "Real rival", Level: 7}}}}
	m := &Match{}
	_, result := m.MatchSignal(context.Background(), nil, nil, nil, nil, 0, st, `{"action":"preview","userId":"stranger"}`)
	if result != "" {
		t.Fatal("private match preview leaked")
	}
	_, result = m.MatchSignal(context.Background(), nil, nil, nil, nil, 0, st, `{"action":"preview","userId":"me"}`)
	var preview struct {
		Opponent matchPreviewPlayer `json:"opponent"`
		EntryFee int64              `json:"entryFee"`
	}
	if json.Unmarshal([]byte(result), &preview) != nil || preview.Opponent.Name != "Real rival" || preview.Opponent.AvatarID != "avatar_owl" {
		t.Fatal(result)
	}
	if st.started || st.aborted {
		t.Fatal("preview changed match lifecycle")
	}
	st.started = true
	_, result = m.MatchSignal(context.Background(), nil, nil, nil, nil, 0, st, `{"action":"cancel_waiting","userId":"me"}`)
	if result != `{"cancelled":false}` || st.aborted {
		t.Fatal("started match cancelled")
	}
	st.started = false
	d := &previewDispatcher{}
	_, result = m.MatchSignal(context.Background(), nil, nil, nil, d, 0, st, `{"action":"cancel_waiting","userId":"me"}`)
	if result != `{"cancelled":true}` || !st.aborted || d.sent != 1 {
		t.Fatal("waiting match not cancelled")
	}
}
func TestCancelDuringMatchCreation(t *testing.T) {
	s := newSearch("cancel-create")
	s.State = searchBotAssigned
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, s.UserID)
	_, err := rpcMatchmakingCancel(ctx, nopLogger{}, nil, nil, `{"searchId":"`+s.ID+`"}`)
	if err != nil || s.State != searchCancelled {
		t.Fatal("in-flight assignment not cancelled", err)
	}
}

type delayedMatchNk struct {
	fakeNk
	entered chan struct{}
	release chan struct{}
	signals int
}

func (n *delayedMatchNk) MatchCreate(context.Context, string, map[string]interface{}) (string, error) {
	close(n.entered)
	<-n.release
	return "delayed", nil
}
func (n *delayedMatchNk) MatchSignal(context.Context, string, string) (string, error) {
	n.signals++
	return `{"cancelled":true}`, nil
}
func TestCancelWhileBotMatchIsBeingCreated(t *testing.T) {
	s := newSearch("cancel-bot-create")
	nk := &delayedMatchNk{entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() { botFallback(nopLogger{}, nk, s.ID); close(done) }()
	<-nk.entered
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, s.UserID)
	if _, err := rpcMatchmakingCancel(ctx, nopLogger{}, nil, nil, `{"searchId":"`+s.ID+`"}`); err != nil {
		t.Fatal(err)
	}
	close(nk.release)
	<-done
	if nk.signals != 1 || nk.notified.Load() != 0 || s.State != searchCancelled {
		t.Fatal("cancelled bot assignment was published")
	}
}
