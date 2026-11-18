package gamedata

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCopiesMatchPackagesConfig(t *testing.T) {
	files, err := filepath.Glob("../../../packages/config/data/*.json")
	if err != nil || len(files) == 0 {
		t.Fatalf("no source config found: %v", err)
	}
	for _, src := range files {
		want, _ := os.ReadFile(src)
		got, err := os.ReadFile(filepath.Base(src))
		if err != nil {
			t.Fatalf("%s missing from gamedata (run pnpm sync:gamedata)", filepath.Base(src))
		}
		norm := func(b []byte) []byte { return bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n")) }
		if !bytes.Equal(norm(want), norm(got)) {
			t.Errorf("%s differs from packages/config/data (run pnpm sync:gamedata)", filepath.Base(src))
		}
	}
}

func TestLoadAndProgressionMirrorsTypeScript(t *testing.T) {
	d, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	p := d.Progression
	// Same expectations as packages/rules/test/progression.test.ts.
	if p.XPForLevel(1) != 0 || p.XPForLevel(2) != 100 {
		t.Fatalf("thresholds: %d %d", p.XPForLevel(1), p.XPForLevel(2))
	}
	for l := 1; l <= p.MaxLevel; l++ {
		if got := p.LevelFromXP(p.XPForLevel(l)); got != l {
			t.Fatalf("LevelFromXP(XPForLevel(%d)) = %d", l, got)
		}
	}
	if !d.Cosmetics.IsFree("teams", "team_volt") || d.Cosmetics.IsFree("teams", "team_ocean") {
		t.Fatal("cosmetic pricing mismatch")
	}
	if d.Economy.StartingBalance["coins"] != 500 {
		t.Fatalf("starting coins = %d", d.Economy.StartingBalance["coins"])
	}
}

func TestClubTeamsSwitch(t *testing.T) {
	on, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(on.Cosmetics.Teams) != 12 || on.Cosmetics.Exists("teams", "club_real_madrid") || on.Cosmetics.Exists("teams", "nation_iran") {
		t.Fatal("catalog must contain only the real car models")
	}

	saved := economyJSON
	defer func() { economyJSON = saved }()
	economyJSON = bytes.Replace(saved, []byte(`"enabled": true,
      "note"`), []byte(`"enabled": false,
      "note"`), 1)
	if bytes.Equal(economyJSON, saved) {
		t.Fatal("test fixture: clubTeams switch not found in economy.json")
	}
	off, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if off.Cosmetics.Exists("teams", "club_real_madrid") {
		t.Fatal("club teams must leave the catalog when clubTeams is disabled")
	}
	if len(off.Cosmetics.Teams) != 12 || !off.Cosmetics.Exists("teams", "team_volt") {
		t.Fatal("all real car teams must stay")
	}
}

func TestCurrencyPacksGrantCurrency(t *testing.T) {
	d, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Cosmetics.CurrencyPacks) == 0 {
		t.Fatal("no currency packs")
	}
	for _, p := range d.Cosmetics.CurrencyPacks {
		if p.Grant["coins"] <= 0 && p.Grant["gems"] <= 0 {
			t.Fatalf("pack %s grants nothing", p.ID)
		}
	}
}
