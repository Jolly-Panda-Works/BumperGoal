package main

import (
	"testing"

	"flickkick/server/gamedata"
)

// useDefaultData installs the embedded defaults for one test and restores the previous config.
func useDefaultData(t *testing.T) {
	t.Helper()
	old := live.Load()
	t.Cleanup(func() { live.Store(old) })
	d, err := gamedata.Load()
	if err != nil {
		t.Fatal(err)
	}
	setData(d)
}
