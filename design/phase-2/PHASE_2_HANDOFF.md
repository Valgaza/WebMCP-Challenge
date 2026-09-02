# Estro Phase 2 Handoff

**Phase:** 2 — Editor shell and interaction foundation
**Sequence:** 17–29
**Status:** Complete · user-verified 2026-09-02
**Date:** 2026-09-02

## Demonstrable result

An existing local photo or unassigned project can now create one empty, non-destructive image document with validated dimensions, resolution, orientation, and background. The same document can be created and inspected through WebMCP. It receives a stable document ID, immutable revision, transaction, autosave lifecycle, and Undo token.

The editor supplies one persisted shell and coordinate system for direct and agent interaction: Select, Hand, and Zoom tools; pan, pointer-centered zoom, fit, 100%, and view rotation; Layers and History; contextual Inspector; resizable and swappable docks; rulers, guides, grid, snapping, and safe areas; distraction-free fallback; stable selection; semantic focus; and a 17-command search surface. Workspace-only changes persist in IndexedDB without changing the project revision.

## Feature completion map

| Order | Feature | Implemented evidence |
|---:|---|---|
| 17 | `PH-001` | Versioned image-document schema, validated create dialog, shared domain command, immutable revision, autosave, Undo, and WebMCP mutation |
| 18 | `SH-030` | Bounded zoom/pan/rotation, fit, actual size, wheel and keyboard navigation, pointer capture, and persisted viewport |
| 19 | `SH-021` | Selection-sensitive document and view Inspector with stable property targets |
| 20 | `SH-085` | Native landmarks and controls, names and instructions, semantic target registry, live summaries, and stable IDs |
| 21 | `SH-086` | Visible focus, roving tabs, route focus, dialog focus, resize separator keyboard support, forced-colors support, and skip link |
| 22 | `SH-019` | Bounded pointer/keyboard resizing, collapse, persisted side swapping, and mutually exclusive compact drawers |
| 23 | `SH-022` | Canvas action bar limited to fit, actual size, zoom state, and valid overlay actions |
| 24 | `SH-025` | Tool, view, overlay, panel, search, Undo/Redo, drawer Escape, and distraction-free shortcuts |
| 25 | `SH-026` | Shared Pointer Events path for mouse, trackpad wheel, touch, and pen plus complete keyboard navigation |
| 26 | `SH-029` | Rulers, stable guides, snapping to a bounded grid, grid toggle, and safe-area overlay |
| 27 | `SH-028` | Fullscreen request with an in-page distraction-free fallback and explicit exit path |
| 28 | `SH-073` | Stable canvas/document selection tools and a visible, labeled WebMCP focus halo |
| 29 | `SH-023` | Shared 17-command registry searched by the UI palette and WebMCP |

## Architecture and schemas

- IndexedDB schema version 5 adds per-project workspace preferences and migrates Phase 1 revision/transaction state to explicit `photoDocument: null` values.
- `ProjectService` remains the only mutation path for UI and WebMCP document creation. It broadcasts committed project changes so an open editor reflects agent mutations immediately.
- `WorkspaceService` validates and persists view-only state separately from project revisions, broadcasts changes to the open UI, and replaces unsupported cache records with safe defaults.
- Project history adds deterministic `document.create` and `document.remove` operations, including replay, inversion, Undo, Redo, recovery, duplication, and repository consistency checks.
- WebMCP schema `2.0.0` exposes 15 top-level tools. The eight Phase 2 additions are `inspect_document`, `apply_document_operation`, `inspect_workspace`, `set_workspace`, `inspect_selection`, `set_selection`, `focus_ui`, and `search_commands`.
- No codec, asset import, media binary, remote worker, cloud storage, authentication, sharing, export, or Phase 3 job capability was added.

## Automated verification

Verification used Node 24.19.0 with the exact locked dependencies. No dependency version or manifest changed.

```sh
npm run typecheck
npm run test:run
npm run build
```

Current result:

- TypeScript: pass.
- Vitest: 12 files, 52 tests, all pass. (Now 53 tests after the post-acceptance correction recorded below.)
- Production build: pass; 1,949 modules transformed.
- Vite reports one non-blocking warning because the main minified JavaScript chunk is about 553 kB before gzip. Phase 2 does not introduce speculative code splitting; later route/worker boundaries can address this when the plan reaches them.
- `git diff --check`: pass.

Coverage includes Phase 1 regressions; v4→v5 migration; unsupported-workspace recovery; document validation, parity, stale-revision rejection, Undo, and Redo; workspace bounds, persistence, guides, docking, and revision isolation; semantic selection/focus; command search; compact drawers; pointer/pen panning; distraction-free fallback; and all 15 WebMCP registrations and contracts.

## Live browser acceptance

The local Phase 2 demonstration completed at desktop, 820px, and 390px widths with no browser console errors:

1. Created the `Phase 2 QA` project through the registered Site tool.
2. Opened its editor and created a 1920×1080, 72 ppi, transparent landscape document through the visible dialog.
3. Observed a fitted 29% canvas, stable document ID, selected layer, Inspector properties, revision 1, and successful autosave.
4. Called `inspect_document`, changed grid and dock preferences through `set_workspace`, and called `focus_ui` for `inspector-document-width`.
5. Confirmed both workspace calls returned `revisionUnchanged: true`; the project revision ID stayed identical before and after navigation changes.
6. Confirmed the open UI updated immediately, the docks swapped, and the requested property received the labeled agent halo.
7. Used Ctrl+Z and Ctrl+Shift+Z in the live canvas; the empty state returned, then the same document ID and settings returned in revision 3.
8. Opened the 17-command palette with Ctrl+K.
9. Confirmed one compact drawer at a time, access to both drawer toggles at 390px, Escape returning to the canvas, and the narrow-workspace advisory.
10. Reset the temporary browser viewport and stopped the local Vite server.

The real Fullscreen API path was not forced in automation because browser fullscreen permission and chrome vary by host. The verified in-page fallback is the required capability-safe path. Native fullscreen was covered by the user's manual acceptance below.

## User acceptance completed

The user ran the containerized verification and the manual exit demonstration, then confirmed Phase 2 tested and reviewed on 2026-09-02. Phase 2 is closed.

## Post-acceptance correction

Live WebMCP testing against the running application exercised all fifteen tools and found one defect, corrected after acceptance:

- `manage_project` returned two different result shapes. `rename` and `snapshot` routed through `resultForMutation`, while `create`, `duplicate`, `save_as`, and `save` returned a reduced four-key payload with no `transactionId`, `undoToken`, `affectedIds`, or `warnings`. The transaction existed in the new project's history; the adapter simply did not surface it, so an agent received no transaction identity and the Activity Center offered no Undo affordance. This contradicted `SH-071`.
- `create`, `duplicate`, and `save_as` now recover and report their initiating transaction. `save` promotes durability rather than committing a revision, so it explicitly returns `transactionId: null` and `undoAvailable: false` instead of omitting the fields.
- Covered by a new `site-tools` test asserting transaction identity for every project-creating operation. The suite is now 12 files and 53 tests.

## Repository and approval state

Phase 2 was committed as `49c483f` with the user's approval. No push, branch operation, agent-run Docker command, deployment, upload, external service, credential, production dependency change, or canonical feature-scope/order change was performed.

