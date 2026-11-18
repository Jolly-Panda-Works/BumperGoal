package main

// Images uploaded in the admin panel (arena art). Stored once per content hash as
// server-owned objects; config overrides refer to them as "asset:<sha256>".
// Players fetch each image once with asset_get and cache it on the device.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg" // registers the decoder for DecodeConfig
	_ "image/png"
	"regexp"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	collectionAsset = "admin_asset"
	maxAssetBytes   = 360000 // decoded; the base64 request stays under socket.max_request_size_bytes
	maxAssetSide    = 4096
)

var assetID = regexp.MustCompile(`^[0-9a-f]{64}$`)

type storedAsset struct {
	Mime string `json:"mime"`
	Data string `json:"data"` // base64
	W    int    `json:"w"`
	H    int    `json:"h"`
}

// imageSize checks the bytes are a PNG, JPEG or WebP image and returns its size.
func imageSize(data []byte) (mime string, w, h int, err error) {
	if len(data) > 30 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		w, h, err = webpSize(data)
		return "image/webp", w, h, err
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		return "", 0, 0, fmt.Errorf("image must be PNG, JPEG or WebP")
	}
	return "image/" + format, cfg.Width, cfg.Height, nil
}

// webpSize reads the canvas size from a VP8, VP8L or VP8X header.
func webpSize(d []byte) (int, int, error) {
	switch string(d[12:16]) {
	case "VP8 ":
		if d[23] == 0x9d && d[24] == 0x01 && d[25] == 0x2a {
			return int(d[26]) | int(d[27]&0x3f)<<8, int(d[28]) | int(d[29]&0x3f)<<8, nil
		}
	case "VP8L":
		if d[20] == 0x2f {
			b := uint32(d[21]) | uint32(d[22])<<8 | uint32(d[23])<<16 | uint32(d[24])<<24
			return int(b&0x3fff) + 1, int(b>>14&0x3fff) + 1, nil
		}
	case "VP8X":
		return 1 + (int(d[24]) | int(d[25])<<8 | int(d[26])<<16), 1 + (int(d[27]) | int(d[28])<<8 | int(d[29])<<16), nil
	}
	return 0, 0, fmt.Errorf("unreadable WebP image")
}

func rpcAdminAssetPut(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var req struct {
		Data string `json:"data"` // data URL
	}
	uid, err := adminAuthorize(ctx, payload, &req)
	if err != nil {
		return "", err
	}
	_, b64, ok := strings.Cut(req.Data, ";base64,")
	if !ok || !strings.HasPrefix(req.Data, "data:image/") {
		return "", runtime.NewError("image must be a data URL", codeInvalidArgument)
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || len(raw) == 0 {
		return "", runtime.NewError("image data is not valid base64", codeInvalidArgument)
	}
	if len(raw) > maxAssetBytes {
		return "", runtime.NewError(fmt.Sprintf("image is larger than %d KB", maxAssetBytes/1000), codeInvalidArgument)
	}
	mime, w, h, err := imageSize(raw)
	if err != nil {
		return "", runtime.NewError(err.Error(), codeInvalidArgument)
	}
	if w < 1 || h < 1 || w > maxAssetSide || h > maxAssetSide {
		return "", runtime.NewError(fmt.Sprintf("image must be at most %d px on each side", maxAssetSide), codeInvalidArgument)
	}
	sum := sha256.Sum256(raw)
	id := hex.EncodeToString(sum[:])
	value, _ := json.Marshal(storedAsset{Mime: mime, Data: base64.StdEncoding.EncodeToString(raw), W: w, H: h})
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection: collectionAsset, Key: id, UserID: systemUserID, Value: string(value),
		PermissionRead: permNoRead, PermissionWrite: permNoWrite,
	}}); err != nil {
		return "", runtime.NewError("image save failed", codeInternal)
	}
	logger.WithFields(map[string]any{"user_id": uid, "asset": id, "bytes": len(raw)}).Info("admin_asset_saved")
	out, _ := json.Marshal(map[string]any{"id": id, "w": w, "h": h, "mime": mime})
	return string(out), nil
}

// rpcAssetGet returns one uploaded image to any signed-in player.
func rpcAssetGet(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	if _, err := userIDFrom(ctx); err != nil {
		return "", err
	}
	var req struct {
		ID string `json:"id"`
	}
	if len(payload) > 256 || json.Unmarshal([]byte(payload), &req) != nil || !assetID.MatchString(req.ID) {
		return "", runtime.NewError("invalid asset", codeInvalidArgument)
	}
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{Collection: collectionAsset, Key: req.ID, UserID: systemUserID}})
	if err != nil {
		return "", runtime.NewError("asset unavailable", codeInternal)
	}
	if len(objs) == 0 {
		return "", runtime.NewError("unknown asset", codeNotFound)
	}
	return objs[0].GetValue(), nil
}
