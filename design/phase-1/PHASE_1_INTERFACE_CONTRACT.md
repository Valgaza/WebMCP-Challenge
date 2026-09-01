# Estro Phase 1 Interface Contract

**Status:** Approved for Phase 1 implementation · 2026-09-01
**Applies to:** Phase 1, sequence 1–16
**Visuals:** [`Project Hub`](./estro-phase-1-project-hub.png) · [`Command and recovery flow`](./estro-phase-1-command-flow.png)

This contract resolves the screens, visible states, interaction hierarchy, keyboard path, and WebMCP feedback needed by the [Phase 1 brief](./PHASE_1_BRIEF.md). It extends the approved [`PRODUCT_DESIGN_BLUEPRINT.md`](../../PRODUCT_DESIGN_BLUEPRINT.md) without changing the product-wide visual direction.

## 1. Design goal

Phase 1 should make an invisible technical foundation understandable without making Estro feel like a database or developer tool. The user sees projects, their durability, and the consequence of each action. Stable IDs and schema details remain available to WebMCP and in secondary technical metadata, but the primary copy stays novice-readable.

The Project Hub is quiet and spacious. Proposal, confirmation, validation, recovery, and Undo surfaces become more explicit only when a decision or exception requires attention.

## 2. Screen and surface inventory

| Surface | Purpose | Phase 1 states |
|---|---|---|
| Project Hub | Create, find, open, rename, duplicate, recover, and request deletion | Empty, loading, populated, selected, no results, storage unavailable, recoverable draft |
| New project sheet | Create a media-neutral project record before Phase 2 adds document details | Default, submitting, validation error, created |
| Project actions menu | Reveal secondary lifecycle actions without filling every row with controls | Open, rename, duplicate, Save As, snapshot, delete |
| Project workspace header | Preserve project identity, save state, Undo/Redo, and WebMCP status after opening | Saving, saved, recovery available, validation failure, WebMCP ready/unavailable |
| Project detail rail | Explain durability and recent activity for the current Project Hub selection | Stable state, autosaving, save failed, recent transaction, Undo available |
| Minimal History view | Show transaction name, actor, time, revision, provenance, and current state | Current, undone, redone, conflict |
| Activity Island | Show bounded agent activity without taking over the page | Inspecting, validating, proposing, awaiting confirmation, committing, complete, failed, cancelled |
| Activity drawer | Expose target, source revision, operations, warnings, result, and Undo | Read result, proposal, stale proposal, committed summary, structured failure |
| Proposal surface | Review a dry run before a multi-edit transaction changes state | Valid, warning, stale, rejected, applying, complete |
| Confirmation sheet | Pause a genuinely destructive command | Awaiting decision, confirming, failed, cancelled |
| Recovery sheet | Compare durable revision and interrupted draft before opening | Reviewing, recover draft, open durable revision, discard draft confirmation |
| Inline validation | Explain a field or command error at its source | Invalid value, conflict, capability unavailable, storage failure |
| Status region | Announce save, recovery, proposal, commit, and Undo results | Polite routine update; alert only for urgent untethered failure |

## 3. Project Hub hierarchy

At the 1440×900 reference viewport:

1. The 52px top bar contains the Estro identity, project search, WebMCP availability, and one filled primary action: **New project**.
2. The 208px library rail contains All projects, Recent, Recoverable, and local storage status. Cloud destinations are not shown as disabled promises in Phase 1.
3. The center list is the primary reading and interaction area. A recovery banner appears above recent projects only while action is available.
4. The 372px detail rail explains the selected project's durability and most recent transaction. It contains the visible Undo affordance when the latest transaction is reversible.
5. Destructive deletion remains in the selected project's actions menu and opens a confirmation sheet. It is never a permanently red row action.

Rows use a list rather than a card grid so project name, project kind, modified time, durability, and recovery state align to stable scanning edges. Selection uses outline, surface, and chevron—not color alone.

## 4. Primary flows

### Create and open

Project Hub → New project sheet → enter name → Create project → project record and initial revision become durable → minimal project workspace opens → focus moves to the project name.

If persistence fails, the sheet remains open, the name remains entered, and the error names whether storage is unavailable, full, blocked, or retryable.

### Rename, duplicate, Save As, and snapshot

The actions menu launches a focused sheet or inline rename state. Submission remains available until validation occurs. Success creates a named transaction/revision, updates the visible project row, announces the result, and exposes Undo when safe.

Duplicate and Save As always create a new project identity. A named snapshot remains inside the same project identity and revision graph.

### Recover

The Project Hub recovery banner and recoverable filter lead to the same recovery sheet. It names:

- the last durable revision;
- the interrupted draft and interruption reason;
- the time and operation count difference;
- the choices to recover the draft or open the durable revision.

Discarding a recoverable draft is a separate confirmed consequence. Opening the durable revision does not silently delete the draft.

### Delete

Actions menu → Delete → stable confirmation sheet → consequence, local-only scope, affected revision count, and irreversibility → Cancel or Delete. Focus returns to the menu trigger on cancellation and to the next logical project row after deletion.

### WebMCP proposal

Agent targets the current project → Activity Island names the target → bounded inspection → proposal drawer names source revision and ordered changes → Apply or Reject. Apply is disabled only while the exact transaction is committing. A stale proposal preserves the project and leads to **Review latest**, not an automatic rebase.

### Undo and Redo

A completed result exposes Undo in the Activity drawer and project detail rail. Both call the same application command. Undo creates a new revision and transaction; it does not erase history. Redo appears only when the transaction graph allows it.

## 5. WebMCP visual parity

| WebMCP event | Visible UI response |
|---|---|
| Capability detection succeeds | Top bar reports `WebMCP ready`; expanded detail can list tool count and schema version |
| Capability detection fails | Quiet `Manual controls available` status; no error styling and no disabled ordinary UI |
| Read-only inspection begins | Activity Island and exact project target identify inspection; no mutation highlight |
| Validation fails | Field path or affected command is highlighted; plain cause, preserved-work statement, and recovery action appear |
| Proposal created | Activity drawer shows source revision, ordered operations, assumptions, warnings, Apply, and Reject |
| Confirmation required | Modal sheet names project, local data affected, destination if any, consequence, Confirm, and Cancel |
| Transaction commits | Only conflicting controls enter pending state; Activity Island transitions to complete |
| Transaction completes | Changed project row/detail briefly highlights; summary, revision, transaction ID, and Undo appear |
| Undo completes | Restored values and new revision are visible; Redo appears only when valid |
| Failure or cancellation | Work-preservation statement and retry/fallback appear; status never disappears automatically while actionable |

## 6. Component behavior

- Project rows are links for opening; their actions menu is a separate button with its own accessible name.
- Search is a labeled search input. Results update in a stable polite live region.
- New project, Apply, and confirmation actions retain their text while pending and add a localized spinner.
- Menus follow the menu-button keyboard model. Arrow keys move between items; Escape closes; focus returns to the trigger.
- Sheets use native dialog semantics where supported, make the background inert, trap focus, close with Escape unless an irreversible commit has started, and restore focus.
- Project lists use ordinary links and buttons rather than an ARIA grid. Native reading and tab order remain sufficient.
- Technical IDs use tabular monospace text and never replace the human-readable project or operation name.
- Status components always pair tone with icon and text.

## 7. Keyboard and focus order

### Project Hub

1. Skip to projects.
2. Estro/home link.
3. Search.
4. WebMCP status/details.
5. New project.
6. Library destinations.
7. Recovery action when present.
8. Project links and each adjacent actions button in document order.
9. Detail-rail actions for the selected project.

Changing selection through a project link does not unexpectedly move focus. Opening a sheet moves focus to its heading or first field. Validation focuses the first invalid field. Closing restores the initiating control unless that control no longer exists.

### Proposal and confirmation

Proposal content is read before its actions in DOM order. Reject precedes Apply so the safer exit is encountered first. Confirmation content names consequence before Cancel and destructive Confirm. No positive `tabindex` is used.

## 8. Loading, empty, error, and recovery states

- Under 150ms: immediate button/selection response; no spinner.
- 150ms–1s: local spinner or label state at the source control.
- 1–10s: Activity Island names the command and target. Phase 1 should rarely exceed this because it performs no media work.
- Longer persistence work is treated as abnormal; show the stage and a safe retry rather than fake progress.
- Initial project loading uses three list-row skeletons matching the real row geometry.
- Empty Project Hub copy: **No projects yet** / **Create a project to begin. Your work stays in this browser.**
- No search results preserve the query and offer **Clear search**.
- Storage errors preserve entered data and distinguish permission denial, quota, unavailable storage, and corruption.
- Recovery always names what is safe before asking what to open or discard.

## 9. Responsive behavior

| Mode | Behavior |
|---|---|
| Wide, 1440px+ | Library rail, project list, and detail rail coexist |
| Standard, 1180–1439px | Detail rail narrows; secondary metadata condenses but project actions remain reachable |
| Compact, 900–1179px | Detail rail becomes a selected-project drawer; library rail remains compact |
| Narrow, below 900px | Library becomes a filter menu; project list becomes the main flow; details open as a sheet |
| 320px reflow | Project search, recovery, create/open, and project actions remain supported; metadata wraps below names without horizontal scrolling |

Use logical sizing and spacing properties. Long project names wrap to two lines in task layouts and truncate only in dense top-bar context where the full name remains available semantically and by tooltip.

## 10. Accessibility acceptance

- One primary `<main>` with a visible page heading and a skip link before repeated chrome.
- Native links, buttons, search input, menu button, and dialog semantics.
- A 2px-equivalent `:focus-visible` perimeter with forced-colors support.
- 40×40px desktop interaction targets where density permits; never below the 24×24px WCAG minimum without a valid exception.
- Stable polite live region mounted before dynamic status updates.
- Field errors linked with `aria-describedby` and `aria-invalid`; first invalid field receives focus after submit.
- Icon-only actions have specific accessible names such as `Project actions for Anniversary film`.
- Agent targeting, user selection, and keyboard focus have different shapes/labels in addition to color.
- Reduced motion removes spectral travel, button scale, and sheet translation while preserving static outlines and status text.
- 200% zoom, 320px reflow, text growth, and keyboard-only completion are Phase 1 acceptance checks.

## 11. Feature coverage

| Feature | Primary interface evidence |
|---|---|
| `SH-001` | Project Hub lifecycle actions and deletion confirmation |
| `SH-010` | Revision-backed project state and transaction flow |
| `SH-011` | Detail-rail and Activity-drawer Undo/Redo |
| `SH-003` | Save state, Save As, and named snapshot flow |
| `SH-002` | Autosave durability and interrupted-write recovery |
| `SH-004` | Recent list, recoverable filter, and recovery banner |
| `SH-018` | Actor, intent, timestamp, transaction, and revision labels |
| `SH-076` | WebMCP readiness, tool count, and schema availability |
| `SH-064` | Bounded project-state inspection result |
| `SH-077` | Stale-revision and storage error surfaces |
| `SH-079` | Destructive project deletion gate |
| `SH-066` | Shared rename command from UI and WebMCP |
| `SH-071` | Transaction/Undo token in completed results |
| `SH-070` | Novice-readable completed change summary |
| `SH-068` | Ordered rename-plus-snapshot transaction |
| `SH-069` | No-mutation proposal with source revision and expiry |

## 12. Review decisions requested

- Approve the list-based Project Hub composition and three-column wide layout.
- Approve the right-side project detail rail as the home for durability and recent Undo.
- Approve the project rename plus named snapshot as the Phase 1 multi-edit demonstration.
- Approve the Activity Island/drawer treatment for inspection and proposals.
- Approve the recovery and destructive confirmation language hierarchy.

Approval permits implementation to begin with the containerized project scaffold and Slice 1. It does not authorize Docker execution, commits, pushes, deployment, uploads, or external service configuration.
