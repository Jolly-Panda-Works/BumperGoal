package main

import (
	"context"
	"testing"
	"time"
)

func TestDailyDayAndStatus(t *testing.T) {
	// 21:00 UTC is already the next day in Iran.
	if got := dailyDay(time.Date(2026, 11, 3, 21, 0, 0, 0, time.UTC)); got != "2026-11-04" {
		t.Fatalf("day %s", got)
	}
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	store := &identityStorage{values: map[string]string{identityKey(collectionPlayer, keyDaily, "p"): `{"day":"2026-11-03","index":3}`}}
	if s := dailyStatus(context.Background(), store, "p", now); s.Index != 3 || !s.ClaimedToday {
		t.Fatalf("status %+v", s)
	}
	if s := dailyStatus(context.Background(), store, "p", now.Add(24*time.Hour)); s.ClaimedToday {
		t.Fatal("yesterday's claim counted today")
	}
	if s := dailyStatus(context.Background(), store, "new", now); s.Index != 0 || s.ClaimedToday {
		t.Fatalf("new player %+v", s)
	}
}
