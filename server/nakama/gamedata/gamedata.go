// Package gamedata embeds the shared configuration from packages/config/data.
// The JSON files here are copies; TestCopiesMatchPackagesConfig fails if they drift.
// Refresh with: pnpm sync:gamedata
package gamedata

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
)

//go:embed physics.json
var physicsJSON []byte

//go:embed rules.json
var rulesJSON []byte

//go:embed progression.json
var progressionJSON []byte

//go:embed economy.json
var economyJSON []byte

//go:embed cosmetics.json
var cosmeticsJSON []byte

//go:embed arenas.json
var arenasJSON []byte

//go:embed ai-profiles.json
var aiProfilesJSON []byte

type Rules struct {
	DiscsPerTeam        int          `json:"discsPerTeam"`
	GoalsToWin          int          `json:"goalsToWin"`
	TurnTimeMs          int          `json:"turnTimeMs"`
	TimeoutForfeitCount int          `json:"timeoutForfeitCount"`
	MaxShots            int          `json:"maxShots"`
	Formation           [][2]float64 `json:"formation"`
	OpponentFormation   [][2]float64 `json:"opponentFormation,omitempty"`
}

type Progression struct {
	MaxLevel   int `json:"maxLevel"`
	LevelCurve struct {
		Base     float64 `json:"base"`
		Exponent float64 `json:"exponent"`
	} `json:"levelCurve"`
	XP struct {
		Win     int `json:"win"`
		Loss    int `json:"loss"`
		PerGoal int `json:"perGoal"`
	} `json:"xp"`
	LevelReward struct {
		CoinsPerLevel    int `json:"coinsPerLevel"`
		GemsEveryNLevels int `json:"gemsEveryNLevels"`
		GemsAmount       int `json:"gemsAmount"`
	} `json:"levelReward"`
}

type Price map[string]int64

type Economy struct {
	StartingBalance Price   `json:"startingBalance"`
	TutorialReward  Price   `json:"tutorialReward"`
	DailyRewards    []Price `json:"dailyRewards"`
	RewardedAd      struct {
		Coins    int64 `json:"coins"`
		DailyCap int   `json:"dailyCap"`
	} `json:"rewardedAd"`
	Features struct {
		ClubTeams struct {
			Enabled bool `json:"enabled"`
		} `json:"clubTeams"`
	} `json:"features"`
}

type TeamAttributes struct {
	Force int `json:"force"`
	Time  int `json:"time"`
	Aim   int `json:"aim"`
}

type Cosmetic struct {
	Attributes *TeamAttributes `json:"attributes,omitempty"`
	Positions  [][2]float64    `json:"positions,omitempty"`
	Image      string          `json:"image,omitempty"` // admin-uploaded disc art (data URL)
	ID         string          `json:"id"`
	Group      string          `json:"group"`
	Price      Price           `json:"price"`
	Default    bool            `json:"default"`
}

type CurrencyPack struct {
	ID      string `json:"id"`
	Grant   Price  `json:"grant"`
	OneTime bool   `json:"oneTime"`
}

type Cosmetics struct {
	Trails        []Cosmetic     `json:"trails"`
	Formations    []Cosmetic     `json:"formations"`
	Teams         []Cosmetic     `json:"teams"`
	Balls         []Cosmetic     `json:"balls"`
	Avatars       []Cosmetic     `json:"avatars"`
	CurrencyPacks []CurrencyPack `json:"currencyPacks"`
}

type Arena struct {
	ID           string  `json:"id"`
	EntryFee     int64   `json:"entryFee"`
	MinLevel     int     `json:"minLevel"`
	XPMultiplier float64 `json:"xpMultiplier"`
	Theme        string  `json:"theme"`
}

type Arenas struct {
	HouseCut float64 `json:"houseCut"`
	Arenas   []Arena `json:"arenas"`
}

type AIProfile struct {
	ID              string    `json:"id"`
	MinLevel        int       `json:"minLevel"`
	MaxSimulations  int       `json:"maxSimulations"`
	PowerSteps      []float64 `json:"powerSteps"`
	AngleOffsetsDeg []float64 `json:"angleOffsetsDeg"`
	BankShots       bool      `json:"bankShots"`
	LookAhead       bool      `json:"lookAhead"`
	AimErrorDeg     float64   `json:"aimErrorDeg"`
	PowerError      float64   `json:"powerError"`
	DefensiveWeight float64   `json:"defensiveWeight"`
	RiskTolerance   float64   `json:"riskTolerance"`
	ThinkTimeMs     int       `json:"thinkTimeMs"`
}

type Data struct {
	PhysicsRaw  json.RawMessage
	Rules       Rules
	Progression Progression
	Economy     Economy
	Cosmetics   Cosmetics
	Arenas      Arenas
	AIProfiles  []AIProfile
}

// Load parses every embedded file without overrides. Call once at module init.
func Load() (*Data, error) {
	d, _, err := LoadWith(nil, true)
	return d, err
}

func parse(raw map[string][]byte) (*Data, error) {
	d := &Data{PhysicsRaw: raw["physics"]}
	var ai struct {
		Profiles []AIProfile `json:"profiles"`
	}
	for _, f := range []struct {
		name string
		into any
	}{
		{"rules", &d.Rules},
		{"progression", &d.Progression},
		{"economy", &d.Economy},
		{"cosmetics", &d.Cosmetics},
		{"arenas", &d.Arenas},
		{"ai-profiles", &ai},
	} {
		if err := json.Unmarshal(raw[f.name], f.into); err != nil {
			return nil, fmt.Errorf("gamedata %s: %w", f.name, err)
		}
	}
	d.AIProfiles = ai.Profiles
	// Mirrors packages/config: club teams leave the catalog when the switch is off.
	if !d.Economy.Features.ClubTeams.Enabled {
		teams := d.Cosmetics.Teams[:0:0]
		for _, t := range d.Cosmetics.Teams {
			if t.Group != "club" {
				teams = append(teams, t)
			}
		}
		d.Cosmetics.Teams = teams
	}
	return d, nil
}

// XPForLevel mirrors xpForLevel in packages/rules/src/progression.ts.
func (p Progression) XPForLevel(level int) int64 {
	if level <= 1 {
		return 0
	}
	return int64(math.Round(p.LevelCurve.Base * math.Pow(float64(level-1), p.LevelCurve.Exponent)))
}

// LevelFromXP mirrors levelFromXp in packages/rules/src/progression.ts.
func (p Progression) LevelFromXP(xp int64) int {
	level := 1
	for level < p.MaxLevel && xp >= p.XPForLevel(level+1) {
		level++
	}
	return level
}

// IsFree reports whether a cosmetic is free (owned by every player).
func (c Cosmetics) IsFree(kind, id string) bool {
	for _, item := range c.list(kind) {
		if item.ID == id {
			return len(item.Price) == 0
		}
	}
	return false
}

// Exists reports whether a cosmetic id exists in the catalog.
func (c Cosmetics) Exists(kind, id string) bool {
	for _, item := range c.list(kind) {
		if item.ID == id {
			return true
		}
	}
	return false
}

// Default returns the default item id for a kind.
func (c Cosmetics) Default(kind string) string {
	items := c.list(kind)
	for _, item := range items {
		if item.Default {
			return item.ID
		}
	}
	if len(items) > 0 {
		return items[0].ID
	}
	return ""
}

// List returns the catalog of one cosmetic kind.
func (c Cosmetics) List(kind string) []Cosmetic { return c.list(kind) }

func (c Cosmetics) list(kind string) []Cosmetic {
	switch kind {
	case "trails":
		return c.Trails
	case "formations":
		return c.Formations
	case "teams":
		return c.Teams
	case "balls":
		return c.Balls
	case "avatars":
		return c.Avatars
	}
	return nil
}

func (c Cosmetics) TeamAttributes(id string) (TeamAttributes, bool) {
	for _, t := range c.Teams {
		if t.ID == id && t.Attributes != nil {
			return *t.Attributes, true
		}
	}
	return TeamAttributes{Force: 6, Time: 6, Aim: 6}, false
}
func (c Cosmetics) TeamMaxImpulse(id string, base float64) float64 {
	a, ok := c.TeamAttributes(id)
	if !ok {
		return base
	}
	return base * (.7 + .03*float64(a.Force))
}
func (c Cosmetics) TeamTurnMs(id string, base int64) int64 {
	a, ok := c.TeamAttributes(id)
	if !ok {
		return base
	}
	return int64(math.Round(float64(base) * (.6 + float64(a.Time)/15)))
}
