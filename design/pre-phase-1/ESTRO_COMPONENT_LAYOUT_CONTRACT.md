# Estro Core System and Component/Layout Contract

**Status:** Pre-Phase 1 approved supporting contract
**Scope:** Shared visual and interaction primitives that Phase 1 and Phase 2 may implement
**Authority:** `PRODUCT_DESIGN_BLUEPRINT.md` is canonical if the two documents ever disagree

This contract converts the approved Estro visual direction into a bounded implementation foundation. It does not define every downstream feature surface and does not change the retained 213-feature scope or sequence.

## 1. Evidence used

- Video editor concept at 1440×900.
- Photo editor adaptation at 1440×900.
- Eight-state WebMCP feedback board.
- Landing, Project Hub, Create/Import, Export/Job Center, and Review wireframes.
- The Phase 1 state/command requirements and Phase 2 shell/interaction requirements.

The representative rendered color pairs used in the artifacts were checked with the WCAG contrast formula:

| Pair | Contrast |
|---|---:|
| Primary text on app background | 17.27:1 |
| Secondary text on app background | 9.10:1 |
| Tertiary text on app background | 4.55:1 |
| Dark label on primary action | 6.80:1 |
| Focus indicator on panel surface | 10.73:1 |
| Danger status on panel surface | 6.46:1 |
| Warning status on panel surface | 9.14:1 |
| Success status on panel surface | 8.23:1 |

These checks confirm the rendered direction, not every future token pairing. Implemented OKLCH tokens still require sRGB-gamut and APCA checks in the supported browser matrix.

## 2. Core visual tokens

Components consume semantic roles, never raw colors.

### Surfaces and text

| Token | Value | Contract |
|---|---|---|
| `--canvas-backdrop` | `oklch(0.095 0.008 260)` | Deepest media surround |
| `--app-bg` | `oklch(0.120 0.009 260)` | Route and application background |
| `--surface-1` | `oklch(0.155 0.010 260)` | Fixed panels and chrome |
| `--surface-2` | `oklch(0.190 0.012 260)` | Controls, menus, selected rows |
| `--surface-3` | `oklch(0.235 0.014 260)` | Neutral hover and emphasis |
| `--border-subtle` | `oklch(0.275 0.012 260)` | Structural separation only |
| `--border-strong` | `oklch(0.400 0.014 260)` | Inputs and active-region boundaries |
| `--text-primary` | `oklch(0.950 0.006 260)` | Primary labels and icons |
| `--text-secondary` | `oklch(0.755 0.010 260)` | Explanations and supporting values |
| `--text-tertiary` | `oklch(0.620 0.010 260)` | Non-essential metadata only |

### Meaning-bearing color

| Token | Value | Contract |
|---|---|---|
| `--accent` | `oklch(0.720 0.145 252)` | Selection, focus relationship, and one local primary action |
| `--accent-hover` | `oklch(0.780 0.135 252)` | Pointer hover or emphasized accent state |
| `--agent-a` | `oklch(0.730 0.150 250)` | Agent activity edge start |
| `--agent-b` | `oklch(0.760 0.145 315)` | Agent activity edge end; never a general-purpose accent |
| `--success` | `oklch(0.760 0.140 150)` | Completed or safely preserved result |
| `--warning` | `oklch(0.820 0.140 82)` | Attention or confirmation consequence |
| `--danger` | `oklch(0.680 0.190 27)` | Failure or destructive consequence |
| `--focus` | `oklch(0.820 0.120 235)` | Keyboard focus perimeter |

Color never communicates state alone. Status components always pair it with an icon and plain text. The blue-to-violet agent pair is reserved for targeting, inspecting, validating, proposing, queued, and running states.

### Type

- Interface stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Technical stack: `ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace`.
- Weights: 400 for normal text, 500 for interface emphasis, 600 for headings and primary actions.
- Changing values use tabular numerals.
- Text remains selectable except on a specific direct-manipulation surface where selection conflicts with the gesture.

| Role | Size / line-height | Use |
|---|---|---|
| Display | 40px / 1.08 | Landing statement only |
| Page title | 28px / 1.15 | Project Hub and major empty states |
| Workspace title | 20px / 1.25 | Export, Review, modal titles |
| Section heading | 16px / 1.3 | Inspector and sheet groups |
| Body | 14px / 1.5 | Explanations, summaries, and errors |
| Control | 13px / 1.3 | Buttons, menus, fields, timeline labels |
| Caption | 12px / 1.35 | Metadata and secondary status |
| Micro | 11px / 1.3 | Time ticks and non-essential compact labels only |

Headings may use balanced wrapping; short descriptions may use pretty wrapping. Explanatory copy is capped near 60–75 characters. Mobile-sized inputs render at no less than 16px.

### Spacing, shape, and iconography

- Base unit: 4px. Shared scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Inter-group space is at least twice the intra-group space.
- Dense editor controls use 8–12px internal spacing; task routes use 24–32px conceptual spacing.
- Compact controls use a 6px radius, popovers 8px, route-level panels 10px, and blocking sheets 12px.
- Borders explain structure or state. Shadows are used only where surfaces overlap.
- Lucide is the provisional icon family on a 24-unit grid at a consistent 1.75px stroke. Default sizes are 16px inside controls and 18px in the tool rail.
- Editor-specific icons must match the same grid, stroke, joins, caps, and optical weight. No emoji or mixed icon libraries.

## 3. Persistent shell contract

The shell owns layout and interaction context. Feature panels provide content; they do not rebuild shell geometry.

| Region | Initial size | Resize/collapse behavior | Persistent responsibility |
|---|---:|---|---|
| Top bar | 52px high | Fixed height; content progressively condenses | Project identity, save state, history actions, agent state, Review, Export |
| Tool rail | 48px wide | Fixed on complete editor; becomes compact mode control on narrow supported flows | Stable tool/mode selection and shortcuts |
| Left working panel | 280px wide | User range 224–360px; drawer at compact widths | Media, Layers, Bins, Effects, Text/Graphics, History, Comments |
| Center stage | Remaining space | Protected first; panels collapse before it becomes unusable | Canvas, monitors, overlays, comparisons, proposal previews |
| Inspector | 304px wide | User range 272–400px; drawer at compact widths | Selection-sensitive properties and validation |
| Photo filmstrip | 120px high when needed | Hidden for one photo; collapsible | Multi-asset and batch context |
| Video timeline | 272px initial height | Vertically resizable; reduces/collapses below 700px viewport height | Tracks, waveforms, keyframes, automation |
| Activity drawer | 360px overlay | Never permanently shrinks the canvas | Agent target, proposal, progress, result, warning, Undo |
| Job Center | Durable drawer | Survives route changes | Queue, stages, processed units, cancel, retry, output |

Panel dimensions are implementation starting values, not serialized project data. User-resized dimensions may be local preferences.

### Responsive modes

| Content-fit mode | Width | Contract |
|---|---:|---|
| Wide | 1440px+ | Left panel, center, Inspector, and bottom workspace coexist; dual video monitors only when the remaining stage still fits |
| Standard | 1180–1439px | Full editor remains; Source Monitor becomes a tab and panel content condenses |
| Compact | 900–1179px | Left working panel and Inspector become mutually exclusive drawers; center stage and timeline remain primary |
| Narrow | Below 900px | Project browsing, review, comments, jobs, and deliberately supported basic edits; advanced dense editor work communicates that a larger workspace is required |

The complete editor starts at 1180×700 and recommends 1280×720 or larger. Supported flows must survive 200% zoom and 320px reflow without hiding a critical action. Breakpoints are content-fit constraints, not device labels.

## 4. Reusable component contract

Phase 1 and Phase 2 build the smallest components needed by their real surfaces. Later phases extend these variants rather than forking unrelated photo and video controls.

| Component family | Required states and behavior |
|---|---|
| `Button` | Primary, secondary, ghost, destructive; default, hover, active, focus-visible, pending, disabled. One filled primary action per local task. Pointer press may scale to 0.96 for 100–140ms; keyboard activation remains immediate. |
| `IconButton` | 40×40px target where density permits; accessible name and shortcut tooltip; active state uses shape, text/tooltip, and color rather than color alone. |
| `Field` / `NumericField` | Visible label, value, unit, helper/error slot, reset, validation, keyboard increments where applicable; changing values use tabular numerals. |
| `SliderField` | Track plus editable numeric field, direct pointer capture, keyboard increments, reset, min/max/default/units exposed semantically. |
| `Tabs` | Stable content categories, preserved selection and scroll, roving keyboard focus, no route navigation disguised as tabs. |
| `SegmentedControl` | Two to four mutually exclusive modes; arrow-key navigation; not used for unrelated destinations. |
| `DisclosureGroup` | Visible label and chevron, state preserved per context; advanced controls are one level deeper and never hidden without a cue. |
| `Panel` / `PanelHeader` | Stable heading, optional tabs, resize affordance, actions in consistent trailing position, logical sizing properties. |
| `StatusLine` | Icon, plain text, semantic tone, optional action; stable polite live region for routine dynamic updates. |
| `ActivityIsland` | Idle, targeting, inspecting, validating, proposing, awaiting confirmation, queued, running, preview-ready, committing, complete, failed, cancelled. Expansion reveals target and next action. |
| `JobItem` | Task and target, real stage or processed units, cancel when supported, retry/fallback, output identity, preserved-work statement on failure/cancellation. |
| `FocusHalo` | At least a 2px equivalent visible perimeter; distinguishes keyboard focus, user selection, and agent targeting with different accompanying labels. |
| `ProposalSurface` | Named target and source revision, scope/diff, reversible preview, Apply/Reject, validation warnings, transaction result and Undo. |
| `ConfirmationSheet` | Consequence, destination/actor, affected items, Confirm/Cancel; background inert, focus trapped and restored. |
| `Popover` / `Tooltip` | Anchored to the trigger and origin-aware. First tooltip may be delayed; movement between adjacent tools is immediate. Essential instructions never live only in a tooltip. |
| `Toast` | Brief non-blocking completion only. Errors or actionable messages persist. Long jobs never depend on a toast for discoverability. |
| `EmptyState` / `Skeleton` / `InlineError` | Skeleton matches final structure; empty state names how to continue; error names cause, preserved work, and recovery action. |

All state-changing UI and WebMCP operations surface the same target IDs, validation result, revision/transaction identity, human-readable summary, and Undo availability.

## 5. Progressive disclosure rules

1. Keep the common action and current value visible.
2. Place advanced controls one explicit disclosure deeper within the same task context.
3. Preserve the user’s disclosure state while the selection remains compatible.
4. Do not hide validation, an active override, a destructive consequence, or an agent-applied change inside a collapsed group.
5. Inspector groups follow visible effect on the result, not internal engine names.
6. Search and WebMCP focus may reveal and focus a hidden control, but they must also show its containing panel and group.

## 6. Motion and loading contract

| Interaction | Contract |
|---|---|
| Keyboard commands, scrubbing, repeated timeline edits | Immediate; no entrance or exit animation |
| Pointer press | 100–140ms transform/color response |
| Tooltip/popover | 125–180ms, origin-aware and interruptible |
| Dropdown/segmented indicator | 150–220ms, interruptible |
| Panel/drawer | 180–260ms along the same spatial path |
| Modal/sheet | 220–280ms; centered modal or source-anchored sheet |
| Drag/trim/transform/slider/mask/brush | 1:1 tracking with pointer capture; no delayed interpolation |

Only transform and opacity animate by default. No `transition: all`, scale-from-zero entrances, slow `ease-in`, or decorative motion on high-frequency actions. Reduced motion uses short opacity changes, removes spectral travel and large repositioning, and retains every static status cue.

Loading follows the existing wait ladder: immediate response below 150ms; local status from 150ms–1s; Activity Island from 1–10s; Job Center for work over 10s or work that survives navigation. Percentages appear only when derived from real progress.

## 7. Accessibility and input contract

- Native controls and landmarks first; ARIA only where native semantics are insufficient.
- Every pointer action has a keyboard path. Escape closes overlays; composite widgets use documented arrow-key and roving-tabindex behavior.
- `:focus-visible` has at least a 2px equivalent perimeter, remains visible in forced-colors mode, and is distinct from selection and agent targeting.
- Desktop targets aim for 40×40px and touch targets for 44×44px; the 24×24px WCAG minimum or a valid spacing exception is never crossed.
- Modal backgrounds become inert; focus moves inside and returns to the trigger.
- Icon-only controls have accessible names. Dynamic routine updates use a stable polite live region; urgent untethered failures may use an alert.
- The product supports reduced motion, reduced transparency, increased contrast, 200% zoom, text growth, and logical direction-aware layout.
- Media autoplay requires a visible pause action. Tutorials and media previews retain captions.

## 8. Decisions this review is intended to confirm

- The semantic dark palette and blue accent, with blue-to-violet reserved for agent activity.
- The system UI and monospace type stacks and the seven-role type scale.
- Adaptive professional density rather than one global compactness setting.
- The initial shell dimensions and collapse order.
- A 272px starting video timeline and conditional 120px photo filmstrip.
- Lucide outline icons at 1.75px pending an implementation-time package decision and icon coverage audit.
- The Activity Island, 360px overlay drawer, and durable Job Center hierarchy.
- The component families and state contracts above as the Phase 1/2 implementation boundary.

## 9. Deliberately unresolved

- Final standalone logo.
- Exact custom drawings for editor-specific icons absent from Lucide.
- Default dual Source/Program Monitor behavior on wide layouts.
- Final browser support matrix and therefore final gamut, material, codec, and motion fallbacks.
- Detailed controls and edge cases belonging to later feature phases.

No production framework, UI package, icon dependency, or runtime implementation is selected by this design contract.
