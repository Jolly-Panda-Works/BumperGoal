package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func liveComms(t *testing.T) *commsClient {
	t.Helper()
	base, key := os.Getenv("COMMS_LIVE_URL"), os.Getenv("COMMS_LIVE_SERVER_KEY")
	if base == "" || key == "" {
		t.Skip("set COMMS_LIVE_URL and COMMS_LIVE_SERVER_KEY to run against a real comms")
	}
	c, err := newCommsClient(base, key, voiceTimeout)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func playerJoin(t *testing.T, base, token string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(base, "/")+"/v1/game/join", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestLiveCommsRoomLifecycle(t *testing.T) {
	c := liveComms(t)
	ctx := context.Background()
	match := "flickkick-live-" + strconv.FormatInt(time.Now().UnixNano(), 36) + ".nakama"
	players := []voicePlayer{{ID: "11111111-1111-1111-1111-111111111111", Name: "Ada"}, {ID: "22222222-2222-2222-2222-222222222222", Name: "بن"}}
	if err := c.OpenRoom(ctx, match, players); err != nil {
		t.Fatal(err)
	}
	if err := c.OpenRoom(ctx, match, players); err != nil {
		t.Fatal("open must be idempotent", err)
	}
	tok, err := c.Token(ctx, match, players[0].ID)
	if err != nil || tok.Token == "" {
		t.Fatal(tok, err)
	}
	status, joined := playerJoin(t, c.baseURL, tok.Token)
	if status != http.StatusOK || joined["player_token"] == nil {
		t.Fatal(status, joined)
	}
	media, _ := joined["media"].(map[string]any)
	if media["url"] == "" || media["token"] == "" {
		t.Fatal("no media grant", joined)
	}
	if status, _ := playerJoin(t, c.baseURL, tok.Token); status != http.StatusUnauthorized {
		t.Fatal("join token reused", status)
	}
	if _, err := c.Token(ctx, match, "33333333-3333-3333-3333-333333333333"); err == nil {
		t.Fatal("token for a player who is not in the match")
	}
	v := newVoiceService(c, "", nil)
	second, err := v.token(ctx, match, players[1].ID, players)
	if err != nil || second.Token == "" {
		t.Fatal(err)
	}
	if err := c.CloseRoom(ctx, match); err != nil {
		t.Fatal(err)
	}
	if err := c.CloseRoom(ctx, match); err != nil {
		t.Fatal("closing twice must succeed", err)
	}
	if status, _ := playerJoin(t, c.baseURL, second.Token); status == http.StatusOK {
		t.Fatal("joined a closed room")
	}
	if os.Getenv("COMMS_LIVE_PRINT_TOKENS") != "" {
		reopened := match + "-ui"
		if err := c.OpenRoom(ctx, reopened, players); err != nil {
			t.Fatal(err)
		}
		a, _ := c.Token(ctx, reopened, players[0].ID)
		b, _ := c.Token(ctx, reopened, players[1].ID)
		out, _ := json.Marshal(map[string]string{"match": reopened, "a": a.Token, "b": b.Token})
		t.Log("TOKENS " + string(out))
	}
}
