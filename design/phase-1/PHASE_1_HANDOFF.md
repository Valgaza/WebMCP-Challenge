# Estro Phase 1 Handoff

**Phase:** 1 — Core project, command, and WebMCP contract
**Sequence:** 1–16
**Status:** Complete · user-verified
**Date:** 2026-09-02

## Demonstrable result

Estro now has a media-independent project foundation that can be driven through the visible interface or seven top-level Site tools. A local project can be created, opened, renamed, duplicated, deleted behind an explicit confirmation, saved, saved under a new identity, captured as a named snapshot, autosaved, recovered after an interrupted write, inspected, changed through deterministic transactions, explained through provenance, proposed without mutation, applied atomically, and undone through immutable transaction identity.

Phase 2 may depend on this project, command, persistence, validation, permission, activity, and WebMCP contract without introducing a parallel state path.

## Feature completion map

| Order | Feature | Implemented evidence |
|---:|---|---|
| 1 | `SH-001` | Project Hub lifecycle, separate duplicate identity, soft deletion, and consequence-focused confirmation |
| 2 | `SH-010` | Typed operations, immutable revisions, append-only transactions, and optimistic head checks |
| 3 | `SH-011` | Undo and Redo append new revisions and preserve prior history |
| 4 | `SH-003` | Explicit Save, Save As with a separate identity, and same-project named snapshots |
| 5 | `SH-002` | Debounced autosave, durable revision checkpoints, and interrupted-write recovery markers |
| 6 | `SH-004` | Recent and Recoverable filters, recovery banner, and bounded recovery details |
| 7 | `SH-018` | Actor, intent, time, revision ancestry, transaction ID, summaries, and affected IDs |
| 8 | `SH-076` | Versioned capability response and seven discoverable JavaScript-registered Site tools |
| 9 | `SH-064` | Bounded project, durability, snapshot, and history inspection |
| 10 | `SH-077` | Stable error codes, field paths, preserved-work statements, and recovery suggestions |
| 11 | `SH-079` | Visible explicit confirmation before the only Phase 1 destructive operation |
| 12 | `SH-066` | UI and WebMCP rename use the same deterministic service and repository command path |
| 13 | `SH-071` | Every mutation returns an immutable transaction ID usable for inspection and Undo |
| 14 | `SH-070` | Novice-readable summaries are shared by results, Activity Center, and History |
| 15 | `SH-068` | Rename plus snapshot commits as one IndexedDB transaction or rolls back completely |
| 16 | `SH-069` | Expiring source-revision-bound proposal validates without mutation and rejects stale apply |

## Architectural boundary delivered

- React and TypeScript UI served through the approved development and production containers.
- IndexedDB schema version 4 for projects, revisions, transactions, durability, snapshots, and proposals, including migrations from earlier Phase 1 data.
- One application service and repository path shared by manual controls and Site tools.
- Seven tools: `get_capabilities`, `inspect_project`, `manage_project`, `propose_transaction`, `apply_transaction`, `inspect_transaction`, and `undo_transaction`.
- Ordinary-browser fallback remains fully functional when `document.modelContext` is absent.
- Autosave coordination now belongs to the shared application service rather than the workspace component. Manual and WebMCP mutations therefore use one debounce/checkpoint lifecycle; an in-session pending save is not presented as recovery, while a reload before completion remains recoverable.
- Each Project Hub row has a full-width native link as its primary action. One click or Enter opens the workspace at desktop and compact widths; the separate actions menu does not depend on the detail rail.
- No media binaries, canvas, codecs, workers, remote compute, cloud storage, authentication, sharing, or Phase 2 interaction systems were introduced.

The registration approach was rechecked against the current [official Site tools documentation](https://learn.chatgpt.com/docs/webmcp): JavaScript registration occurs on the top-level page, support is capability-detected, read-only annotations are declared, ordinary UI is preserved, and side effects remain narrow and verifiable.

## Verification evidence

### Automated coverage prepared

- 10 test files containing 37 tests cover schemas, error normalization, deterministic replay and inversion, lifecycle, history conflicts, IndexedDB migration and repair, pending autosave versus interrupted-session recovery, snapshots, atomic proposals, stale proposal rollback, Site-tool registration and durable mutation parity, permission gating, transaction inspection and Undo activity, direct row navigation, keyboard opening, dialog focus, exact-field errors, and stable live-region announcements.
- The production build script runs `tsc --noEmit` before Vite, so the final build is also the TypeScript gate.
- The final container run is pending because project rules require the user—not the agent—to execute Docker.

### Manual and live-browser acceptance completed

- The user verified persistence across reload, rename, duplicate, deletion confirmation, responsive layout, history, recovery, snapshots, and the consolidated Phase 1 behavior.
- The built-in browser discovered exactly seven tools with the expected schemas and read-only annotations.
- Real tool calls previously proved bounded inspection, no-mutation proposal creation, atomic Apply, one-token Undo, actionable invalid-input output, and visible deletion confirmation.
- The closure pass verified menu Arrow navigation, Escape, focus restoration, safe Cancel focus, no deletion on cancellation, route-specific titles, a single page-level workspace heading, exact-field error association, and focus on the invalid field.
- Previous 320px acceptance reported equal document client and scroll widths. The closure CSS also keeps mobile text fields at 16px and suppresses non-essential transition duration under reduced motion.

### Corrective acceptance completed

- A normal Hub rename reaches **Saved locally** without incorrectly showing **Recovery available**.
- Reloading before autosave completion still exposes the genuinely interrupted revision as recoverable.
- One click on the main part of a row and Enter on its focused link open the workspace, including below the width where the detail rail is hidden.
- The actions menu opens without navigating.

## Final container verification

The user completed the containerized verification from the repository root:

```sh
docker compose run --rm app npm run test:run
docker compose run --rm app npm run build
```

Final acceptance was reported complete on 2026-09-02: all 10 test files and 37 tests pass, the production build succeeds, and the focused corrective workflows above behave as intended. Phase 1 is closed.

## Repository and approval state

Phase 1 was later committed with the user's approval across `9b5c0b6`, `6b4fd95`, `d36910f`, `20b22c6`, and `c7f491a`. No push, branch creation, deployment, upload, API-key change, external service configuration, dependency change, or agent-run Docker command was performed.
