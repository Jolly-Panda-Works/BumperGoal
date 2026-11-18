package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

type nopLogger struct{}

func (nopLogger) Debug(string, ...interface{})                       {}
func (nopLogger) Info(string, ...interface{})                        {}
func (nopLogger) Warn(string, ...interface{})                        {}
func (nopLogger) Error(string, ...interface{})                       {}
func (l nopLogger) WithField(string, interface{}) runtime.Logger     { return l }
func (l nopLogger) WithFields(map[string]interface{}) runtime.Logger { return l }
func (nopLogger) Fields() map[string]interface{}                     { return nil }

type fakeNk struct{ created, notified atomic.Int32 }

func (f *fakeNk) MatchCreate(context.Context, string, map[string]interface{}) (string, error) {
	f.created.Add(1)
	return "bot-match", nil
}
func (f *fakeNk) NotificationSend(context.Context, string, string, map[string]interface{}, int, string, bool) error {
	f.notified.Add(1)
	return nil
}

type presence struct{ uid string }

func (p presence) GetHidden() bool                   { return false }
func (p presence) GetPersistence() bool              { return false }
func (p presence) GetUsername() string               { return p.uid }
func (p presence) GetStatus() string                 { return "" }
func (p presence) GetReason() runtime.PresenceReason { return 0 }
func (p presence) GetUserId() string                 { return p.uid }
func (p presence) GetSessionId() string              { return "s-" + p.uid }
func (p presence) GetNodeId() string                 { return "n" }

type entry struct {
	uid, search string
}

func (e entry) GetPresence() runtime.Presence { return presence{e.uid} }
func (e entry) GetTicket() string             { return "t-" + e.uid }
func (e entry) GetProperties() map[string]interface{} {
	return map[string]interface{}{"searchId": e.search, "arena": "park"}
}
func (e entry) GetPartyId() string   { return "" }
func (e entry) GetCreateTime() int64 { return 0 }

func newSearch(uid string) *search {
	s := &search{ID: newID(), UserID: uid, Arena: "park", State: searchSearching, Created: time.Now(), timer: time.NewTimer(time.Hour)}
	mmMu.Lock()
	searches[s.ID] = s
	userSearches[uid] = s.ID
	mmMu.Unlock()
	return s
}

// The bot timer and the matchmaker race for the same search: exactly one may win.
func TestBotFallbackAndPairingNeverBothWin(t *testing.T) {
	for i := 0; i < 500; i++ {
		a, b := newSearch("a"+newID()), newSearch("b"+newID())
		nk := &fakeNk{}
		var wg sync.WaitGroup
		var paired int
		wg.Add(2)
		go func() { defer wg.Done(); botFallback(nopLogger{}, nk, a.ID) }()
		go func() {
			defer wg.Done()
			paired = len(matchmakerOverride(context.Background(), nopLogger{}, nil, nil,
				[][]runtime.MatchmakerEntry{{entry{a.UserID, a.ID}, entry{b.UserID, b.ID}}}))
		}()
		wg.Wait()
		bot := int(nk.created.Load())
		if paired+bot != 1 {
			t.Fatalf("iteration %d: paired=%d botMatches=%d (want exactly one)", i, paired, bot)
		}
		if paired == 1 && (a.State != searchMatched || b.State != searchMatched) {
			t.Fatalf("paired but states %s/%s", a.State, b.State)
		}
		if bot == 1 && (a.State != searchBotAssigned || b.State != searchSearching) {
			t.Fatalf("bot but states %s/%s", a.State, b.State)
		}
	}
}

func TestCancelledOrAssignedSearchesAreNeverPaired(t *testing.T) {
	a, b, c := newSearch("ca"), newSearch("cb"), newSearch("cc")
	a.State = searchCancelled
	got := matchmakerOverride(context.Background(), nopLogger{}, nil, nil, [][]runtime.MatchmakerEntry{
		{entry{a.UserID, a.ID}, entry{b.UserID, b.ID}},
		{entry{b.UserID, b.ID}, entry{c.UserID, c.ID}},
		{entry{c.UserID, c.ID}, entry{b.UserID, b.ID}}, // b and c already used in this batch
	})
	if len(got) != 1 || b.State != searchMatched || c.State != searchMatched {
		t.Fatalf("got %d pairs, states %s %s", len(got), b.State, c.State)
	}
	// A forged searchId owned by someone else is rejected.
	d, e := newSearch("cd"), newSearch("ce")
	if n := len(matchmakerOverride(context.Background(), nopLogger{}, nil, nil, [][]runtime.MatchmakerEntry{
		{entry{"intruder", d.ID}, entry{e.UserID, e.ID}},
	})); n != 0 {
		t.Fatal("paired a search with a presence that does not own it")
	}
	nk := &fakeNk{}
	botFallback(nopLogger{}, nk, b.ID) // already matched
	if nk.created.Load() != 0 {
		t.Fatal("bot match created for a matched search")
	}
}
