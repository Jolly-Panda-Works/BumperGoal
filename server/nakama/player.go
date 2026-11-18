package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"

	"flickkick/server/sim"
)

// Storage layout (server-owned objects have PermissionWrite = 0).
const (
	collectionPlayer = "player"
	keyProgress      = "progress" // server-owned: xp, stats
	keyLoadout       = "loadout"  // user-chosen, server-validated: team, ball, avatar
)

const (
	permNoRead    = 0
	permOwnerRead = 1
	permNoWrite   = 0
)

// gRPC-style status codes understood by Nakama clients.
const (
	codeInvalidArgument = 3
	codeNotFound        = 5
	codeInternal        = 13
	codeUnauthenticated = 16
)

type Stats struct {
	Played       int `json:"played"`
	Won          int `json:"won"`
	Lost         int `json:"lost"`
	GoalsFor     int `json:"goalsFor"`
	GoalsAgainst int `json:"goalsAgainst"`
	WinStreak    int `json:"winStreak"`
	BestStreak   int `json:"bestStreak"`
}

type Progress struct {
	WeeklyStart  int64 `json:"weeklyStart"`
	WeeklyXP     int64 `json:"weeklyXP"`
	WeeklyWins   int   `json:"weeklyWins"`
	XP           int64 `json:"xp"`
	Stats        Stats `json:"stats"`
	TutorialDone bool  `json:"tutorialDone"`
}

type Loadout struct {
	TrailID     string `json:"trailId"`
	FormationID string `json:"formationId"`
	TeamID      string `json:"teamId"`
	BallID      string `json:"ballId"`
	AvatarID    string `json:"avatarId"`
}

type ProfileResponse struct {
	OwnedTrails     []string         `json:"ownedTrails"`
	OwnedFormations []string         `json:"ownedFormations"`
	OwnedTeams      []string         `json:"ownedTeams"`
	OwnedBalls      []string         `json:"ownedBalls"`
	OwnedAvatars    []string         `json:"ownedAvatars"`
	UserID          string           `json:"userId"`
	Username        string           `json:"username"`
	PlayerCode      string           `json:"playerCode"`
	DisplayName     string           `json:"displayName"`
	Level           int              `json:"level"`
	XP              int64            `json:"xp"`
	Wallet          map[string]int64 `json:"wallet"`
	Stats           Stats            `json:"stats"`
	Loadout         Loadout          `json:"loadout"`
	Daily           DailyStatus      `json:"daily"`
	EmailLinked     bool             `json:"emailLinked"`
	SimVersion      int              `json:"simVersion"`
	ConfigRevision  int64            `json:"configRevision"`
	// LanguagesRevision changes when the admin panel adds, edits or removes a language.
	LanguagesRevision int64 `json:"languagesRevision"`
}

var displayNamePattern = regexp.MustCompile(`^[\p{L}\p{N}_ .-]{3,16}$`)

func userIDFrom(ctx context.Context) (string, error) {
	id, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || id == "" {
		return "", runtime.NewError("authentication required", codeUnauthenticated)
	}
	return id, nil
}

func afterAuthenticateDevice(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, out *api.Session, _ *api.AuthenticateDeviceRequest) error {
	return ensurePlayer(ctx, logger, nk, out)
}

func afterAuthenticateEmail(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, out *api.Session, _ *api.AuthenticateEmailRequest) error {
	return ensurePlayer(ctx, logger, nk, out)
}

// ensurePlayer creates progress, loadout and the starting wallet exactly once.
// The progress object is written with Version "*" (create only) in the same
// MultiUpdate as the wallet grant, so a retry or a second device cannot grant twice.
func ensurePlayer(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, out *api.Session) error {
	userID, err := userIDFrom(ctx)
	if err != nil {
		return err
	}
	progress, _ := json.Marshal(Progress{})
	loadout, _ := json.Marshal(Loadout{
		TeamID:      gd().Cosmetics.Default("teams"),
		BallID:      gd().Cosmetics.Default("balls"),
		FormationID: gd().Cosmetics.Default("formations"),
		AvatarID:    gd().Cosmetics.Default("avatars"),
	})
	writes := []*runtime.StorageWrite{
		{Collection: collectionPlayer, Key: keyProgress, UserID: userID, Value: string(progress), Version: "*", PermissionRead: permOwnerRead, PermissionWrite: permNoWrite},
		{Collection: collectionPlayer, Key: keyLoadout, UserID: userID, Value: string(loadout), Version: "*", PermissionRead: permOwnerRead, PermissionWrite: permNoWrite},
	}
	grant := map[string]int64{}
	for k, v := range gd().Economy.StartingBalance {
		grant[k] = v
	}
	wallet := []*runtime.WalletUpdate{{UserID: userID, Changeset: grant, Metadata: map[string]any{"reason": "starting_balance"}}}
	if _, _, err := nk.MultiUpdate(ctx, nil, writes, nil, wallet, true); err != nil {
		if isVersionConflict(err) {
			return nil // already initialised
		}
		logger.WithField("user_id", userID).WithField("error", err.Error()).Error("player init failed")
		return runtime.NewError("player init failed", codeInternal)
	}
	logger.WithFields(map[string]any{"user_id": userID, "created": out.GetCreated()}).Info("player initialised")
	return nil
}

func isVersionConflict(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "version check failed") || strings.Contains(msg, "storage write rejected")
}

func readObject[T any](ctx context.Context, nk runtime.NakamaModule, userID, key string) (T, error) {
	var v T
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionPlayer, Key: key, UserID: userID}})
	if err != nil {
		return v, err
	}
	if len(objs) == 0 {
		return v, errNotFound
	}
	err = json.Unmarshal([]byte(objs[0].GetValue()), &v)
	return v, err
}

var errNotFound = errors.New("not found")

func loadProfile(ctx context.Context, nk runtime.NakamaModule, userID string) (*ProfileResponse, error) {
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return nil, runtime.NewError("account not found", codeNotFound)
	}
	progress, err := readObject[Progress](ctx, nk, userID, keyProgress)
	if err != nil {
		return nil, runtime.NewError("profile not initialised", codeNotFound)
	}
	loadout, err := readObject[Loadout](ctx, nk, userID, keyLoadout)
	if err != nil {
		return nil, runtime.NewError("profile not initialised", codeNotFound)
	}
	loadout.TeamID = gd().Cosmetics.ResolveTeamID(loadout.TeamID)
	if !gd().Cosmetics.Exists("formations", loadout.FormationID) {
		loadout.FormationID = gd().Cosmetics.Default("formations")
	}
	wallet := map[string]int64{}
	if raw := account.GetWallet(); raw != "" {
		_ = json.Unmarshal([]byte(raw), &wallet)
	}
	playerCode, err := ensurePlayerCode(ctx, nk, userID)
	if err != nil {
		return nil, runtime.NewError("could not load player identity", codeInternal)
	}
	return &ProfileResponse{
		OwnedFormations:   ownedFormations(ctx, nk, userID),
		OwnedTrails:       ownedTrails(ctx, nk, userID),
		OwnedTeams:        ownedItems(ctx, nk, userID, "teams"),
		OwnedBalls:        ownedItems(ctx, nk, userID, "balls"),
		OwnedAvatars:      ownedItems(ctx, nk, userID, "avatars"),
		UserID:            userID,
		PlayerCode:        playerCode,
		Username:          account.GetUser().GetUsername(),
		DisplayName:       account.GetUser().GetDisplayName(),
		Level:             gd().Progression.LevelFromXP(progress.XP),
		XP:                progress.XP,
		Wallet:            wallet,
		Stats:             progress.Stats,
		Loadout:           loadout,
		Daily:             dailyStatus(ctx, nk, userID, time.Now()),
		EmailLinked:       account.GetEmail() != "",
		SimVersion:        sim.Version,
		ConfigRevision:    live.Load().revision,
		LanguagesRevision: currentLanguages().Revision,
	}, nil
}

func rpcProfileGet(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, _ string) (string, error) {
	userID, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	p, err := loadProfile(ctx, nk, userID)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(p)
	return string(out), nil
}

type profileUpdateRequest struct {
	Username    *string `json:"username"`
	DisplayName *string `json:"displayName"`
	TeamID      *string `json:"teamId"`
	BallID      *string `json:"ballId"`
	FormationID *string `json:"formationId"`
	TrailID     *string `json:"trailId"`
	AvatarID    *string `json:"avatarId"`
}

// rpcProfileUpdate validates every field server-side; cosmetics must be free
// or owned.
func rpcProfileUpdate(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req profileUpdateRequest
	if len(payload) > 1024 || json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid payload", codeInvalidArgument)
	}
	username, name := "", ""
	if req.DisplayName != nil || req.Username != nil {
		if req.DisplayName != nil {
			name = strings.TrimSpace(*req.DisplayName)
		} else {
			name = strings.TrimSpace(*req.Username)
		}
		if !utf8.ValidString(name) || !displayNamePattern.MatchString(name) {
			return "", runtime.NewError("invalid display name", codeInvalidArgument)
		}
		// One public name, with a case-insensitive unique account key. Nakama
		// usernames cannot contain spaces, so spaces share the underscore key.
		username = canonicalPlayerName(name)
		if err := nk.AccountUpdateId(ctx, userID, username, nil, name, "", "", "", ""); err != nil {
			return "", runtime.NewError("username unavailable", 6)
		}
	}
	if req.TeamID != nil || req.BallID != nil || req.AvatarID != nil || req.FormationID != nil || req.TrailID != nil {
		objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionPlayer, Key: keyLoadout, UserID: userID}})
		if err != nil || len(objs) == 0 {
			return "", runtime.NewError("profile not initialised", codeNotFound)
		}
		var loadout Loadout
		_ = json.Unmarshal([]byte(objs[0].GetValue()), &loadout)
		for _, f := range []struct {
			kind string
			val  *string
			dst  *string
		}{{"trails", req.TrailID, &loadout.TrailID}, {"formations", req.FormationID, &loadout.FormationID}, {"teams", req.TeamID, &loadout.TeamID}, {"balls", req.BallID, &loadout.BallID}, {"avatars", req.AvatarID, &loadout.AvatarID}} {
			if f.val == nil {
				continue
			}
			if f.kind == "trails" && *f.val == "" {
				*f.dst = ""
				continue
			}
			if !gd().Cosmetics.Exists(f.kind, *f.val) || !ownsItem(ctx, nk, userID, f.kind, *f.val) {
				return "", runtime.NewError("item not owned", codeInvalidArgument)
			}
			*f.dst = *f.val
		}
		value, _ := json.Marshal(loadout)
		if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
			Collection: collectionPlayer, Key: keyLoadout, UserID: userID, Value: string(value),
			Version: objs[0].GetVersion(), PermissionRead: permOwnerRead, PermissionWrite: permNoWrite,
		}}); err != nil {
			return "", runtime.NewError("profile changed concurrently, retry", codeInvalidArgument)
		}
	}
	logger.WithField("user_id", userID).Debug("profile updated")
	return rpcProfileGet(ctx, logger, nil, nk, "")
}

func rpcHealthcheck(ctx context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ string) (string, error) {
	out, _ := json.Marshal(map[string]any{"ok": true, "version": ServerVersion, "simVersion": sim.Version})
	return string(out), nil
}

func canonicalPlayerName(name string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), " ", "_"))
}
