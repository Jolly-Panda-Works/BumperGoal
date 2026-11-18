package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
	"time"
)

// One immutable record per invitee arbitrates retries and competing inviters.
// Both wallet grants and this record commit in the same transaction.
func rpcReferralApply(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req struct {
		PlayerCode string `json:"playerCode"`
	}
	if len(payload) > 128 || json.Unmarshal([]byte(payload), &req) != nil || !playerCodePattern.MatchString(req.PlayerCode) {
		return "", runtime.NewError("invalid invitation code", codeInvalidArgument)
	}
	existing, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionPlayer, Key: "referral", UserID: userID}})
	if err != nil {
		return "", err
	}
	if len(existing) > 0 {
		return `{"applied":false}`, nil
	}
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: identityCodes, Key: req.PlayerCode, UserID: identityOwner}})
	if err != nil {
		return "", err
	}
	if len(objects) == 0 {
		return "", runtime.NewError("inviter not found", codeNotFound)
	}
	var inviter playerIdentity
	if json.Unmarshal([]byte(objects[0].GetValue()), &inviter) != nil || inviter.UserID == "" || inviter.UserID == userID {
		return "", runtime.NewError("invalid inviter", codeInvalidArgument)
	}
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return "", err
	}
	// Registration grace period allows a delayed first connection, not old accounts.
	if account.GetUser().GetCreateTime() == nil || time.Now().Unix()-account.GetUser().GetCreateTime().GetSeconds() > 86400 {
		return "", runtime.NewError("invitation is only available for new accounts", codeInvalidArgument)
	}
	value, _ := json.Marshal(map[string]any{"inviter": inviter.UserID, "code": req.PlayerCode, "createdAt": time.Now().Unix()})
	writes := []*runtime.StorageWrite{{Collection: collectionPlayer, Key: "referral", UserID: userID, Value: string(value), Version: "*", PermissionRead: permOwnerRead, PermissionWrite: permNoWrite}}
	wallets := []*runtime.WalletUpdate{
		{UserID: userID, Changeset: map[string]int64{"gems": 5}, Metadata: map[string]any{"reason": "referral_received", "invitee": userID}},
		{UserID: inviter.UserID, Changeset: map[string]int64{"gems": 10}, Metadata: map[string]any{"reason": "referral_invited", "invitee": userID}},
	}
	if _, _, err = nk.MultiUpdate(ctx, nil, writes, nil, wallets, true); err != nil {
		if isVersionConflict(err) {
			return `{"applied":false}`, nil
		}
		return "", err
	}
	return `{"applied":true}`, nil
}
