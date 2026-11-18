package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
)

func ownsTrail(ctx context.Context, nk runtime.NakamaModule, uid, id string) bool {
	return ownsItem(ctx, nk, uid, "trails", id)
}
func ownedTrails(ctx context.Context, nk runtime.NakamaModule, uid string) []string {
	return ownedItems(ctx, nk, uid, "trails")
}
func rpcTrailPurchase(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		ID string `json:"id"`
	}
	if len(payload) > 256 || json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid trail", codeInvalidArgument)
	}
	return purchaseItem(ctx, nk, "trails", req.ID)
}
