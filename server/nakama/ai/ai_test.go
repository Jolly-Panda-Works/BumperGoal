package ai

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"flickkick/server/gamedata"
	"flickkick/server/rules"
	"flickkick/server/sim"
)

func setup(t *testing.T) (*gamedata.Data, sim.Config, *sim.Sim) {
	return setupWith(t, sim.NewCompilerEngine) // tests run outside the plugin
}

func setupWith(t *testing.T, newEngine func(sim.Config) *sim.Engine) (*gamedata.Data, sim.Config, *sim.Sim) {
	t.Helper()
	d, err := gamedata.Load()
	if err != nil {
		t.Fatal(err)
	}
	var p sim.Config
	if err := json.Unmarshal(d.PhysicsRaw, &p); err != nil {
		t.Fatal(err)
	}
	s, err := newEngine(p).NewSim(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return d, p, s
}

func TestLevelMapping(t *testing.T) {
	d, _, _ := setup(t)
	for level, want := range map[int]string{0: "rookie", 1: "rookie", 4: "amateur", 9: "pro", 16: "elite", 50: "elite"} {
		if got := ProfileForLevel(level, d.AIProfiles).ID; got != want {
			t.Errorf("level %d: %s, want %s", level, got, want)
		}
	}
}

func TestBotPlaysAFullMatchLegally(t *testing.T) {
	d, p, s := setup(t)
	st := rules.NewMatch("ai", "online_bot", [2]rules.Player{{ID: "a"}, {ID: "b", IsBot: true}}, 42, d.Rules)
	profiles := map[rules.Side]gamedata.AIProfile{
		rules.L: ProfileForLevel(4, d.AIProfiles),
		rules.R: ProfileForLevel(9, d.AIProfiles),
	}
	for guard := 0; st.Phase != "ENDED" && guard < 200; guard++ {
		side := st.Turn.Side
		dec, err := Decide(st, side, profiles[side], s, p, st.RngSeed)
		if err != nil {
			t.Fatal(err)
		}
		if dec.Simulations > profiles[side].MaxSimulations {
			t.Fatalf("budget exceeded: %d", dec.Simulations)
		}
		res, err := s.SimulateShot(st.Bodies, sim.Impulse{BodyIndex: dec.Shot.DiscIndex, IX: dec.Shot.IX, IY: dec.Shot.IY}, 0)
		if err != nil {
			t.Fatal(err)
		}
		st.ApplyShotResult(side, dec.Shot, res, d.Rules)
	}
	if st.Phase != "ENDED" {
		t.Fatal("match did not finish")
	}
}

func TestDeterministicAndBounded(t *testing.T) {
	d, p, s := setup(t)
	st := rules.NewMatch("ai", "online_bot", [2]rules.Player{{ID: "a"}, {ID: "b", IsBot: true}}, 9, d.Rules)
	elite := ProfileForLevel(50, d.AIProfiles)
	t0 := time.Now()
	a, err := Decide(st, st.Turn.Side, elite, s, p, 123)
	if err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(t0)
	b, _ := Decide(st, st.Turn.Side, elite, s, p, 123)
	if a != b {
		t.Fatalf("not deterministic: %+v vs %+v", a, b)
	}
	if a.Simulations > elite.MaxSimulations {
		t.Fatalf("simulations %d > %d", a.Simulations, elite.MaxSimulations)
	}
	t.Logf("elite decision: %d simulations in %v", a.Simulations, elapsed)
	if elapsed > 5*time.Second {
		t.Fatalf("too slow: %v", elapsed)
	}
}
