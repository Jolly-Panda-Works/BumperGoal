package main

import (
	"encoding/json"
	"fmt"
	"sync/atomic"

	"flickkick/server/gamedata"
	"flickkick/server/sim"
)

// liveConfig is the effective game data: embedded defaults plus admin overrides.
// It is replaced as a whole when an admin saves, so a request or match that
// loaded it once sees one consistent version.
type liveConfig struct {
	data      *gamedata.Data
	physics   sim.Config
	engine    *sim.Engine
	revision  int64
	overrides gamedata.Overrides
	stale     []string
}

var (
	live       atomic.Pointer[liveConfig]
	baseEngine = sim.NewEngine(sim.Config{}) // holds the shared wasm compilation cache
)

// gd returns the effective game data.
func gd() *gamedata.Data { return live.Load().data }

func buildLive(o gamedata.Overrides, revision int64, strict bool) (*liveConfig, error) {
	d, stale, err := gamedata.LoadWith(o, strict)
	if err != nil {
		return nil, err
	}
	var physics sim.Config
	if err := json.Unmarshal(d.PhysicsRaw, &physics); err != nil {
		return nil, fmt.Errorf("physics config: %w", err)
	}
	if o == nil {
		o = gamedata.Overrides{}
	}
	return &liveConfig{data: d, physics: physics, engine: baseEngine.WithConfig(physics), revision: revision, overrides: o, stale: stale}, nil
}

// setData installs game data without overrides (tests and module init).
func setData(d *gamedata.Data) {
	var physics sim.Config
	_ = json.Unmarshal(d.PhysicsRaw, &physics)
	live.Store(&liveConfig{data: d, physics: physics, engine: baseEngine.WithConfig(physics), overrides: gamedata.Overrides{}})
}
