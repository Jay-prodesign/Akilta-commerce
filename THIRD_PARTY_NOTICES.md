# Third-Party Notices

No third-party source is vendored or bundled into this repository's own code. Dependencies are installed
via `pnpm install` against the pinned lockfile (`pnpm-lock.yaml`); this notice records their licenses as
of the P0-024A toolchain baseline (`pnpm licenses list`, run against `pnpm-lock.yaml`).

## Direct production dependencies

| Package | Version | License |
|---|---|---|
| drizzle-orm | 0.45.2 | Apache-2.0 |
| hono | 4.12.34 | MIT |
| pg | 8.22.0 | MIT |
| zod | 4.4.3 | MIT |

All direct production dependency licenses are permissive (MIT/Apache-2.0); no action required.

## Transitive dependency license summary (dev + prod, full tree)

325 resolved packages. License distribution: MIT (143), Apache-2.0 (20), ISC (9), BSD-2-Clause (6),
BSD-3-Clause (3), MIT OR Apache-2.0 (3), MPL-2.0 (2), LGPL-3.0-or-later (1), CC0-1.0 (1), BlueOak-1.0.0 (1).

Notable non-permissive-adjacent licenses, all transitive **devDependencies** (build/test tooling only,
never bundled into the deployed Worker):

- `@img/sharp-libvips-linux-x64` — LGPL-3.0-or-later (native image-processing binary, pulled transitively
  through the Wrangler/Workers dev toolchain; weak copyleft, dependency use only, not a derivative work).
- `lightningcss`, `lightningcss-linux-x64-gnu` — MPL-2.0 (file-level copyleft; used only by dev tooling).

No GPL/AGPL, no `UNLICENSED`, and no packages with an unresolved/unknown license were found in the full
resolved tree.

## Security

`pnpm audit`: 0 known vulnerabilities against the current lockfile (see `docs/exec-plans/active/AC-ENG-TASK-001-P0-024A.md` D-086 QA Verification Bundle for the full remediation record — `hono` was
bumped to the patched `4.12.34`; `undici` and `esbuild` transitive versions are pinned via
`pnpm-workspace.yaml` `overrides` to their patched minimum versions).
