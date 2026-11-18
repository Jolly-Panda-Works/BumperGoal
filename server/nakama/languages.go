package main

// Languages added in the admin panel. The index (codes, names, versions) is one
// server-owned object; each translation is its own object. Clients see the index
// revision in their profile and fetch the translations they lack.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	keyLanguages       = "languages" // in collectionAdmin: the index
	collectionLanguage = "admin_language"

	maxLanguages         = 20
	maxTranslationBytes  = 300000
	maxTranslationString = 4000
	maxTranslationDepth  = 6
)

// Built into the web client; the panel cannot replace them.
var builtInLanguages = map[string]bool{"en": true, "fa": true, "ar": true}

var (
	languageCode   = regexp.MustCompile(`^[a-z]{2,3}(-[a-z0-9]{2,8})?$`)
	languageLocale = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$`)
)

type LanguageMeta struct {
	Code    string `json:"code"`
	Label   string `json:"label"`
	Dir     string `json:"dir"`
	Locale  string `json:"locale"`
	Enabled bool   `json:"enabled"`
	Version int64  `json:"version"`
	Strings int    `json:"strings"`
}

type languageIndex struct {
	Revision  int64          `json:"revision"`
	Languages []LanguageMeta `json:"languages"`
}

// liveLanguages caches the index so profile_get and config_get need no storage read.
var liveLanguages atomic.Pointer[languageIndex]

func currentLanguages() *languageIndex {
	if idx := liveLanguages.Load(); idx != nil {
		return idx
	}
	return &languageIndex{Languages: []LanguageMeta{}}
}

// enabledLanguages is what players may pick.
func (idx *languageIndex) enabled() []LanguageMeta {
	out := []LanguageMeta{}
	for _, l := range idx.Languages {
		if l.Enabled {
			out = append(out, l)
		}
	}
	return out
}

func readLanguageIndex(ctx context.Context, nk runtime.NakamaModule) (languageIndex, string, error) {
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionAdmin, Key: keyLanguages, UserID: systemUserID}})
	if err != nil {
		return languageIndex{}, "", err
	}
	if len(objs) == 0 {
		return languageIndex{Languages: []LanguageMeta{}}, "*", nil
	}
	var idx languageIndex
	if err := json.Unmarshal([]byte(objs[0].GetValue()), &idx); err != nil {
		return languageIndex{}, "", err
	}
	if idx.Languages == nil {
		idx.Languages = []LanguageMeta{}
	}
	return idx, objs[0].GetVersion(), nil
}

func loadLanguages(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	idx, _, err := readLanguageIndex(ctx, nk)
	if err != nil {
		logger.WithField("error", err.Error()).Error("language index unreadable")
		idx = languageIndex{Languages: []LanguageMeta{}}
	}
	liveLanguages.Store(&idx)
}

// countStrings validates a translation tree (nested objects of strings) and counts its leaves.
func countStrings(v any, depth int) (int, error) {
	switch t := v.(type) {
	case string:
		if utf8.RuneCountInString(t) > maxTranslationString {
			return 0, fmt.Errorf("a translation is longer than %d characters", maxTranslationString)
		}
		return 1, nil
	case map[string]any:
		if depth > maxTranslationDepth {
			return 0, fmt.Errorf("translations nest too deep")
		}
		n := 0
		for k, child := range t {
			if k == "" || strings.HasPrefix(k, "__") {
				return 0, fmt.Errorf("invalid translation key %q", k)
			}
			c, err := countStrings(child, depth+1)
			if err != nil {
				return 0, err
			}
			n += c
		}
		return n, nil
	}
	return 0, fmt.Errorf("translations must be text")
}

type languageInput struct {
	Code        string          `json:"code"`
	Label       string          `json:"label"`
	Dir         string          `json:"dir"`
	Locale      string          `json:"locale"`
	Enabled     bool            `json:"enabled"`
	Translation json.RawMessage `json:"translation"`
}

func validateLanguage(in languageInput) (int, error) {
	if !languageCode.MatchString(in.Code) {
		return 0, fmt.Errorf("code must look like \"de\" or \"pt-br\"")
	}
	if builtInLanguages[in.Code] {
		return 0, fmt.Errorf("%s is built into the game", in.Code)
	}
	if l := utf8.RuneCountInString(strings.TrimSpace(in.Label)); l == 0 || l > 40 {
		return 0, fmt.Errorf("name must be 1-40 characters")
	}
	if in.Dir != "ltr" && in.Dir != "rtl" {
		return 0, fmt.Errorf("direction must be ltr or rtl")
	}
	if !languageLocale.MatchString(in.Locale) {
		return 0, fmt.Errorf("locale must look like \"de-DE\"")
	}
	if len(in.Translation) > maxTranslationBytes {
		return 0, fmt.Errorf("translation is larger than %d KB", maxTranslationBytes/1000)
	}
	var tree any
	if err := json.Unmarshal(in.Translation, &tree); err != nil {
		return 0, fmt.Errorf("translation is not valid JSON")
	}
	if _, ok := tree.(map[string]any); !ok {
		return 0, fmt.Errorf("translation must be an object")
	}
	return countStrings(tree, 0)
}

// writeLanguageIndex saves the index (optimistic version) with extra writes in one transaction.
func writeLanguageIndex(ctx context.Context, nk runtime.NakamaModule, idx languageIndex, version string, extra ...*runtime.StorageWrite) error {
	sort.Slice(idx.Languages, func(i, j int) bool { return idx.Languages[i].Code < idx.Languages[j].Code })
	value, _ := json.Marshal(idx)
	writes := append([]*runtime.StorageWrite{{
		Collection: collectionAdmin, Key: keyLanguages, UserID: systemUserID, Value: string(value),
		Version: version, PermissionRead: permNoRead, PermissionWrite: permNoWrite,
	}}, extra...)
	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		if isVersionConflict(err) {
			return runtime.NewError("languages were changed elsewhere; reload", codeInvalidArgument)
		}
		return runtime.NewError("language save failed", codeInternal)
	}
	liveLanguages.Store(&idx)
	return nil
}

func rpcAdminLanguageSet(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		Language languageInput `json:"language"`
	}
	uid, err := adminAuthorize(ctx, payload, &req)
	if err != nil {
		return "", err
	}
	in := req.Language
	in.Label = strings.TrimSpace(in.Label)
	count, err := validateLanguage(in)
	if err != nil {
		return "", runtime.NewError(err.Error(), codeInvalidArgument)
	}
	admin.mu.Lock()
	defer admin.mu.Unlock()
	idx, version, err := readLanguageIndex(ctx, nk)
	if err != nil {
		return "", runtime.NewError("languages unavailable", codeInternal)
	}
	meta := LanguageMeta{Code: in.Code, Label: in.Label, Dir: in.Dir, Locale: in.Locale, Enabled: in.Enabled, Version: time.Now().UnixMilli(), Strings: count}
	replaced := false
	for i, l := range idx.Languages {
		if l.Code == in.Code {
			idx.Languages[i], replaced = meta, true
		}
	}
	if !replaced {
		if len(idx.Languages) >= maxLanguages {
			return "", runtime.NewError(fmt.Sprintf("at most %d added languages", maxLanguages), codeInvalidArgument)
		}
		idx.Languages = append(idx.Languages, meta)
	}
	idx.Revision++
	translation := &runtime.StorageWrite{
		Collection: collectionLanguage, Key: in.Code, UserID: systemUserID, Value: string(in.Translation),
		PermissionRead: permNoRead, PermissionWrite: permNoWrite,
	}
	if err := writeLanguageIndex(ctx, nk, idx, version, translation); err != nil {
		return "", err
	}
	logger.WithFields(map[string]any{"user_id": uid, "code": in.Code, "strings": count, "enabled": in.Enabled}).Info("admin_language_saved")
	return adminLanguagesState(ctx, nk)
}

func rpcAdminLanguageDelete(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		Code string `json:"code"`
	}
	uid, err := adminAuthorize(ctx, payload, &req)
	if err != nil {
		return "", err
	}
	admin.mu.Lock()
	defer admin.mu.Unlock()
	idx, version, err := readLanguageIndex(ctx, nk)
	if err != nil {
		return "", runtime.NewError("languages unavailable", codeInternal)
	}
	kept := idx.Languages[:0]
	for _, l := range idx.Languages {
		if l.Code != req.Code {
			kept = append(kept, l)
		}
	}
	if len(kept) == len(idx.Languages) {
		return "", runtime.NewError("unknown language", codeInvalidArgument)
	}
	idx.Languages = kept
	idx.Revision++
	if err := writeLanguageIndex(ctx, nk, idx, version); err != nil {
		return "", err
	}
	_ = nk.StorageDelete(ctx, []*runtime.StorageDelete{{Collection: collectionLanguage, Key: req.Code, UserID: systemUserID}})
	logger.WithFields(map[string]any{"user_id": uid, "code": req.Code}).Info("admin_language_deleted")
	return adminLanguagesState(ctx, nk)
}

func readTranslations(ctx context.Context, nk runtime.NakamaModule, codes []string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	if len(codes) == 0 {
		return out, nil
	}
	reads := make([]*runtime.StorageRead, 0, len(codes))
	for _, c := range codes {
		reads = append(reads, &runtime.StorageRead{Collection: collectionLanguage, Key: c, UserID: systemUserID})
	}
	objs, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, err
	}
	for _, o := range objs {
		out[o.GetKey()] = json.RawMessage(o.GetValue())
	}
	return out, nil
}

// adminLanguagesState returns every added language with its translation, for the editor.
func adminLanguagesState(ctx context.Context, nk runtime.NakamaModule) (string, error) {
	idx, _, err := readLanguageIndex(ctx, nk)
	if err != nil {
		return "", runtime.NewError("languages unavailable", codeInternal)
	}
	codes := []string{}
	for _, l := range idx.Languages {
		codes = append(codes, l.Code)
	}
	translations, err := readTranslations(ctx, nk, codes)
	if err != nil {
		return "", runtime.NewError("languages unavailable", codeInternal)
	}
	out, _ := json.Marshal(map[string]any{"revision": idx.Revision, "languages": idx.Languages, "translations": translations})
	return string(out), nil
}

func rpcAdminLanguagesGet(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := adminAuthorize(ctx, payload, nil); err != nil {
		return "", err
	}
	return adminLanguagesState(ctx, nk)
}

// rpcLanguagesGet gives players the enabled languages; with "codes" it includes those translations.
func rpcLanguagesGet(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := userIDFrom(ctx); err != nil {
		return "", err
	}
	var req struct {
		Codes []string `json:"codes"`
	}
	if payload != "" && (len(payload) > 1024 || json.Unmarshal([]byte(payload), &req) != nil) {
		return "", runtime.NewError("invalid request", codeInvalidArgument)
	}
	idx := currentLanguages()
	enabled := idx.enabled()
	wanted := []string{}
	for _, c := range req.Codes {
		for _, l := range enabled {
			if l.Code == c {
				wanted = append(wanted, c)
			}
		}
	}
	translations, err := readTranslations(ctx, nk, wanted)
	if err != nil {
		return "", runtime.NewError("languages unavailable", codeInternal)
	}
	out, _ := json.Marshal(map[string]any{"revision": idx.Revision, "languages": enabled, "translations": translations})
	return string(out), nil
}
