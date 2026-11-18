package main

import (
	"context"
	"testing"
)

func TestPaidTrailEntitlements(t *testing.T) {
	useDefaultData(t)
	if len(gd().Cosmetics.Trails) != 10 {
		t.Fatal("want ten trails")
	}
	store := &identityStorage{values: map[string]string{}}
	for _, trail := range gd().Cosmetics.Trails {
		if len(trail.Price) == 0 || ownsTrail(context.Background(), store, "new-player", trail.ID) {
			t.Fatal("new player has a free trail")
		}
	}
	id := gd().Cosmetics.Trails[0].ID
	store.values[identityKey(collectionLedger, "trail:"+id, "owner")] = `{"id":"` + id + `"}`
	if !ownsTrail(context.Background(), store, "owner", id) || ownsTrail(context.Background(), store, "other", id) {
		t.Fatal("trail ownership not scoped")
	}
	if len(ownedTrails(context.Background(), store, "new-player")) != 0 {
		t.Fatal("default trail granted")
	}
}
