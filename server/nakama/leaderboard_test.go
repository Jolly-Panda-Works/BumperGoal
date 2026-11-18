package main

import (
	"testing"
	"time"
)

func TestWeekStartUTC(t *testing.T) {
	monday := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC).Unix()
	for day := 26; day <= 31; day++ {
		if got := weekStart(time.Date(2026, 10, day, 23, 59, 0, 0, time.UTC)); got != monday {
			t.Fatalf("day %d: %d", day, got)
		}
	}
	if got := weekStart(time.Date(2026, 11, 1, 23, 59, 0, 0, time.UTC)); got != monday {
		t.Fatal(got)
	}
	if got := weekStart(time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)); got == monday {
		t.Fatal("week did not reset")
	}
}
