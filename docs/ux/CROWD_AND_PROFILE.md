# Spectator art

- Generator: built-in image_gen; alpha-transparent 1254 × 1254 PNG.
- Asset: `apps/web/public/assets/crowd/fans-atlas.png`.
- Prompt: Original FlickKick premium stylized 3D toy-like adult football fans, exactly eight separate full-body characters in an aligned 4-column × 2-row sprite atlas. Diverse men and women, different skin tones and hairstyles, colorful plain blue/green/red/yellow jerseys, happy faces, both arms raised cheering. Compact readable sculpted forms, soft upper-left light. Transparent gutters, no floor, shadows, text, logos or watermark.
- Runtime: eight upper-body atlas regions, 18 spectators on each sideline (12 in battery saver). Counter-rotated to the portrait camera. Idle cheering increases after goals; reduced-motion disables movement. Spectators remain outside the playable pitch and do not affect physics.

# Profile and invitation update

Profile heading has icon shortcuts for level rewards, tutorial, history and settings. Six statistics are consolidated into the identity card; invitation sits underneath. Verified at CSS viewport 342 × 601: main and inner panel scrollHeight equal clientHeight.

Dialogs render into document.body above navigation, with a blurred backdrop, bounded scrollable content and keyboard focus containment. Inputs retain text selection; other game UI does not.

Invitation rewards are server-authoritative: `referral_apply` resolves the permanent eight-digit code and atomically grants 10 gems to the inviter and 5 to the invitee. One immutable create-only record per invitee prevents duplicate or competing invitations. Self-invites and accounts older than the 24-hour registration grace period are rejected. Sharing alone never grants gems. This requires a running Nakama server; disconnected builds cannot award account-wide invitation rewards. No real invitation was sent during QA.
