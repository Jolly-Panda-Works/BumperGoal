package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"math/big"
	"regexp"

	"github.com/heroiclabs/nakama-common/runtime"
)

const identityCodes = "player_codes"
const identityOwner = "00000000-0000-0000-0000-000000000000"

var usernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)
var playerCodePattern = regexp.MustCompile(`^[1-9][0-9]{7}$`)

type playerIdentity struct {
	UserID     string `json:"userId"`
	PlayerCode string `json:"playerCode"`
}

func randomPlayerCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(90000000))
	if err != nil {
		return "", err
	}
	return value.Add(value, big.NewInt(10000000)).String(), nil
}

// Both reverse and forward mappings are created in one atomic storage transaction.
// The shared system owner makes each code globally unique, while Version "*"
// arbitrates collisions and concurrent requests without custom database tables.
func ensurePlayerCode(ctx context.Context, nk runtime.NakamaModule, userID string) (string, error) {
	for attempt := 0; attempt < 32; attempt++ {
		objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionPlayer, Key: "identity", UserID: userID}})
		if err != nil {
			return "", err
		}
		if len(objects) > 0 {
			var identity playerIdentity
			if err := json.Unmarshal([]byte(objects[0].GetValue()), &identity); err != nil {
				return "", err
			}
			return identity.PlayerCode, nil
		}
		code, err := randomPlayerCode()
		if err != nil {
			return "", err
		}
		value, _ := json.Marshal(playerIdentity{UserID: userID, PlayerCode: code})
		_, err = nk.StorageWrite(ctx, []*runtime.StorageWrite{
			{Collection: collectionPlayer, Key: "identity", UserID: userID, Value: string(value), Version: "*", PermissionRead: permOwnerRead, PermissionWrite: permNoWrite},
			{Collection: identityCodes, Key: code, UserID: identityOwner, Value: string(value), Version: "*", PermissionRead: permNoRead, PermissionWrite: permNoWrite},
		})
		if err == nil {
			return code, nil
		}
		if !isVersionConflict(err) {
			return "", err
		}
	}
	return "", runtime.NewError("could not allocate player code", codeInternal)
}

// Authenticated, minimal public identity lookup for friend invitations.
func rpcPlayerLookup(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := userIDFrom(ctx); err != nil {
		return "", err
	}
	var req struct {
		PlayerCode string `json:"playerCode"`
	}
	if len(payload) > 128 || json.Unmarshal([]byte(payload), &req) != nil || !playerCodePattern.MatchString(req.PlayerCode) {
		return "", runtime.NewError("invalid player code", codeInvalidArgument)
	}
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: identityCodes, Key: req.PlayerCode, UserID: identityOwner}})
	if err != nil || len(objects) == 0 {
		return "", runtime.NewError("player not found", codeNotFound)
	}
	var identity playerIdentity
	if json.Unmarshal([]byte(objects[0].GetValue()), &identity) != nil {
		return "", runtime.NewError("player not found", codeNotFound)
	}
	userID := identity.UserID
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return "", runtime.NewError("player not found", codeNotFound)
	}
	out, _ := json.Marshal(map[string]string{"userId": userID, "playerCode": req.PlayerCode, "username": account.GetUser().GetUsername(), "displayName": account.GetUser().GetDisplayName()})
	return string(out), nil
}
