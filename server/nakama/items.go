package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flickkick/server/gamedata"
	"github.com/heroiclabs/nakama-common/runtime"
)

// Paid cosmetics live in the ledger as "<kind>:<id>", written once with the charge.
var ledgerPrefix = map[string]string{
	"trails":     "trail:",
	"formations": "formation:",
	"teams":      "team:",
	"balls":      "ball:",
	"avatars":    "avatar:",
}

func ownsItem(ctx context.Context, nk runtime.NakamaModule, uid, kind, id string) bool {
	if !gd().Cosmetics.Exists(kind, id) {
		return false
	}
	if gd().Cosmetics.IsFree(kind, id) {
		return true
	}
	reads := []*runtime.StorageRead{{Collection: collectionLedger, Key: ledgerPrefix[kind] + id, UserID: uid}}
	if kind == "teams" {
		for old, current := range gamedata.TeamAliases {
			if current == id {
				reads = append(reads, &runtime.StorageRead{Collection: collectionLedger, Key: ledgerPrefix[kind] + old, UserID: uid})
			}
		}
	}
	objects, err := nk.StorageRead(ctx, reads)
	return err == nil && len(objects) > 0
}

func ownedItems(ctx context.Context, nk runtime.NakamaModule, uid, kind string) []string {
	owned := []string{}
	reads := []*runtime.StorageRead{}
	for _, item := range gd().Cosmetics.List(kind) {
		if len(item.Price) == 0 {
			owned = append(owned, item.ID)
		} else {
			reads = append(reads, &runtime.StorageRead{Collection: collectionLedger, Key: ledgerPrefix[kind] + item.ID, UserID: uid})
		}
	}
	if len(reads) == 0 {
		return owned
	}
	if kind == "teams" {
		for old, current := range gamedata.TeamAliases {
			if !gd().Cosmetics.IsFree("teams", current) {
				reads = append(reads, &runtime.StorageRead{Collection: collectionLedger, Key: ledgerPrefix[kind] + old, UserID: uid})
			}
		}
	}
	objects, err := nk.StorageRead(ctx, reads)
	if err == nil {
		for _, obj := range objects {
			var item struct {
				ID string `json:"id"`
			}
			if json.Unmarshal([]byte(obj.Value), &item) == nil {
				if kind == "teams" {
					item.ID = gamedata.LegacyTeamID(item.ID)
				}
				if gd().Cosmetics.Exists(kind, item.ID) {
					found := false
					for _, id := range owned {
						if id == item.ID {
							found = true
						}
					}
					if !found {
						owned = append(owned, item.ID)
					}
				}
			}
		}
	}
	return owned
}

// purchaseItem charges the wallet and records ownership in one write; buying twice is a no-op.
func purchaseItem(ctx context.Context, nk runtime.NakamaModule, kind, id string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	if _, ok := ledgerPrefix[kind]; !ok {
		return "", runtime.NewError("unknown item kind", codeInvalidArgument)
	}
	for _, item := range gd().Cosmetics.List(kind) {
		if item.ID != id {
			continue
		}
		if len(item.Price) > 0 && !ownsItem(ctx, nk, uid, kind, id) {
			changes := map[string]int64{}
			for currency, amount := range item.Price {
				changes[currency] = -amount
			}
			if _, err := writeOnce(ctx, nk, uid, ledgerPrefix[kind]+id, map[string]string{"id": id}, changes, kind+"_purchase"); err != nil {
				return "", runtime.NewError("purchase failed or insufficient balance", codeInvalidArgument)
			}
		}
		return rpcProfileGet(ctx, nil, nil, nk, "")
	}
	return "", runtime.NewError("unknown item", codeInvalidArgument)
}

func rpcItemPurchase(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		Kind string `json:"kind"`
		ID   string `json:"id"`
	}
	if len(payload) > 256 || json.Unmarshal([]byte(payload), &req) != nil {
		return "", runtime.NewError("invalid item", codeInvalidArgument)
	}
	return purchaseItem(ctx, nk, req.Kind, req.ID)
}
