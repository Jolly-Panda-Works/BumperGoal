// Package rules is the Go twin of packages/rules/src/match.ts. JSON field
// names match the TypeScript MatchState so the server can send its state to
// clients as-is. Shared vectors (packages/rules/test/vectors.json) keep the
// two implementations in lockstep.
package rules

import (
	"math"

	"flickkick/server/gamedata"
	"flickkick/server/sim"
)

const ProtocolVersion = 1

type Side string

const (
	L Side = "L"
	R Side = "R"
)

func Other(s Side) Side {
	if s == L {
		return R
	}
	return L
}

type Player struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Level       int    `json:"level"`
	TeamID      string `json:"teamId"`
	IsBot       bool   `json:"isBot"`
	Side        Side   `json:"side"`
}

type Shot struct {
	Seq       int     `json:"seq"`
	DiscIndex int     `json:"discIndex"`
	IX        float32 `json:"ix"`
	IY        float32 `json:"iy"`
}

type Turn struct {
	Index int  `json:"index"`
	Side  Side `json:"side"`
	Seq   int  `json:"seq"`
}

type Score struct {
	L int `json:"L"`
	R int `json:"R"`
}

func (s Score) Get(side Side) int {
	if side == L {
		return s.L
	}
	return s.R
}

func (s *Score) Add(side Side, n int) {
	if side == L {
		s.L += n
	} else {
		s.R += n
	}
}

type Result struct {
	Winner Side   `json:"winner"`
	Reason string `json:"reason"`
}

type State struct {
	ProtocolVersion     int        `json:"protocolVersion"`
	SimVersion          int        `json:"simVersion"`
	MatchID             string     `json:"matchId"`
	Mode                string     `json:"mode"`
	Players             [2]Player  `json:"players"`
	Phase               string     `json:"phase"` // AWAIT_SHOT | SIMULATING | ENDED
	Turn                Turn       `json:"turn"`
	Bodies              []sim.Body `json:"bodies"`
	DiscsPerTeam        int        `json:"discsPerTeam"`
	Score               Score      `json:"score"`
	GoalsToWin          int        `json:"goalsToWin"`
	ShotCount           int        `json:"shotCount"`
	MaxShots            int        `json:"maxShots"`
	SuddenDeath         bool       `json:"suddenDeath"`
	ConsecutiveTimeouts Score      `json:"consecutiveTimeouts"`
	TimeoutForfeitCount int        `json:"timeoutForfeitCount"`
	RngSeed             uint32     `json:"rngSeed"`
	Result              *Result    `json:"result"`
	StateHash           string     `json:"stateHash"`
}

// Event mirrors the MatchEvent union in packages/rules/src/types.ts.
type Event struct {
	Type        string  `json:"type"`
	Side        Side    `json:"side,omitempty"`
	Shot        *Shot   `json:"shot,omitempty"`
	Scorer      Side    `json:"scorer,omitempty"`
	OwnGoal     *bool   `json:"ownGoal,omitempty"`
	Score       *Score  `json:"score,omitempty"`
	Index       *int    `json:"index,omitempty"`
	Consecutive int     `json:"consecutive,omitempty"`
	Result      *Result `json:"result,omitempty"`
}

// Rng is mulberry32, identical to packages/rules/src/rng.ts.
type Rng struct{ state uint32 }

func NewRng(seed uint32) *Rng { return &Rng{state: seed} }

func (r *Rng) Next() float64 {
	r.state += 0x6d2b79f5
	t := r.state
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return float64(t^(t>>14)) / 4294967296
}

func (r *Rng) Gaussian() float64 {
	u := math.Max(r.Next(), 1e-12)
	v := r.Next()
	return math.Sqrt(-2*math.Log(u)) * math.Cos(2*math.Pi*v)
}

// MixSeed mirrors mixSeed in rng.ts.
func MixSeed(a, b uint32) uint32 {
	h := a ^ (b * 0x9e3779b1)
	h = (h ^ (h >> 16)) * 0x85ebca6b
	h = (h ^ (h >> 13)) * 0xc2b2ae35
	return h ^ (h >> 16)
}

func KickoffBodies(r gamedata.Rules) []sim.Body {
	n := r.DiscsPerTeam
	bodies := make([]sim.Body, 0, 2*n+1)
	for i := 0; i < n; i++ {
		bodies = append(bodies, sim.Body{Kind: "disc", X: float32(r.Formation[i][0]), Y: float32(r.Formation[i][1]), Angle: 0})
	}
	opponent := r.OpponentFormation
	if len(opponent) != n {
		opponent = r.Formation
	}
	for i := 0; i < n; i++ {
		bodies = append(bodies, sim.Body{Kind: "disc", X: -float32(opponent[i][0]), Y: float32(opponent[i][1]), Angle: float32(math.Pi)})
	}
	return append(bodies, sim.Body{Kind: "ball", X: 0, Y: 0})
}

func NewMatch(matchID, mode string, players [2]Player, seed uint32, r gamedata.Rules) *State {
	bodies := KickoffBodies(r)
	first := R
	if NewRng(seed).Next() < 0.5 {
		first = L
	}
	players[0].Side, players[1].Side = L, R
	return &State{
		ProtocolVersion:     ProtocolVersion,
		SimVersion:          sim.Version,
		MatchID:             matchID,
		Mode:                mode,
		Players:             players,
		Phase:               "AWAIT_SHOT",
		Turn:                Turn{Index: 0, Side: first, Seq: 1},
		Bodies:              bodies,
		DiscsPerTeam:        r.DiscsPerTeam,
		GoalsToWin:          r.GoalsToWin,
		MaxShots:            r.MaxShots,
		TimeoutForfeitCount: r.TimeoutForfeitCount,
		RngSeed:             seed,
		StateHash:           sim.HashBodies(bodies),
	}
}

func (s *State) DiscOwner(index int) (Side, bool) {
	switch {
	case index < 0:
		return "", false
	case index < s.DiscsPerTeam:
		return L, true
	case index < 2*s.DiscsPerTeam:
		return R, true
	}
	return "", false
}

func (s *State) PlayerOf(side Side) Player {
	if side == L {
		return s.Players[0]
	}
	return s.Players[1]
}

const magnitudeTolerance = 1e-4

// ValidateShot returns "" when the shot is legal, else the same rejection codes as TS.
func (s *State) ValidateShot(side Side, shot Shot, p sim.Config) string {
	if s.Phase == "ENDED" {
		return "match_ended"
	}
	if s.Phase != "AWAIT_SHOT" {
		return "not_awaiting_shot"
	}
	if s.Turn.Side != side {
		return "not_your_turn"
	}
	if shot.Seq != s.Turn.Seq {
		return "stale_seq"
	}
	owner, ok := s.DiscOwner(shot.DiscIndex)
	if !ok {
		return "invalid_disc"
	}
	if owner != side {
		return "not_your_disc"
	}
	ix, iy := float64(shot.IX), float64(shot.IY)
	if math.IsNaN(ix) || math.IsNaN(iy) || math.IsInf(ix, 0) || math.IsInf(iy, 0) {
		return "non_finite"
	}
	m := math.Hypot(ix, iy)
	if m < p.MinImpulse*(1-magnitudeTolerance) || m > p.MaxImpulse*(1+magnitudeTolerance) {
		return "power_out_of_range"
	}
	return ""
}

func (s *State) nextTurn(side Side) Turn {
	return Turn{Index: s.Turn.Index + 1, Side: side, Seq: s.Turn.Seq + 1}
}

func (s *State) end(winner Side, reason string, events *[]Event) {
	s.Phase = "ENDED"
	s.Result = &Result{Winner: winner, Reason: reason}
	score := s.Score
	*events = append(*events, Event{Type: "ended", Result: s.Result, Score: &score})
}

func ptrInt(v int) *int    { return &v }
func ptrBool(v bool) *bool { return &v }

// ApplyShotResult mirrors applyShotResult in match.ts. It mutates s.
func (s *State) ApplyShotResult(side Side, shot Shot, res sim.Result, r gamedata.Rules) []Event {
	sh := shot
	events := []Event{{Type: "shot", Side: side, Shot: &sh}}
	if res.Outcome == "invalid" {
		events = append(events, Event{Type: "invalid_simulation", Side: side})
		s.Phase = "AWAIT_SHOT"
		s.Turn.Seq++
		return events
	}
	s.ShotCount++
	if side == L {
		s.ConsecutiveTimeouts.L = 0
	} else {
		s.ConsecutiveTimeouts.R = 0
	}

	if res.Outcome == "goal_left" || res.Outcome == "goal_right" {
		scorer := R
		if res.Outcome == "goal_right" {
			scorer = L
		}
		s.Score.Add(scorer, 1)
		score := s.Score
		events = append(events, Event{Type: "goal", Scorer: scorer, OwnGoal: ptrBool(scorer != side), Score: &score})
		if s.Score.Get(scorer) >= s.GoalsToWin || s.SuddenDeath {
			s.Bodies = res.Bodies
			s.StateHash = res.Hash
			s.end(scorer, "goals", &events)
			return events
		}
		s.Bodies = KickoffBodies(r)
		s.StateHash = sim.HashBodies(s.Bodies)
		s.Turn = s.nextTurn(Other(scorer))
		s.Phase = "AWAIT_SHOT"
	} else {
		s.Bodies = res.Bodies
		s.StateHash = res.Hash
		s.Turn = s.nextTurn(Other(side))
		s.Phase = "AWAIT_SHOT"
	}

	if s.ShotCount >= s.MaxShots && !s.SuddenDeath {
		if s.Score.L != s.Score.R {
			winner := R
			if s.Score.L > s.Score.R {
				winner = L
			}
			s.end(winner, "max_shots", &events)
			return events
		}
		s.SuddenDeath = true
		events = append(events, Event{Type: "sudden_death"})
	}
	events = append(events, Event{Type: "turn", Side: s.Turn.Side, Index: ptrInt(s.Turn.Index)})
	return events
}

// ApplyTimeout mirrors applyTimeout in match.ts.
func (s *State) ApplyTimeout() []Event {
	if s.Phase != "AWAIT_SHOT" {
		return nil
	}
	side := s.Turn.Side
	s.ConsecutiveTimeouts.Add(side, 1)
	consecutive := s.ConsecutiveTimeouts.Get(side)
	events := []Event{{Type: "timeout", Side: side, Consecutive: consecutive}}
	if consecutive >= s.TimeoutForfeitCount {
		s.end(Other(side), "forfeit_timeouts", &events)
		return events
	}
	s.Turn = s.nextTurn(Other(side))
	return append(events, Event{Type: "turn", Side: s.Turn.Side, Index: ptrInt(s.Turn.Index)})
}

// Forfeit ends the match against `side`.
func (s *State) Forfeit(side Side, reason string) []Event {
	if s.Phase == "ENDED" {
		return nil
	}
	var events []Event
	s.end(Other(side), reason, &events)
	return events
}

// MatchXP mirrors matchXp in progression.ts.
func MatchXP(won bool, goals int, multiplier float64, p gamedata.Progression) int64 {
	base := p.XP.Loss
	if won {
		base = p.XP.Win
	}
	if goals < 0 {
		goals = 0
	}
	return int64(math.Round(float64(base+p.XP.PerGoal*goals) * multiplier))
}

// LevelUpRewards mirrors levelUpRewards in progression.ts.
func LevelUpRewards(from, to int, p gamedata.Progression) (coins, gems int64) {
	for level := from + 1; level <= to; level++ {
		coins += int64(p.LevelReward.CoinsPerLevel * level)
		if level%p.LevelReward.GemsEveryNLevels == 0 {
			gems += int64(p.LevelReward.GemsAmount)
		}
	}
	return
}
