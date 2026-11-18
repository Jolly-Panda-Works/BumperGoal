package main

import (
	"flickkick/server/gamedata"
	"flickkick/server/rules"
	"flickkick/server/sim"
	"math"
	"testing"
)

func TestTeamAttributesLimitsAndTime(t *testing.T) {
	useDefaultData(t)
	s := &matchState{physics: sim.Config{MinImpulse: .25, MaxImpulse: 9}, st: &rules.State{Phase: "AWAIT_SHOT", DiscsPerTeam: 5, Players: [2]rules.Player{{TeamID: "team_volt", Side: rules.L}, {TeamID: "team_coral", Side: rules.R}}}}
	s.st.Turn.Side = rules.R
	if s.turnTicks() != 16*tickRate {
		t.Fatal("wrong team turn budget")
	}
	if math.Abs(s.teamPhysics(rules.R).MaxImpulse-7.92) > .00001 {
		t.Fatal("wrong team force limit")
	}
	shot := rules.Shot{DiscIndex: 5, IX: 9, Seq: s.st.Turn.Seq}
	if s.st.ValidateShot(rules.R, shot, s.teamPhysics(rules.R)) != "power_out_of_range" {
		t.Fatal("overpowered shot accepted")
	}
	seen := map[gamedata.TeamAttributes]bool{}
	for _, team := range gd().Cosmetics.Teams {
		if team.Attributes == nil {
			t.Fatal("missing attributes")
		}
		if seen[*team.Attributes] {
			t.Fatal("duplicate team stats")
		}
		seen[*team.Attributes] = true
	}
}
