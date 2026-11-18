package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
)

// rpcPackClaim credits a currency pack to the server wallet. Packs are test
// grants until store payments exist: no charge, one-time packs once per player.
func rpcPackClaim(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var req struct {
		ID string `json:"id"`
	}
	if len(payload) > 256 || json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid pack", codeInvalidArgument)
	}
	for _, p := range gd().Cosmetics.CurrencyPacks {
		if p.ID != req.ID {
			continue
		}
		changes := map[string]int64{}
		for currency, amount := range p.Grant {
			if amount > 0 {
				changes[currency] = amount
			}
		}
		if p.OneTime {
			applied, err := writeOnce(ctx, nk, uid, "pack:"+p.ID, map[string]string{"id": p.ID}, changes, "pack_claim")
			if err != nil {
				return "", runtime.NewError("pack claim failed", codeInvalidArgument)
			}
			if !applied {
				return "", runtime.NewError("pack already claimed", codeInvalidArgument)
			}
		} else if len(changes) > 0 {
			if _, _, err := nk.WalletUpdate(ctx, uid, changes, map[string]any{"reason": "pack_claim", "pack": p.ID}, true); err != nil {
				return "", runtime.NewError("pack claim failed", codeInvalidArgument)
			}
		}
		return rpcProfileGet(ctx, nil, nil, nk, "")
	}
	return "", runtime.NewError("unknown pack", codeInvalidArgument)
}
