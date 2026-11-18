# FlickKick illustrated UI icon family

Generated with the built-in image_gen tool, one generation per icon. All fourteen original PNG masters have real alpha transparency, 1254 x 1254 pixels, preserved unchanged in `art-source/masters/ui-icons/` (Git LFS).

Runtime assets: `apps/web/public/assets/icons/<name>.webp`, 128 x 128 with preserved alpha, about 125 KiB in total. Re-export with `node tools/export-ui-icons.mjs`; this uses the repository's Sharp export approach, trims transparent padding and preserves proportions. UI labels and accessible parent names remain localized.

## Final prompt set

Common prompt (insert the subject below):

Production UI icon for original FlickKick tabletop soccer mobile game. Subject: SUBJECT. Exactly ONE isolated icon centered on a square canvas, entire object fills 84% with even transparent padding. Premium stylized 3D mobile game collectible aesthetic matching a polished gold lightning coin and a faceted cyan diamond: chunky sculpted toy forms, very broad clean bevels, warm gold #FFC83D and amber edges, royal/navy blue enamel #164B9A, tiny cyan accents #38D9FF, saturated vivid materials, soft upper-left key light, restrained broad highlights, front-facing almost orthographic with slight 3/4 volume. Bold simple readable silhouette at 24-32 px, generous substantial shapes, minimal small details. All objects share exactly this palette and lighting. Actual alpha transparent background. No square tile, no button, no surrounding circular badge, no floor, no cast shadow, no text, no letters, no numbers, no watermark. This is final raster game artwork, not line art and not a flat vector.

| Name | Subject |
| --- | --- |
| settings | a single chunky golden eight-tooth mechanical gear, deep blue inset hub with a small cyan center |
| history | a chunky blue clock face in a thick warm-gold rim, gold clock hands and one gold circular rewind arrow, no numerals |
| tutorial | an open chunky royal-blue book with thick ivory pages and a golden five-point star embossed on the right page |
| level-reward | a chunky royal-blue treasure gift box with broad warm-gold ribbons, lid slightly lifted and one large cyan crystal peeking out |
| home | a compact royal-blue toy clubhouse shaped like a house, thick warm-gold roof and a bright cyan doorway |
| shop | a compact royal-blue sports shop storefront with a striped gold-and-blue awning, broad gold trim and one cyan entrance |
| rank | one large chunky polished gold trophy cup, royal-blue handles and base, a small faceted cyan jewel inset in the cup |
| locker | a compact closed royal-blue sports locker cabinet, broad gold bevel trim, one small golden football jersey emblem on its door |
| packs | an open chunky royal-blue treasure chest with gold trim overflowing with a few large gold coins and two large cyan diamonds |
| trails | one chunky royal-blue tabletop soccer disc with a thick gold rim, three broad curved tapered cyan-and-gold speed ribbons flowing behind it to the left |
| formations | a compact upright royal-blue football tactics board with a thick gold beveled frame, three large gold player discs linked by simple cyan paths, no letters or numbers |
| avatars | one friendly stylized toy human bust, warm-gold sculpted head with simple friendly face, royal-blue football jersey with cyan collar, broad rounded shapes |
| balls | one chunky soccer football with ivory hexagonal panels and royal-blue pentagonal panels, broad soft polished bevels, a few small warm-gold seam accents |
| teams | one chunky royal-blue football jersey with thick gold collar and sleeve edges and one large simple cyan star at the chest |

## Verification

All 14 runtime images loaded successfully at 128px. Shop tested at CSS viewport 342 x 601: six illustrated category tabs and five navigation icons fit without horizontal overflow. Profile's four shortcut icons loaded and its content remained unscrolled (393px client/scroll height). Shared icon components also update Locker, Home rewards and History empty state. Utility back/close/check controls retain their existing shapes.

Screenshots: `screens/39-game-icon-family.png`, `screens/40-shop-game-icons.png`.
