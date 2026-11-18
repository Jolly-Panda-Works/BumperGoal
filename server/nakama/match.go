package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"math"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"

	"flickkick/server/ai"
	"flickkick/server/gamedata"
	"flickkick/server/rules"
	"flickkick/server/sim"
)

// Match protocol v1 (ARCHITECTURE §3.4, §5). JSON payloads.
const (
	OpShot         = 1 // client → server: {seq, discIndex, ix, iy}
	OpShotResolved = 2 // server → clients
	OpStateSync    = 3 // server → client(s): full state, sent on (re)join and after a rejection
	OpEnded        = 4 // server → each client: result + that player's rewards
	OpReject       = 5 // server → sender: {reason, seq}
	OpForfeit      = 6 // client → server
)

const (
	matchModule     = "flickkick_1v1"
	tickRate        = 10
	joinTimeoutSec  = 20
	disconnectGrace = 30
	endLingerSec    = 5
	maxPayloadBytes = 512
)

type botTurn struct {
	shot rules.Shot
	err  error
	seq  int
}

type matchState struct {
	trailIDs    map[rules.Side]string
	matchRules  gamedata.Rules
	cfg         *gamedata.Data // config version the match was created with
	engine      *sim.Engine
	avatars     map[rules.Side]string
	statistics  MatchStatistics
	startedAtMs int64
	st          *rules.State
	physics     sim.Config
	sim         *sim.Sim
	aiSim       *sim.Sim
	arena       gamedata.Arena
	mode        string // "ranked" | "bot"

	sides        map[string]rules.Side // userID → side (humans only)
	presences    map[string]runtime.Presence
	disconnected map[string]int64 // userID → tick
	started      bool
	aborted      bool
	createdTick  int64
	turnStart    int64 // tick when the current turn becomes playable (after animations)
	deadline     int64 // tick when the current turn times out
	endTick      int64
	finalized    bool
	botProfile   gamedata.AIProfile
	botResult    chan botTurn
	botBusySeq   int
	logger       runtime.Logger
	voice        *voiceService
	voiceOpen    bool
	voiceClosed  bool
}

type Match struct{}

func newMatch(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule) (runtime.Match, error) {
	return &Match{}, nil
}

func randomSeed() uint32 {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return binary.LittleEndian.Uint32(b[:])
}

func (m *Match) MatchInit(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	mode, _ := params["mode"].(string)
	arenaID, _ := params["arena"].(string)
	usersRaw, _ := params["users"].([]interface{})
	matchID, _ := ctx.Value(runtime.RUNTIME_CTX_MATCH_ID).(string)
	lc := live.Load() // the match keeps this config version to the end
	d := lc.data
	arena, ok := findArena(d, arenaID)
	if !ok || (mode != "ranked" && mode != "bot" && mode != "friend") || ((mode == "ranked" || mode == "friend") && len(usersRaw) != 2) || (mode == "bot" && len(usersRaw) != 1) {
		logger.WithField("params", params).Error("invalid match params")
		return nil, 0, ""
	}
	users := make([]string, len(usersRaw))
	for i, u := range usersRaw {
		users[i], _ = u.(string)
	}

	matchRules := d.Rules
	matchRules.OpponentFormation = d.Rules.Formation
	trailIDs := map[rules.Side]string{}
	avatars := map[rules.Side]string{}
	var players [2]rules.Player
	sides := map[string]rules.Side{}
	for i, uid := range users {
		players[i] = playerInfo(ctx, nk, uid)
		loadout, _ := readObject[Loadout](ctx, nk, uid, keyLoadout)
		avatars[[]rules.Side{rules.L, rules.R}[i]] = loadout.AvatarID
		if ownsTrail(ctx, nk, uid, loadout.TrailID) {
			trailIDs[[]rules.Side{rules.L, rules.R}[i]] = loadout.TrailID
		}
		for _, f := range d.Cosmetics.Formations {
			if f.ID == loadout.FormationID && len(f.Positions) == d.Rules.DiscsPerTeam && ownsFormation(ctx, nk, uid, f.ID) {
				if i == 0 {
					matchRules.Formation = f.Positions
				} else {
					matchRules.OpponentFormation = f.Positions
				}
			}
		}
		sides[uid] = []rules.Side{rules.L, rules.R}[i]
	}
	var botProfile gamedata.AIProfile
	if mode == "bot" {
		botProfile = ai.ProfileForLevel(players[0].Level, d.AIProfiles)
		team := d.Cosmetics.Default("teams")
		if len(d.Cosmetics.Teams) > 0 {
			team = d.Cosmetics.Teams[int(randomSeed())%len(d.Cosmetics.Teams)].ID
		}
		players[1] = rules.Player{ID: "bot:" + botProfile.ID, DisplayName: []string{"Nova", "Atlas", "Blaze", "Orion", "Rio", "Sky"}[int(randomSeed())%6], Level: players[0].Level, TeamID: team, IsBot: true}
	}
	if players[0].TeamID == players[1].TeamID {
		for _, t := range d.Cosmetics.Teams {
			if len(t.Price) == 0 && t.ID != players[0].TeamID {
				players[1].TeamID = t.ID
				break
			}
		}
	}
	matchMode := "online"
	if mode == "bot" {
		matchMode = "online_bot"
	}

	s, err := lc.engine.NewSim(context.Background())
	if err != nil {
		logger.WithField("error", err.Error()).Error("sim init failed")
		return nil, 0, ""
	}
	if mode == "bot" {
		avatars[rules.R] = "bot"
		if len(d.Cosmetics.Avatars) > 0 {
			avatars[rules.R] = d.Cosmetics.Avatars[int(randomSeed())%len(d.Cosmetics.Avatars)].ID
		}
	}
	for i, p := range players {
		a, _ := d.Cosmetics.TeamAttributes(p.TeamID)
		matchRules.CarMassScales[i] = .7 + .06*float64(a.Weight)
	}
	state := &matchState{
		trailIDs:     trailIDs,
		matchRules:   matchRules,
		avatars:      avatars,
		st:           rules.NewMatch(matchID, matchMode, players, randomSeed(), matchRules),
		cfg:          d,
		engine:       lc.engine,
		physics:      lc.physics,
		sim:          s,
		arena:        arena,
		mode:         mode,
		sides:        sides,
		presences:    map[string]runtime.Presence{},
		disconnected: map[string]int64{},
		botProfile:   botProfile,
		logger:       logger,
		voice:        currentVoice(),
	}
	label, _ := json.Marshal(map[string]any{"mode": mode, "arena": arena.ID, "users": users})
	logger.WithFields(map[string]any{"match_id": matchID, "mode": mode, "arena": arena.ID, "users": users}).Info("match_created")
	return state, tickRate, string(label)
}

func playerInfo(ctx context.Context, nk runtime.NakamaModule, userID string) rules.Player {
	p := rules.Player{ID: userID, DisplayName: "Player", Level: 1, TeamID: gd().Cosmetics.Default("teams")}
	if acc, err := nk.AccountGetId(ctx, userID); err == nil {
		if n := acc.GetUser().GetDisplayName(); n != "" {
			p.DisplayName = n
		} else {
			p.DisplayName = acc.GetUser().GetUsername()
		}
	}
	if prog, err := readObject[Progress](ctx, nk, userID, keyProgress); err == nil {
		p.Level = gd().Progression.LevelFromXP(prog.XP)
	}
	if lo, err := readObject[Loadout](ctx, nk, userID, keyLoadout); err == nil && lo.TeamID != "" {
		p.TeamID = gd().Cosmetics.ResolveTeamID(lo.TeamID)
	}
	return p
}

func findArena(d *gamedata.Data, id string) (gamedata.Arena, bool) {
	for _, a := range d.Arenas.Arenas {
		if a.ID == id {
			return a, true
		}
	}
	return gamedata.Arena{}, false
}

func (m *Match) MatchJoinAttempt(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, presence runtime.Presence, _ map[string]string) (interface{}, bool, string) {
	s := state.(*matchState)
	if _, ok := s.sides[presence.GetUserId()]; !ok {
		return s, false, "not a player in this match"
	}
	if s.st.Phase == "ENDED" || s.aborted {
		return s, false, "match is over"
	}
	return s, true, ""
}

func (m *Match) MatchJoin(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, d runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*matchState)
	for _, p := range presences {
		uid := p.GetUserId()
		s.presences[uid] = p
		delete(s.disconnected, uid)
		if s.started {
			s.sendSync(d, tick, p) // reconnection
			logger.WithFields(map[string]any{"match_id": s.st.MatchID, "user_id": uid}).Info("player_rejoined")
		}
	}
	if !s.started && len(s.presences) == len(s.sides) {
		s.start(ctx, logger, nk, d, tick)
	}
	return s
}

// start debits entry fees (idempotent per match + user) and opens the first turn.
func (s *matchState) start(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, d runtime.MatchDispatcher, tick int64) {
	charged := []string{}
	for uid := range s.sides {
		if s.mode == "friend" {
			continue
		}
		if err := chargeEntry(ctx, nk, s.st.MatchID, uid, s.arena.EntryFee); err != nil {
			logger.WithFields(map[string]any{"match_id": s.st.MatchID, "user_id": uid, "error": err.Error()}).Warn("entry_fee_failed")
			for _, c := range charged {
				refundEntry(ctx, nk, s.st.MatchID, c, s.arena.EntryFee)
			}
			s.abort(d, "insufficient_funds")
			return
		}
		charged = append(charged, uid)
	}
	s.started = true
	s.startedAtMs = time.Now().UnixMilli()
	s.turnStart = tick
	s.deadline = tick + s.turnTicks()
	logger.WithFields(map[string]any{"match_id": s.st.MatchID, "mode": s.mode}).Info("match_started")
	s.openVoice()
	s.sendSync(d, tick, nil)
}

func (s *matchState) teamPhysics(side rules.Side) sim.Config {
	cfg := s.physics
	for _, p := range s.st.Players {
		if p.Side == side {
			cfg.MaxImpulse = s.data().Cosmetics.TeamMaxImpulse(p.TeamID, cfg.MaxImpulse)
		}
	}
	return cfg
}
func (s *matchState) turnTicks() int64 {
	ms := int64(s.data().Rules.TurnTimeMs)
	for _, p := range s.st.Players {
		if p.Side == s.st.Turn.Side {
			ms = s.data().Cosmetics.TeamTurnMs(p.TeamID, ms)
		}
	}
	return ms * tickRate / 1000
}

func (s *matchState) abort(d runtime.MatchDispatcher, reason string) {
	s.aborted = true
	s.closeVoice()
	payload, _ := json.Marshal(map[string]any{"aborted": true, "reason": reason})
	_ = d.BroadcastMessage(OpEnded, payload, nil, nil, true)
}

type syncPayload struct {
	TrailIDs map[rules.Side]string `json:"trailIds"`
	State    *rules.State          `json:"state"`
	You      rules.Side            `json:"you"`
	TurnMs   int64                 `json:"turnMs"`
	Arena    string                `json:"arena"`
	Prize    int64                 `json:"prize"`
}

func (s *matchState) remainingMs(tick int64) int64 {
	if s.st.Phase != "AWAIT_SHOT" {
		return 0
	}
	return max64(0, s.deadline-tick) * 1000 / tickRate
}

func (s *matchState) sendSync(d runtime.MatchDispatcher, tick int64, to runtime.Presence) {
	targets := []runtime.Presence{to}
	if to == nil {
		targets = nil
		for _, p := range s.presences {
			targets = append(targets, p)
		}
	}
	for _, p := range targets {
		payload, _ := json.Marshal(syncPayload{
			TrailIDs: s.trailIDs, State: s.st, You: s.sides[p.GetUserId()], TurnMs: s.remainingMs(tick),
			Arena: s.arena.ID, Prize: s.prize(),
		})
		_ = d.BroadcastMessage(OpStateSync, payload, []runtime.Presence{p}, nil, true)
	}
}

func prizeFor(a gamedata.Arena, houseCut float64) int64 {
	return int64(math.Round(float64(a.EntryFee) * 2 * (1 - houseCut)))
}

func (s *matchState) prize() int64 {
	if s.mode == "friend" {
		return 0
	}
	return prizeFor(s.arena, s.data().Arenas.HouseCut)
}

// data is the match's config version (the live one for states built in tests).
func (s *matchState) data() *gamedata.Data {
	if s.cfg != nil {
		return s.cfg
	}
	return gd()
}

func (s *matchState) simEngine() *sim.Engine {
	if s.engine != nil {
		return s.engine
	}
	return live.Load().engine
}

func (m *Match) MatchLeave(_ context.Context, logger runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, d runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*matchState)
	for _, p := range presences {
		uid := p.GetUserId()
		delete(s.presences, uid)
		s.disconnected[uid] = tick
		logger.WithFields(map[string]any{"match_id": s.st.MatchID, "user_id": uid}).Info("player_left")
	}
	if !s.started && len(s.presences) == 0 {
		s.abort(d, "players_left")
	}
	return s
}

type shotMessage struct {
	Seq       int      `json:"seq"`
	DiscIndex *int     `json:"discIndex"`
	IX        *float64 `json:"ix"`
	IY        *float64 `json:"iy"`
}

func (m *Match) MatchLoop(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, d runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	s := state.(*matchState)
	if s.createdTick == 0 {
		s.createdTick = tick
	}
	if s.aborted {
		s.cleanup()
		return nil
	}
	if !s.started {
		if tick-s.createdTick > joinTimeoutSec*tickRate {
			logger.WithField("match_id", s.st.MatchID).Info("match_join_timeout")
			s.abort(d, "join_timeout")
			s.cleanup()
			return nil
		}
		return s
	}
	if s.st.Phase == "ENDED" {
		if !s.finalized {
			s.finalize(ctx, logger, nk, d)
		}
		if tick-s.endTick > endLingerSec*tickRate {
			s.cleanup()
			return nil
		}
		return s
	}

	for _, msg := range messages {
		uid := msg.GetUserId()
		side, ok := s.sides[uid]
		if !ok {
			continue
		}
		switch msg.GetOpCode() {
		case OpShot:
			s.handleShot(logger, d, tick, msg, side)
		case OpForfeit:
			s.emit(d, tick, s.st.Forfeit(side, "forfeit_quit"), nil)
		}
		if s.st.Phase == "ENDED" {
			s.endTick = tick
			return s
		}
	}

	// Server bot: decide in a goroutine with its own sim, apply after its think time.
	if s.mode == "bot" && s.st.Turn.Side == rules.R && s.st.Phase == "AWAIT_SHOT" && tick >= s.turnStart {
		s.runBot(logger, d, tick)
	}

	if s.st.Phase == "AWAIT_SHOT" && tick > s.deadline {
		s.emit(d, tick, s.st.ApplyTimeout(), nil)
		s.turnStart = tick
		s.deadline = tick + s.turnTicks()
	}

	for uid, at := range s.disconnected {
		if tick-at > disconnectGrace*tickRate && s.st.Phase != "ENDED" {
			logger.WithFields(map[string]any{"match_id": s.st.MatchID, "user_id": uid}).Info("disconnect_forfeit")
			s.emit(d, tick, s.st.Forfeit(s.sides[uid], "forfeit_disconnect"), nil)
		}
	}
	if s.st.Phase == "ENDED" {
		s.endTick = tick
	}
	return s
}

func (s *matchState) reject(d runtime.MatchDispatcher, tick int64, to runtime.Presence, reason string, seq int) {
	s.logger.WithFields(map[string]any{"match_id": s.st.MatchID, "user_id": to.GetUserId(), "reason": reason, "seq": seq}).Info("shot_rejected")
	payload, _ := json.Marshal(map[string]any{"reason": reason, "seq": seq})
	_ = d.BroadcastMessage(OpReject, payload, []runtime.Presence{to}, nil, true)
	s.sendSync(d, tick, to)
}

func (s *matchState) handleShot(logger runtime.Logger, d runtime.MatchDispatcher, tick int64, msg runtime.MatchData, side rules.Side) {
	var m shotMessage
	if len(msg.GetData()) > maxPayloadBytes || json.Unmarshal(msg.GetData(), &m) != nil || m.DiscIndex == nil || m.IX == nil || m.IY == nil {
		s.reject(d, tick, msg, "bad_payload", m.Seq)
		return
	}
	if tick < s.turnStart {
		s.reject(d, tick, msg, "not_awaiting_shot", m.Seq)
		return
	}
	shot := rules.Shot{Seq: m.Seq, DiscIndex: *m.DiscIndex, IX: float32(*m.IX), IY: float32(*m.IY)}
	if reason := s.st.ValidateShot(side, shot, s.teamPhysics(side)); reason != "" {
		s.reject(d, tick, msg, reason, m.Seq)
		return
	}
	s.applyShot(d, tick, side, shot)
	logger.WithFields(map[string]any{"match_id": s.st.MatchID, "side": side, "seq": shot.Seq}).Debug("shot_applied")
}

func (s *matchState) applyShot(d runtime.MatchDispatcher, tick int64, side rules.Side, shot rules.Shot) {
	preHash := s.st.StateHash
	res, err := s.sim.SimulateShot(s.st.Bodies, sim.Impulse{BodyIndex: shot.DiscIndex, IX: shot.IX, IY: shot.IY}, 0)
	if err != nil {
		res = sim.Result{Outcome: "invalid", Bodies: s.st.Bodies, Hash: s.st.StateHash}
	}
	events := s.st.ApplyShotResult(side, shot, res, s.matchRules)
	s.statistics.recordShot(side, shot, res, events, s.teamPhysics(side).MaxImpulse)
	// Next turn opens after the clients' playback (+ goal celebration).
	animation := int64(math.Ceil(float64(res.Ticks)/60*tickRate)) + 2
	for _, e := range events {
		if e.Type == "goal" {
			animation += 2 * tickRate
		}
	}
	s.turnStart = tick + animation
	s.deadline = s.turnStart + s.turnTicks()
	s.emit(d, tick, events, &resolved{Side: side, Shot: shot, PreHash: preHash, Outcome: res.Outcome, Ticks: res.Ticks, Hash: res.Hash})
}

type resolved struct {
	Side    rules.Side `json:"side"`
	Shot    rules.Shot `json:"shot"`
	PreHash string     `json:"preHash"`
	Outcome string     `json:"outcome"`
	Ticks   int        `json:"ticks"`
	Hash    string     `json:"hash"`
}

// emit broadcasts rules events with the authoritative state.
func (s *matchState) emit(d runtime.MatchDispatcher, tick int64, events []rules.Event, shot *resolved) {
	s.statistics.recordEvents(events)
	if len(events) == 0 && shot == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"resolved": shot, "events": events, "state": s.st, "turnMs": (max64(0, s.deadline-tick)) * 1000 / tickRate,
		"turnStartMs": max64(0, s.turnStart-tick) * 1000 / tickRate,
	})
	_ = d.BroadcastMessage(OpShotResolved, payload, nil, nil, true)
}

func (s *matchState) runBot(logger runtime.Logger, d runtime.MatchDispatcher, tick int64) {
	thinkTicks := int64(s.botProfile.ThinkTimeMs) * tickRate / 1000
	if s.botResult == nil && s.botBusySeq != s.st.Turn.Seq {
		if s.aiSim == nil {
			aiSim, err := s.simEngine().NewSim(context.Background())
			if err != nil {
				logger.WithField("error", err.Error()).Error("bot sim init failed")
				return
			}
			s.aiSim = aiSim
		}
		snapshot := *s.st
		snapshot.Bodies = append([]sim.Body(nil), s.st.Bodies...)
		ch := make(chan botTurn, 1)
		s.botResult, s.botBusySeq = ch, s.st.Turn.Seq
		go func(st rules.State, aiSim *sim.Sim, profile gamedata.AIProfile, physics sim.Config) {
			dec, err := ai.Decide(&st, rules.R, profile, aiSim, physics, st.RngSeed)
			ch <- botTurn{shot: dec.Shot, err: err, seq: st.Turn.Seq}
		}(snapshot, s.aiSim, serverProfile(s.botProfile), s.teamPhysics(rules.R))
		return
	}
	if s.botResult == nil || tick < s.turnStart+thinkTicks {
		return
	}
	select {
	case r := <-s.botResult:
		s.botResult = nil
		if r.err != nil || r.seq != s.st.Turn.Seq {
			logger.WithFields(map[string]any{"match_id": s.st.MatchID}).Warn("bot_decision_dropped")
			return // the turn timer passes the turn
		}
		if reason := s.st.ValidateShot(rules.R, r.shot, s.teamPhysics(rules.R)); reason == "" {
			s.applyShot(d, tick, rules.R, r.shot)
		}
	default:
	}
}

func (s *matchState) cleanup() {
	s.closeVoice()
	if s.sim != nil {
		_ = s.sim.Close()
		s.sim = nil
	}
	// The bot goroutine may still use aiSim; it is closed by GC of the runtime only
	// after the goroutine returns, so close it lazily from there.
	if s.aiSim != nil && s.botResult == nil {
		_ = s.aiSim.Close()
		s.aiSim = nil
	}
}

func (m *Match) MatchTerminate(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, _ int) interface{} {
	if s, ok := state.(*matchState); ok {
		s.cleanup()
	}
	return state
}

type matchPreviewPlayer struct {
	Name     string `json:"name"`
	AvatarID string `json:"avatarId"`
	Level    int    `json:"level"`
	IsBot    bool   `json:"isBot"`
}

func (m *Match) MatchSignal(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, d runtime.MatchDispatcher, _ int64, state interface{}, payload string) (interface{}, string) {
	s := state.(*matchState)
	var req struct {
		Action string `json:"action"`
		UserID string `json:"userId"`
	}
	if json.Unmarshal([]byte(payload), &req) != nil {
		return state, ""
	}
	side, ok := s.sides[req.UserID]
	if !ok {
		return state, ""
	}
	if req.Action == "cancel_waiting" {
		cancelled := !s.started
		if cancelled {
			s.abort(d, "search_cancelled")
		}
		result, _ := json.Marshal(map[string]any{"cancelled": cancelled})
		return state, string(result)
	}
	if req.Action == "voice" {
		return state, s.voiceSignal()
	}
	if req.Action != "preview" || s.aborted || s.st.Phase == "ENDED" {
		return state, ""
	}
	opponent := rules.Other(side)
	var player rules.Player
	for _, p := range s.st.Players {
		if p.Side == opponent {
			player = p
		}
	}
	result, _ := json.Marshal(map[string]any{
		"opponent": matchPreviewPlayer{Name: player.DisplayName, AvatarID: s.avatars[opponent], Level: player.Level, IsBot: player.IsBot},
		"arena":    s.arena.ID, "entryFee": s.arena.EntryFee, "prize": s.prize(), "started": s.started,
	})
	return state, string(result)
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// serverAIMaxSimulations caps bot search inside the plugin. wazero must run in
// interpreter mode in a Go plugin (~200 ms per prediction), so the full Pro/Elite
// budgets would exceed the turn timer. Level still changes aim error, power error
// and defensive weighting. Configurable with AI_SERVER_MAX_SIMULATIONS.
var serverAIMaxSimulations = 12

func serverProfile(p gamedata.AIProfile) gamedata.AIProfile {
	if p.MaxSimulations > serverAIMaxSimulations {
		p.MaxSimulations = serverAIMaxSimulations
		p.LookAhead = false
	}
	return p
}
