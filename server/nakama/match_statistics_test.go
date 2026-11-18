package main

import (
	"context"
	"flickkick/server/rules"
	"flickkick/server/sim"
	"github.com/heroiclabs/nakama-common/runtime"
	"testing"
)

func TestMatchStatistics(t *testing.T) {
	stats := newMatchStatistics()
	shot := rules.Shot{IX: 3, IY: 4}
	ownGoal := true
	normal := false
	stats.recordShot(rules.L, shot, sim.Result{Outcome: "goal_right", Ticks: 120}, []rules.Event{{Type: "goal", Scorer: rules.L, OwnGoal: &normal}}, 10)
	stats.recordShot(rules.R, shot, sim.Result{Outcome: "goal_right", Ticks: 60}, []rules.Event{{Type: "goal", Scorer: rules.L, OwnGoal: &ownGoal}}, 10)
	stats.recordEvents([]rules.Event{{Type: "timeout", Side: rules.R}})
	if stats.Sides[rules.L].ScoringShots != 1 || stats.Sides[rules.L].PowerTotal != 50 || stats.Sides[rules.L].SimulationTicks != 120 {
		t.Fatal(stats.Sides[rules.L])
	}
	if stats.Sides[rules.R].OwnGoals != 1 || stats.Sides[rules.R].ScoringShots != 0 || stats.Sides[rules.R].Timeouts != 1 {
		t.Fatal(stats.Sides[rules.R])
	}
	stats.recordShot(rules.L, shot, sim.Result{Outcome: "invalid"}, nil, 10)
	if stats.Sides[rules.L].Shots != 1 {
		t.Fatal("invalid simulation counted")
	}
}

func TestHistoryDetailIsOwnerScoped(t *testing.T) {
	value := `{"matchId":"match-1"}`
	store := &identityStorage{values: map[string]string{identityKey(collectionHistory, "match-1", "owner"): value}}
	owner := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "owner")
	got, err := rpcHistoryGet(owner, nil, nil, store, `{"matchId":"match-1"}`)
	if err != nil || got != value {
		t.Fatalf("own match: %s %v", got, err)
	}
	stranger := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "other")
	if _, err := rpcHistoryGet(stranger, nil, nil, store, `{"matchId":"match-1"}`); err == nil {
		t.Fatal("another player's history was exposed")
	}
	if _, err := rpcHistoryGet(context.Background(), nil, nil, store, `{"matchId":"match-1"}`); err == nil {
		t.Fatal("unauthenticated history read")
	}
}
