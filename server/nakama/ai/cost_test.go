package ai

import (
	"testing"
	"time"

	"flickkick/server/rules"
	"flickkick/server/sim"
)

func TestDecisionCostPerProfile(t *testing.T) {
	if testing.Short() {
		t.Skip("measurement only; run without -short")
	}
	d, p, s := setupWith(t, sim.NewEngine) // the interpreter the plugin uses
	st := rules.NewMatch("cost", "online_bot", [2]rules.Player{{ID: "a"}, {ID: "b", IsBot: true}}, 9, d.Rules)
	for _, prof := range d.AIProfiles {
		t0 := time.Now()
		dec, err := Decide(st, st.Turn.Side, prof, s, p, 1)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%-8s %3d simulations  %v", prof.ID, dec.Simulations, time.Since(t0).Round(time.Millisecond))
	}
}
