# Estro Product Design Blueprint

**Status:** Pre-Phase-1 design foundation approved · Baseline 1.0 · Dark-theme prototype

This document defines Estro’s visual identity, interaction language, design system, information architecture, page-to-page flows, WebMCP feedback model, and UI placement for all 213 retained capabilities. It is the design source of truth that sits alongside [`FEATURE_IMPLEMENTATION_PLAN.md`](./FEATURE_IMPLEMENTATION_PLAN.md) and [`FEATURE_DEPENDENCY_LEDGER.md`](./FEATURE_DEPENDENCY_LEDGER.md).

The approved Phase 1/2 implementation boundary is expanded in the supporting [`ESTRO_COMPONENT_LAYOUT_CONTRACT.md`](./design/pre-phase-1/ESTRO_COMPONENT_LAYOUT_CONTRACT.md). If that supporting document and this blueprint ever disagree, this blueprint is authoritative.

It intentionally describes a browser product rather than copying macOS or any reference site. The references supply principles—clarity, restraint, physical response, thoughtful motion, and visible system status—not a skin to imitate.

## 1. Reference synthesis

- [Transitions.dev](https://transitions.dev/) demonstrates a near-black, low-noise interface in which small transition studies are isolated and legible. Relevant patterns include state-text swaps, skeleton-to-content reveals, spinner-to-check completion, origin-aware menus, panel reveals, thinking states, streaming text, and restrained toasts.
- [Beam](https://beam.jakubantalik.com/) uses a spectral moving edge as a focal signal against an otherwise quiet dark surface. In this product, that language is reserved for active WebMCP work and never becomes permanent decoration.
- [Emil Kowalski’s Apple-design guidance](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) emphasizes immediate response, direct manipulation, interruptibility, spatial consistency, momentum-aware gestures, restraint, and feedback that explains state.
- [Apple’s Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/design-principles) and [design resources](https://developer.apple.com/design/) reinforce agency, familiarity, simplicity, craft, accessibility, and purposeful hierarchy.

### Direction distilled

The product should feel **calm, precise, cinematic, capable, and trustworthy**. It should not feel sterile, gamified, neon, excessively glassy, or like a generic admin dashboard. The media remains the visual hero; the interface quietly frames it.

## 2. Experience principles

1. **Media first.** The canvas or program monitor owns the visual center. Chrome recedes until needed.
2. **Simple, not simplistic.** Common actions remain visible; advanced controls are progressively disclosed one level deeper, not hidden behind vague menus.
3. **Direct manipulation first.** Dragging, trimming, scrubbing, transforming, masking, and brushing track the pointer continuously and can be interrupted.
4. **One action, one visible consequence.** Every user or agent action identifies its target, current state, and result.
5. **Agent work is never invisible.** WebMCP inspection, proposals, waits, mutations, confirmations, jobs, completion, and failure each have a distinct visible state.
6. **Agency and forgiveness.** Preview before expensive or destructive work; show scope; preserve undo; confirm only meaningful consequences.
7. **Quiet defaults.** Neutral surfaces, restrained borders, one primary accent, one filled primary action per view.
8. **Detail compounds.** Optical alignment, tooltip timing, focus restoration, press response, hit areas, text wrapping, and motion origins are treated as product quality.
9. **Motion earns its place.** Motion explains continuity, confirms input, or communicates status. Frequent keyboard actions and timeline operations remain effectively instant.
10. **Accessibility is visual quality.** Contrast, focus, semantics, keyboard access, reduced motion, target size, and readable status communication are foundational.

## 3. Visual identity

### Brand usage

- **Product name:** Estro.
- **Written form:** always `Estro` in title case; do not set the name in all capitals.
- **Initial identity:** wordmark-first. Use the product name in the system UI typeface at semibold weight rather than inventing a permanent symbol before visual exploration.
- **Placement:** the wordmark belongs on the Landing page, Project Hub, and compact top-left application identity area. It should not compete with the active media or project name inside the editor.
- **Motion:** the wordmark remains still. Agent activity is communicated through the separate Activity Island and spectral edge, never by animating the brand.
- **Standalone mark:** deliberately deferred until the first visual direction has been evaluated. If a temporary browser or application glyph becomes necessary, it must be a simple placeholder and must not be treated as the final logo.

### Personality

- **Primary emotion:** quiet confidence.
- **Secondary emotion:** creative possibility without intimidation.
- **Voice:** concise, specific, calm, and helpful; no jargon when plain language works.
- **Visual metaphor:** a dark editing room with carefully lit instruments.
- **Signature detail:** a restrained spectral edge or soft aurora used only while an agent is actively working, proposing, or waiting for approval.

### What to avoid

- Permanent animated gradients, ambient blobs, or glowing every control.
- Pure-black layers with no usable depth distinction.
- Excessive translucent surfaces stacked on each other.
- Pill-shaped containers for ordinary rectangular controls.
- Large radii on dense editor panels.
- Heavy shadows, repeated divider lines, or card grids inside the editor.
- Motion on scrubbing, keyboard commands, rapid tool switching, or repeated timeline actions.
- Color as the only indication of selection, error, warning, or completion.

## 4. Product information architecture

The product has six primary destinations. Most editing happens inside one persistent editor shell so media, selection, history, and agent context do not reset during navigation.

| Destination | Purpose | Primary contents |
|---|---|---|
| Landing | Explain the promise and enter the product | Product statement, example outcomes, open/create action |
| Project Hub | Find, create, recover, organize, or import projects | Recent projects, drafts, templates, status, search |
| Create/Import | Establish project type and source media | Photo/video choice, dimensions/sequence settings, picker, folder import |
| Editor | Perform photo and video work | Media, canvas/monitors, layers or timeline, inspector, tools, history, agent activity |
| Export | Configure, render, inspect, download, or publish output | Range, formats, presets, estimates, jobs, final preview |
| Review | Share, compare, comment, annotate, and approve | Review player, versions, comments, roles, links, locks |

### Route model

```text
/                         Landing
/projects                 Project Hub
/projects/new             Create or import
/editor/:projectId        Persistent editor shell
/editor/:projectId/export Export workspace over the same project context
/editor/:projectId/review Review workspace for owners/collaborators
/review/:shareId          Read-only or comment-enabled review link
```

Export and review are route-addressable workspaces, but they preserve the editor’s project revision and return path. Jobs, history, commands, and agent activity are global drawers rather than separate pages.

## 5. Persistent editor shell

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Project / save state     Context actions    Agent activity     Export    │
├──────┬───────────────────────┬───────────────────────────────┬───────────┤
│ Tool │ Media / Layers / Bins │                               │ Inspector │
│ rail │ / Effects / History   │   Canvas or Program Monitor   │           │
│      │                       │                               │           │
├──────┴───────────────────────┴───────────────────────────────┴───────────┤
│ Photo filmstrip / Video timeline / keyframes / audio lanes               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Shell regions

- **Top bar:** back to projects, project name, save/sync/offline state, undo/redo, contextual actions, agent state, review, export.
- **Tool rail:** stable mode selection. Icons are paired with tooltips and shortcuts; the active tool has shape, icon, and color reinforcement.
- **Left working panel:** switches among Media, Layers, Bins, Effects, Text/Graphics, History, and Comments without changing the central selection.
- **Center stage:** photo canvas or video monitors; owns transform handles, guides, masks, selections, overlays, comparison, and agent proposal previews.
- **Inspector:** context-sensitive properties grouped by effect on the result, not internal implementation terminology.
- **Bottom workspace:** photo filmstrip/batch tray or video timeline, waveform, automation, and keyframe lanes.
- **Agent Activity Island:** compact status at the top center; expands into an activity drawer containing target, proposal, progress, result, warnings, and Undo.
- **Job Center:** persistent drawer available from the top bar; survives navigation and shows queue, progress, cancel, retry, and outputs.

### Default panel arrangements

The shell is shared, but its opening arrangement responds to the type of editing work rather than forcing photo and video into the same layout.

| Region | Photo default | Video default |
|---|---|---|
| Left working panel | Layers selected; Media is an adjacent tab | Media/Bins selected; other workspaces remain available from the rail |
| Center stage | Single canvas with pasteboard, guides, and direct-manipulation handles | Program Monitor; Source Monitor becomes a tab at standard widths and may sit beside it only when space permits |
| Right side | Contextual Inspector | Contextual Inspector |
| Bottom workspace | Hidden for a single image; 120px filmstrip/batch tray when multiple assets are active | 272px timeline with waveform, automation, and keyframe lanes; vertically resizable |
| Agent feedback | Activity Island at top center; 360px overlay drawer expands without permanently reducing canvas width | Same behavior; durable work additionally appears in Job Center |

The approved implementation baseline is: 52px top bar, 48px tool rail, 280px left panel, and 304px Inspector. The left panel resizes from 224–360px and the Inspector from 272–400px. Video begins with a 272px vertically resizable timeline. Photo uses a 120px filmstrip only when multiple assets or batch context make it useful. These are content-tested starting values, not immutable project data or permanent constants.

## 6. Page-to-page user flows

### 6.1 New project

Landing → Project Hub → Create/Import → choose Photo or Video → configure only essential settings → select media → Editor. Advanced format or sequence settings sit behind an explicit disclosure. Import progress remains attached to the entering asset and then moves to Job Center if it becomes long-running.

### 6.2 Returning or recovering

Project Hub → recent project or recoverable draft → recovery summary when necessary → Editor at the last stable revision. Missing media opens a focused relink sheet without discarding edits.

### 6.3 Photo editing

Project Hub → Photo Editor → select layer or region → choose tool/adjustment → manipulate directly or use Inspector → compare before/after → save automatically → Export → inspect output → download or return.

### 6.4 Video editing

Project Hub → Video Editor → import/browse media → source preview and mark ranges → append/insert to timeline → trim and arrange → add motion/color/audio/titles/captions → preview range → Export → monitor render → inspect output.

### 6.5 Agent collaboration

Any editor state → external agent invokes WebMCP → target receives a visible halo → Agent Activity Island names the operation → inspection returns quietly, or a proposal appears as a reversible preview → user confirms when required → localized or job progress appears → result summary identifies changes and offers Undo → focus returns to the affected media.

### 6.6 Teaching

Agent explanation → affected control and media region are highlighted → a small anchored teaching card explains the goal and parameter in plain language → user performs the step or asks the agent to apply it → step progress updates without blocking manual editing.

### 6.7 Review and collaboration

Editor → Review → select revision → create link and role → reviewer opens shared route → plays or compares → anchors comment to object/region/time → owner resolves feedback or opens it in the editor → revisions remain identifiable.

### 6.8 Export and publishing

Editor → Export → choose destination preset/range → capability validation and size estimate → preview → confirm external publishing if applicable → render job → progress/cancel → output inspection → download/publish receipt → return to editor revision.

## 7. Dark-only design system

These values are the approved implementation baseline. Use semantic tokens in code; components must not consume raw palette values directly. The rendered design direction passes the representative contrast checks below, while the implemented OKLCH tokens still require sRGB-gamut, APCA, and browser-matrix verification.

### 7.1 Color tokens (OKLCH)

| Token | Value | Role |
|---|---|---|
| `--canvas-backdrop` | `oklch(0.095 0.008 260)` | Space around media; deepest neutral |
| `--app-bg` | `oklch(0.120 0.009 260)` | Main application background |
| `--surface-1` | `oklch(0.155 0.010 260)` | Panels and primary chrome |
| `--surface-2` | `oklch(0.190 0.012 260)` | Raised controls, menus, selected rows |
| `--surface-3` | `oklch(0.235 0.014 260)` | Hovered or emphasized neutral surface |
| `--border-subtle` | `oklch(0.275 0.012 260)` | Structural separation only |
| `--border-strong` | `oklch(0.400 0.014 260)` | Input and active-region boundaries |
| `--text-primary` | `oklch(0.950 0.006 260)` | Primary text and icons |
| `--text-secondary` | `oklch(0.755 0.010 260)` | Supporting text |
| `--text-tertiary` | `oklch(0.620 0.010 260)` | Metadata, never critical content |
| `--accent` | `oklch(0.720 0.145 252)` | Selection, primary action, focus relationship |
| `--accent-hover` | `oklch(0.780 0.135 252)` | Hover/active accent |
| `--agent-a` | `oklch(0.730 0.150 250)` | Agent activity edge start |
| `--agent-b` | `oklch(0.760 0.145 315)` | Agent activity edge end |
| `--success` | `oklch(0.760 0.140 150)` | Completed/safe state |
| `--warning` | `oklch(0.820 0.140 82)` | Warning/attention |
| `--danger` | `oklch(0.680 0.190 27)` | Destructive/error state |
| `--focus` | `oklch(0.820 0.120 235)` | Keyboard focus indicator |

Rules: one color has one meaning; critical statuses always include icon and text; the accent fills at most one primary action in a local view; the spectral agent pair appears only during agent-related state.

Representative artifact pairs were measured with the WCAG contrast formula:

| Rendered pair | Contrast |
|---|---:|
| Primary text on application background | 17.27:1 |
| Secondary text on application background | 9.10:1 |
| Tertiary text on application background | 4.55:1 |
| Dark label on primary action | 6.80:1 |
| Focus perimeter on panel surface | 10.73:1 |
| Danger status on panel surface | 6.46:1 |
| Warning status on panel surface | 9.14:1 |
| Success status on panel surface | 8.23:1 |

### 7.2 Typography

- **Primary:** system UI stack—`ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`—for native clarity and zero font-loading delay.
- **Technical values:** `ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace` for timecode, dimensions, frame rates, percentages, and identifiers.
- **Weights:** 400 regular, 500 interface emphasis, 600 headings/primary actions. Avoid thin text at editor sizes.
- **Changing values:** use tabular numerals for timecode, progress, dimensions, sliders, audio meters, and counters.

| Role | Size / line-height | Usage |
|---|---|---|
| Display | `40px / 1.08` | Landing statement only |
| Page title | `28px / 1.15` | Project Hub and major empty states |
| Workspace title | `20px / 1.25` | Export, review, modal titles |
| Section heading | `16px / 1.3` | Inspector and sheet groups |
| Body | `14px / 1.5` | Explanations, summaries, errors |
| Control | `13px / 1.3` | Buttons, menus, inputs, timeline labels |
| Caption | `12px / 1.35` | Metadata and secondary status |
| Micro | `11px / 1.3` | Time ticks only; never essential instructions |

Use natural sentence case, balanced headings, pretty wrapping on descriptions, and a 60–75 character measure for explanatory text. Inputs remain at least 16px on mobile-sized layouts.

### 7.3 Spacing and density

Base spacing unit: 4px. Token scale: `4, 8, 12, 16, 24, 32, 48, 64`.

- Dense editor chrome uses 8–12px internal spacing while maintaining at least 40px desktop hit areas where possible.
- Task pages, onboarding, export, and review use 24–32px group spacing.
- Inter-group spacing is at least twice intra-group spacing.
- Prefer negative space to repeated divider lines.
- Align related controls to stable edges and use logical properties for direction-aware layout.

Estro uses **adaptive professional density**: comfortable enough for a novice to parse, but compact where continuous editing requires many controls to coexist. Density follows the task, not a single global compactness setting.

| Context | Initial density |
|---|---|
| Landing, Project Hub, Create/Import | 24–32px between conceptual groups; generous explanatory space |
| Export, Review, confirmations, teaching | 16–24px internal grouping and 24–32px between sections |
| Editor panels and timeline | 8–12px internal spacing with progressive disclosure for advanced controls |
| Tool rail buttons | 40×40px hit area with an 18px icon |
| Panel headers | 40px high |
| Inspector rows | 32–36px high according to control complexity |
| Menus and popovers | 32px minimum row height on pointer-first desktop layouts |

The approved photo, video, route-flow, WebMCP-state, and component-system artifacts confirm the initial scanability, target separation, label truncation, and media-stage balance of these values. Implementation must repeat those checks with live text growth, 200% zoom, keyboard focus, and representative media before treating individual component dimensions as final.

### 7.4 Shape, borders, and depth

| Element | Radius | Treatment |
|---|---:|---|
| Compact control/input | 6px | Neutral fill or single border |
| Menu/popover | 8px | Raised surface, origin-aware |
| Panel/card | 10px | Used outside dense editor regions |
| Modal/sheet | 12px | Centered or edge-anchored with clear hierarchy |
| Status chip/avatar | Full | Reserved for genuinely compact/status objects |

Use subtle borders for structure and shadows only where layers overlap. Translucency is restricted to floating top chrome, popovers, and agent surfaces; do not stack translucent layers. Provide solid fallbacks for reduced transparency and low-performance devices.

### 7.5 Icons

Use **Lucide** as the approved initial icon direction because it is open, broad, visually quiet, and suitable for a browser application. Use its outline style at a consistent 1.75px stroke and the icons’ native 24-unit grid. Default rendered sizes are 16px in controls and 18px in the tool rail. Active state comes from foreground color, selection surface, and accompanying label or tooltip—not from mixing unrelated filled icon families. This design decision does not authorize installing the package; dependency selection remains an implementation-time approval boundary.

Editor-specific symbols that Lucide does not provide may be custom drawn only after an icon coverage audit. They must match the same grid, stroke, joins, caps, and optical weight. Do not mix icon libraries or use emoji as product icons. Icon-only controls require accessible names and delayed tooltips that become instant when moving between neighboring toolbar items. Installing any icon package remains an implementation decision governed by the project’s dependency-approval rules.

### 7.6 Core controls

- **Primary button:** accent fill, one per local task surface.
- **Secondary button:** neutral raised surface.
- **Ghost button:** frequent low-emphasis editor actions.
- **Destructive button:** neutral until the confirmation surface; danger color is reserved for consequence.
- **Slider:** numeric field paired with track; direct dragging plus keyboard increments and reset.
- **Segmented control:** two to four mutually exclusive modes; avoid for navigation across unrelated content.
- **Tabs:** stable content categories; preserve selection and scroll where appropriate.
- **Popover:** anchored to trigger and opens from that origin.
- **Modal:** only for focused blocking decisions; background inert and focus restored on close.
- **Toast:** completion or brief background status; errors/actions persist until dismissed or resolved.
- **Tooltip:** names icons and exposes shortcuts; never carries essential instructions alone.

### 7.7 Shared component state contract

Phase 1 and Phase 2 implement the smallest real set needed by their surfaces. Later phases extend these components rather than creating unrelated photo and video variants.

| Component family | Minimum contract |
|---|---|
| Button and icon button | Primary, secondary, ghost, destructive, hover, active, focus-visible, pending, and disabled states; one filled primary action per local task; icon-only controls have accessible names |
| Field and numeric field | Visible label, value, unit, helper/error slot, reset, validation, and tabular changing values |
| Slider field | Track paired with a numeric field; pointer capture, keyboard increments, reset, and exposed units/ranges/default |
| Tabs and segmented control | Stable categories or two-to-four exclusive modes; documented arrow-key behavior and preserved context |
| Disclosure group | Visible affordance and preserved state; active overrides, validation, consequences, and agent changes never remain hidden |
| Panel and panel header | Stable heading, optional tabs, logical resize behavior, and consistently placed actions |
| Status line | Icon, plain text, semantic tone, optional action, and a stable polite live-region path |
| Activity Island | Every state in the WebMCP activity machine; expansion names target, scope, progress/result, and next action |
| Job item | Task and target, real stage or processed units, cancel, retry/fallback, output identity, and partial-output disposition |
| Focus halo | Visually distinguishes keyboard focus, user selection, and agent targeting with static non-color cues |
| Proposal surface | Target, source revision, scope/diff, reversible preview, Apply/Reject, warnings, transaction result, and Undo |
| Confirmation sheet | Consequence, destination/actor, affected items, Confirm/Cancel, inert background, and focus restoration |
| Popover, tooltip, and toast | Origin-aware transient surfaces; essential instructions never depend on a tooltip; errors/actions persist; long jobs remain in Job Center |
| Empty, loading, and error states | Skeleton matches final structure; empty state names how to continue; error names cause, preserved work, and recovery |

Every state-changing UI and WebMCP operation must surface the same stable target IDs, validation result, revision or transaction identity, human-readable summary, and Undo availability.

## 8. Motion and direct manipulation

### Motion tiers

| Frequency / purpose | Behavior |
|---|---|
| Keyboard commands, scrubbing, tool switching, repeated timeline edits | Immediate; no entrance/exit animation |
| Press response | 100–140ms pointer-only scale/color response |
| Tooltip/popover | 125–180ms; origin-aware; subsequent tooltips instant |
| Dropdown/segmented indicator | 150–220ms; interruptible transition |
| Panel/drawer | 180–260ms; same enter/exit path |
| Modal/sheet | 220–280ms; centered modal or source-anchored sheet |
| Drag, trim, transform, slider, mask, brush | 1:1 continuous tracking; pointer capture; no delayed animation |
| Momentum gesture | Spring from live value with carried velocity and subtle boundary resistance |
| Loading/progress | Continuous and purposeful; never blocks interaction merely to finish decoration |

Animate transform and opacity by default. Avoid `transition: all`, scale from zero, slow `ease-in`, layout-property animation, and non-interruptible gesture animations. Reduced motion replaces spatial motion with short cross-fades and removes beam travel, bounce, parallax, and large repositioning.

## 9. WebMCP visual feedback system

The browser page must make agent behavior understandable even when the conversation is outside the page.

### 9.1 Agent activity state machine

```text
Idle → Targeting → Inspecting/Validating → Proposing → Awaiting confirmation
                                      ↘ Queued → Running → Preview ready
                                                   → Committing → Complete
                                                   → Failed / Cancelled
```

| State | Visible treatment |
|---|---|
| Targeting | 2px focus halo around exact object/control; activity island names target |
| Inspecting | Small fast activity glyph and plain status text; no canvas obstruction |
| Validating | Localized spinner in affected control or activity island |
| Proposing | Ghosted canvas/timeline result, before/after control, scope summary, Apply/Reject |
| Awaiting confirmation | Stable confirmation sheet with consequence, destination, affected items, and unchanged background preview |
| Queued | Queue position only when meaningful; Cancel remains visible |
| Running | Determinate progress when real; otherwise staged indeterminate indicator plus current task |
| Preview ready | Preview badge and side-by-side or overlay comparison; source revision remains named |
| Committing | Short localized spinner; input disabled only for the exact conflicting target |
| Complete | Spinner morphs to check, changed target briefly highlighted, summary + Undo |
| Failed | Error icon, plain cause, preserved work, retry/fallback action |
| Cancelled | Neutral stopped state with partial-output disposition stated |

The Beam-inspired spectral edge may travel around the Agent Activity Island or active target only during Inspecting, Validating, Queued, or Running. It becomes a static accent outline under reduced motion and disappears on completion.

### 9.2 Wait-duration ladder

| Observed duration | Required feedback |
|---:|---|
| 0–150ms | Immediate press/selection response; no spinner |
| 150ms–1s | Localized 14–16px spinner or text-state swap at the action source |
| 1–10s | Activity Island with task label and cancel when supported |
| 10s+ or navigable work | Persistent Job Center item with stages, determinate progress when real, cancel/retry, and completion notification |

Never show fake percentages. If duration is unknown, show the current stage and processed units when available. Collection loading uses skeletons shaped like the final content; media analysis uses a stable placeholder with activity confined to the analyzed region.

### 9.3 Feedback placement hierarchy

1. Put feedback on the affected control or media object when the scope is local.
2. Use the Agent Activity Island for operation-level status.
3. Use Job Center for durable or long-running work.
4. Use a toast only for completion that does not require immediate inspection.
5. Use a modal or confirmation sheet only when the user must decide before work continues.

All dynamic status text is announced through a stable polite live region. Urgent failures use an alert only when immediate attention is required. Color is always paired with icon and text.

## 10. Responsive and adaptive behavior

The prototype is dark-only and desktop-first because precise photo/video editing benefits from width, pointer precision, and keyboard access. The initial judging and design viewport is **1440×900 CSS pixels**. The numeric thresholds below are approved content-fit starting constraints derived from panel widths and the minimum useful media stage—not device-brand presets.

| Width condition | Editor behavior |
|---|---|
| Wide · 1440px and above | Left working panel, center stage, Inspector, and bottom workspace can remain visible together; video may offer dual Source/Program monitors when the media area still fits |
| Standard · 1180–1439px | Full editor remains available; left content switches through the rail, Source Monitor becomes a tab, Inspector remains visible, and the timeline stays resizable |
| Compact · 900–1179px | Inspector and left working panel become mutually exclusive drawers; center stage and timeline remain primary |
| Narrow · below 900px | Project browsing, review, comments, job monitoring, and deliberately selected basic edits; dense timeline and advanced multi-panel workflows require a larger workspace |

The design minimum for the complete multi-panel editor is **1180×700 CSS pixels**; **1280×720 or larger** is recommended. Below 700px in height, the bottom workspace collapses or reduces before the center stage becomes unusable.

The interface must survive 200% zoom, 320px reflow for supported flows, text growth, and keyboard-only operation. Safe areas and logical properties are mandatory. Fullscreen media may bleed to edges; controls remain inside safe margins.

## 11. Accessibility baseline

- Native interactive elements before custom ARIA.
- Visible `:focus-visible` indicator with at least a 2px equivalent perimeter and forced-colors support.
- Complete keyboard path for every pointer action; timeline/canvas composite widgets use documented keyboard models.
- Escape closes overlays; modals trap and restore focus; background becomes inert.
- Minimum 24×24 CSS-pixel target under WCAG rules; aim for 40×40 desktop and 44×44 touch where density permits.
- Accessible names for every icon-only control and state announcement for progress/results.
- Status never relies on color alone.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`, zoom, text resize, and forced-colors behavior are designed as component variants.
- Autoplaying media has pause controls; errors and actionable toasts do not disappear automatically.
- Media and tutorial captions remain available, readable, and style-safe.

## 12. Design deliverables before and during implementation

### Before Phase 1

- [x] Approve emotional direction, dark palette direction, typography, density, and agent signature.
- [x] Produce a 1440×900 primary [`Video Editor`](./design/pre-phase-1/estro-video-editor-concept.png) visual and matching [`Photo Editor`](./design/pre-phase-1/estro-photo-editor-concept.png) adaptation.
- [x] Define the full [`WebMCP feedback lifecycle`](./design/pre-phase-1/estro-webmcp-feedback-states.png), including proposal, wait, result, failure, cancellation, and Undo.
- [x] Produce structural [`supporting-flow wireframes`](./design/pre-phase-1/estro-supporting-flow-wireframes.png) for Landing, Project Hub, Create/Import, Export/Job Center, and Review.
- [x] Confirm color, typography, density, icons, shell dimensions, responsive transitions, focus, motion, loading, and progressive disclosure in the [`core-system board`](./design/pre-phase-1/estro-core-system-contract.png).
- [x] Define the reusable Phase 1/2 component states and layout boundaries in the [`component/layout contract`](./design/pre-phase-1/ESTRO_COMPONENT_LAYOUT_CONTRACT.md).

### For every implementation phase

- User journey and demonstrable design goal.
- Screen/panel inventory and interaction states.
- Wireframe or prototype approved before production UI work.
- UI and WebMCP behavior shown together.
- Loading, empty, error, unsupported, cancellation, and recovery states.
- Keyboard, focus, reduced-motion, and contrast behavior.
- Design acceptance added to the phase exit demonstration.

## 13. Feature-to-interface coverage index

Every retained feature is listed once below. The surface identifies where the user finds it; the feedback classes identify how direct and WebMCP-driven activity becomes visible.

### Feedback classes

| Code | Meaning | Required treatment |
|---|---|---|
| `I` | Immediate edit | Direct preview, updated Inspector/state, revision acknowledgement, Undo; spinner only after 150ms |
| `R` | Read/inspect/focus | Target highlight or selected state, skeleton only if data is not ready, no mutation styling |
| `S` | Short wait | Localized spinner or text-state swap at the action source |
| `J` | Long-running job | Activity Island → Job Center with stage/progress/cancel/retry → output focus |
| `P` | Proposal/confirmation | Scope/diff/consequence, stable Apply/Reject or Confirm/Cancel decision |
| `B` | Background state | Persistent save/sync/offline/recovery status without blocking work |
| `C` | Collaboration/external | Actor/destination/permission identity, network state, confirmation where required |
| `T` | Teaching/navigation | Focus halo, anchored explanation, step indicator, manual-control handoff |

### Shared feature coverage

| ID | Feature | Primary UI surface | Feedback |
|---|---|---|---|
| `SH-001` | Create, open, rename, duplicate, and delete projects | Project Hub · editor top bar · version/recovery surfaces | I, P, B |
| `SH-002` | Autosave and crash recovery | Project Hub · editor top bar · version/recovery surfaces | I, B |
| `SH-003` | Explicit save, Save As, and project snapshots | Project Hub · editor top bar · version/recovery surfaces | I, B |
| `SH-004` | Recent projects and recoverable drafts | Project Hub · editor top bar · version/recovery surfaces | I, B |
| `SH-005` | Project templates | Project Hub · editor top bar · version/recovery surfaces | I, B |
| `SH-006` | Portable project package | Project Hub · editor top bar · version/recovery surfaces | I, J, B |
| `SH-007` | Project version history | Project Hub · editor top bar · version/recovery surfaces | I, B |
| `SH-008` | Cross-device/cloud project sync | Project Hub · editor top bar · version/recovery surfaces | I, B |
| `SH-009` | Offline editing | Project Hub · editor top bar · version/recovery surfaces | I, B |
| `SH-010` | Non-destructive operation graph | Editor top bar · History panel · comparison overlay | I |
| `SH-011` | Undo and redo | Editor top bar · History panel · comparison overlay | I |
| `SH-012` | Multi-step history panel | Editor top bar · History panel · comparison overlay | I |
| `SH-013` | Named snapshots/checkpoints | Editor top bar · History panel · comparison overlay | I |
| `SH-014` | Selective revert of an operation | Editor top bar · History panel · comparison overlay | I |
| `SH-015` | Before/after comparison | Editor top bar · History panel · comparison overlay | I, R |
| `SH-016` | Copy and paste edit attributes | Editor top bar · History panel · comparison overlay | I |
| `SH-017` | Presets for reusable edit settings | Editor top bar · History panel · comparison overlay | I |
| `SH-018` | Edit provenance | Editor top bar · History panel · comparison overlay | I |
| `SH-019` | Resizable and dockable panels | Persistent editor shell · command palette · canvas chrome | I |
| `SH-021` | Context-sensitive property inspector | Persistent editor shell · command palette · canvas chrome | I |
| `SH-022` | Contextual task/action bar | Persistent editor shell · command palette · canvas chrome | I |
| `SH-023` | Searchable commands and features | Persistent editor shell · command palette · canvas chrome | I, R |
| `SH-025` | Keyboard shortcuts | Persistent editor shell · command palette · canvas chrome | I |
| `SH-026` | Mouse, trackpad, touch, and pen input | Persistent editor shell · command palette · canvas chrome | I |
| `SH-028` | Fullscreen and distraction-free preview | Persistent editor shell · command palette · canvas chrome | I, R |
| `SH-029` | Rulers, guides, grids, snapping, and safe areas | Persistent editor shell · command palette · canvas chrome | I |
| `SH-030` | Zoom, pan, rotate view, and fit-to-view | Persistent editor shell · command palette · canvas chrome | I |
| `SH-031` | Pixel grid and actual-size view | Persistent editor shell · command palette · canvas chrome | I |
| `SH-032` | Multiple preview quality levels | Persistent editor shell · command palette · canvas chrome | I, R |
| `SH-033` | Local file import via picker and drag-and-drop | Media Library panel · import/relink sheets · asset browser | R, S, J |
| `SH-034` | Folder import | Media Library panel · import/relink sheets · asset browser | R, S, J |
| `SH-035` | Asset library with thumbnails | Media Library panel · import/relink sheets · asset browser | R, S |
| `SH-036` | Asset metadata inspection | Media Library panel · import/relink sheets · asset browser | R, S |
| `SH-037` | Tags, ratings, labels, favorites, and collections | Media Library panel · import/relink sheets · asset browser | R, S |
| `SH-038` | Search and filters | Media Library panel · import/relink sheets · asset browser | R, S |
| `SH-040` | Missing-media detection and relinking | Media Library panel · import/relink sheets · asset browser | R, S, J, B |
| `SH-041` | Replace source while preserving edits | Media Library panel · import/relink sheets · asset browser | R, S |
| `SH-042` | Font management and missing-font substitution | Media Library panel · import/relink sheets · asset browser | R, S |
| `SH-043` | Proxy/optimized media generation | Media Library panel · import/relink sheets · asset browser | R, S, J |
| `SH-044` | Position, scale, rotation, and anchor/origin controls | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-045` | Crop, fit, fill, and aspect-ratio behavior | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-046` | Opacity | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-047` | Blend modes | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-048` | Alignment and distribution | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-049` | Grouping and nesting | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-050` | Lock, hide, solo, mute, and isolate | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-051` | Masks | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-052` | Clipping relationships | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-053` | Adjustment/effect containers | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-054` | Keyframeable properties | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-055` | Motion paths and easing curves | Canvas/program monitor · selection overlay · Inspector | I |
| `SH-056` | Point text and paragraph text | Graphics/Text tools · Inspector · canvas/program monitor | I |
| `SH-057` | Font family, weight, style, size, leading, tracking, and kerning | Graphics/Text tools · Inspector · canvas/program monitor | I |
| `SH-058` | Text alignment, indentation, lists, and paragraph spacing | Graphics/Text tools · Inspector · canvas/program monitor | I |
| `SH-060` | Text styles and reusable brand styles | Graphics/Text tools · Inspector · canvas/program monitor | I |
| `SH-061` | Shapes and vector paths | Graphics/Text tools · Inspector · canvas/program monitor | I |
| `SH-062` | Gradients, patterns, and reusable swatches | Graphics/Text tools · Inspector · canvas/program monitor | I |
| `SH-063` | SVG import and export | Graphics/Text tools · Inspector · canvas/program monitor | I, J |
| `SH-064` | Structured project-state inspection tool | Agent Activity Island · activity drawer · focused target | R |
| `SH-065` | Asset inventory and metadata tool | Agent Activity Island · activity drawer · focused target | R |
| `SH-066` | Deterministic atomic edit tools | Agent Activity Island · activity drawer · focused target | I, P |
| `SH-067` | Batch edit tools | Agent Activity Island · activity drawer · focused target | I, J, P |
| `SH-068` | Transactional multi-edit operations | Agent Activity Island · activity drawer · focused target | I, P |
| `SH-069` | Dry-run or proposal mode | Agent Activity Island · activity drawer · focused target | I, P |
| `SH-070` | Human-readable change summary | Agent Activity Island · activity drawer · focused target | I, P |
| `SH-071` | Tool-level undo tokens or transaction IDs | Agent Activity Island · activity drawer · focused target | I, P |
| `SH-072` | Preview-render tool | Agent Activity Island · activity drawer · focused target | R, J |
| `SH-073` | Selection and focus tool | Agent Activity Island · activity drawer · focused target | R, T |
| `SH-074` | Explain-this-edit tool | Agent Activity Island · activity drawer · focused target | R, T |
| `SH-075` | Guided teaching/highlight mode | Agent Activity Island · activity drawer · focused target | R, T |
| `SH-076` | Capability discovery and schema versioning | Agent Activity Island · activity drawer · focused target | R |
| `SH-077` | Structured validation and actionable errors | Agent Activity Island · activity drawer · focused target | I, P |
| `SH-078` | Long-running job progress and cancellation | Agent Activity Island · activity drawer · focused target | R, J |
| `SH-079` | Permission gates for upload, external sharing, and destructive edits | Agent Activity Island · activity drawer · focused target | P, C |
| `SH-081` | Shareable read-only preview | Review workspace · share/role sheets · global shell | R, P, C |
| `SH-082` | Comments anchored to objects, regions, or timecodes | Review workspace · share/role sheets · global shell | P, C |
| `SH-083` | Roles and permissions | Review workspace · share/role sheets · global shell | P, C |
| `SH-084` | Complete keyboard operation | Review workspace · share/role sheets · global shell | P, C |
| `SH-085` | Semantic controls and screen-reader labels | Review workspace · share/role sheets · global shell | P, C |
| `SH-086` | Visible focus and predictable tab order | Review workspace · share/role sheets · global shell | P, C, T |
| `SH-087` | Reduced-motion mode | Review workspace · share/role sheets · global shell | P, C |
| `SH-088` | High-contrast mode and non-color status indicators | Review workspace · share/role sheets · global shell | P, C |
| `SH-089` | Captioned tutorials and accessible media previews | Review workspace · share/role sheets · global shell | R, P, C |

### Photo feature coverage

| ID | Feature | Primary UI surface | Feedback |
|---|---|---|---|
| `PH-001` | Create documents with dimensions, resolution, orientation, and background | Photo canvas · Document inspector · contextual bar | I |
| `PH-002` | Resize image with resampling controls | Photo canvas · Document inspector · contextual bar | I |
| `PH-003` | Resize canvas independently of image | Photo canvas · Document inspector · contextual bar | I |
| `PH-004` | Crop, straighten, rotate, and flip | Photo canvas · Document inspector · contextual bar | I |
| `PH-005` | Perspective crop and keystone correction | Photo canvas · Document inspector · contextual bar | I |
| `PH-007` | Pixel layers | Layers panel · photo canvas · Layer inspector | I |
| `PH-008` | Layer groups and nested groups | Layers panel · photo canvas · Layer inspector | I |
| `PH-009` | Layer masks | Layers panel · photo canvas · Layer inspector | I |
| `PH-010` | Vector masks | Layers panel · photo canvas · Layer inspector | I |
| `PH-011` | Clipping masks | Layers panel · photo canvas · Layer inspector | I |
| `PH-012` | Adjustment layers | Layers panel · photo canvas · Layer inspector | I |
| `PH-013` | Fill layers | Layers panel · photo canvas · Layer inspector | I |
| `PH-014` | Layer styles | Layers panel · photo canvas · Layer inspector | I |
| `PH-015` | Channels and alpha channels | Layers panel · photo canvas · Layer inspector | I |
| `PH-016` | Rectangular and elliptical marquee | Photo canvas overlay · selection toolbar · Mask inspector | I |
| `PH-017` | Freehand, polygonal, and magnetic lasso | Photo canvas overlay · selection toolbar · Mask inspector | I |
| `PH-018` | Magic wand and contiguous color selection | Photo canvas overlay · selection toolbar · Mask inspector | I |
| `PH-019` | Color-range and luminance-range selection | Photo canvas overlay · selection toolbar · Mask inspector | I |
| `PH-020` | Select-and-mask workspace | Photo canvas overlay · selection toolbar · Mask inspector | I |
| `PH-021` | Save, load, transform, expand, contract, smooth, and border selections | Photo canvas overlay · selection toolbar · Mask inspector | I |
| `PH-022` | Selection from layer transparency or path | Photo canvas overlay · selection toolbar · Mask inspector | I |
| `PH-023` | Free transform with numeric controls | Photo canvas transform overlay · Geometry inspector | I |
| `PH-024` | Warp transform | Photo canvas transform overlay · Geometry inspector | I |
| `PH-026` | Clone stamp | Photo tool rail · brush HUD · canvas | I |
| `PH-027` | Red-eye correction | Photo tool rail · brush HUD · canvas | I |
| `PH-028` | Dodge, burn, and sponge | Photo tool rail · brush HUD · canvas | I |
| `PH-029` | Blur, sharpen, and smudge brushes | Photo tool rail · brush HUD · canvas | I |
| `PH-030` | Brightness and contrast | Color inspector · histogram · photo canvas | I |
| `PH-031` | Exposure, offset, and gamma | Color inspector · histogram · photo canvas | I |
| `PH-032` | Levels with per-channel histograms | Color inspector · histogram · photo canvas | I, R |
| `PH-033` | Curves | Color inspector · histogram · photo canvas | I |
| `PH-034` | White balance and tint | Color inspector · histogram · photo canvas | I |
| `PH-035` | Hue, saturation, and lightness | Color inspector · histogram · photo canvas | I |
| `PH-036` | Vibrance | Color inspector · histogram · photo canvas | I |
| `PH-037` | Color balance | Color inspector · histogram · photo canvas | I |
| `PH-038` | Selective color | Color inspector · histogram · photo canvas | I |
| `PH-039` | Black-and-white conversion and channel mixing | Color inspector · histogram · photo canvas | I |
| `PH-040` | Gradient map | Color inspector · histogram · photo canvas | I |
| `PH-041` | Photo filter and color lookup/LUT | Color inspector · histogram · photo canvas | I |
| `PH-042` | Shadows/highlights recovery | Color inspector · histogram · photo canvas | I, B |
| `PH-043` | Replace color | Color inspector · histogram · photo canvas | I |
| `PH-044` | Posterize, threshold, invert, and equalize | Color inspector · histogram · photo canvas | I |
| `PH-045` | Histogram and clipping warnings | Color inspector · histogram · photo canvas | I, R |
| `PH-046` | Manual distortion and perspective correction | Develop workspace · compare view · batch tray | I |
| `PH-047` | Sharpening and output sharpening | Develop workspace · compare view · batch tray | I |
| `PH-048` | Camera and creative profiles | Develop workspace · compare view · batch tray | I |
| `PH-049` | Batch synchronization across photos | Develop workspace · compare view · batch tray | I, J, B |
| `PH-050` | Brush, pencil, and eraser tools | Photo tool rail · brush/fill HUD · canvas | I |
| `PH-051` | Brush presets | Photo tool rail · brush/fill HUD · canvas | I |
| `PH-052` | Pen pressure, tilt, rotation, and velocity dynamics | Photo tool rail · brush/fill HUD · canvas | I |
| `PH-054` | Gradient tool | Photo tool rail · brush/fill HUD · canvas | I |
| `PH-055` | Paint bucket and tolerance-based fill | Photo tool rail · brush/fill HUD · canvas | I |
| `PH-057` | Gaussian, box, motion, radial, lens, and surface blur | Effects browser · Inspector · photo canvas | I |
| `PH-058` | Unsharp mask, smart sharpen, and high-pass sharpening | Effects browser · Inspector · photo canvas | I |
| `PH-059` | Add/reduce noise, dust and scratches, median | Effects browser · Inspector · photo canvas | I |
| `PH-060` | Distort, ripple, wave, twirl, spherize, and displacement | Effects browser · Inspector · photo canvas | I |
| `PH-061` | Pixelate, mosaic, crystallize, and halftone | Effects browser · Inspector · photo canvas | I |
| `PH-062` | JPEG, PNG, WebP, AVIF, and GIF import/export | Import/Export workspace · format preview · Job Center | J, P |
| `PH-064` | Export for web with format/quality preview | Import/Export workspace · format preview · Job Center | R, J, P |
| `PH-065` | Batch export and asset generation | Import/Export workspace · format preview · Job Center | J, P |

### Video feature coverage

| ID | Feature | Primary UI surface | Feedback |
|---|---|---|---|
| `VI-001` | Sequence creation with resolution, frame rate, pixel aspect, and audio settings | Video Media panel · bins · source/program monitors | R, S |
| `VI-002` | Multiple sequences per project | Video Media panel · bins · source/program monitors | R, S |
| `VI-003` | Bins/folders and freeform storyboard view | Video Media panel · bins · source/program monitors | R, S |
| `VI-004` | Source and program monitors | Video Media panel · bins · source/program monitors | R, S |
| `VI-005` | In/Out points and subclips | Video Media panel · bins · source/program monitors | R, S |
| `VI-006` | Markers with colors, names, comments, and durations | Video Media panel · bins · source/program monitors | R, S |
| `VI-007` | Timecode display and navigation | Video Media panel · bins · source/program monitors | R, S |
| `VI-009` | Duplicate clip and usage detection | Video Media panel · bins · source/program monitors | R, S, J |
| `VI-010` | Offline media and relinking | Video Media panel · bins · source/program monitors | R, S, B |
| `VI-011` | Multi-track video and audio timeline | Timeline · contextual toolbar · source/program monitors | I |
| `VI-012` | Add, delete, rename, reorder, lock, hide, mute, and solo tracks | Timeline · contextual toolbar · source/program monitors | I, P |
| `VI-013` | Insert and overwrite edits | Timeline · contextual toolbar · source/program monitors | I |
| `VI-014` | Drag-and-drop append and rearrangement | Timeline · contextual toolbar · source/program monitors | I |
| `VI-015` | Split/razor and join-through edits | Timeline · contextual toolbar · source/program monitors | I |
| `VI-016` | Ripple trim | Timeline · contextual toolbar · source/program monitors | I |
| `VI-017` | Roll trim | Timeline · contextual toolbar · source/program monitors | I |
| `VI-019` | Lift, extract, ripple delete, and close gap | Timeline · contextual toolbar · source/program monitors | I, P |
| `VI-020` | Snapping and linked selection | Timeline · contextual toolbar · source/program monitors | I |
| `VI-021` | Link/unlink audio and video | Timeline · contextual toolbar · source/program monitors | I |
| `VI-022` | Group, label, and select related clips | Timeline · contextual toolbar · source/program monitors | I |
| `VI-023` | Subsequences and sequence duplication | Timeline · contextual toolbar · source/program monitors | I |
| `VI-024` | Adjustment layers | Timeline · contextual toolbar · source/program monitors | I |
| `VI-025` | Clip replacement while retaining attributes | Timeline · contextual toolbar · source/program monitors | I |
| `VI-027` | Clip duration and speed controls | Timeline · speed/sync inspector · monitors | I |
| `VI-028` | Reverse playback | Timeline · speed/sync inspector · monitors | I |
| `VI-029` | Frame hold/freeze frame | Timeline · speed/sync inspector · monitors | I |
| `VI-030` | Audio/video synchronization by timestamp or timecode | Timeline · speed/sync inspector · monitors | I, J, B |
| `VI-031` | Motion properties: position, scale, rotation, anchor, opacity | Program monitor overlay · Effect Controls · keyframe lane | I |
| `VI-032` | Keyframes with linear, hold, bezier, ease-in, and ease-out interpolation | Program monitor overlay · Effect Controls · keyframe lane | I |
| `VI-033` | Effect controls and keyframe timeline | Program monitor overlay · Effect Controls · keyframe lane | I |
| `VI-034` | Crop, feather, edge, and opacity masks | Program monitor overlay · Effect Controls · keyframe lane | I |
| `VI-035` | Luma key, track matte, and alpha matte | Program monitor overlay · Effect Controls · keyframe lane | I |
| `VI-036` | Blend modes | Program monitor overlay · Effect Controls · keyframe lane | I |
| `VI-037` | Reframe/reposition for alternate aspect ratios | Program monitor overlay · Effect Controls · keyframe lane | I |
| `VI-038` | Cross dissolve, dip, wipe, slide, push, and zoom transitions | Effects browser · timeline · Effect inspector | I |
| `VI-039` | Audio crossfades | Effects browser · timeline · Effect inspector | I |
| `VI-040` | Transition presets and favorites | Effects browser · timeline · Effect inspector | I |
| `VI-041` | Blur, sharpen, noise, grain, distort, stylize, and pixelate effects | Effects browser · timeline · Effect inspector | I |
| `VI-042` | Shadow, glow, bevel, and edge effects | Effects browser · timeline · Effect inspector | I |
| `VI-043` | Lens distortion, vignette, flare, and chromatic effects | Effects browser · timeline · Effect inspector | I |
| `VI-044` | Preset stack and effect templates | Effects browser · timeline · Effect inspector | I |
| `VI-045` | Basic exposure, contrast, highlights, shadows, whites, and blacks | Video Color workspace · scopes · Color inspector | I |
| `VI-046` | White balance and tint eyedropper | Video Color workspace · scopes · Color inspector | I |
| `VI-047` | Saturation and vibrance | Video Color workspace · scopes · Color inspector | I |
| `VI-048` | LUT import, preview, and export | Video Color workspace · scopes · Color inspector | I, R, J |
| `VI-049` | Color presets/looks | Video Color workspace · scopes · Color inspector | I |
| `VI-050` | Waveform display and sample-aware scrubbing | Audio workspace · mixer · waveform/timeline | I, R |
| `VI-051` | Clip gain, track volume, pan, mute, and solo | Audio workspace · mixer · waveform/timeline | I |
| `VI-052` | Audio keyframes and automation lanes | Audio workspace · mixer · waveform/timeline | I |
| `VI-053` | Loudness meters and normalization | Audio workspace · mixer · waveform/timeline | I, R, J |
| `VI-054` | EQ, compressor, limiter, gate, delay, and reverb | Audio workspace · mixer · waveform/timeline | I |
| `VI-055` | Voice-over recording | Audio workspace · mixer · waveform/timeline | I |
| `VI-056` | Audio channel mapping | Audio workspace · mixer · waveform/timeline | I |
| `VI-058` | Title cards, lower thirds, and editable text overlays | Graphics/Captions workspace · program monitor | I |
| `VI-059` | Shapes, icons, logos, images, and grouped graphics | Graphics/Captions workspace · program monitor | I |
| `VI-060` | Per-property title animation | Graphics/Captions workspace · program monitor | I |
| `VI-061` | Manual caption/subtitle tracks | Graphics/Captions workspace · program monitor | I |
| `VI-062` | Caption styling and reusable styles | Graphics/Captions workspace · program monitor | I |
| `VI-063` | Beat detection and cut-to-music assistance | Agent proposal drawer · timeline · analysis result overlay | J, P |
| `VI-064` | Natural-language effect and parameter editing | Agent proposal drawer · timeline · analysis result overlay | J, P |
| `VI-065` | Timecoded comments | Review player · timecoded comment rail · version view | P, C |
| `VI-066` | Review links with playback and annotations | Review player · timecoded comment rail · version view | P, C |
| `VI-067` | Version stacks and side-by-side version comparison | Review player · timecoded comment rail · version view | R, P, C |
| `VI-068` | Shared projects and project locking | Review player · timecoded comment rail · version view | P, C |
| `VI-069` | Import common MP4/MOV/WebM media | Export workspace · output preview · Job Center | J, P |
| `VI-071` | Audio-only WAV, MP3, AAC, and FLAC export | Export workspace · output preview · Job Center | J, P |
| `VI-072` | Export presets for social, web, archive, and professional delivery | Export workspace · output preview · Job Center | J, P |
| `VI-073` | Render selected range, work area, or individual clips | Export workspace · output preview · Job Center | J, P |
| `VI-074` | Direct publishing to social/video platforms | Export workspace · output preview · Job Center | J, P |
| `VI-075` | Watermarking and review burns | Export workspace · output preview · Job Center | J, P |

## 14. Approved baseline and deferred inputs

The Pre-Phase 1 review established the following implementation baseline. These decisions remain subject to evidence from live browser implementation, but Phase 1 and Phase 2 may now depend on them without reopening the overall visual direction.

### Approved baseline

| Decision | Approved direction |
|---|---|
| Product identity | Estro, using a restrained wordmark-first treatment |
| Accent | Blue for selection/focus relationship; blue-to-violet spectral treatment reserved for active WebMCP/agent state |
| Density | Adaptive professional density: roomy task flows, compact editor surfaces, progressive disclosure for advanced controls |
| Shell geometry | 52px top bar, 48px rail, 280px left panel with 224–360px range, 304px Inspector with 272–400px range |
| Photo arrangement | Layers left, canvas center, Inspector right; 120px filmstrip only for multi-asset or batch context |
| Video arrangement | Media/Bins left, Program Monitor center, Inspector right, 272px resizable timeline below; Source Monitor adapts with width |
| Agent footprint | Compact top-center Activity Island, expandable 360px overlay drawer, and durable Job Center for long-running work |
| Icon direction | Lucide outline style on a 24-unit grid at 1.75px stroke; matching custom editor icons only where necessary |
| Viewports | 1440×900 primary; 1180×700 complete-editor minimum; 1280×720 recommended; drawers below 1180px |
| Interaction foundation | Immediate frequent actions, interruptible transient motion, truthful wait ladder, visible focus, 40px desktop/44px touch targets where density permits |

### Deferred until evidence exists

- Final standalone logo or product mark.
- Coverage audit and final drawings for editor-specific icons absent from Lucide.
- Whether video exposes dual Source/Program monitors by default on wide layouts or only when explicitly enabled.
- Final supported browser matrix, which determines gamut, material, codec, and motion fallbacks.
- Any dimension adjustment required by live representative content, 200% zoom, localization, or measured performance.

### Can be decided during detailed flows

- Landing-page narrative and example media.
- First-run onboarding depth and whether a sample project is offered.
- Exact wording and personality of empty states, errors, confirmations, and teaching cards.
- Whether optional sound/haptic feedback exists; the default should remain silent.
- Collaboration identity treatment: names, initials, avatars, or anonymous reviewers.
- Mobile editing boundary beyond project browsing, review, jobs, and basic adjustments.
- Whether exported review media carries product branding by default or only when explicitly selected.

## 15. Integrity statement

- Retained features represented: **213**
- Shared features: **83**
- Photo features: **60**
- Video features: **70**
- Features omitted or duplicated in the coverage index: **0**

This blueprint defines the approved design baseline. Implementation must still verify component values in-browser against representative media, real content length, supported viewports, keyboard navigation, screen-reader behavior, reduced-motion settings, contrast/APCA, gamut, and measured performance. Evidence-driven corrections may refine values without silently changing the product principles or the retained feature scope.
