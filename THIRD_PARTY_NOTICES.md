# Third-Party Notices

No third-party source is vendored or bundled into this repository's own code. Dependencies are installed
via `pnpm install` against the pinned lockfile (`pnpm-lock.yaml`); this notice records their licenses and
audit status as of the AC-REPO-RECON-001 Unit A materialization (`pnpm licenses list` / `pnpm audit`, run
against this candidate tree's `pnpm-lock.yaml`).

## Direct production dependencies

| Package | Version | License |
|---|---|---|
| drizzle-orm | 0.45.2 | Apache-2.0 |
| hono | 4.12.34 | MIT |
| pg | 8.22.0 | MIT |
| zod | 4.4.3 | MIT |

All direct production dependency licenses are permissive (MIT/Apache-2.0); no action required.

## Transitive dependency license summary (dev + prod, full tree)

189 resolved packages (`pnpm licenses list`, this candidate tree). License distribution: MIT (143),
Apache-2.0 (20), ISC (9), BSD-2-Clause (6), MIT OR Apache-2.0 (3), BSD-3-Clause (3), MPL-2.0 (2),
LGPL-3.0-or-later (1), CC0-1.0 (1), BlueOak-1.0.0 (1).

Notable non-permissive-adjacent licenses, all transitive **devDependencies** (build/test tooling only,
never bundled into the deployed Worker):

- `@img/sharp-libvips-linux-x64` — LGPL-3.0-or-later (native image-processing binary, pulled transitively
  through the Wrangler/Workers dev toolchain; weak copyleft, dependency use only, not a derivative work).
- `lightningcss`, `lightningcss-linux-x64-gnu` — MPL-2.0 (file-level copyleft; used only by dev tooling).

No GPL/AGPL, no `UNLICENSED`, and no packages with an unresolved/unknown license were found in the full
resolved tree.

## Security

`pnpm audit` against this candidate tree's lockfile: **6 known vulnerabilities (1 high, 5 moderate)**,
none in a direct production dependency's *pinned* version behavior — all are patched-version-available
advisories against versions this lockfile currently resolves:

- **high** — `sharp` (transitive, via `@cloudflare/vitest-pool-workers`/`wrangler`/`miniflare`, dev-only):
  libheif vulnerabilities (GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545); patched `>=0.35.4`.
- **moderate** — `vitest` / `@vitest/mocker` (dev-only): path traversal / arbitrary file read via redirect
  mock (GHSA-82fw-gwwq-j7x9); patched `>=4.1.11` (lockfile currently resolves `4.1.10`).
- **moderate ×3** — `hono` (direct production dependency, pinned `4.12.34` per `DEPENDENCY_BASELINE.json`):
  incomplete `toSSG()` path-containment fix (GHSA-gqvv-2mrq-wpjv), unbounded dot-notation nesting in
  `parseBody()` (GHSA-g6gw-c38x-mqfc), query-parser fragment/cache-key differential (GHSA-crvj-82cr-hjcx);
  all patched `>=4.13.5`.

This is a truth-preserving reconciliation only: the prior claim of "0 known vulnerabilities" was stale.
Bumping `hono`/`vitest` to a patched version is a dependency/source-hardening change, not a metadata
correction, and is out of scope for this materialization unit — recorded here as real, current findings
for a separate, explicitly-scoped hardening decision.
