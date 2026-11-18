package rules

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"flickkick/server/gamedata"
	"flickkick/server/sim"
)

type action struct {
	Type      string  `json:"type"`
	DiscIndex int     `json:"discIndex"`
	IX        float32 `json:"ix"`
	IY        float32 `json:"iy"`
}

type snapshot struct {
	Phase       string   `json:"phase"`
	Turn        Turn     `json:"turn"`
	Score       Score    `json:"score"`
	ShotCount   int      `json:"shotCount"`
	SuddenDeath bool     `json:"suddenDeath"`
	Result      *Result  `json:"result"`
	StateHash   string   `json:"stateHash"`
	Events      []string `json:"events"`
}

func TestRulesVectorsMatchTypeScript(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/rules/test/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Scripts []struct {
			Seed      uint32     `json:"seed"`
			Actions   []action   `json:"actions"`
			Snapshots []snapshot `json:"snapshots"`
		} `json:"scripts"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	data, err := gamedata.Load()
	if err != nil {
		t.Fatal(err)
	}
	var physics sim.Config
	if err := json.Unmarshal(data.PhysicsRaw, &physics); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	engine := sim.NewEngine(physics)
	defer engine.Close(ctx)
	s, err := engine.NewSim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for _, sc := range vectors.Scripts {
		players := [2]Player{
			{ID: "a", DisplayName: "A", Level: 1, TeamID: "team_volt"},
			{ID: "b", DisplayName: "B", Level: 1, TeamID: "team_coral"},
		}
		st := NewMatch("vec", "online", players, sc.Seed, data.Rules)
		for i, a := range sc.Actions {
			var events []Event
			if a.Type == "timeout" {
				events = st.ApplyTimeout()
			} else {
				side := st.Turn.Side
				shot := Shot{Seq: st.Turn.Seq, DiscIndex: a.DiscIndex, IX: a.IX, IY: a.IY}
				if reason := st.ValidateShot(side, shot, physics); reason != "" {
					t.Fatalf("seed %d action %d: rejected %s", sc.Seed, i, reason)
				}
				res, err := s.SimulateShot(st.Bodies, sim.Impulse{BodyIndex: a.DiscIndex, IX: a.IX, IY: a.IY}, 0)
				if err != nil {
					t.Fatal(err)
				}
				events = st.ApplyShotResult(side, shot, res, data.Rules)
			}
			types := make([]string, len(events))
			for k, e := range events {
				types[k] = e.Type
			}
			got := snapshot{st.Phase, st.Turn, st.Score, st.ShotCount, st.SuddenDeath, st.Result, st.StateHash, types}
			if want := sc.Snapshots[i]; !reflect.DeepEqual(got, want) {
				t.Fatalf("seed %d action %d (%s):\n got  %+v\n want %+v", sc.Seed, i, a.Type, got, want)
			}
		}
	}
}
