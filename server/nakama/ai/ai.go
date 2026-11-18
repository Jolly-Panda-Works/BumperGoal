// Package ai is the Go twin of packages/rules/src/ai (server bots for the
// matchmaking fallback). Same candidate generation, evaluation, look-ahead,
// profiles and seeded execution noise. Decisions are deterministic per
// (state, profile, seed) within this runtime; the server simulates the chosen
// shot authoritatively, so bit-equality with the browser AI is not required.
package ai

import (
	"errors"
	"math"
	"sort"

	"flickkick/server/gamedata"
	"flickkick/server/rules"
	"flickkick/server/sim"
)

type vec struct{ x, y float64 }

func sub(a, b vec) vec      { return vec{a.x - b.x, a.y - b.y} }
func length(v vec) float64  { return math.Hypot(v.x, v.y) }
func dist(a, b vec) float64 { return math.Hypot(a.x-b.x, a.y-b.y) }
func dot(a, b vec) float64  { return a.x*b.x + a.y*b.y }
func at(b sim.Body) vec     { return vec{float64(b.X), float64(b.Y)} }
func rotate(v vec, r float64) vec {
	c, s := math.Cos(r), math.Sin(r)
	return vec{v.x*c - v.y*s, v.x*s + v.y*c}
}
func norm(v vec) vec {
	l := length(v)
	if l > 1e-9 {
		return vec{v.x / l, v.y / l}
	}
	return vec{1, 0}
}

func attackGoal(side rules.Side, p sim.Config) vec {
	if side == rules.L {
		return vec{p.Arena.HalfWidth, 0}
	}
	return vec{-p.Arena.HalfWidth, 0}
}

func ownGoal(side rules.Side, p sim.Config) vec { return attackGoal(rules.Other(side), p) }

func distToSegment(p, a, b vec) float64 {
	ab := sub(b, a)
	t := math.Max(0, math.Min(1, dot(sub(p, a), ab)/math.Max(dot(ab, ab), 1e-9)))
	return dist(p, vec{a.x + ab.x*t, a.y + ab.y*t})
}

// ProfileForLevel mirrors profileForLevel (step mapping by minLevel).
func ProfileForLevel(level int, profiles []gamedata.AIProfile) gamedata.AIProfile {
	sorted := append([]gamedata.AIProfile(nil), profiles...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].MinLevel < sorted[j].MinLevel })
	chosen := sorted[0]
	for _, p := range sorted {
		if level >= p.MinLevel {
			chosen = p
		}
	}
	return chosen
}

type candidate struct {
	disc  int
	dir   vec
	power float64
	kind  string
	prior float64
}

func discIndices(s *rules.State, side rules.Side) []int {
	start := 0
	if side == rules.R {
		start = s.DiscsPerTeam
	}
	out := make([]int, s.DiscsPerTeam)
	for i := range out {
		out[i] = start + i
	}
	return out
}

func generate(s *rules.State, side rules.Side, prof gamedata.AIProfile, p sim.Config, budget int) []candidate {
	ball := at(s.Bodies[len(s.Bodies)-1])
	goal := attackGoal(side, p)
	home := ownGoal(side, p)
	rr := p.Disc.Radius + p.Ball.Radius
	wallY := p.Arena.HalfHeight - p.Disc.Radius
	var out []candidate
	push := func(disc int, dir vec, kind string, prior float64) {
		for _, off := range prof.AngleOffsetsDeg {
			d := dir
			if off != 0 {
				d = rotate(dir, off*math.Pi/180)
			}
			for _, power := range prof.PowerSteps {
				out = append(out, candidate{disc, d, power, kind, prior - math.Abs(off)*0.5})
			}
		}
	}
	targets := []vec{goal, {goal.x, p.Arena.GoalHalfWidth * 0.55}, {goal.x, -p.Arena.GoalHalfWidth * 0.55}}
	for _, i := range discIndices(s, side) {
		disc := at(s.Bodies[i])
		proximity := 10 - dist(disc, ball)
		for _, target := range targets {
			u := norm(sub(target, ball))
			ghost := vec{ball.x - u.x*rr, ball.y - u.y*rr}
			dir := norm(sub(ghost, disc))
			if dot(dir, u) > 0.25 {
				push(i, dir, "strike", 30+proximity+dot(dir, u)*10)
			}
		}
		push(i, norm(sub(ball, disc)), "direct", 15+proximity)
		if prof.BankShots {
			u := norm(sub(goal, ball))
			ghost := vec{ball.x - u.x*rr, ball.y - u.y*rr}
			for _, wall := range []float64{wallY, -wallY} {
				push(i, norm(sub(vec{ghost.x, 2*wall - ghost.y}, disc)), "bank", 8+proximity)
			}
		}
		if prof.DefensiveWeight >= 0.4 {
			guard := vec{home.x + (ball.x-home.x)*0.35, home.y + (ball.y-home.y)*0.35}
			if dist(disc, guard) > p.Disc.Radius*2 {
				push(i, norm(sub(guard, disc)), "block", 5+prof.DefensiveWeight*10)
			}
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].prior != out[b].prior {
			return out[a].prior > out[b].prior
		}
		if out[a].disc != out[b].disc {
			return out[a].disc < out[b].disc
		}
		return out[a].power < out[b].power
	})
	if budget < 1 {
		budget = 1
	}
	if len(out) > budget {
		out = out[:budget]
	}
	return out
}

const goalScore = 1000.0

func evaluate(s *rules.State, side rules.Side, res sim.Result, prof gamedata.AIProfile, p sim.Config) float64 {
	scored, conceded := "goal_left", "goal_right"
	if side == rules.L {
		scored, conceded = "goal_right", "goal_left"
	}
	switch res.Outcome {
	case scored:
		return goalScore
	case conceded:
		return -goalScore * (2 - prof.RiskTolerance)
	case "invalid":
		return -goalScore
	}
	ball := at(res.Bodies[len(res.Bodies)-1])
	goal, home := attackGoal(side, p), ownGoal(side, p)
	sign := 1.0
	if side == rules.R {
		sign = -1
	}
	lead := s.Score.Get(side) - s.Score.Get(rules.Other(side))
	late := float64(s.ShotCount) / math.Max(1, float64(s.MaxShots))
	attackBias, defendBias := 1.0, 1.0
	if lead < 0 {
		attackBias = 1 + late
	} else if lead > 0 {
		attackBias, defendBias = 0.7, 1.5
	}
	progress := sign * ball.x / p.Arena.HalfWidth
	threat := math.Max(0, 1-dist(ball, goal)/6)
	danger := math.Max(0, 1-dist(ball, home)/6)
	coverage := 0
	for _, i := range discIndices(s, side) {
		if distToSegment(at(res.Bodies[i]), ball, home) < p.Disc.Radius+p.Ball.Radius+0.25 {
			coverage++
		}
	}
	w := prof.DefensiveWeight
	return 100*progress*attackBias + 80*threat*(0.5+prof.RiskTolerance)*attackBias -
		90*danger*w*defendBias + 25*math.Min(float64(coverage), 2)*w*defendBias
}

func toImpulse(c candidate, p sim.Config) (float32, float32) {
	m := math.Max(p.MinImpulse, c.power*p.MaxImpulse)
	return float32(c.dir.x * m), float32(c.dir.y * m)
}

type Decision struct {
	Shot        rules.Shot
	Simulations int
}

const lookAheadTop = 4

// Decide picks a shot for `side`. The simulation count is bounded by the profile.
func Decide(s *rules.State, side rules.Side, prof gamedata.AIProfile, engine *sim.Sim, p sim.Config, seed uint32) (Decision, error) {
	reserve := 0
	if prof.LookAhead {
		reserve = lookAheadTop * s.DiscsPerTeam * 2
	}
	cands := generate(s, side, prof, p, prof.MaxSimulations-reserve)
	type scoredC struct {
		c     candidate
		res   sim.Result
		score float64
	}
	scored := make([]scoredC, 0, len(cands))
	sims := 0
	for _, c := range cands {
		ix, iy := toImpulse(c, p)
		res, err := engine.SimulateShot(s.Bodies, sim.Impulse{BodyIndex: c.disc, IX: ix, IY: iy}, 0)
		if err != nil {
			return Decision{}, err
		}
		sims++
		scored = append(scored, scoredC{c, res, evaluate(s, side, res, prof, p)})
	}
	byScore := func() {
		sort.SliceStable(scored, func(a, b int) bool {
			if scored[a].score != scored[b].score {
				return scored[a].score > scored[b].score
			}
			return scored[a].c.prior > scored[b].c.prior
		})
	}
	byScore()
	if prof.LookAhead {
		opp := rules.Other(side)
		concede := "goal_right"
		if side == rules.L {
			concede = "goal_left"
		}
		for k := 0; k < len(scored) && k < lookAheadTop; k++ {
			e := &scored[k]
			if e.score >= goalScore || e.res.Outcome != "settled" {
				continue
			}
			ball := at(e.res.Bodies[len(e.res.Bodies)-1])
			target := attackGoal(opp, p)
			worst := 0.0
			for _, i := range discIndices(s, opp) {
				disc := at(e.res.Bodies[i])
				u := norm(sub(target, ball))
				rr := p.Disc.Radius + p.Ball.Radius
				dir := norm(sub(vec{ball.x - u.x*rr, ball.y - u.y*rr}, disc))
				for _, power := range []float64{0.7, 1.0} {
					m := power * p.MaxImpulse
					reply, err := engine.SimulateShot(e.res.Bodies, sim.Impulse{BodyIndex: i, IX: float32(dir.x * m), IY: float32(dir.y * m)}, 0)
					if err != nil {
						return Decision{}, err
					}
					sims++
					if reply.Outcome == concede {
						worst = math.Max(worst, goalScore*0.6)
					}
				}
			}
			e.score -= worst
		}
		byScore()
	}
	if len(scored) == 0 {
		return Decision{}, errors.New("no candidates")
	}
	best := scored[0].c
	rng := rules.NewRng(rules.MixSeed(seed, uint32(s.Turn.Index)))
	aimErr := rng.Gaussian() * prof.AimErrorDeg * math.Pi / 180
	powerScale := 1 + rng.Gaussian()*prof.PowerError
	dir := rotate(best.dir, aimErr)
	m := math.Min(p.MaxImpulse, math.Max(p.MinImpulse, best.power*powerScale*p.MaxImpulse))
	shot := rules.Shot{Seq: s.Turn.Seq, DiscIndex: best.disc, IX: float32(dir.x * m), IY: float32(dir.y * m)}
	if reason := s.ValidateShot(side, shot, p); reason != "" {
		return Decision{}, errors.New("AI produced an invalid shot: " + reason)
	}
	return Decision{Shot: shot, Simulations: sims}, nil
}
