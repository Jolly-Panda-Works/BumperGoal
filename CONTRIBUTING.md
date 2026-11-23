# Contributing to Bumper Goal

Use Node.js 22.22 or newer and pnpm 10. Run `pnpm install --frozen-lockfile` and `pnpm dev` to start the game. Before opening a pull request, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

Target `main` for shared changes. Use `Iranian-store` for changes specific to the Iranian Android distribution. For gameplay changes, describe the affected game modes and verify the layout in landscape on a phone-sized viewport. For simulation changes, check both browser and server determinism.

Include the origin and redistribution terms for contributed assets. Report security concerns privately as described in [SECURITY.md](SECURITY.md).
