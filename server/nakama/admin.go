package main

// Admin balancing: an operator signs in with ADMIN_USERNAME / ADMIN_PASSWORD
// (runtime env, never in the client) and edits game data overrides at runtime.
// Overrides live in server-owned storage; every save is validated, audited and
// swapped in as a new liveConfig. Matches keep the version they started with.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"

	"flickkick/server/gamedata"
)

const (
	collectionAdmin = "admin"
	keyBalance      = "balance"
	collectionAudit = "admin_audit"
	systemUserID    = "00000000-0000-0000-0000-000000000000"

	adminTokenTTL      = 12 * time.Hour
	adminMinPassword   = 12
	adminLoginFailures = 10 // failed logins allowed per minute, across all callers
	adminAuditShown    = 20
	adminMaxPayload    = 500000 // room for uploaded team images; see socket.max_request_size_bytes
)

var admin struct {
	username string
	password string
	key      []byte // token signing key, derived from the credentials

	mu       sync.Mutex // serialises saves and guards failures
	failures []time.Time
}

// configureAdmin enables the admin RPCs only with both credentials set and a long password.
func configureAdmin(env map[string]string, logger runtime.Logger) {
	user, pass := strings.TrimSpace(env["ADMIN_USERNAME"]), env["ADMIN_PASSWORD"]
	admin.username, admin.password, admin.key = "", "", nil
	if user == "" || len(pass) < adminMinPassword {
		if logger != nil && (user != "" || pass != "") {
			logger.Warn("admin panel disabled: ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters are required")
		}
		return
	}
	sum := sha256.Sum256([]byte("flickkick-admin\x00" + user + "\x00" + pass))
	admin.username, admin.password, admin.key = user, pass, sum[:]
}

func adminSign(exp int64) string {
	mac := hmac.New(sha256.New, admin.key)
	fmt.Fprintf(mac, "admin:%d", exp)
	return strconv.FormatInt(exp, 10) + "." + hex.EncodeToString(mac.Sum(nil))
}

func adminTokenValid(token string, now time.Time) bool {
	if admin.key == nil {
		return false
	}
	expStr, _, ok := strings.Cut(token, ".")
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if !ok || err != nil || now.Unix() >= exp {
		return false
	}
	return hmac.Equal([]byte(token), []byte(adminSign(exp)))
}

// adminCheckCredentials compares in constant time and rate-limits failed attempts.
func adminCheckCredentials(user, pass string, now time.Time) error {
	admin.mu.Lock()
	defer admin.mu.Unlock()
	recent := admin.failures[:0]
	for _, t := range admin.failures {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	admin.failures = recent
	if admin.key == nil {
		return runtime.NewError("admin panel is disabled", codeNotFound)
	}
	if len(admin.failures) >= adminLoginFailures {
		return runtime.NewError("too many attempts, wait a minute", codeUnauthenticated)
	}
	userOK := subtle.ConstantTimeCompare([]byte(user), []byte(admin.username))
	passOK := subtle.ConstantTimeCompare([]byte(pass), []byte(admin.password))
	if userOK&passOK != 1 {
		admin.failures = append(admin.failures, now)
		return runtime.NewError("wrong username or password", codeUnauthenticated)
	}
	return nil
}

type balanceDoc struct {
	Revision  int64              `json:"revision"`
	Overrides gamedata.Overrides `json:"overrides"`
	UpdatedAt int64              `json:"updatedAt"`
	UpdatedBy string             `json:"updatedBy"`
}

type auditChange struct {
	Path   string          `json:"path"`
	Before json.RawMessage `json:"before,omitempty"` // previous override; absent = default
	After  json.RawMessage `json:"after,omitempty"`  // new override; absent = back to default
}

type auditEntry struct {
	Revision int64         `json:"revision"`
	At       int64         `json:"at"`
	By       string        `json:"by"`
	Changes  []auditChange `json:"changes"`
}

func auditKey(revision int64) string { return fmt.Sprintf("r%012d", revision) }

func readBalance(ctx context.Context, nk runtime.NakamaModule) (balanceDoc, string, error) {
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionAdmin, Key: keyBalance, UserID: systemUserID}})
	if err != nil {
		return balanceDoc{}, "", err
	}
	if len(objs) == 0 {
		return balanceDoc{Overrides: gamedata.Overrides{}}, "*", nil
	}
	var doc balanceDoc
	if err := json.Unmarshal([]byte(objs[0].GetValue()), &doc); err != nil {
		return balanceDoc{}, "", err
	}
	if doc.Overrides == nil {
		doc.Overrides = gamedata.Overrides{}
	}
	return doc, objs[0].GetVersion(), nil
}

// loadLiveConfig installs the stored overrides at module start. Overrides that no
// longer validate (a release changed the defaults) are reported and left out.
func loadLiveConfig(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) error {
	defaults, err := buildLive(nil, 0, true)
	if err != nil {
		return fmt.Errorf("load gamedata: %w", err)
	}
	live.Store(defaults)
	doc, _, err := readBalance(ctx, nk)
	if err != nil {
		logger.WithField("error", err.Error()).Error("balance overrides unreadable; using defaults")
		return nil
	}
	lc, err := buildLive(doc.Overrides, doc.Revision, false)
	if err != nil {
		logger.WithField("error", err.Error()).Error("balance overrides invalid; using defaults")
		defaults.revision = doc.Revision
		return nil
	}
	if len(lc.stale) > 0 {
		logger.WithField("paths", lc.stale).Warn("balance overrides skipped: their defaults no longer exist")
	}
	live.Store(lc)
	return nil
}

// appliedOverrides leaves out stale paths, so clients only see what the server uses.
func (lc *liveConfig) appliedOverrides() gamedata.Overrides {
	out := gamedata.Overrides{}
	for p, v := range lc.overrides {
		out[p] = v
	}
	for _, p := range lc.stale {
		delete(out, p)
	}
	return out
}

// rpcConfigGet returns the effective balance for clients to layer over their bundled defaults.
func rpcConfigGet(ctx context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ string) (string, error) {
	if _, err := userIDFrom(ctx); err != nil {
		return "", err
	}
	lc := live.Load()
	out, _ := json.Marshal(map[string]any{"revision": lc.revision, "overrides": lc.appliedOverrides()})
	return string(out), nil
}

func rpcAdminLogin(ctx context.Context, logger runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, payload string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if len(payload) > 1024 || json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid login", codeInvalidArgument)
	}
	now := time.Now()
	if err := adminCheckCredentials(req.Username, req.Password, now); err != nil {
		logger.WithField("user_id", uid).Warn("admin_login_failed")
		return "", err
	}
	exp := now.Add(adminTokenTTL).Unix()
	logger.WithField("user_id", uid).Info("admin_login")
	out, _ := json.Marshal(map[string]any{"token": adminSign(exp), "expiresAt": exp})
	return string(out), nil
}

func adminState(ctx context.Context, nk runtime.NakamaModule) (string, error) {
	lc := live.Load()
	doc, _, err := readBalance(ctx, nk)
	if err != nil {
		return "", runtime.NewError("balance unavailable", codeInternal)
	}
	audit := []auditEntry{}
	if doc.Revision > 0 {
		reads := []*runtime.StorageRead{}
		for r := doc.Revision; r > 0 && r > doc.Revision-adminAuditShown; r-- {
			reads = append(reads, &runtime.StorageRead{Collection: collectionAudit, Key: auditKey(r), UserID: systemUserID})
		}
		if objs, err := nk.StorageRead(ctx, reads); err == nil {
			for _, o := range objs {
				var e auditEntry
				if json.Unmarshal([]byte(o.GetValue()), &e) == nil {
					audit = append(audit, e)
				}
			}
		}
	}
	stale := lc.stale
	if stale == nil {
		stale = []string{}
	}
	out, _ := json.Marshal(map[string]any{
		"revision": doc.Revision, "overrides": doc.Overrides, "stale": stale,
		"updatedAt": doc.UpdatedAt, "updatedBy": doc.UpdatedBy,
		"defaults": gamedata.Defaults(), "audit": audit,
	})
	return string(out), nil
}

func adminAuthorize(ctx context.Context, payload string, into any) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req struct {
		Token string `json:"token"`
	}
	if len(payload) > adminMaxPayload || json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid request", codeInvalidArgument)
	}
	if !adminTokenValid(req.Token, time.Now()) {
		return "", runtime.NewError("admin sign-in required", codeUnauthenticated)
	}
	if into != nil && json.Unmarshal([]byte(payload), into) != nil {
		return "", runtime.NewError("invalid request", codeInvalidArgument)
	}
	return uid, nil
}

func rpcAdminConfigGet(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := adminAuthorize(ctx, payload, nil); err != nil {
		return "", err
	}
	return adminState(ctx, nk)
}

func diffOverrides(before, after gamedata.Overrides) []auditChange {
	changes := []auditChange{}
	for p, v := range after {
		if old, ok := before[p]; !ok || string(old) != string(v) {
			changes = append(changes, auditChange{Path: p, Before: old, After: v})
		}
	}
	for p, v := range before {
		if _, ok := after[p]; !ok {
			changes = append(changes, auditChange{Path: p, Before: v})
		}
	}
	return changes
}

// rpcAdminConfigSet replaces the whole override set. revision must match the
// stored one, so two open panels cannot silently overwrite each other.
func rpcAdminConfigSet(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		Revision  int64              `json:"revision"`
		Overrides gamedata.Overrides `json:"overrides"`
	}
	uid, err := adminAuthorize(ctx, payload, &req)
	if err != nil {
		return "", err
	}
	if req.Overrides == nil {
		req.Overrides = gamedata.Overrides{}
	}
	admin.mu.Lock()
	defer admin.mu.Unlock()
	doc, version, err := readBalance(ctx, nk)
	if err != nil {
		return "", runtime.NewError("balance unavailable", codeInternal)
	}
	if doc.Revision != req.Revision {
		return "", runtime.NewError("balance was changed elsewhere; reload", codeInvalidArgument)
	}
	next := doc.Revision + 1
	lc, err := buildLive(req.Overrides, next, true)
	if err != nil {
		return "", runtime.NewError(err.Error(), codeInvalidArgument)
	}
	changes := diffOverrides(doc.Overrides, req.Overrides)
	now := time.Now().Unix()
	value, _ := json.Marshal(balanceDoc{Revision: next, Overrides: req.Overrides, UpdatedAt: now, UpdatedBy: uid})
	audit, _ := json.Marshal(auditEntry{Revision: next, At: now, By: uid, Changes: changes})
	writes := []*runtime.StorageWrite{
		{Collection: collectionAdmin, Key: keyBalance, UserID: systemUserID, Value: string(value), Version: version, PermissionRead: permNoRead, PermissionWrite: permNoWrite},
		{Collection: collectionAudit, Key: auditKey(next), UserID: systemUserID, Value: string(audit), Version: "*", PermissionRead: permNoRead, PermissionWrite: permNoWrite},
	}
	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		if isVersionConflict(err) {
			return "", runtime.NewError("balance was changed elsewhere; reload", codeInvalidArgument)
		}
		return "", runtime.NewError("balance save failed", codeInternal)
	}
	live.Store(lc)
	logger.WithFields(map[string]any{"user_id": uid, "revision": next, "changes": len(changes)}).Info("admin_balance_saved")
	return adminState(ctx, nk)
}
