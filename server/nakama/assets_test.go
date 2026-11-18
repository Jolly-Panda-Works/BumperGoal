package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"testing"
)

func pngDataURL(t *testing.T, w, h int) string {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestAdminAssetsRoundTrip(t *testing.T) {
	withAdmin(t)
	nk := newVersionedStorage()
	token := adminToken(t, nk)
	if _, err := adminCall(t, rpcAdminAssetPut, nk, map[string]any{"token": "bad", "data": pngDataURL(t, 4, 4)}); err == nil {
		t.Fatal("unsigned upload accepted")
	}
	res, err := adminCall(t, rpcAdminAssetPut, nk, map[string]any{"token": token, "data": pngDataURL(t, 40, 20)})
	if err != nil {
		t.Fatal(err)
	}
	id := strings.Trim(string(res["id"]), `"`)
	if !assetID.MatchString(id) || string(res["w"]) != "40" || string(res["h"]) != "20" {
		t.Fatalf("upload result %v", res)
	}
	got, err := adminCall(t, rpcAssetGet, nk, map[string]any{"id": id})
	if err != nil || strings.Trim(string(got["mime"]), `"`) != "image/png" {
		t.Fatalf("asset_get: %v %v", err, got["mime"])
	}
	for name, data := range map[string]string{
		"not image": "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("hello world")),
		"svg":       "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
		"no base64": "data:image/png,xyz",
	} {
		if _, err := adminCall(t, rpcAdminAssetPut, nk, map[string]any{"token": token, "data": data}); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if _, err := adminCall(t, rpcAssetGet, nk, map[string]any{"id": "../x"}); err == nil {
		t.Error("bad id accepted")
	}
}

func TestWebPSize(t *testing.T) {
	// 1x1 lossless WebP.
	raw, _ := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	mime, w, h, err := imageSize(raw)
	if err != nil || mime != "image/webp" || w != 1 || h != 1 {
		t.Fatalf("webp: %s %d %d %v", mime, w, h, err)
	}
}
