package sim

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// Cross-runtime contract: the same scenarios as packages/sim/test must give
// exactly the hashes recorded by the JS (V8) run in vectors.json.

type scenarioFile struct {
	Repetitions int `json:"repetitions"`
	Scenarios   []struct {
		Name   string               `json:"name"`
		Bodies [][3]json.RawMessage `json:"bodies"`
		Shots  [][3]float64         `json:"shots"`
	} `json:"scenarios"`
}

type vectorFile struct {
	Physics Config `json:"physics"`
	Results map[string][]struct {
		Outcome string `json:"outcome"`
		Ticks   int    `json:"ticks"`
		Hash    string `json:"hash"`
	} `json:"results"`
}

func mustRead(t *testing.T, path string, v any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatal(err)
	}
}

func loadConfig(t *testing.T) Config {
	var c Config
	mustRead(t, "../../../packages/config/data/physics.json", &c)
	return c
}

func TestEmbeddedWasmIsThePinnedRapierBuild(t *testing.T) {
	sum := sha256.Sum256(rapierWasm)
	if got := hex.EncodeToString(sum[:]); got != RapierWasmSHA256 {
		t.Fatalf("rapier wasm sha256 = %s, want %s", got, RapierWasmSHA256)
	}
}

func TestCrossRuntimeVectors(t *testing.T) {
	cfg := loadConfig(t)
	var scenarios scenarioFile
	var vectors vectorFile
	mustRead(t, "../../../packages/sim/test/scenarios.json", &scenarios)
	mustRead(t, "../../../packages/sim/test/vectors.json", &vectors)
	if vectors.Physics != cfg {
		t.Fatalf("vectors.json was generated with different physics config")
	}

	ctx := context.Background()
	engine := NewEngine(cfg)
	defer engine.Close(ctx)
	s, err := engine.NewSim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for _, sc := range scenarios.Scenarios {
		bodies := make([]Body, len(sc.Bodies))
		for i, b := range sc.Bodies {
			var kind string
			var x, y float64
			_ = json.Unmarshal(b[0], &kind)
			_ = json.Unmarshal(b[1], &x)
			_ = json.Unmarshal(b[2], &y)
			k := "disc"
			if kind == "b" {
				k = "ball"
			}
			bodies[i] = Body{Kind: k, X: float32(x), Y: float32(y)}
		}
		want := vectors.Results[sc.Name]
		for rep := 0; rep < 3; rep++ {
			cur := bodies
			for i, shot := range sc.Shots {
				r, err := s.SimulateShot(cur, Impulse{BodyIndex: int(shot[0]), IX: float32(shot[1]), IY: float32(shot[2])}, 0)
				if err != nil {
					t.Fatalf("%s shot %d: %v", sc.Name, i, err)
				}
				w := want[i]
				if r.Outcome != w.Outcome || r.Ticks != w.Ticks || r.Hash != w.Hash {
					t.Fatalf("%s shot %d (rep %d): got %s/%d/%s, want %s/%d/%s",
						sc.Name, i, rep, r.Outcome, r.Ticks, r.Hash, w.Outcome, w.Ticks, w.Hash)
				}
				cur = r.Bodies
			}
		}
	}
}

func BenchmarkFormationShotInterpreter(b *testing.B) { benchFormation(b, NewEngine) }
func BenchmarkFormationShotCompiler(b *testing.B)    { benchFormation(b, NewCompilerEngine) }

func benchFormation(b *testing.B, newEngine func(Config) *Engine) {
	var cfg Config
	raw, _ := os.ReadFile("../../../packages/config/data/physics.json")
	_ = json.Unmarshal(raw, &cfg)
	ctx := context.Background()
	engine := newEngine(cfg)
	s, _ := engine.NewSim(ctx)
	bodies := []Body{
		{"disc", -6.2, 0}, {"disc", -4.4, 1.9}, {"disc", -4.4, -1.9}, {"disc", -2.2, 0.9}, {"disc", -2.2, -0.9},
		{"disc", 6.2, 0}, {"disc", 4.4, 1.9}, {"disc", 4.4, -1.9}, {"disc", 2.2, 0.9}, {"disc", 2.2, -0.9},
		{"ball", 0, 0},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.SimulateShot(bodies, Impulse{3, 6.5, -1.1}, 0); err != nil {
			b.Fatal(err)
		}
	}
}
