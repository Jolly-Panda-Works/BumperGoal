package main

import (
	"testing"
	"time"
)

func TestBotFallbackCannotExceedTenSeconds(t *testing.T) {
	previous := botTimeout
	defer func() { botTimeout = previous }()
	for _, value := range []string{"", "15000", "10000", "2000"} {
		botTimeout = 10 * time.Second
		configureMatchmaking(map[string]string{"MM_BOT_TIMEOUT_MS": value})
		if botTimeout > 10*time.Second {
			t.Fatalf("fallback delayed by %s", value)
		}
		if value == "2000" && botTimeout != 2*time.Second {
			t.Fatal("local test override ignored")
		}
	}
}
