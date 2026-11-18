package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const keyDaily = "daily" // server-owned: last claimed day and position in the reward cycle

// The reward day turns over at midnight Iran time (no daylight saving since 2022).
var dailyZone = time.FixedZone("IRST", 3*3600+30*60)

type DailyState struct {
	Day   string `json:"day"`
	Index int    `json:"index"`
}

// DailyStatus is what the client shows: rewards claimed in the cycle and whether today's is taken.
type DailyStatus struct {
	Index        int  `json:"index"`
	ClaimedToday bool `json:"claimedToday"`
}

func dailyDay(t time.Time) string { return t.In(dailyZone).Format("2006-01-02") }

func readDaily(ctx context.Context, nk runtime.NakamaModule, uid string) (DailyState, string, error) {
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionPlayer, Key: keyDaily, UserID: uid}})
	if err != nil {
		return DailyState{}, "", err
	}
	if len(objs) == 0 {
		return DailyState{}, "*", nil
	}
	var state DailyState
	_ = json.Unmarshal([]byte(objs[0].GetValue()), &state)
	return state, objs[0].GetVersion(), nil
}

func dailyStatus(ctx context.Context, nk runtime.NakamaModule, uid string, now time.Time) DailyStatus {
	state, _, err := readDaily(ctx, nk, uid)
	if err != nil {
		return DailyStatus{}
	}
	return DailyStatus{Index: state.Index, ClaimedToday: state.Day == dailyDay(now)}
}

// rpcDailyClaim credits today's reward once. The day record is written with its
// read version in the same MultiUpdate as the grant, so a retry cannot pay twice.
func rpcDailyClaim(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, _ string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	rewards := gd().Economy.DailyRewards
	if len(rewards) == 0 {
		return "", runtime.NewError("no daily rewards", codeInvalidArgument)
	}
	state, version, err := readDaily(ctx, nk, uid)
	if err != nil {
		return "", runtime.NewError("daily reward unavailable", codeInternal)
	}
	today := dailyDay(time.Now())
	if state.Day == today {
		return "", runtime.NewError("daily reward already claimed", codeInvalidArgument)
	}
	index := state.Index % len(rewards)
	value, _ := json.Marshal(DailyState{Day: today, Index: index + 1})
	writes := []*runtime.StorageWrite{{
		Collection: collectionPlayer, Key: keyDaily, UserID: uid, Value: string(value),
		Version: version, PermissionRead: permOwnerRead, PermissionWrite: permNoWrite,
	}}
	changes := map[string]int64{}
	for currency, amount := range rewards[index] {
		if amount > 0 {
			changes[currency] = amount
		}
	}
	var wallets []*runtime.WalletUpdate
	if len(changes) > 0 {
		wallets = []*runtime.WalletUpdate{{UserID: uid, Changeset: changes, Metadata: map[string]any{"reason": "daily_reward", "day": today}}}
	}
	if _, _, err := nk.MultiUpdate(ctx, nil, writes, nil, wallets, true); err != nil {
		if isVersionConflict(err) {
			return "", runtime.NewError("daily reward already claimed", codeInvalidArgument)
		}
		return "", runtime.NewError("daily reward unavailable", codeInternal)
	}
	return rpcProfileGet(ctx, nil, nil, nk, "")
}
