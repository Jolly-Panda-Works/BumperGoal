package gamedata

// Balance overrides: admin edits layered over the embedded defaults at runtime.
//
// An override maps a path to a replacement leaf value. A path starts with the
// file name ("economy", "cosmetics", ...) and walks object keys; array elements
// are addressed by "@<id>" when they carry an id, otherwise by index:
//
//	economy/startingBalance             {"coins": 800, "gems": 10}
//	cosmetics/teams/@team_ocean/price   {"coins": 1500}
//	ai-profiles/profiles/@pro/aimErrorDeg  2.5
//	rules/formation/0                   [-6, 0]
//	cosmetics/teams/@team_ocean/image   "data:image/webp;base64,..." (replaces the disc art)
//	arenas/arenas/@city/theme           "coast" (board look: one of the default themes)
//
// Only balance leaves are editable: numbers, booleans, prices and number or
// price lists. Ids, strings and structure (adding or removing items) are not.
// packages/config/src/overrides.ts applies the same paths on the client.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Leaf kinds an override can replace.
const (
	KindNumber  = "number"
	KindBool    = "bool"
	KindPrice   = "price"
	KindNumbers = "numbers"
	KindPrices  = "prices"
	KindImage   = "image"
	KindChoice  = "choice"
	KindArt     = "art"
)

// An arena's uploaded board art (cover, background, turf, frame, goal), each an
// "asset:<sha256>" image from admin_asset_put: arenas/arenas/@<id>/art.
var artPath = regexp.MustCompile(`^arenas/arenas/@[^/]+/art$`)

// Arenas added in the panel: arenas/arenas/+<id> holds the whole new arena.
var newArenaPath = regexp.MustCompile(`^arenas/arenas/\+([a-z][a-z0-9_]{1,23})$`)

var assetRef = regexp.MustCompile(`^asset:[0-9a-f]{64}$`)

// An arena's look is one of the board themes the defaults already use.
var themePath = regexp.MustCompile(`^arenas/arenas/@[^/]+/theme$`)

// Themes lists the board themes an arena can use (from the embedded defaults).
func Themes() []string {
	var a Arenas
	_ = json.Unmarshal(arenasJSON, &a)
	seen := map[string]bool{}
	out := []string{}
	for _, arena := range a.Arenas {
		if !seen[arena.Theme] {
			seen[arena.Theme] = true
			out = append(out, arena.Theme)
		}
	}
	return out
}

// MaxImageLength caps a team image data URL (the panel uploads ~192 px webp).
const MaxImageLength = 60000

// Team disc art can be replaced by an uploaded image: cosmetics/teams/@<id>/image.
// Any shop item and AI level can get an uploaded picture: <list>/@<id>/image.
var imagePath = regexp.MustCompile(`^(cosmetics/(teams|balls|avatars|trails|currencyPacks)|ai-profiles/profiles)/@[^/]+/image$`)
var imagePrefix = regexp.MustCompile(`^data:image/(webp|png|jpeg);base64,`)

// Overrides maps a path to its replacement value.
type Overrides map[string]json.RawMessage

// Files lists every config document by the name used as the first path segment.
var Files = []string{"economy", "cosmetics", "arenas", "progression", "rules", "physics", "ai-profiles"}

func rawFile(name string) []byte {
	switch name {
	case "physics":
		return physicsJSON
	case "rules":
		return rulesJSON
	case "progression":
		return progressionJSON
	case "economy":
		return economyJSON
	case "cosmetics":
		return cosmeticsJSON
	case "arenas":
		return arenasJSON
	case "ai-profiles":
		return aiProfilesJSON
	}
	return nil
}

// Defaults returns the embedded documents, keyed by file name.
func Defaults() map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, f := range Files {
		out[f] = rawFile(f)
	}
	return out
}

// Price objects: currency → whole amount. "price" may also be null (free item).
var priceKeys = map[string]bool{"price": true, "grant": true, "startingBalance": true, "tutorialReward": true}

// Number lists whose length is part of the balance; every other list keeps its length.
var variableLists = map[string]bool{"powerSteps": true, "angleOffsetsDeg": true, "dailyRewards": true}

// Paths that stay fixed: tied to art, layout, unbuilt features or loadout defaults.
var lockedPaths = []string{
	"rules/discsPerTeam",
	"physics/arena/halfWidth",
	"physics/arena/halfHeight",
	"physics/arena/cornerChamfer",
	"economy/features/payments",
	"economy/features/ads",
	"economy/features/lootBoxes",
	"economy/features/vip",
	"economy/features/seasonPass",
}

var currencies = map[string]bool{"coins": true, "gems": true}

// LeafKind classifies a default value found under key; "" means not editable.
func LeafKind(key string, def any) string {
	if priceKeys[key] {
		return KindPrice
	}
	if key == "dailyRewards" {
		return KindPrices
	}
	switch v := def.(type) {
	case float64:
		return KindNumber
	case bool:
		return KindBool
	case []any:
		if len(v) == 0 {
			return ""
		}
		for _, e := range v {
			if _, ok := e.(float64); !ok {
				return ""
			}
		}
		return KindNumbers
	}
	return ""
}

func locked(path string, segs []string) bool {
	for _, p := range lockedPaths {
		if path == p || strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	for _, s := range segs {
		if s == "default" || s == "id" {
			return true
		}
	}
	return false
}

// node is a resolved leaf inside a decoded document.
type node struct {
	set  func(any)
	val  any
	key  string
	kind string
}

// locate walks a decoded document set to the leaf a path names.
func locate(docs map[string]any, path string) (node, error) {
	segs := strings.Split(path, "/")
	root, ok := docs[segs[0]]
	if !ok || len(segs) < 2 {
		return node{}, fmt.Errorf("%s: unknown path", path)
	}
	if locked(path, segs) {
		return node{}, fmt.Errorf("%s: not editable", path)
	}
	cur, key := root, segs[0]
	var set func(any)
	for _, seg := range segs[1:] {
		if LeafKind(key, cur) != "" {
			return node{}, fmt.Errorf("%s: unknown path", path)
		}
		switch c := cur.(type) {
		case map[string]any:
			child, ok := c[seg]
			if !ok && ((seg == "image" && imagePath.MatchString(path)) || (seg == "art" && artPath.MatchString(path))) {
				ok = true // no image or art until one is uploaded
			}
			if !ok {
				return node{}, fmt.Errorf("%s: unknown path", path)
			}
			cur, key, set = child, seg, func(v any) { c[seg] = v }
		case []any:
			idx := -1
			if strings.HasPrefix(seg, "@") {
				for j, e := range c {
					if m, ok := e.(map[string]any); ok && m["id"] == seg[1:] {
						idx = j
						break
					}
				}
			} else if n, err := strconv.Atoi(seg); err == nil && n >= 0 && n < len(c) {
				if m, ok := c[n].(map[string]any); !ok || m["id"] == nil {
					idx = n
				}
			}
			if idx < 0 {
				return node{}, fmt.Errorf("%s: unknown path", path)
			}
			j := idx
			cur, set = c[j], func(v any) { c[j] = v }
		default:
			return node{}, fmt.Errorf("%s: unknown path", path)
		}
	}
	kind := LeafKind(key, cur)
	if imagePath.MatchString(path) {
		kind = KindImage
	} else if themePath.MatchString(path) {
		kind = KindChoice
	} else if artPath.MatchString(path) {
		kind = KindArt
	}
	if kind == "" {
		return node{}, fmt.Errorf("%s: not editable", path)
	}
	return node{set: set, val: cur, key: key, kind: kind}, nil
}

func checkPrice(v any, nullable bool) (any, error) {
	if v == nil {
		if nullable {
			return nil, nil
		}
		return nil, fmt.Errorf("price required")
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("price must be an object")
	}
	for c, a := range m {
		n, ok := a.(float64)
		if !currencies[c] || !ok || n < 0 || n != math.Trunc(n) || n > 1e9 {
			return nil, fmt.Errorf("price %s must be a whole amount of coins or gems", c)
		}
	}
	return m, nil
}

// checkValue validates a replacement for a leaf and returns it decoded.
func checkValue(n node, raw json.RawMessage) (any, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("invalid JSON")
	}
	switch n.kind {
	case KindNumber:
		if f, ok := v.(float64); ok && !math.IsInf(f, 0) {
			return f, nil
		}
		return nil, fmt.Errorf("must be a number")
	case KindImage:
		str, ok := v.(string)
		loc := imagePrefix.FindStringIndex(str)
		if !ok || loc == nil || len(str) > MaxImageLength {
			return nil, fmt.Errorf("image must be a webp, png or jpeg data URL under %d KB", MaxImageLength/1000)
		}
		if _, err := base64.StdEncoding.DecodeString(str[loc[1]:]); err != nil {
			return nil, fmt.Errorf("image data is not valid base64")
		}
		return str, nil
	case KindArt:
		return checkArt(v)
	case KindChoice:
		str, _ := v.(string)
		for _, t := range Themes() {
			if str == t {
				return str, nil
			}
		}
		return nil, fmt.Errorf("theme must be one of %s", strings.Join(Themes(), ", "))
	case KindBool:
		if _, ok := v.(bool); ok {
			return v, nil
		}
		return nil, fmt.Errorf("must be true or false")
	case KindPrice:
		return checkPrice(v, n.key == "price")
	case KindNumbers, KindPrices:
		list, ok := v.([]any)
		if !ok || len(list) == 0 || len(list) > 64 {
			return nil, fmt.Errorf("must be a list of 1-64 entries")
		}
		if !variableLists[n.key] && len(list) != len(n.val.([]any)) {
			return nil, fmt.Errorf("must keep %d entries", len(n.val.([]any)))
		}
		for _, e := range list {
			if n.kind == KindPrices {
				if _, err := checkPrice(e, false); err != nil {
					return nil, err
				}
			} else if _, ok := e.(float64); !ok {
				return nil, fmt.Errorf("entries must be numbers")
			}
		}
		return list, nil
	}
	return nil, fmt.Errorf("not editable")
}

// LoadWith parses the embedded defaults with overrides applied and validates
// the result. strict rejects any override that does not apply; otherwise such
// paths are skipped and returned as stale (a default they named was removed).
func LoadWith(o Overrides, strict bool) (*Data, []string, error) {
	docs := map[string]any{}
	for _, f := range Files {
		var v any
		if err := json.Unmarshal(rawFile(f), &v); err != nil {
			return nil, nil, fmt.Errorf("gamedata %s: %w", f, err)
		}
		docs[f] = v
	}
	paths := make([]string, 0, len(o))
	for p := range o {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var stale []string
	for _, p := range paths {
		m := newArenaPath.FindStringSubmatch(p)
		if m == nil {
			continue
		}
		if err := addArena(docs, m[1], o[p]); err != nil {
			if strict {
				return nil, nil, fmt.Errorf("%s: %w", p, err)
			}
			stale = append(stale, p)
		}
	}
	for _, p := range paths {
		if newArenaPath.MatchString(p) {
			continue
		}
		n, err := locate(docs, p)
		var v any
		if err == nil {
			v, err = checkValue(n, o[p])
			if err != nil {
				err = fmt.Errorf("%s: %w", p, err)
			}
		}
		if err != nil {
			if strict {
				return nil, nil, err
			}
			stale = append(stale, p)
			continue
		}
		n.set(v)
	}
	raws := map[string][]byte{}
	for f, v := range docs {
		raws[f], _ = json.Marshal(v)
	}
	d, err := parse(raws)
	if err != nil {
		return nil, stale, err
	}
	if err := d.Validate(); err != nil {
		return nil, stale, err
	}
	return d, stale, nil
}

// Physics mirrors the parts of physics.json that balance checks need.
type Physics struct {
	Arena struct {
		GoalHalfWidth   float64 `json:"goalHalfWidth"`
		GoalDepth       float64 `json:"goalDepth"`
		HalfHeight      float64 `json:"halfHeight"`
		WallRestitution float64 `json:"wallRestitution"`
		StopSpeed       float64 `json:"stopSpeed"`
	} `json:"arena"`
	Disc            Body    `json:"disc"`
	Ball            Body    `json:"ball"`
	MaxStepsPerShot int     `json:"maxStepsPerShot"`
	MaxImpulse      float64 `json:"maxImpulse"`
	MinImpulse      float64 `json:"minImpulse"`
	BoundsMargin    float64 `json:"boundsMargin"`
}

type Body struct {
	HalfLength     float64 `json:"halfLength,omitempty"`
	HalfWidth      float64 `json:"halfWidth,omitempty"`
	BorderRadius   float64 `json:"borderRadius,omitempty"`
	AngularDamping float64 `json:"angularDamping,omitempty"`
	Radius         float64 `json:"radius"`
	Density        float64 `json:"density"`
	LinearDamping  float64 `json:"linearDamping"`
	Restitution    float64 `json:"restitution"`
}

func between(name string, v, lo, hi float64) error {
	if math.IsNaN(v) || v < lo || v > hi {
		return fmt.Errorf("%s must be between %g and %g", name, lo, hi)
	}
	return nil
}

// Validate rejects values that would break play or the economy.
func (d *Data) Validate() error {
	var p Physics
	if err := json.Unmarshal(d.PhysicsRaw, &p); err != nil {
		return fmt.Errorf("gamedata physics: %w", err)
	}
	checks := []error{
		between("rules.goalsToWin", float64(d.Rules.GoalsToWin), 1, 20),
		between("rules.turnTimeMs", float64(d.Rules.TurnTimeMs), 3000, 120000),
		between("rules.timeoutForfeitCount", float64(d.Rules.TimeoutForfeitCount), 1, 20),
		between("rules.maxShots", float64(d.Rules.MaxShots), 2, 1000),
		between("progression.maxLevel", float64(d.Progression.MaxLevel), 2, 1000),
		between("progression.levelCurve.base", d.Progression.LevelCurve.Base, 1, 1e6),
		between("progression.levelCurve.exponent", d.Progression.LevelCurve.Exponent, 0.1, 5),
		between("progression.xp.win", float64(d.Progression.XP.Win), 0, 1e6),
		between("progression.xp.loss", float64(d.Progression.XP.Loss), 0, 1e6),
		between("progression.xp.perGoal", float64(d.Progression.XP.PerGoal), 0, 1e6),
		between("progression.levelReward.coinsPerLevel", float64(d.Progression.LevelReward.CoinsPerLevel), 0, 1e6),
		between("progression.levelReward.gemsEveryNLevels", float64(d.Progression.LevelReward.GemsEveryNLevels), 1, 1000),
		between("progression.levelReward.gemsAmount", float64(d.Progression.LevelReward.GemsAmount), 0, 1e6),
		between("economy.rewardedAd.coins", float64(d.Economy.RewardedAd.Coins), 0, 1e6),
		between("economy.rewardedAd.dailyCap", float64(d.Economy.RewardedAd.DailyCap), 0, 100),
		between("arenas.houseCut", d.Arenas.HouseCut, 0, 0.95),
		between("physics.arena.goalHalfWidth", p.Arena.GoalHalfWidth, 0.3, p.Arena.HalfHeight-0.2),
		between("physics.arena.goalDepth", p.Arena.GoalDepth, 0.3, 3),
		between("physics.arena.wallRestitution", p.Arena.WallRestitution, 0, 1.5),
		between("physics.arena.stopSpeed", p.Arena.StopSpeed, 0.001, 1),
		between("physics.maxStepsPerShot", float64(p.MaxStepsPerShot), 60, 6000),
		between("physics.minImpulse", p.MinImpulse, 0.01, 100),
		between("physics.maxImpulse", p.MaxImpulse, p.MinImpulse, 100),
		between("physics.boundsMargin", p.BoundsMargin, 0.5, 10),
	}
	for name, b := range map[string]Body{"disc": p.Disc, "ball": p.Ball} {
		checks = append(checks,
			between("physics."+name+".radius", b.Radius, 0.05, 1.5),
			between("physics."+name+".density", b.Density, 0.01, 100),
			between("physics."+name+".linearDamping", b.LinearDamping, 0, 20),
			between("physics."+name+".restitution", b.Restitution, 0, 1.5),
		)
	}
	checks = append(checks,
		between("physics.disc.halfLength", p.Disc.HalfLength, 0.1, 1.5),
		between("physics.disc.halfWidth", p.Disc.HalfWidth, 0.1, 1.5),
		between("physics.disc.borderRadius", p.Disc.BorderRadius, 0, math.Min(p.Disc.HalfLength, p.Disc.HalfWidth)),
		between("physics.disc.angularDamping", p.Disc.AngularDamping, 0, 20),
	)
	for _, c := range []string{"coins", "gems"} {
		if _, ok := d.Economy.StartingBalance[c]; !ok {
			checks = append(checks, fmt.Errorf("economy.startingBalance needs %s", c))
		}
	}
	if len(d.Economy.DailyRewards) == 0 {
		checks = append(checks, fmt.Errorf("economy.dailyRewards needs at least one day"))
	}
	for _, a := range d.Arenas.Arenas {
		checks = append(checks,
			between("arenas."+a.ID+".entryFee", float64(a.EntryFee), 0, 1e9),
			between("arenas."+a.ID+".minLevel", float64(a.MinLevel), 1, float64(d.Progression.MaxLevel)),
			between("arenas."+a.ID+".xpMultiplier", a.XPMultiplier, 0, 100),
		)
	}
	for _, a := range d.AIProfiles {
		n := "ai-profiles." + a.ID
		checks = append(checks,
			between(n+".minLevel", float64(a.MinLevel), 1, float64(d.Progression.MaxLevel)),
			between(n+".maxSimulations", float64(a.MaxSimulations), 1, 2000),
			between(n+".aimErrorDeg", a.AimErrorDeg, 0, 90),
			between(n+".powerError", a.PowerError, 0, 1),
			between(n+".defensiveWeight", a.DefensiveWeight, 0, 10),
			between(n+".riskTolerance", a.RiskTolerance, 0, 10),
			between(n+".thinkTimeMs", float64(a.ThinkTimeMs), 0, 10000),
		)
		for _, s := range a.PowerSteps {
			checks = append(checks, between(n+".powerSteps", s, 0.05, 1))
		}
	}
	for _, t := range d.Cosmetics.Teams {
		if a := t.Attributes; a != nil {
			for name, v := range map[string]int{"force": a.Force, "time": a.Time, "aim": a.Aim, "weight": a.Weight} {
				checks = append(checks, between("cosmetics."+t.ID+"."+name, float64(v), 1, 10))
			}
		}
	}
	for _, err := range checks {
		if err != nil {
			return err
		}
	}
	return nil
}

func number(m map[string]any, key string, lo, hi float64, whole bool) (float64, error) {
	v, ok := m[key].(float64)
	if !ok || v < lo || v > hi || (whole && v != math.Trunc(v)) {
		return 0, fmt.Errorf("%s must be between %g and %g", key, lo, hi)
	}
	return v, nil
}

// checkArt validates an arena art object and keeps only known fields.
func checkArt(v any) (any, error) {
	in, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("art must be an object")
	}
	out := map[string]any{}
	for part, raw := range in {
		switch part {
		case "cover", "background", "turf", "frame", "goal":
		default:
			return nil, fmt.Errorf("unknown art part %q", part)
		}
		img, ok := raw.(map[string]any)
		src, _ := img["src"].(string)
		if !ok || !assetRef.MatchString(src) {
			return nil, fmt.Errorf("%s must reference an uploaded image", part)
		}
		w, err := number(img, "w", 1, 4096, true)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", part, err)
		}
		h, err := number(img, "h", 1, 4096, true)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", part, err)
		}
		clean := map[string]any{"src": src, "w": w, "h": h}
		if part == "frame" {
			insets, ok := img["insets"].(map[string]any)
			if !ok {
				return nil, fmt.Errorf("frame needs insets")
			}
			ci := map[string]any{}
			for _, side := range []string{"left", "top", "right", "bottom"} {
				limit := w / 2
				if side == "top" || side == "bottom" {
					limit = h / 2
				}
				n, err := number(insets, side, 0, limit, true)
				if err != nil {
					return nil, fmt.Errorf("frame inset %w", err)
				}
				ci[side] = n
			}
			clean["insets"] = ci
		}
		if part == "goal" {
			mouth, err := number(img, "mouthX", 0, 1, false)
			if err != nil {
				return nil, fmt.Errorf("goal %w", err)
			}
			clean["mouthX"] = mouth
		}
		out[part] = clean
	}
	return out, nil
}

// addArena appends an arena defined in the panel to the arenas document.
func addArena(docs map[string]any, id string, raw json.RawMessage) error {
	var in map[string]any
	if err := json.Unmarshal(raw, &in); err != nil {
		return fmt.Errorf("arena must be an object")
	}
	list, _ := docs["arenas"].(map[string]any)["arenas"].([]any)
	for _, a := range list {
		if m, _ := a.(map[string]any); m["id"] == id {
			return fmt.Errorf("arena %s already exists", id)
		}
	}
	arena := map[string]any{"id": id}
	var err error
	if arena["entryFee"], err = number(in, "entryFee", 0, 1e9, true); err != nil {
		return err
	}
	if arena["minLevel"], err = number(in, "minLevel", 1, 1000, true); err != nil {
		return err
	}
	if arena["xpMultiplier"], err = number(in, "xpMultiplier", 0, 100, false); err != nil {
		return err
	}
	theme, _ := in["theme"].(string)
	known := false
	for _, t := range Themes() {
		known = known || t == theme
	}
	if !known {
		return fmt.Errorf("theme must be one of %s", strings.Join(Themes(), ", "))
	}
	arena["theme"] = theme
	names, ok := in["names"].(map[string]any)
	if !ok {
		return fmt.Errorf("arena needs names")
	}
	clean := map[string]any{}
	for lang, n := range names {
		str, ok := n.(string)
		if !ok || len(lang) > 8 || utf8.RuneCountInString(str) > 40 {
			return fmt.Errorf("arena names must be text of at most 40 characters")
		}
		if strings.TrimSpace(str) != "" {
			clean[lang] = strings.TrimSpace(str)
		}
	}
	if _, ok := clean["en"]; !ok {
		return fmt.Errorf("arena needs an English name")
	}
	arena["names"] = clean
	docs["arenas"].(map[string]any)["arenas"] = append(list, arena)
	return nil
}
