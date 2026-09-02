# Estro Phase 2 Handoff

**Phase:** 2 — Editor shell and interaction foundation  
**Sequence:** 17–29  
**Status:** Implementation complete · final user container and manual acceptance required  
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
- Vitest: 12 files, 52 tests, all pass.
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

The real Fullscreen API path was not forced in automation because browser fullscreen permission and chrome vary by host. The verified in-page fallback is the required capability-safe path. The user should exercise native fullscreen once during final manual acceptance.

## Final user action required

- **Action required:** Run the project-owned container verification and the short manual exit demonstration.
- **Why:** Project rules prohibit the agent from running Docker, and Phase 2 cannot be marked user-verified until the approved container runtime and native browser fullscreen path are confirmed.
- **Exact steps:** From the repository root, run:

  ```sh
  docker compose run --rm app npm run typecheck
  docker compose run --rm app npm run test:run
  docker compose run --rm app npm run build
  docker compose up --build
  ```

  Then open `http://localhost:5173`, create an unassigned/photo project and a 1920×1080 transparent document, try Hand drag and `+`, `-`, `0`, `1`, `R`, Ctrl/Cmd+K, Ctrl/Cmd+Z, Redo, panel resize/swap, grid/guides, compact drawer toggling, WebMCP inspection/focus, and native distraction-free fullscreen.
- **Expected result:** 12 test files and 52 tests pass, the build succeeds with only the documented chunk-size warning, the UI and WebMCP paths show the same stable document state, workspace actions do not add project revisions, Undo/Redo round-trip the document, and fullscreen or its explicit in-page fallback exits cleanly.
- **Return to the agent:** The three command summaries and any failed interaction, with secrets removed.
- **Risk or side effect:** Compose creates or reuses the project dependency volume and starts only local development services. It does not migrate external data or upload media.

## Repository and approval state

The worktree contains the uncommitted Phase 2 implementation and the user's existing Phase 1 files. No commit, push, branch operation, Docker command, deployment, upload, external service, credential, production dependency change, or canonical feature-scope/order change was performed.

