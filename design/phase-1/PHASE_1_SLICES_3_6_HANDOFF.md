# Phase 1 Slices 3–6 Handoff

**Slices:** Durability and recovery; Site tools; safe parity; transactional proposals
**Features:** `SH-003`, `SH-002`, `SH-004`, `SH-076`, `SH-064`, `SH-077`, `SH-079`, `SH-066`, `SH-071`, `SH-070`, `SH-068`, `SH-069`
**Status:** Complete · user-verified 2026-09-02

## Demonstrable outcome

An Estro project can be explicitly saved, saved under a separate identity, captured as a named snapshot, autosaved after a debounce, and recovered after an interrupted write. The same project can be inspected and deterministically changed through seven top-level Site tools. A rename-plus-snapshot request can be proposed without mutation, reviewed, committed atomically from an unchanged source revision, inspected, and undone with one transaction token. Destructive deletion stops at a visible confirmation surface.

## Implemented boundary

- IndexedDB version 4 stores project durability checkpoints, named snapshots, and expiring proposals alongside projects, revisions, and transactions.
- Draft writes retain the last durable revision and a recovery marker; explicit Save or autosave promotes the current head atomically.
- Project Hub Recent and Recoverable views, recovery summary, draft labels, Save As, snapshot actions, and accurate selected-project durability.
- Workspace Save, Save As, snapshot, autosave, recovery decision, named-snapshot, proposal, result, and Undo surfaces.
- Seven JavaScript-registered top-level tools: `get_capabilities`, `inspect_project`, `manage_project`, `propose_transaction`, `apply_transaction`, `inspect_transaction`, and `undo_transaction`.
- Read-only annotations, bounded inspection, versioned capability result, narrow JSON Schemas, stable structured error envelope, and ordinary-browser fallback.
- One service and repository path shared by UI and Site tools for rename, snapshot, transaction application, and Undo.
- Visible Activity Island/drawer treatment for inspection, proposals, confirmation, completion, failure, cancellation, and Undo.
- Rename-plus-snapshot side effects are committed with the revision and proposal-state change in one IndexedDB transaction; stale proposals and snapshot-side-effect failures roll back completely.
- A shared service-level autosave coordinator covers Hub, workspace, Activity Center, and Site-tool mutations. Pending saves remain distinct from recovery during the live session; only a preserved revision observed after an interrupted reload is offered as recovery.
- Project rows are native responsive navigation links, so opening does not depend on the desktop-only detail rail.

## Agent verification completed

- The running Vite application loaded without console warnings or errors after the batch changes.
- The built-in browser discovered exactly seven live Site tools with the expected schemas and read-only annotations.
- Real Site-tool calls verified capability discovery and bounded inspection against a migrated Slice 2 project.
- A dedicated local QA project proved: proposal creation left name, revision, and snapshot count unchanged; Apply produced one transaction, one resulting revision, and one snapshot; Undo restored the name and removed the snapshot with one new revision.
- Invalid rename returned `INVALID_INPUT`, a field path, preserved-work flag, and recovery suggestion without mutation.
- A Site-tool deletion request returned `confirmation_required`, opened the visible confirmation dialog with focus on Cancel, and left the project intact after cancellation.
- The Project Hub showed the recoverable-draft count and banner; the workspace recovery decision promoted the preserved draft; manual named snapshot creation appeared in both the snapshot list and History.
- Keyboard acceptance verified menu-button Arrow navigation, Escape dismissal, trigger-focus restoration, safe initial deletion focus, and cancellation without mutation.
- Route changes now expose a context-specific document title and move focus to the workspace project-name heading once, without stealing focus after later mutations.
- Structured proposal errors now mark, describe, and focus only the affected field; WebMCP activity uses a stable polite live region.
- Transaction inspection, apply, Undo, and validation failures now expose visible Activity Center progress or failure instead of completing silently.

## User verification completed

- The complete containerized Vitest suite passes: 10 test files and 37 tests.
- The containerized TypeScript and production Vite build passes.
- Normal rename autosave, interrupted-reload recovery, row click/Enter opening at compact width, and actions-menu separation were rechecked successfully.

## Repository and approval state

No commit, push, deployment, upload, agent-run Docker command, API key, or external service change was performed.
