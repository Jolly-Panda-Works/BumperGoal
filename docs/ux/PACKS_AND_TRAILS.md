# Currency packs and disc trail corrections

- Packs: coin/gem filters fill two equal columns. At 342 x 601 the complete first two cards fit above the bottom fade (card bottom 459px, list bottom 519px). Cards use compact artwork and localized short claim labels.
- Artwork: tiered currency compositions share one component between the catalog and confirmation dialog; six gem tiers no longer reuse an identical single pile.
- Trail: live per-side sync overrides the initial scene snapshot, including an explicit empty string for unequip. Trail samples begin at the rear rim rather than under the disc, retain up to 450ms of motion, taper, and cap their speed-dependent length at 220 world pixels. Dark outlines and wider twin ribbons remain readable on grass. No physics or shot rules changed.
- Verification: isolated real MatchScene/Rapier preview, no saved match result; late-sync, unequip, readability, speed scaling, idle and teleport-reset tests. Screenshot: `screens/35-trail-visible.png`.
