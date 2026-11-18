package main

import (
	"context"
	"errors"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"sync"
	"testing"
)

func TestPlayerCodeFormat(t *testing.T) {
	for i := 0; i < 100; i++ {
		code, err := randomPlayerCode()
		if err != nil {
			t.Fatal(err)
		}
		if !playerCodePattern.MatchString(code) {
			t.Fatalf("invalid code %q", code)
		}
	}
}

func TestUsernameValidation(t *testing.T) {
	for _, name := range []string{"ali_123", "player1", "abc"} {
		if !usernamePattern.MatchString(name) {
			t.Fatal(name)
		}
	}
	for _, name := range []string{"ab", "Name", "player name", "../player", "very_long_player_name_over_limit"} {
		if usernamePattern.MatchString(name) {
			t.Fatal(name)
		}
	}
}

// A transactional storage fake exercises the contract used for global reservations.
type identityStorage struct {
	runtime.NakamaModule
	mu         sync.Mutex
	values     map[string]string
	rejectOnce bool
}

func identityKey(collection, key, user string) string { return collection + ":" + key + ":" + user }
func (s *identityStorage) StorageRead(_ context.Context, reads []*runtime.StorageRead) ([]*api.StorageObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := []*api.StorageObject{}
	for _, read := range reads {
		if value, ok := s.values[identityKey(read.Collection, read.Key, read.UserID)]; ok {
			result = append(result, &api.StorageObject{Value: value})
		}
	}
	return result, nil
}
func (s *identityStorage) StorageWrite(_ context.Context, writes []*runtime.StorageWrite) ([]*api.StorageObjectAck, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rejectOnce {
		s.rejectOnce = false
		return nil, errors.New("storage write rejected")
	}
	for _, write := range writes {
		if _, ok := s.values[identityKey(write.Collection, write.Key, write.UserID)]; ok {
			return nil, errors.New("storage write rejected")
		}
	}
	for _, write := range writes {
		s.values[identityKey(write.Collection, write.Key, write.UserID)] = write.Value
	}
	return nil, nil
}
func TestConcurrentIdentityReservation(t *testing.T) {
	store := &identityStorage{values: map[string]string{}, rejectOnce: true}
	var wait sync.WaitGroup
	codes := make(chan string, 24)
	for i := 0; i < 24; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			code, err := ensurePlayerCode(context.Background(), store, "same-user")
			if err != nil {
				t.Error(err)
				return
			}
			codes <- code
		}()
	}
	wait.Wait()
	close(codes)
	expected := ""
	for code := range codes {
		if expected == "" {
			expected = code
		}
		if code != expected {
			t.Errorf("identity changed: %s != %s", code, expected)
		}
	}
	if len(store.values) != 2 {
		t.Fatalf("partial or duplicate mapping: %d", len(store.values))
	}
	other, err := ensurePlayerCode(context.Background(), store, "other-user")
	if err != nil || other == expected {
		t.Fatalf("second player reservation: %s %v", other, err)
	}
}

func TestSinglePlayerNameCanonicalKey(t *testing.T) {
	for _, name := range []string{"Crafted", "crafted", " CRAFTED "} {
		if got := canonicalPlayerName(name); got != "crafted" {
			t.Fatalf("%q canonicalized to %q", name, got)
		}
	}
	if canonicalPlayerName("Ali Reza") != canonicalPlayerName("ali_reza") {
		t.Fatal("space and underscore variants must reserve the same name")
	}
	if canonicalPlayerName("یوسف") != "یوسف" {
		t.Fatal("Persian names must be preserved")
	}
}
