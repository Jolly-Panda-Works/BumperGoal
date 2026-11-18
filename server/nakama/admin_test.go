package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"

	"flickkick/server/gamedata"
)

// versionedStorage is a storage fake with Nakama's optimistic version checks.
type versionedStorage struct {
	runtime.NakamaModule
	mu      sync.Mutex
	objects map[string]*api.StorageObject
	seq     int
}

func (s *versionedStorage) StorageRead(_ context.Context, reads []*runtime.StorageRead) ([]*api.StorageObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []*api.StorageObject{}
	for _, r := range reads {
		if o, ok := s.objects[identityKey(r.Collection, r.Key, r.UserID)]; ok {
			out = append(out, o)
		}
	}
	return out, nil
}

func (s *versionedStorage) StorageWrite(_ context.Context, writes []*runtime.StorageWrite) ([]*api.StorageObjectAck, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range writes {
		cur, exists := s.objects[identityKey(w.Collection, w.Key, w.UserID)]
		if (w.Version == "*" && exists) || (w.Version != "" && w.Version != "*" && (!exists || cur.Version != w.Version)) {
			return nil, errors.New("Storage write rejected - version check failed.")
		}
	}
	for _, w := range writes {
		s.seq++
		s.objects[identityKey(w.Collection, w.Key, w.UserID)] = &api.StorageObject{
			Collection: w.Collection, Key: w.Key, UserId: w.UserID, Value: w.Value, Version: strconv.Itoa(s.seq),
		}
	}
	return nil, nil
}

func newVersionedStorage() *versionedStorage {
	return &versionedStorage{objects: map[string]*api.StorageObject{}}
}

func withAdmin(t *testing.T) {
	t.Helper()
	configureAdmin(map[string]string{"ADMIN_USERNAME": "ops", "ADMIN_PASSWORD": "correct horse battery"}, nil)
	t.Cleanup(func() {
		configureAdmin(nil, nil)
		admin.failures = nil
	})
}

func userCtx() context.Context {
	return context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "admin-device")
}

func TestAdminDisabledWithoutStrongCredentials(t *testing.T) {
	for _, env := range []map[string]string{
		{},
		{"ADMIN_USERNAME": "ops"},
		{"ADMIN_USERNAME": "ops", "ADMIN_PASSWORD": "short"},
		{"ADMIN_USERNAME": " ", "ADMIN_PASSWORD": "long enough password"},
	} {
		configureAdmin(env, nil)
		if err := adminCheckCredentials(env["ADMIN_USERNAME"], env["ADMIN_PASSWORD"], time.Now()); err == nil {
			t.Fatalf("admin enabled with %v", env)
		}
		if adminTokenValid(adminSign(time.Now().Add(time.Hour).Unix()), time.Now()) {
			t.Fatal("token accepted while disabled")
		}
	}
}

func TestAdminTokens(t *testing.T) {
	withAdmin(t)
	now := time.Now()
	token := adminSign(now.Add(time.Hour).Unix())
	if !adminTokenValid(token, now) {
		t.Fatal("fresh token rejected")
	}
	if adminTokenValid(token, now.Add(2*time.Hour)) {
		t.Fatal("expired token accepted")
	}
	exp, sig, _ := strings.Cut(token, ".")
	if adminTokenValid(exp+"9."+sig, now) || adminTokenValid(exp+"."+strings.Repeat("0", len(sig)), now) || adminTokenValid("", now) {
		t.Fatal("tampered token accepted")
	}
	configureAdmin(map[string]string{"ADMIN_USERNAME": "ops", "ADMIN_PASSWORD": "a different password"}, nil)
	if adminTokenValid(token, now) {
		t.Fatal("token survived a password change")
	}
}

func TestAdminLoginRateLimit(t *testing.T) {
	withAdmin(t)
	now := time.Now()
	if adminCheckCredentials("ops", "correct horse battery", now) != nil {
		t.Fatal("valid login rejected")
	}
	for i := 0; i < adminLoginFailures; i++ {
		if adminCheckCredentials("ops", "guess", now) == nil {
			t.Fatal("wrong password accepted")
		}
	}
	if adminCheckCredentials("ops", "correct horse battery", now) == nil {
		t.Fatal("login allowed during lockout")
	}
	if adminCheckCredentials("ops", "correct horse battery", now.Add(61*time.Second)) != nil {
		t.Fatal("lockout did not expire")
	}
}

func adminCall(t *testing.T, fn func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, string) (string, error), nk runtime.NakamaModule, req map[string]any) (map[string]json.RawMessage, error) {
	t.Helper()
	payload, _ := json.Marshal(req)
	out, err := fn(userCtx(), nopLogger{}, nil, nk, string(payload))
	if err != nil {
		return nil, err
	}
	var res map[string]json.RawMessage
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		t.Fatal(err)
	}
	return res, nil
}

func TestAdminSaveSwapsLiveConfigAndAudits(t *testing.T) {
	useDefaultData(t)
	withAdmin(t)
	nk := newVersionedStorage()
	if _, err := adminCall(t, rpcAdminConfigGet, nk, map[string]any{"token": "bad"}); err == nil {
		t.Fatal("unsigned request accepted")
	}
	login, err := adminCall(t, rpcAdminLogin, nk, map[string]any{"username": "ops", "password": "correct horse battery"})
	if err != nil {
		t.Fatal(err)
	}
	var token string
	_ = json.Unmarshal(login["token"], &token)

	before := live.Load()
	overrides := map[string]any{"cosmetics/currencyPacks/@pack_coins_1/grant": map[string]int{"coins": 4321}, "rules/goalsToWin": 3}
	res, err := adminCall(t, rpcAdminConfigSet, nk, map[string]any{"token": token, "revision": 0, "overrides": overrides})
	if err != nil {
		t.Fatal(err)
	}
	if string(res["revision"]) != "1" || gd().Cosmetics.CurrencyPacks[0].Grant["coins"] != 4321 || gd().Rules.GoalsToWin != 3 {
		t.Fatalf("save not applied: %s", res["revision"])
	}
	if before.data.Rules.GoalsToWin != 2 {
		t.Fatal("the previous config version was mutated; running matches would change")
	}
	var audit []auditEntry
	_ = json.Unmarshal(res["audit"], &audit)
	if len(audit) != 1 || len(audit[0].Changes) != 2 || audit[0].By != "admin-device" {
		t.Fatalf("audit: %+v", audit)
	}

	if _, err := adminCall(t, rpcAdminConfigSet, nk, map[string]any{"token": token, "revision": 0, "overrides": map[string]any{}}); err == nil {
		t.Fatal("save from a stale revision accepted")
	}
	if _, err := adminCall(t, rpcAdminConfigSet, nk, map[string]any{"token": token, "revision": 1, "overrides": map[string]any{"arenas/houseCut": 2}}); err == nil {
		t.Fatal("invalid balance accepted")
	}
	if gd().Rules.GoalsToWin != 3 || live.Load().revision != 1 {
		t.Fatal("a rejected save changed the live config")
	}

	cfg, err := adminCall(t, rpcConfigGet, nk, map[string]any{})
	if err != nil || string(cfg["revision"]) != "1" || !strings.Contains(string(cfg["overrides"]), "4321") {
		t.Fatalf("config_get: %v %s", err, cfg["overrides"])
	}

	// A restart loads the stored overrides; reset clears them again.
	live.Store(before)
	if err := loadLiveConfig(context.Background(), nopLogger{}, nk); err != nil || gd().Rules.GoalsToWin != 3 {
		t.Fatalf("stored overrides not loaded: %v", err)
	}
	if _, err := adminCall(t, rpcAdminConfigSet, nk, map[string]any{"token": token, "revision": 1, "overrides": map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	if gd().Rules.GoalsToWin != 2 || gd().Cosmetics.CurrencyPacks[0].Grant["coins"] != 1000 {
		t.Fatal("reset did not restore defaults")
	}
}

func TestConfigGetHidesStaleOverrides(t *testing.T) {
	useDefaultData(t)
	lc, err := buildLive(gamedata.Overrides{"cosmetics/teams/@gone/price": json.RawMessage(`{"coins":1}`), "rules/maxShots": json.RawMessage(`80`)}, 4, false)
	if err != nil {
		t.Fatal(err)
	}
	live.Store(lc)
	cfg, err := adminCall(t, rpcConfigGet, newVersionedStorage(), map[string]any{})
	if err != nil || strings.Contains(string(cfg["overrides"]), "gone") || !strings.Contains(string(cfg["overrides"]), "maxShots") {
		t.Fatalf("config_get: %v %s", err, cfg["overrides"])
	}
}

func TestMatchKeepsItsConfigVersion(t *testing.T) {
	useDefaultData(t)
	s := &matchState{cfg: gd(), arena: gd().Arenas.Arenas[0]}
	prize := s.prize()
	lc, err := buildLive(gamedata.Overrides{"arenas/houseCut": json.RawMessage(`0.5`)}, 1, true)
	if err != nil {
		t.Fatal(err)
	}
	live.Store(lc)
	if s.prize() != prize || prizeFor(s.arena, gd().Arenas.HouseCut) == prize {
		t.Fatal("a running match must keep the house cut it started with")
	}
}
