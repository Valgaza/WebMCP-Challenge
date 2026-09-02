# Estro Phase 2 Interaction Contract

**Phase:** 2 — Editor shell and interaction foundation  
**Sequence:** 17–29  
**Status:** Implementation contract  
**Authority:** `PRODUCT_DESIGN_BLUEPRINT.md` remains canonical

## Demonstration frame

The Phase 2 demonstration starts with an existing local photo or unassigned project that has no document. The user creates a 1920×1080 landscape document at 72 pixels per inch with a transparent, white, black, or custom solid background. The editor then exposes one stable document ID, a bounded canvas, view-only navigation, semantic workspace targets, and the same state through WebMCP.

Creating the document is a project mutation and therefore creates a revision, transaction, summary, autosave state, and Undo token. Zooming, panning, rotating the view, changing panels, toggling overlays, entering distraction-free mode, selecting the document, and focusing controls are workspace changes. They persist locally but do not change the project revision.

## Screen and panel inventory

- The 52px top bar preserves project identity, save state, Undo/Redo, the Activity Island entry point, distraction-free preview, and future Export placement.
- The 48px tool rail exposes Select, Hand, and Zoom modes as semantic buttons with names and shortcuts.
- The left working panel opens on Layers for a photo document and shows a single immutable document/canvas row until Phase 4 introduces pixel layers.
- The center stage owns the pasteboard, rulers, guides, grid, safe areas, document canvas, selection outline, agent focus halo, and viewport controls.
- The 304px Inspector shows document properties when the document is selected and view properties when the canvas is selected.
- The contextual action bar sits inside the center stage above the canvas and shows only actions valid for the current selection/tool.
- The command palette is an anchored modal search surface over the editor. It exposes command name, shortcut, availability, and result count.
- At compact widths the left panel and Inspector become mutually exclusive drawers. Below the supported editor width, the canvas remains operable with one drawer at a time and a larger-workspace advisory.

## Interaction model

- Pointer drag with the Hand tool, Space-drag, middle-button drag, and touch/pen drag pan the view with pointer capture.
- Wheel scroll pans; Ctrl/Meta + wheel zooms around the pointer. Keyboard `+`, `-`, `0`, and `1` zoom in, zoom out, fit, and show 100% respectively.
- `R` rotates the view by 90 degrees; Shift+`R` resets rotation. View rotation never changes document pixels or dimensions.
- `G` toggles the grid, `;` toggles guides, Shift+`;` toggles snapping, and `F` enters or exits distraction-free preview. Escape exits preview, closes drawers/palette, or clears transient focus in that order.
- Command search opens with Ctrl/Meta+`K`, uses a native search input, arrow keys move the active result, Enter runs it, and Escape closes and restores trigger focus.
- Panel resize handles are separators with numeric values, min/max bounds, keyboard arrow increments, Home/End bounds, and pointer capture. Double-click resets the approved baseline width.
- Canvas/document selection is separate from DOM focus. Agent targeting adds a labeled halo and focuses the requested semantic control without mutating project state.

## Empty, loading, error, and fallback states

- A project without a document shows one primary `Create image document` action and the essential document fields; no fake canvas content is shown.
- Loading preserves the final shell geometry with quiet structured placeholders.
- Invalid dimensions, resolution, or background values remain in the create form, announce exact inline errors, and focus the first invalid field.
- A persisted workspace record with an unsupported schema is ignored in favor of safe defaults; the project document remains untouched.
- If the Fullscreen API is unavailable or denied, distraction-free mode still hides editing chrome inside the page and reports the browser limitation.
- If Pointer Events do not expose pressure, tilt, or pen type, navigation remains available through mouse/touch basics and the complete keyboard path.
- If WebMCP is unavailable, every Phase 2 capability remains available through the visible interface and capability discovery reports the limitation.

## Focus, semantics, and status

The DOM reading order is top bar, tool rail, left panel, center stage, Inspector, transient overlays. A skip link targets the center workspace. Native buttons, inputs, output, dialog, search, and landmark elements are preferred. Custom canvas and resize widgets expose their role, name, value, instructions, and keyboard alternative. All icon-only actions have accessible names. Keyboard focus uses the approved 2px focus perimeter, remains distinct from selection and agent targeting, and is preserved in forced colors.

One stable polite live region announces viewport values, panel changes, WebMCP focus, command completion, and fallback states. Creative mutation summaries continue through the Phase 1 activity and history systems.

## Pass/fail evidence

Phase 2 passes only if UI and WebMCP document creation produce equivalent revision state; Undo and Redo remove and restore the same document; workspace changes survive reload without incrementing the revision; all Phase 2 commands validate bounds and stable IDs; the pointer and keyboard navigation paths produce the same viewport values; focus lands on and visibly identifies requested semantic targets; panel bounds and compact fallbacks hold; and the production typecheck, tests, and build succeed in the project container.
