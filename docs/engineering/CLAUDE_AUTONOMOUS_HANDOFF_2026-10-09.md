# AI Commerce — Claude autonomous engineering handoff (2026-10-09)

## Operating mandate
Claude is the primary implementation engineer for Commercial Ready V1. Continue through the existing canonical prioritized backlog without waiting for ChatGPT/Brain reviews between routine engineering tasks. For each bounded task: select from canonical 00/21/25 and repo task state, implement, run proportional tests, fix, commit, open/update the existing PR, record exact head/checks/blockers, and proceed to the next **independent safe task**. Do not manufacture a task or re-run broad audits when an executable task exists. Reuse verified evidence; do not repeat unchanged checks without cause.

This handoff is a durable instruction for the **next Claude session**; committing this file does not itself start or schedule a Claude process. ChatGPT may review asynchronously, and a pending Brain review is not a routine stop condition. Engineering may report IMPLEMENTED / TESTED; independent VERIFIED is a separate gate. Do not promote unreviewed changes to VERIFIED or production.

## Immediate recovery: AC-XSESSION-107A0 / PR #37
Repo: `Jay-prodesign/Akilta-commerce`.
Draft PR: https://github.com/Jay-prodesign/Akilta-commerce/pull/37
Branch: `claude/ac-xsession-107a0-conflict-hardening`
Code/test commit before this handoff: `5b9da8b0f2a9a01425a1b4ceb7fbaeb9b29277a2`.
Verified D3 parent baseline: `8db865ab112a7922544fac61948b32c48e13717f`.
A0 code delta versus D3: `packages/authz/src/auth-identity.ts` and `tests/security/auth-identity.spec.ts`, exactly two files. Do not infer this PR is merge-ready: against `main` it currently includes inherited D3 work (124 changed files reported on PR creation). D3 PR #34 historical status is PASS/VERIFIED but live merge/PR state must be checked before dependency resolution.

1. Re-read current PR head and existing A0 code/tests. Check type safety and security semantics. Exact provider+subject duplicates must DENY, including permutations and inactive duplicate identity records; unique identity retains existing semantics. Exact ACTIVE provider+external-organization duplicates must return null; inactive/wrong-scope noise must not falsely conflict.
2. Run repository-supported typecheck, lint, security tests, Worker smoke, license and CI as applicable. Fix any A0 regressions on this branch. Treat inherited dependency audit separately; do not hide new advisories.
3. Reconcile D3/main dependency and avoid duplicate PRs or merging unverified history. Keep #37 draft while dependency or CI unresolved. If main has not incorporated D3, do not silently rebase/cherry-pick or merge protected code; select independent next task while awaiting authorized integration.
4. Record exact SHA, tests, changed files, CI, residual issues and next cursor in existing task/handoff conventions. No fake PASS.
5. Then proceed through next authorized, independent, high-value implementation backlog work without requiring Brain to approve each task.

## Boundaries
No merges without separate authority; no production deploy, live provider/Meta/OAuth connections, credential/secret operations, financial/legal commitments, repository visibility change, customer-data mutations, cross-repo writes, or public launch. AKILTA parent and AI Commerce are isolated products. Do not force shared accounts/databases. Never override a real owner/security/provider gate. If a task is blocked, record the blocker and work on an independent authorized task; only stop when no safe meaningful work remains.

## Project sources
Canonical Google Drive: 00 Project Command Center; 21 CR-V1 Implementation Backlog & Acceptance Matrix (Google **Sheets**, BACKLOG tab); 25 Engineering Handoff. Repo-native task record is the implementation cursor. Existing roadmap/scope and D-090 invariants remain authoritative. This file is an execution handoff, not a substitute for them.
