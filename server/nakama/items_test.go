package main

import (
	"context"
	"testing"
)

func TestPaidItemOwnershipPerKind(t *testing.T) {
	useDefaultData(t)
	for kind := range ledgerPrefix {
		var paid string
		for _, item := range gd().Cosmetics.List(kind) {
			if len(item.Price) > 0 {
				paid = item.ID
				break
			}
		}
		if paid == "" {
			continue
		}
		store := &identityStorage{values: map[string]string{identityKey(collectionLedger, ledgerPrefix[kind]+paid, "owner"): `{"id":"` + paid + `"}`}}
		if !ownsItem(context.Background(), store, "owner", kind, paid) || ownsItem(context.Background(), store, "other", kind, paid) {
			t.Fatalf("%s ownership not scoped", kind)
		}
		found := false
		for _, id := range ownedItems(context.Background(), store, "owner", kind) {
			found = found || id == paid
		}
		if !found {
			t.Fatalf("%s owned list misses %s", kind, paid)
		}
	}
}
