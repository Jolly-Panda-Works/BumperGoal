package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/heroiclabs/nakama-common/runtime"
)

func (s *versionedStorage) StorageDelete(_ context.Context, deletes []*runtime.StorageDelete) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, d := range deletes {
		delete(s.objects, identityKey(d.Collection, d.Key, d.UserID))
	}
	return nil
}

func adminToken(t *testing.T, nk runtime.NakamaModule) string {
	t.Helper()
	login, err := adminCall(t, rpcAdminLogin, nk, map[string]any{"username": "ops", "password": "correct horse battery"})
	if err != nil {
		t.Fatal(err)
	}
	var token string
	_ = json.Unmarshal(login["token"], &token)
	return token
}

func TestAdminLanguagesLifecycle(t *testing.T) {
	withAdmin(t)
	old := liveLanguages.Load()
	t.Cleanup(func() { liveLanguages.Store(old) })
	liveLanguages.Store(nil)
	nk := newVersionedStorage()
	token := adminToken(t, nk)
	german := map[string]any{
		"code": "de", "label": "Deutsch", "dir": "ltr", "locale": "de-DE", "enabled": false,
		"translation": map[string]any{"app": map[string]any{"name": "FlickKick"}, "nav": map[string]any{"home": "Start"}},
	}
	if _, err := adminCall(t, rpcAdminLanguageSet, nk, map[string]any{"token": "bad", "language": german}); err == nil {
		t.Fatal("unsigned language save accepted")
	}
	res, err := adminCall(t, rpcAdminLanguageSet, nk, map[string]any{"token": token, "language": german})
	if err != nil {
		t.Fatal(err)
	}
	var langs []LanguageMeta
	_ = json.Unmarshal(res["languages"], &langs)
	if len(langs) != 1 || langs[0].Strings != 2 || currentLanguages().Revision != 1 {
		t.Fatalf("saved: %+v", langs)
	}

	// Disabled languages stay hidden from players.
	players, err := adminCall(t, rpcLanguagesGet, nk, map[string]any{"codes": []string{"de"}})
	if err != nil || string(players["languages"]) != "[]" || string(players["translations"]) != "{}" {
		t.Fatalf("disabled language leaked: %v %s %s", err, players["languages"], players["translations"])
	}
	german["enabled"] = true
	if _, err := adminCall(t, rpcAdminLanguageSet, nk, map[string]any{"token": token, "language": german}); err != nil {
		t.Fatal(err)
	}
	players, err = adminCall(t, rpcLanguagesGet, nk, map[string]any{"codes": []string{"de", "fr"}})
	if err != nil || !strings.Contains(string(players["translations"]), "Start") || currentLanguages().Revision != 2 {
		t.Fatalf("enabled language missing: %v %s", err, players["translations"])
	}

	if _, err := adminCall(t, rpcAdminLanguageDelete, nk, map[string]any{"token": token, "code": "de"}); err != nil {
		t.Fatal(err)
	}
	if len(currentLanguages().Languages) != 0 || currentLanguages().Revision != 3 {
		t.Fatal("language not deleted")
	}
	if _, err := adminCall(t, rpcAdminLanguageDelete, nk, map[string]any{"token": token, "code": "de"}); err == nil {
		t.Fatal("deleting an unknown language succeeded")
	}
}

func TestLanguageValidation(t *testing.T) {
	good := languageInput{Code: "pt-br", Label: "Português", Dir: "ltr", Locale: "pt-BR", Translation: json.RawMessage(`{"a":{"b":"c"}}`)}
	if n, err := validateLanguage(good); err != nil || n != 1 {
		t.Fatalf("valid language rejected: %v", err)
	}
	for name, mutate := range map[string]func(*languageInput){
		"built-in":    func(l *languageInput) { l.Code = "fa" },
		"bad code":    func(l *languageInput) { l.Code = "Deutsch" },
		"empty label": func(l *languageInput) { l.Label = " " },
		"direction":   func(l *languageInput) { l.Dir = "ttb" },
		"locale":      func(l *languageInput) { l.Locale = "x; drop" },
		"not object":  func(l *languageInput) { l.Translation = json.RawMessage(`["a"]`) },
		"number leaf": func(l *languageInput) { l.Translation = json.RawMessage(`{"a":1}`) },
		"proto key":   func(l *languageInput) { l.Translation = json.RawMessage(`{"__proto__":"x"}`) },
		"long string": func(l *languageInput) {
			l.Translation = json.RawMessage(`{"a":"` + strings.Repeat("x", maxTranslationString+1) + `"}`)
		},
	} {
		l := good
		mutate(&l)
		if _, err := validateLanguage(l); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
