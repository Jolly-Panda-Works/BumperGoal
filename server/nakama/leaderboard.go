package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

const weeklyBoard = "flickkick_weekly_xp"
const allTimeBoard = "flickkick_alltime_xp"

func weekStart(now time.Time) int64 {
	u := now.UTC()
	day := time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
	return day.AddDate(0, 0, -(int(day.Weekday())+6)%7).Unix()
}

func initLeaderboards(ctx context.Context, nk runtime.NakamaModule) error {
	if err := nk.LeaderboardCreate(ctx, weeklyBoard, true, "desc", "best", "0 0 * * 1", nil, true); err != nil {
		return err
	}
	return nk.LeaderboardCreate(ctx, allTimeBoard, true, "desc", "best", "", nil, true)
}

// Absolute committed XP with the best operator makes retries idempotent.
func publishRankings(ctx context.Context, nk runtime.NakamaModule, userID string) error {
	progress, err := readObject[Progress](ctx, nk, userID, keyProgress)
	if err != nil {
		return err
	}
	loadout, err := readObject[Loadout](ctx, nk, userID, keyLoadout)
	if err != nil {
		return err
	}
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		return err
	}
	metadata := map[string]any{"name": account.GetUser().GetDisplayName(), "avatarId": loadout.AvatarID, "level": gd().Progression.LevelFromXP(progress.XP)}
	username := account.GetUser().GetUsername()
	if _, err := nk.LeaderboardRecordWrite(ctx, allTimeBoard, userID, username, progress.XP, int64(progress.Stats.Won), metadata, nil); err != nil {
		return err
	}
	if progress.WeeklyStart == weekStart(time.Now()) {
		_, err = nk.LeaderboardRecordWrite(ctx, weeklyBoard, userID, username, progress.WeeklyXP, int64(progress.WeeklyWins), metadata, nil)
	}
	return err
}

type rankingEntry struct {
	UserID   string `json:"userId"`
	Name     string `json:"name"`
	AvatarID string `json:"avatarId"`
	Level    int    `json:"level"`
	Rank     int64  `json:"rank"`
	Score    int64  `json:"score"`
}

func rpcLeaderboard(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var request struct {
		Period string `json:"period"`
	}
	if len(payload) > 128 || json.Unmarshal([]byte(payload), &request) != nil || (request.Period != "weekly" && request.Period != "allTime") {
		return "", runtime.NewError("invalid period", codeInvalidArgument)
	}
	_ = publishRankings(ctx, nk, userID)
	board := weeklyBoard
	if request.Period == "allTime" {
		board = allTimeBoard
	}
	records, owners, _, _, err := nk.LeaderboardRecordsList(ctx, board, []string{userID}, 50, "", 0)
	if err != nil {
		return "", runtime.NewError("could not load leaderboard", codeInternal)
	}
	entries := make([]rankingEntry, 0, len(records)+1)
	seen := map[string]bool{}
	for _, record := range append(records, owners...) {
		if seen[record.GetOwnerId()] {
			continue
		}
		seen[record.GetOwnerId()] = true
		entry := rankingEntry{Level: 1}
		_ = json.Unmarshal([]byte(record.GetMetadata()), &entry)
		entry.UserID, entry.Rank, entry.Score = record.GetOwnerId(), record.GetRank(), record.GetScore()
		entries = append(entries, entry)
	}
	out, _ := json.Marshal(map[string]any{"records": entries})
	return string(out), nil
}
