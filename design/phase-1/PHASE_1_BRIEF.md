# Estro Phase 1 Brief

**Phase:** 1 — Core project, command, and WebMCP contract
**Sequence:** 1–16
**Status:** Complete · all six slices implemented and user-verified 2026-09-02
**Feature IDs:** `SH-001`, `SH-010`, `SH-011`, `SH-003`, `SH-002`, `SH-004`, `SH-018`, `SH-076`, `SH-064`, `SH-077`, `SH-079`, `SH-066`, `SH-071`, `SH-070`, `SH-068`, `SH-069`

This brief is governed by [`AGENTS.md`](../../AGENTS.md), the canonical order in [`FEATURE_IMPLEMENTATION_PLAN.md`](../../FEATURE_IMPLEMENTATION_PLAN.md), the dependencies in [`FEATURE_DEPENDENCY_LEDGER.md`](../../FEATURE_DEPENDENCY_LEDGER.md), and the approved visual and interaction rules in [`PRODUCT_DESIGN_BLUEPRINT.md`](../../PRODUCT_DESIGN_BLUEPRINT.md).

## 1. Demonstrable goal

A reviewer can create a local Estro project, make and inspect deterministic non-destructive changes, save and recover it, and undo a named transaction. The same outcome can be produced through the visible UI or through WebMCP, and both paths expose the same validation, revision identity, human-readable summary, confirmation requirements, and Undo result.

No photo, video, asset, codec, canvas, timeline, remote compute, or cloud account is required to prove the Phase 1 contract.

## 2. Phase-entry state and verified prerequisites

- Pre-Phase 1 is complete and its exit audit passes.
- The approved design baseline covers Project Hub, editor top-bar state, proposals, confirmations, validation, agent activity, completion, failure, and Undo.
- The repository is connected to the intended GitHub remote and is on `main`.
- At Phase 1 entry, the repository contained planning and design artifacts only. Phase 1 added the approved application framework, runtime, source tree, container definitions, and test suite.
- The Phase 1 application stack, local persistence direction, initial browser target, dependency isolation, and container-first delivery direction are approved in section 12.
- All existing files are untracked. No commit or push is authorized by this brief.

## 3. Current WebMCP constraints

Phase 1 follows the current [official OpenAI Site tools documentation](https://learn.chatgpt.com/docs/webmcp):

- Site tools are the current ChatGPT implementation of the proposed WebMCP standard.
- The built-in browser currently discovers tools registered with JavaScript on the top-level page.
- Declarative form-attribute tools and tools registered inside iframes are not currently supported in the built-in browser.
- Registration must be capability-detected through `document.modelContext` so Estro remains fully usable in ordinary browsers without WebMCP.
- Read-only operations identify themselves as read-only.
- Tool input must be narrow, side effects must be explicit, and results must contain enough structured information to verify the outcome.
- WebMCP must reuse Estro's own authorization, validation, and application commands rather than create a privileged parallel path.

These constraints are an architectural input, not a browser-only integration task deferred until the end.

## 4. Phase architecture boundary

### In the browser

- Versioned `ProjectDocument` records with stable IDs and lifecycle state.
- A deterministic command engine with validation before mutation.
- A revision and transaction graph with replayable or inverse data.
- IndexedDB persistence for project documents, revisions, transactions, snapshots, recovery markers, and recent-project metadata.
- One application service layer used by both visible controls and WebMCP tool handlers.
- Top-level JavaScript WebMCP registration with capability detection.
- Project Hub and the smallest project workspace surfaces needed to expose save, history, proposal, permission, validation, summary, and Undo states.

### Deliberately absent in Phase 1

- OPFS media/cache storage; Phase 1 has no binary media.
- Cloud storage, synchronization, authentication, or collaboration.
- Remote compute, workers, job queues, GPUs, media processing, or final rendering.
- Service-worker offline application caching. Crash recovery is proven from durable local project data; product-wide offline editing remains a later feature.

The data and command interfaces must leave room for those later systems without pretending they exist now.

### Environment and container boundary

- JavaScript dependencies remain project-local in `node_modules` and are reproduced from the committed npm lockfile; no global package installation is part of the project setup.
- Development and production container definitions will be maintained with the application. The development container keeps dependencies in a container-owned volume, while the production image uses a multi-stage build and serves only the compiled static application.
- If Python tooling becomes necessary later, it must use a repository-local `.venv` or an isolated build container rather than the system interpreter environment.
- Browser storage such as IndexedDB cannot live inside the application container: it belongs to each visitor's browser profile. The container serves the application code; it does not own the user's local project database.
- Container configuration will be created and statically inspected by the agent, but build and run commands will be given to the user rather than executed by the agent unless the user explicitly changes that instruction.

## 5. Canonical domain contract

The implemented TypeScript model follows this behavioral contract:

- Every project, revision, transaction, snapshot, proposal, and operation has a stable opaque ID.
- Every persisted record carries a schema version.
- A project points to one durable head revision; mutations create a new revision rather than overwrite historical state.
- A transaction contains one or more ordered typed operations and either commits completely or changes nothing.
- Each committed transaction records actor, intent, timestamp, parent revision, resulting revision, affected IDs, normalized parameters, warnings, provenance, and Undo availability.
- Validation runs before commit and returns stable error codes, field paths, expected values, conflicts, permission requirements, and safe recovery suggestions.
- Dry runs normalize and validate operations without changing the project or durable head revision.
- Destructive actions return a pending confirmation contract before execution.
- Undo uses the transaction graph. An unsafe selective revert returns a structured conflict rather than silently merging.
- Autosave and explicit save both persist known revisions; their UI meaning differs, but they do not maintain competing project models.

## 6. Vertical slices

Each slice must work from UI through domain logic, persistence where applicable, WebMCP where applicable, and visible result feedback before the next slice broadens the contract.

### Slice 1 — Local project lifecycle (`SH-001`)

Build a Project Hub that can create, open, rename, duplicate, and request deletion of local projects. Project identity, schema version, timestamps, lifecycle state, and current revision are visible or inspectable. Deletion uses a consequence-focused confirmation surface and cannot occur through an unconfirmed agent call.

**Evidence:** lifecycle unit tests; reload persistence; duplicate identity separation; delete confirmation; ordinary-browser fallback.

### Slice 2 — Non-destructive state and history (`SH-010`, `SH-011`, `SH-018`)

Route every state change through typed operations and immutable revisions. Implement undo and redo over transaction identity, and retain actor/intent provenance. Expose a minimal History surface without prematurely building Phase 2's complete editor panels.

**Evidence:** deterministic replay tests; inverse/redo tests; stable-ID tests; provenance shown in UI; corrupted or conflicting history fails safely.

### Slice 3 — Save, snapshots, autosave, and recovery (`SH-003`, `SH-002`, `SH-004`)

Persist explicit saves, Save As copies, named snapshots, debounced autosaves, recovery markers, recent projects, and recoverable drafts in IndexedDB. Simulate interruption and reopen at the last durable revision with a plain-language recovery summary.

**Evidence:** reload and interruption tests; atomic checkpoint behavior; quota/write failure state; recent/draft ordering; Save As identity separation; recovery never discards the last good revision.

### Slice 4 — WebMCP discovery, inspection, and errors (`SH-076`, `SH-064`, `SH-077`)

Register versioned top-level tools when WebMCP is available and show a truthful supported/unsupported status in Estro. Provide bounded, structured project inspection and a uniform validation/error envelope. Unsupported browsers retain the complete human interface.

**Evidence:** tool-registration contract tests; capability-detection test; bounded inspection result; read-only annotations; invalid input produces actionable structured errors and no mutation.

### Slice 5 — Safe atomic UI/WebMCP parity (`SH-079`, `SH-066`, `SH-071`, `SH-070`)

Connect one deterministic project mutation to both a visible control and a WebMCP tool through the same command handler. Return a transaction ID, resulting revision, affected IDs, normalized inputs, warnings, a novice-readable change summary, and Undo availability. Apply permission and confirmation policy before destructive execution.

**Evidence:** UI and WebMCP parity test; duplicate invocation/idempotency policy test; destructive-action gate; inspectable transaction; UI and tool Undo reach the same project state.

### Slice 6 — Transactional proposals (`SH-068`, `SH-069`)

Validate an ordered multi-operation request as one unit, show a proposal without changing the durable project, and commit it only from an unchanged compatible source revision. A stale proposal or one invalid operation causes a rollback-safe structured failure. The committed result has one transaction and Undo token.

The Phase 1 demonstration transaction will combine existing project operations, such as a project rename and a named snapshot, so atomicity is proven without inventing media-specific edits.

**Evidence:** dry run leaves the head revision unchanged; stale proposal rejection; all-or-nothing failure; one transaction ID; one Undo restores the pre-transaction state.

## 7. WebMCP operation surface

The phase begins with a small stable tool surface rather than one tool per retained feature:

| Tool | Mode | Purpose | Required result identity |
|---|---|---|---|
| `get_capabilities` | Read | Report schema/tool versions, supported operations, local availability, limits, and permission requirements | Capability/schema version |
| `inspect_project` | Read | Return a bounded project, revision, history, proposal, or transaction view using narrow selectors | Project and revision IDs |
| `manage_project` | Write/confirm as required | Create, rename, duplicate, save, snapshot, or request deletion through typed discriminators | Project, revision, transaction, warnings |
| `propose_transaction` | Read/dry run | Validate and normalize an ordered operation set without mutation | Proposal ID, source revision, impact, warnings |
| `apply_transaction` | Write | Commit a valid proposal or explicit ordered transaction atomically | Transaction/Undo token and resulting revision |
| `inspect_transaction` | Read | Explain actor, intent, operations, before/after values, warnings, and Undo state | Transaction and revision IDs |
| `undo_transaction` | Write | Revert a safe transaction or return a dependency conflict | New transaction/revision or conflict |

The final schemas may consolidate an operation only when the resulting contract stays narrow and unambiguous. Every handler delegates to the same application command used by the UI.

## 8. Phase 1 UI and design scope

Detailed Phase 1 design must be reviewed before production UI work. It will cover:

- Project Hub: empty, loading, populated, recent, recoverable, and storage-error states.
- Create, rename, duplicate, Save As, snapshot, and deletion-confirmation flows.
- Minimal project workspace top bar: project identity, save/autosave state, undo/redo, WebMCP availability, and activity entry point.
- Minimal History view: operation name, actor, time, revision, summary, and current/undone state.
- Activity Island and drawer states actually used in this phase: targeting, inspecting, validating, proposing, awaiting confirmation, committing, complete, failed, and cancelled.
- Proposal surface: source revision, ordered changes, warnings, Apply/Reject, stale state, success summary, and Undo.
- Structured inline validation and preserved-work recovery messages.
- Keyboard path, focus entry/return, live-region announcements, reduced motion, increased contrast, 200% zoom, and supported narrow Project Hub behavior.

The approved Estro tokens, density, radii, motion durations, wait ladder, and blue-to-violet agent treatment remain authoritative. Phase 1 does not implement the Phase 2 canvas, tool rail, Inspector, dockable panels, or media workspace.

## 9. Acceptance demonstration

From a clean browser profile:

1. Open Estro in a browser without WebMCP, create a local project, rename it, save a named snapshot, reload, and reopen the same durable revision.
2. Make a UI change, inspect its provenance, Undo, Redo, and verify the named revision and visible state each time.
3. Simulate an interrupted autosave, reload, choose the recoverable draft, and show the recovery reason and last durable revision.
4. Open the same build in a supported WebMCP environment and inspect capabilities and project state without mutation.
5. Request an invalid mutation and show matching structured validation in the tool result and visible UI with no revision change.
6. Request a dry-run multi-edit proposal. Show the exact target, source revision, normalized operations, warnings, and unchanged project head.
7. Apply the proposal, show one transaction ID and human-readable summary, reload to prove durability, then Undo it through the returned transaction ID.
8. Request project deletion through WebMCP, show that execution pauses at an explicit confirmation surface, cancel it, and prove the project remains intact.
9. Disable or remove WebMCP support and prove all ordinary UI actions still work.

## 10. Required verification evidence

- Unit tests for schemas, validation, command determinism, revisions, transactions, Undo/Redo, proposals, summaries, and permission policy.
- Persistence integration tests for create/open/save/Save As/snapshot/autosave/recovery/recent projects and failure handling.
- UI integration tests for the Project Hub, status, proposal, confirmation, validation, recovery, and Undo paths.
- WebMCP adapter tests proving top-level feature detection, tool metadata, structured results, read-only annotations, and delegation to application commands.
- At least one real supported-browser WebMCP demonstration, because a mocked `document.modelContext` is not sufficient final evidence.
- Keyboard and focus walkthrough; live-region verification; reduced-motion check; 200% zoom and Project Hub narrow-layout check.
- Reload-based proof that committed changes survive and dry runs do not.
- A recorded phase handoff listing the exact commands run, results, unverified items, and user actions.

## 11. Non-goals

- Photo/video documents, assets, import, media previews, canvas, timeline, effects, codecs, export, or rendering.
- Remote compute, friend-hosted workers, job queues, Docker, cloud deployment, or API keys.
- Authentication, cloud persistence, sharing, collaboration, or cross-device synchronization.
- Product-wide offline mode or service-worker caching.
- Complete editor shell behavior, panel docking, command search, or media-specific history visualization.
- Final standalone logo, final custom icon set, or browser support beyond the approved initial target.
- Commit, push, pull request, deployment, or external transmission without explicit user approval.

## 12. Approved implementation decisions

The user approved the following baseline on 2026-09-01:

1. **Application stack and package manager:** React + TypeScript + Vite using npm.
2. **Runtime schema validation:** Zod, shared by UI, application commands, persistence boundaries, and WebMCP adapters.
3. **Local persistence wrapper:** Dexie over IndexedDB for transactions, versioned migrations, and testable local persistence.
4. **Routing:** React Router for the planned route model.
5. **Icon package:** `lucide-react`, installed when the approved Phase 1 detailed design confirms its icon inventory.
6. **Initial browser target:** current Chromium and the ChatGPT/Codex built-in browser for WebMCP acceptance. Other modern browsers retain the complete human UI but are compatibility checks rather than Phase 1 acceptance targets.
7. **Dependency isolation:** npm dependencies are repository-local and lockfile-pinned. Any future Python dependency uses a repository-local virtual environment or isolated container.
8. **Container-first delivery:** provide development and production container definitions wherever the browser/client architecture permits, without misrepresenting browser-owned IndexedDB as container storage.
9. **Container execution boundary:** create and review container files, but ask the user to run build/start commands. Do not run Docker automatically.

The user approved the detailed Phase 1 interface direction on 2026-09-01. Production implementation may proceed through the documented slices, while Docker execution, commits, pushes, deployment, uploads, and external service configuration remain separately approval-gated.

## 13. Expected user actions

Before implementation:

- Review the Phase 1 detailed wireframe/prototype before production UI work begins.

After design approval:

- Run the supplied container build/start command when asked, then report the complete terminal output and browser URL.
- Perform any signed-in ChatGPT/Codex built-in-browser WebMCP verification step that cannot be completed from the workspace.

During verification, the agent will ask the user to perform any step that requires their signed-in ChatGPT browser session or another action unavailable from the workspace. No Docker run, API key, secret, upload, deployment, commit, or push is currently required.

## 14. Phase exit condition

Phase 1 is complete only when a local project can be created, deterministically mutated through both UI and WebMCP, validated, saved, recovered, explained, and undone without media-specific code; the detailed design and accessibility checks pass; the real WebMCP path is demonstrated; and all remaining limitations are explicitly recorded.
