package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/types/known/timestamppb"
	"sync"
	"testing"
	"time"
)

type referralStore struct {
	runtime.NakamaModule
	mu       sync.Mutex
	claimed  bool
	balances map[string]int64
	created  time.Time
	fail     bool
}

func (s *referralStore) StorageRead(_ context.Context, reads []*runtime.StorageRead) ([]*api.StorageObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if reads[0].Key == "referral" {
		if s.claimed {
			return []*api.StorageObject{{Value: `{}`}}, nil
		}
		return nil, nil
	}
	value, _ := json.Marshal(playerIdentity{UserID: "inviter", PlayerCode: "12345678"})
	return []*api.StorageObject{{Value: string(value)}}, nil
}
func (s *referralStore) AccountGetId(context.Context, string) (*api.Account, error) {
	return &api.Account{User: &api.User{CreateTime: timestamppb.New(s.created)}}, nil
}
func (s *referralStore) MultiUpdate(_ context.Context, _ []*runtime.AccountUpdate, writes []*runtime.StorageWrite, _ []*runtime.StorageDelete, wallets []*runtime.WalletUpdate, _ bool) ([]*api.StorageObjectAck, []*runtime.WalletUpdateResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return nil, nil, errors.New("database unavailable")
	}
	if s.claimed {
		return nil, nil, errors.New("storage write rejected")
	}
	if len(writes) != 1 || writes[0].Version != "*" || len(wallets) != 2 {
		panic("non-atomic referral")
	}
	s.claimed = true
	for _, w := range wallets {
		s.balances[w.UserID] += w.Changeset["gems"]
	}
	return nil, nil, nil
}
func TestReferralAtomicAndIdempotent(t *testing.T) {
	s := &referralStore{balances: map[string]int64{}, created: time.Now()}
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "invitee")
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := rpcReferralApply(ctx, nil, nil, s, `{"playerCode":"12345678"}`); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if s.balances["inviter"] != 10 || s.balances["invitee"] != 5 {
		t.Fatal(s.balances)
	}
}
func TestReferralRejectsSelfAndOldAccount(t *testing.T) {
	for _, tc := range []struct {
		id  string
		age time.Duration
	}{{"inviter", 0}, {"invitee", 48 * time.Hour}} {
		s := &referralStore{balances: map[string]int64{}, created: time.Now().Add(-tc.age)}
		ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, tc.id)
		if _, err := rpcReferralApply(ctx, nil, nil, s, `{"playerCode":"12345678"}`); err == nil {
			t.Fatal("accepted ineligible invitation")
		}
		if len(s.balances) > 0 {
			t.Fatal("granted ineligible reward")
		}
	}
}
func TestReferralFailureDoesNotGrant(t *testing.T) {
	s := &referralStore{balances: map[string]int64{}, created: time.Now(), fail: true}
	ctx := context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "invitee")
	if _, err := rpcReferralApply(ctx, nil, nil, s, `{"playerCode":"12345678"}`); err == nil {
		t.Fatal("expected failure")
	}
	if s.claimed || len(s.balances) > 0 {
		t.Fatal("partial commit")
	}
}
