package main

import (
	"math"

	"flickkick/server/rules"
	"flickkick/server/sim"
)

type SideStatistics struct {
	Shots           int     `json:"shots"`
	ScoringShots    int     `json:"scoringShots"`
	OwnGoals        int     `json:"ownGoals"`
	Timeouts        int     `json:"timeouts"`
	PowerTotal      float64 `json:"powerTotal"`
	SimulationTicks int     `json:"simulationTicks"`
}
type MatchStatistics struct {
	Version    int                            `json:"version"`
	DurationMs int64                          `json:"durationMs"`
	Sides      map[rules.Side]*SideStatistics `json:"sides"`
}

func newMatchStatistics() MatchStatistics {
	return MatchStatistics{Version: 1, Sides: map[rules.Side]*SideStatistics{rules.L: {}, rules.R: {}}}
}
func (stats *MatchStatistics) ensure() {
	if stats.Sides == nil {
		*stats = newMatchStatistics()
	}
}
func (stats *MatchStatistics) recordShot(side rules.Side, shot rules.Shot, result sim.Result, events []rules.Event, maxImpulse float64) {
	if result.Outcome == "invalid" {
		return
	}
	stats.ensure()
	own := stats.Sides[side]
	own.Shots++
	own.SimulationTicks += result.Ticks
	own.PowerTotal += math.Min(100, math.Max(0, math.Hypot(float64(shot.IX), float64(shot.IY))/maxImpulse*100))
	for _, event := range events {
		if event.Type == "goal" {
			if event.OwnGoal != nil && *event.OwnGoal {
				own.OwnGoals++
			} else if event.Scorer == side {
				own.ScoringShots++
			}
		}
	}
}
func (stats *MatchStatistics) recordEvents(events []rules.Event) {
	stats.ensure()
	for _, event := range events {
		if event.Type == "timeout" {
			stats.Sides[event.Side].Timeouts++
		}
	}
}
