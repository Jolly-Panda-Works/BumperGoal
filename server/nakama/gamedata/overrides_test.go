package gamedata

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOverridesApplyToEveryGroup(t *testing.T) {
	d, stale, err := LoadWith(Overrides{
		"economy/startingBalance":                      json.RawMessage(`{"coins": 900, "gems": 3}`),
		"economy/dailyRewards":                         json.RawMessage(`[{"coins": 10}, {"gems": 1}]`),
		"cosmetics/teams/@team_ocean/price":            json.RawMessage(`{"gems": 7}`),
		"cosmetics/teams/@team_ocean/attributes/force": json.RawMessage(`9`),
		"cosmetics/currencyPacks/@pack_coins_1/grant":  json.RawMessage(`{"coins": 2500}`),
		"arenas/houseCut":                              json.RawMessage(`0.1`),
		"arenas/arenas/@city/entryFee":                 json.RawMessage(`250`),
		"progression/xp/win":                           json.RawMessage(`150`),
		"rules/goalsToWin":                             json.RawMessage(`3`),
		"rules/formation/0":                            json.RawMessage(`[-6, 0.5]`),
		"physics/ball/linearDamping":                   json.RawMessage(`1.2`),
		"ai-profiles/profiles/@pro/powerSteps":         json.RawMessage(`[0.5, 1]`),
		"economy/features/clubTeams/enabled":           json.RawMessage(`false`),
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(stale) != 0 {
		t.Fatalf("stale: %v", stale)
	}
	if d.Economy.StartingBalance["coins"] != 900 || len(d.Economy.DailyRewards) != 2 || d.Economy.DailyRewards[1]["gems"] != 1 {
		t.Fatalf("economy: %+v", d.Economy)
	}
	attrs, _ := d.Cosmetics.TeamAttributes("team_ocean")
	ocean := d.Cosmetics.Teams[0]
	for _, team := range d.Cosmetics.Teams {
		if team.ID == "team_ocean" {
			ocean = team
		}
	}
	if ocean.Price["gems"] != 7 || ocean.Price["coins"] != 0 || attrs.Force != 9 {
		t.Fatalf("team: %+v", ocean)
	}
	for _, team := range d.Cosmetics.Teams {
		if team.Group == "club" {
			t.Fatal("club teams should leave the catalog when switched off")
		}
	}
	if d.Cosmetics.CurrencyPacks[0].Grant["coins"] != 2500 || d.Arenas.HouseCut != 0.1 || d.Arenas.Arenas[1].EntryFee != 250 {
		t.Fatal("packs or arenas not overridden")
	}
	if d.Progression.XP.Win != 150 || d.Rules.GoalsToWin != 3 || d.Rules.Formation[0] != [2]float64{-6, 0.5} {
		t.Fatal("progression or rules not overridden")
	}
	var p Physics
	_ = json.Unmarshal(d.PhysicsRaw, &p)
	if p.Ball.LinearDamping != 1.2 || p.Disc.LinearDamping != 1.4 {
		t.Fatalf("physics: %+v", p)
	}
	for _, a := range d.AIProfiles {
		if a.ID == "pro" && (len(a.PowerSteps) != 2 || a.PowerSteps[1] != 1) {
			t.Fatalf("ai: %+v", a)
		}
	}
}

func TestFreeAndPaidPrices(t *testing.T) {
	d, _, err := LoadWith(Overrides{
		"cosmetics/teams/@team_ocean/price": json.RawMessage(`null`),
		"cosmetics/teams/@team_volt/price":  json.RawMessage(`{"coins": 100}`),
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if !d.Cosmetics.IsFree("teams", "team_ocean") || d.Cosmetics.IsFree("teams", "team_volt") {
		t.Fatal("price null should make an item free and a price should make it paid")
	}
}

func TestOverridesRejectBadEdits(t *testing.T) {
	for path, value := range map[string]string{
		"economy/nope":                                `1`,
		"cosmetics/teams/@missing/price":              `{"coins": 1}`,
		"cosmetics/teams/0/price":                     `{"coins": 1}`,
		"cosmetics/teams/@team_ocean/id":              `"x"`,
		"cosmetics/teams/@team_ocean/primary":         `"#fff"`,
		"cosmetics/teams/@team_volt/default":          `false`,
		"rules/discsPerTeam":                          `6`,
		"physics/arena/halfWidth":                     `9`,
		"economy/features/payments/enabled":           `true`,
		"economy/startingBalance":                     `{"coins": -5, "gems": 1}`,
		"economy/startingBalance/coins":               `5`,
		"economy/tutorialReward":                      `{"diamonds": 5}`,
		"cosmetics/currencyPacks/@pack_coins_1/grant": `{"coins": 1.5}`,
		"economy/dailyRewards":                        `[]`,
		"economy/startingBalance ":                    `{}`,
		"rules/formation/0":                           `[1, 2, 3]`,
		"rules/goalsToWin":                            `"3"`,
		"rules/turnTimeMs":                            `100`,
		"arenas/houseCut":                             `1`,
		"physics/maxImpulse":                          `0.1`,
		"progression/levelReward/gemsEveryNLevels":    `0`,
		"cosmetics/teams/@team_ocean/attributes/aim":  `11`,
		"progression/xp/win":                          `10.5`,
		"economy/tutorialReward/price":                `null`,
	} {
		if _, _, err := LoadWith(Overrides{path: json.RawMessage(value)}, true); err == nil {
			t.Errorf("%s = %s was accepted", path, value)
		}
	}
}

func TestStaleOverridesAreSkippedWhenNotStrict(t *testing.T) {
	d, stale, err := LoadWith(Overrides{
		"cosmetics/teams/@retired_team/price": json.RawMessage(`{"coins": 1}`),
		"rules/goalsToWin":                    json.RawMessage(`4`),
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(stale) != 1 || !strings.Contains(stale[0], "retired_team") || d.Rules.GoalsToWin != 4 {
		t.Fatalf("stale %v goals %d", stale, d.Rules.GoalsToWin)
	}
}

func TestDefaultsAreUntouchedByOverrides(t *testing.T) {
	if _, _, err := LoadWith(Overrides{"rules/goalsToWin": json.RawMessage(`5`)}, true); err != nil {
		t.Fatal(err)
	}
	d, err := Load()
	if err != nil || d.Rules.GoalsToWin != 2 {
		t.Fatalf("defaults changed: %v %d", err, d.Rules.GoalsToWin)
	}
}

func TestTeamImageOverride(t *testing.T) {
	img := `"data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="`
	d, _, err := LoadWith(Overrides{"cosmetics/teams/@team_ocean/image": json.RawMessage(img)}, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, team := range d.Cosmetics.Teams {
		if team.ID == "team_ocean" && !strings.HasPrefix(team.Image, "data:image/webp;base64,") {
			t.Fatal("image not applied")
		}
	}
	for path, value := range map[string]string{
		"cosmetics/teams/@team_ocean/image":          `"https://evil.example/x.png"`,
		"cosmetics/teams/@team_ocean/image ":         img,
		"cosmetics/formations/@formation_wall/image": img,
		"cosmetics/teams/@missing/image":             img,
		"cosmetics/teams/@team_volt/image":           `"data:image/svg+xml;base64,PHN2Zz4="`,
		"cosmetics/teams/@team_coral/image":          `"data:image/png;base64,***"`,
		"cosmetics/teams/@team_royal/image":          `"data:image/png;base64,` + strings.Repeat("A", MaxImageLength) + `"`,
	} {
		if _, _, err := LoadWith(Overrides{path: json.RawMessage(value)}, true); err == nil {
			t.Errorf("%s = %.40s was accepted", path, value)
		}
	}
}

func TestArenaThemeOverride(t *testing.T) {
	d, _, err := LoadWith(Overrides{"arenas/arenas/@park/theme": json.RawMessage(`"legends"`)}, true)
	if err != nil || d.Arenas.Arenas[0].Theme != "legends" {
		t.Fatalf("theme not applied: %v", err)
	}
	for _, v := range []string{`"moon"`, `3`, `""`} {
		if _, _, err := LoadWith(Overrides{"arenas/arenas/@park/theme": json.RawMessage(v)}, true); err == nil {
			t.Errorf("theme %s accepted", v)
		}
	}
	if _, _, err := LoadWith(Overrides{"arenas/arenas/@park/id": json.RawMessage(`"x"`)}, true); err == nil {
		t.Error("arena id accepted")
	}
}

const testAsset = "asset:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestNewArenaAndArt(t *testing.T) {
	art := `{"turf":{"src":"` + testAsset + `","w":800,"h":480},"frame":{"src":"` + testAsset + `","w":820,"h":500,"insets":{"left":60,"top":60,"right":60,"bottom":70}},"goal":{"src":"` + testAsset + `","w":180,"h":360,"mouthX":0.75}}`
	d, _, err := LoadWith(Overrides{
		"arenas/arenas/+desert":          json.RawMessage(`{"entryFee":800,"minLevel":8,"xpMultiplier":1.5,"theme":"coast","names":{"en":"Desert","fa":"صحرا"}}`),
		"arenas/arenas/@desert/art":      json.RawMessage(art),
		"arenas/arenas/@park/art":        json.RawMessage(`{"cover":{"src":"` + testAsset + `","w":960,"h":540}}`),
		"arenas/arenas/@desert/entryFee": json.RawMessage(`900`),
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	last := d.Arenas.Arenas[len(d.Arenas.Arenas)-1]
	if last.ID != "desert" || last.EntryFee != 900 || last.Theme != "coast" || last.MinLevel != 8 {
		t.Fatalf("added arena: %+v", last)
	}
	for name, o := range map[string]Overrides{
		"duplicate id":  {"arenas/arenas/+park": json.RawMessage(`{"entryFee":1,"minLevel":1,"xpMultiplier":1,"theme":"park","names":{"en":"P"}}`)},
		"no name":       {"arenas/arenas/+moon": json.RawMessage(`{"entryFee":1,"minLevel":1,"xpMultiplier":1,"theme":"park","names":{}}`)},
		"bad theme":     {"arenas/arenas/+moon": json.RawMessage(`{"entryFee":1,"minLevel":1,"xpMultiplier":1,"theme":"mars","names":{"en":"M"}}`)},
		"bad id":        {"arenas/arenas/+Moon!": json.RawMessage(`{}`)},
		"art url":       {"arenas/arenas/@park/art": json.RawMessage(`{"turf":{"src":"https://x/y.png","w":1,"h":1}}`)},
		"art part":      {"arenas/arenas/@park/art": json.RawMessage(`{"logo":{"src":"` + testAsset + `","w":1,"h":1}}`)},
		"frame insets":  {"arenas/arenas/@park/art": json.RawMessage(`{"frame":{"src":"` + testAsset + `","w":100,"h":100}}`)},
		"goal mouth":    {"arenas/arenas/@park/art": json.RawMessage(`{"goal":{"src":"` + testAsset + `","w":100,"h":100,"mouthX":2}}`)},
		"missing arena": {"arenas/arenas/@nowhere/art": json.RawMessage(`{}`)},
	} {
		if _, _, err := LoadWith(o, true); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	for _, p := range []string{"ai-profiles/profiles/@pro/image", "cosmetics/balls/@ball_classic/image", "cosmetics/avatars/@avatar_fox/image", "cosmetics/trails/@trail_comet/image", "cosmetics/currencyPacks/@pack_coins_1/image"} {
		if _, _, err := LoadWith(Overrides{p: json.RawMessage(`"data:image/png;base64,iVBORw0KGgo="`)}, true); err != nil {
			t.Errorf("%s rejected: %v", p, err)
		}
	}
}
