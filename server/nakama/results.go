package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"

	"flickkick/server/rules"
)

const (
	collectionLedger  = "ledger"  // idempotency records for currency changes (server-owned)
	collectionHistory = "history" // one object per match per player (server-owned)
)

// writeOnce performs storage writes + wallet changes in one transaction. The
// idempotency record is created with Version "*", so replaying the same
// operation (retry, duplicate message, reconnect) fails as a whole.
func writeOnce(ctx context.Context, nk runtime.NakamaModule, userID, key string, record any, changes map[string]int64, reason string, extra ...*runtime.StorageWrite) (bool, error) {
	value, _ := json.Marshal(record)
	writes := append([]*runtime.StorageWrite{{
		Collection: collectionLedger, Key: key, UserID: userID, Value: string(value),
		Version: "*", PermissionRead: permOwnerRead, PermissionWrite: permNoWrite,
	}}, extra...)
	var wallets []*runtime.WalletUpdate
	nonZero := map[string]int64{}
	for k, v := range changes {
		if v != 0 {
			nonZero[k] = v
		}
	}
	if len(nonZero) > 0 {
		wallets = []*runtime.WalletUpdate{{UserID: userID, Changeset: nonZero, Metadata: map[string]any{"reason": reason, "key": key}}}
	}
	if _, _, err := nk.MultiUpdate(ctx, nil, writes, nil, wallets, true); err != nil {
		if isVersionConflict(err) {
			return false, nil // already applied
		}
		return false, err
	}
	return true, nil
}

func chargeEntry(ctx context.Context, nk runtime.NakamaModule, matchID, userID string, fee int64) error {
	_, err := writeOnce(ctx, nk, userID, matchID+":entry", map[string]any{"matchId": matchID, "fee": fee},
		map[string]int64{"coins": -fee}, "arena_entry")
	return err
}

func refundEntry(ctx context.Context, nk runtime.NakamaModule, matchID, userID string, fee int64) {
	_, _ = writeOnce(ctx, nk, userID, matchID+":refund", map[string]any{"matchId": matchID, "fee": fee},
		map[string]int64{"coins": fee}, "arena_refund")
}

type HistoryEntry struct {
	PlayerAvatarID   string           `json:"playerAvatarId,omitempty"`
	OpponentAvatarID string           `json:"opponentAvatarId,omitempty"`
	PlayerName       string           `json:"playerName,omitempty"`
	TeamID           string           `json:"teamId,omitempty"`
	OpponentTeamID   string           `json:"opponentTeamId,omitempty"`
	PlayerSide       rules.Side       `json:"playerSide,omitempty"`
	Statistics       *MatchStatistics `json:"statistics,omitempty"`
	MatchID          string           `json:"matchId"`
	EndedAt          int64            `json:"endedAt"`
	Mode             string           `json:"mode"`
	Arena            string           `json:"arena"`
	OpponentName     string           `json:"opponentName"`
	OpponentIsBot    bool             `json:"opponentIsBot"`
	ScoreFor         int              `json:"scoreFor"`
	ScoreAgainst     int              `json:"scoreAgainst"`
	Won              bool             `json:"won"`
	Reason           string           `json:"reason"`
	Rewards          Reward           `json:"rewards"`
}

type Reward struct {
	XP          int64 `json:"xp"`
	Coins       int64 `json:"coins"`
	Gems        int64 `json:"gems"`
	Prize       int64 `json:"prize"`
	EntryFee    int64 `json:"entryFee"`
	LevelBefore int   `json:"levelBefore"`
	LevelAfter  int   `json:"levelAfter"`
}

// finalize records the result for every human exactly once and tells each
// player their own rewards. Rewards derive only from the server's state.
func (s *matchState) finalize(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, d runtime.MatchDispatcher) {
	s.finalized = true
	s.closeVoice()
	s.statistics.ensure()
	if s.startedAtMs > 0 {
		s.statistics.DurationMs = time.Now().UnixMilli() - s.startedAtMs
	}
	res := s.st.Result
	if res == nil {
		return
	}
	for uid, side := range s.sides {
		reward, err := Reward{}, error(nil)
		if s.mode != "friend" {
			reward, err = recordResult(ctx, nk, s, uid, side)
		}
		if err != nil {
			logger.WithFields(map[string]any{"match_id": s.st.MatchID, "user_id": uid, "error": err.Error()}).Error("result_record_failed")
		}
		payload, _ := json.Marshal(map[string]any{"state": s.st, "result": res, "rewards": reward, "recorded": err == nil, "statistics": s.statistics})
		if p, ok := s.presences[uid]; ok {
			_ = d.BroadcastMessage(OpEnded, payload, []runtime.Presence{p}, nil, true)
		}
	}
	logger.WithFields(map[string]any{"match_id": s.st.MatchID, "winner": res.Winner, "reason": res.Reason, "score": s.st.Score}).Info("match_ended")
}

func recordResult(ctx context.Context, nk runtime.NakamaModule, s *matchState, uid string, side rules.Side) (Reward, error) {
	won := s.st.Result.Winner == side
	opp := s.st.PlayerOf(rules.Other(side))
	goals := s.st.Score.Get(side)
	for attempt := 0; attempt < 3; attempt++ {
		objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionPlayer, Key: keyProgress, UserID: uid}})
		if err != nil || len(objs) == 0 {
			return Reward{}, fmt.Errorf("progress missing: %v", err)
		}
		var prog Progress
		_ = json.Unmarshal([]byte(objs[0].GetValue()), &prog)
		before := s.data().Progression.LevelFromXP(prog.XP)
		xp := rules.MatchXP(won, goals, s.arena.XPMultiplier, s.data().Progression)
		prog.XP += xp
		start := weekStart(time.Now())
		if prog.WeeklyStart != start {
			prog.WeeklyStart, prog.WeeklyXP, prog.WeeklyWins = start, 0, 0
		}
		prog.WeeklyXP += xp
		if won {
			prog.WeeklyWins++
		}
		after := s.data().Progression.LevelFromXP(prog.XP)
		lvlCoins, lvlGems := rules.LevelUpRewards(before, after, s.data().Progression)
		prize := int64(0)
		if won {
			prize = s.prize()
		}
		st := &prog.Stats
		st.Played++
		st.GoalsFor += goals
		st.GoalsAgainst += s.st.Score.Get(rules.Other(side))
		if won {
			st.Won++
			st.WinStreak++
			if st.WinStreak > st.BestStreak {
				st.BestStreak = st.WinStreak
			}
		} else {
			st.Lost++
			st.WinStreak = 0
		}
		reward := Reward{XP: xp, Coins: prize + lvlCoins, Gems: lvlGems, Prize: prize, EntryFee: s.arena.EntryFee, LevelBefore: before, LevelAfter: after}
		entry := HistoryEntry{
			PlayerAvatarID: s.avatars[side], OpponentAvatarID: s.avatars[rules.Other(side)],
			PlayerName: s.st.PlayerOf(side).DisplayName, TeamID: s.st.PlayerOf(side).TeamID, OpponentTeamID: opp.TeamID, PlayerSide: side, Statistics: &s.statistics,
			MatchID: s.st.MatchID, EndedAt: time.Now().Unix(), Mode: s.st.Mode, Arena: s.arena.ID,
			OpponentName: opp.DisplayName, OpponentIsBot: opp.IsBot,
			ScoreFor: goals, ScoreAgainst: s.st.Score.Get(rules.Other(side)), Won: won, Reason: s.st.Result.Reason, Rewards: reward,
		}
		progValue, _ := json.Marshal(prog)
		histValue, _ := json.Marshal(entry)
		applied, err := writeOnce(ctx, nk, uid, s.st.MatchID+":result", map[string]any{"matchId": s.st.MatchID, "rewards": reward},
			map[string]int64{"coins": reward.Coins, "gems": reward.Gems}, "match_reward",
			&runtime.StorageWrite{Collection: collectionPlayer, Key: keyProgress, UserID: uid, Value: string(progValue),
				Version: objs[0].GetVersion(), PermissionRead: permOwnerRead, PermissionWrite: permNoWrite},
			&runtime.StorageWrite{Collection: collectionHistory, Key: s.st.MatchID, UserID: uid, Value: string(histValue),
				Version: "*", PermissionRead: permOwnerRead, PermissionWrite: permNoWrite},
		)
		if err != nil {
			return Reward{}, err
		}
		if applied {
			_ = publishRankings(ctx, nk, uid)
			return reward, nil
		}
		// Conflict: either already recorded (idempotent replay) or progress changed concurrently.
		if prev, err := readLedger(ctx, nk, uid, s.st.MatchID+":result"); err == nil {
			_ = publishRankings(ctx, nk, uid)
			return prev, nil
		}
	}
	return Reward{}, errors.New("could not record result after retries")
}

func readLedger(ctx context.Context, nk runtime.NakamaModule, uid, key string) (Reward, error) {
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionLedger, Key: key, UserID: uid}})
	if err != nil || len(objs) == 0 {
		return Reward{}, errNotFound
	}
	var rec struct {
		Rewards Reward `json:"rewards"`
	}
	err = json.Unmarshal([]byte(objs[0].GetValue()), &rec)
	return rec.Rewards, err
}

// rpcHistoryList returns the caller's most recent online matches (newest first).
func rpcHistoryList(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, _ string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	objs, _, err := nk.StorageList(ctx, "", uid, collectionHistory, 100, "")
	if err != nil {
		return "", runtime.NewError("could not read history", codeInternal)
	}
	entries := make([]HistoryEntry, 0, len(objs))
	for _, o := range objs {
		var e HistoryEntry
		if json.Unmarshal([]byte(o.GetValue()), &e) == nil {
			entries = append(entries, e)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].EndedAt > entries[j].EndedAt })
	out, _ := json.Marshal(map[string]any{"entries": entries})
	return string(out), nil
}

// Reads a single match owned by the authenticated player, including older records.
func rpcHistoryGet(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	uid, err := userIDFrom(ctx)
	if err != nil {
		return "", err
	}
	var request struct {
		MatchID string `json:"matchId"`
	}
	if len(payload) > 512 || json.Unmarshal([]byte(payload), &request) != nil || len(request.MatchID) == 0 || len(request.MatchID) > 128 {
		return "", runtime.NewError("invalid match id", codeInvalidArgument)
	}
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionHistory, Key: request.MatchID, UserID: uid}})
	if err != nil || len(objects) == 0 {
		return "", runtime.NewError("match not found", codeNotFound)
	}
	return objects[0].GetValue(), nil
}
