package main

import (
	"context"
	"flickkick/server/rules"
	"testing"
)

func TestFormationOwnershipAndIndependentKickoff(t *testing.T) {
	useDefaultData(t)
	store := &identityStorage{values: map[string]string{identityKey(collectionLedger, "formation:formation_claw", "owner"): `{"id":"formation_claw"}`}}
	if !ownsFormation(context.Background(), store, "owner", "formation_claw") || ownsFormation(context.Background(), store, "other", "formation_claw") {
		t.Fatal("ownership not scoped")
	}
	if !ownsFormation(context.Background(), store, "other", "formation_wall") || ownsFormation(context.Background(), store, "owner", "unknown") {
		t.Fatal("free/unknown ownership")
	}
	r := gd().Rules
	r.Formation = gd().Cosmetics.Formations[3].Positions
	r.OpponentFormation = gd().Cosmetics.Formations[1].Positions
	bodies := rules.KickoffBodies(r)
	if bodies[1].X != float32(r.Formation[1][0]) || bodies[6].X != -float32(r.OpponentFormation[1][0]) {
		t.Fatal("opponent formation was overwritten")
	}
}
