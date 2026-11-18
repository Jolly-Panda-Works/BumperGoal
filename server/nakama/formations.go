package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
)

func ownsFormation(ctx context.Context, nk runtime.NakamaModule, uid, id string) bool {
	return ownsItem(ctx, nk, uid, "formations", id)
}
func ownedFormations(ctx context.Context, nk runtime.NakamaModule, uid string) []string {
	return ownedItems(ctx, nk, uid, "formations")
}
func rpcFormationPurchase(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		ID string `json:"id"`
	}
	if len(payload) > 256 || json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid formation", codeInvalidArgument)
	}
	return purchaseItem(ctx, nk, "formations", req.ID)
}
