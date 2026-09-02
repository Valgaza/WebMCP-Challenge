# Estro End-to-End Feature Implementation Plan

This document describes the path Estro will follow from design foundation through the final retained capability. It combines a bounded Pre-Phase 1 design stage, the canonical 213-feature dependency sequence, the delivery rhythm used inside every implementation phase, and the conditions for considering the complete product plan fulfilled.

The numbered feature order remains an architectural dependency order—not a deadline cut, release priority, staffing plan, or estimate. Every retained feature appears exactly once. Pre-Phase 1 contains no feature implementation and does not change the approved feature count or order.

All phase work is governed by [`AGENTS.md`](./AGENTS.md), which defines the required preparation, approval boundaries, WebMCP rules, user-action protocol, verification, and phase-completion standard.

The product’s visual identity, interface architecture, interaction patterns, loading feedback, and feature-to-interface coverage are defined in [`PRODUCT_DESIGN_BLUEPRINT.md`](./PRODUCT_DESIGN_BLUEPRINT.md).

The detailed compute, storage, UI, runtime, application-component, fallback, and WebMCP requirements remain authoritative in [`FEATURE_DEPENDENCY_LEDGER.md`](./FEATURE_DEPENDENCY_LEDGER.md). This plan answers a different question: **in what order should those capabilities become real so that later work builds on proven earlier systems?**

## Ordering rules

1. **Design language before implementation detail.** Establish Estro’s visual identity, editor composition, interaction rules, WebMCP feedback language, and core component conventions before Phase 1, while leaving downstream feature details to the phase in which they become real.
2. **State before behavior.** Project identity, schemas, non-destructive commands, persistence, history, validation, permissions, and transaction identity precede editing surfaces.
3. **A complete vertical slice before broad abstraction.** A small end-to-end photo workflow proves canvas, compositing, preview, color, export, and WebMCP interaction before video adds time, decode, audio, and rendering complexity.
4. **Shared engines before domain depth.** Masks, effects, keyframes, typography, vectors, presets, and batch operations are generalized only after both initial photo and video paths reveal their real requirements.
5. **Local deterministic work before distributed work.** Editing correctness precedes sync, collaboration, review, external publishing, and other networked side effects.
6. **WebMCP is architectural, not an add-on.** Its schemas, inspection, validation, permissions, atomic commands, transactions, summaries, and dry runs are established in Phase 1; later phases register new operations against that contract.
7. **Necessity and browser difficulty break ties; they do not override prerequisites.** A difficult foundational feature stays early when everything depends on it, while an easy feature stays late when it only makes sense over a mature subsystem.
8. **Cross-cutting requirements begin before their completion row.** Accessibility, permissions, observability, design-system consistency, and error semantics constrain every phase. Their later product-wide entries mark when complete acceptance can be claimed, not when work first begins.
9. **Detailed design stays close to implementation.** Pre-Phase 1 establishes the shared visual system and representative surfaces. Each later phase resolves its own complete interaction states immediately before building them, using what the working product has taught us.

## Dependency backbone

```mermaid
flowchart LR
    P0[Pre-1. Design foundation] --> P1
    P1[1. State, commands, WebMCP] --> P2[2. Shell and interaction]
    P2 --> P3[3. Assets, codecs, jobs]
    P3 --> P4[4. Complete photo slice]
    P4 --> P5[5. Complete video slice]
    P4 --> P6[6. Shared editing systems]
    P5 --> P6
    P6 --> P7[7. Deep photo structure]
    P7 --> P8[8. Photo depth and scale]
    P6 --> P9[9. Video motion and graphics]
    P5 --> P9
    P9 --> P10[10. Audio and intelligence]
    P8 --> P11[11. Project robustness]
    P10 --> P11
    P11 --> P12[12. Collaboration and delivery]
```

The numbered list below is the canonical single-stream order. The graph shows dependency convergence; it does not alter the sequence numbers.

## Phase summary

| Phase | Sequence | Features | Architectural result |
|---:|---:|---:|---|
| Pre-1 | — | 0 | Approved visual, interaction, and responsive foundation for implementation |
| 1 | 1–16 | 16 | Core project, command, and WebMCP contract |
| 2 | 17–29 | 13 | Editor shell and interaction foundation |
| 3 | 30–42 | 13 | Assets, codecs, preview, and asynchronous jobs |
| 4 | 43–61 | 19 | First complete photo editing workflow |
| 5 | 62–91 | 30 | First complete video editing workflow |
| 6 | 92–112 | 21 | Reusable shared editing systems |
| 7 | 113–140 | 28 | Deep photo structure, selection, painting, and retouching |
| 8 | 141–161 | 21 | Photo color, effects, photographic workflow, and scale |
| 9 | 162–185 | 24 | Video motion, compositing, effects, color, and graphics |
| 10 | 186–194 | 9 | Advanced audio, synchronization, and intelligent assistance |
| 11 | 195–200 | 6 | Asset and project robustness |
| 12 | 201–213 | 13 | Collaboration, external delivery, and final accessibility acceptance |

## Pre-Phase 1 — Design foundation

Pre-Phase 1 establishes enough visual and interaction certainty to begin implementation without attempting to predict every downstream screen. It is a design and planning gate, not an additional feature phase.

### Demonstrable goal

A reviewer can see how Estro will look, understand its primary photo and video workspace structure, and follow how a visible WebMCP operation moves from inspection through completion or failure.

### Required deliverables

1. **Primary video-editor visual at 1440×900.** Show realistic media, Media/Bins, Program Monitor, Inspector, timeline, project state, the Activity Island, and at least one visible agent operation.
2. **Photo-editor adaptation.** Reuse the same shell and design language while showing Layers, photo canvas, Inspector, and the conditional multi-asset filmstrip.
3. **Critical WebMCP feedback states.** Represent inspecting, proposing, awaiting confirmation, running, completed, failed, cancelled, and undoable results at the correct local, Activity Island, drawer, or Job Center level.
4. **Supporting-flow wireframes.** Cover Landing, Project Hub, Create/Import, Export, Review, and their relationship to the persistent editor context. These need structural certainty, not final decoration.
5. **Core system confirmation.** Review color, type, icon style, density, panel proportions, timeline height, responsive transitions, focus treatment, motion, loading feedback, and progressive disclosure against representative content.
6. **Component and layout contract.** Identify the reusable shell regions and core controls Phase 1 and Phase 2 can build without prematurely specifying every later feature surface.
7. **Canonical-document update.** Record approved decisions in `PRODUCT_DESIGN_BLUEPRINT.md` and reflect any sequencing consequences here without changing feature scope or order silently.

### Explicitly outside Pre-Phase 1

- Pixel-perfect designs for every retained capability.
- Every menu, modal, inspector permutation, empty state, and failure edge case.
- Final responsive treatment of every phase at every viewport.
- Production implementation of the shell or component library.
- A permanent standalone logo if the first visual has not provided enough evidence to design it well.

### Exit condition

The primary editor direction and photo adaptation are approved; the shared design tokens and layout rules are specific enough for implementation; the major routes and WebMCP feedback model are understandable; and unresolved choices are recorded for the phase in which they matter.

### Completion record

**Status:** Complete · design and planning gate only · zero retained features implemented

The approved evidence is stored in [`design/pre-phase-1`](./design/pre-phase-1/):

- primary [`Video Editor`](./design/pre-phase-1/estro-video-editor-concept.png) and matching [`Photo Editor`](./design/pre-phase-1/estro-photo-editor-concept.png) visuals;
- the eight-state [`WebMCP feedback system`](./design/pre-phase-1/estro-webmcp-feedback-states.png);
- the [`supporting product flows`](./design/pre-phase-1/estro-supporting-flow-wireframes.png);
- the [`core-system board`](./design/pre-phase-1/estro-core-system-contract.png) and detailed [`component/layout contract`](./design/pre-phase-1/ESTRO_COMPONENT_LAYOUT_CONTRACT.md);
- the final [`Pre-Phase 1 exit audit`](./design/pre-phase-1/PRE_PHASE_1_EXIT_AUDIT.md).

Approved decisions have been promoted into `PRODUCT_DESIGN_BLUEPRINT.md`. No sequencing consequence was found: the canonical 213-feature count and order remain unchanged. Deferred choices are recorded in the blueprint and audit for resolution only when implementation evidence exists.

## Delivery loop for Phases 1–12

Every implementation phase follows the same product loop. A phase does not begin as a raw feature checklist and does not end when isolated components compile.

1. **Reorient.** Read the current instructions, plan, relevant ledger entries, blueprint coverage, code, configuration, tests, and prerequisite behavior.
2. **Write the phase brief.** State the demonstrable goal, entry evidence, end-to-end slices, WebMCP coverage, UI scope, user actions, non-goals, open decisions, and acceptance evidence.
3. **Resolve that phase’s detailed design.** Design the actual screens, states, controls, waits, errors, compact behavior, keyboard path, and agent feedback required by the phase. Extend existing patterns before introducing new ones.
4. **Build vertical slices.** Connect UI, domain commands, non-destructive state, persistence, preview or compute, WebMCP registration, history, permissions, and feedback in the smallest complete increments.
5. **Verify parity and resilience.** Confirm equivalent UI and WebMCP outcomes, then test undo, persistence, failure, cancellation, fallbacks, accessibility, and performance where relevant.
6. **Run the phase demonstration.** Start from a known state and prove the documented user and agent outcome with observable state and output.
7. **Review and hand off.** Record what changed, what was verified, what remains unresolved, and what the next phase may safely depend on. Do not commit, push, deploy, run Docker, or perform other approval-gated actions without the user’s explicit instruction.

### UI and interaction track across the phases

| Stage | Design focus carried into implementation |
|---:|---|
| Pre-1 | Estro identity, reference editor visuals, route wireframes, design tokens, responsive shell rules, and WebMCP feedback language |
| 1 | Project creation, save/recovery state, permission and validation surfaces, change summaries, proposals, confirmations, and undo visibility |
| 2 | Working editor shell, canvas navigation, panels, Inspector, action bar, command search, input methods, focus, and semantic controls |
| 3 | Import, Asset Library, metadata, search, missing-media recovery, preview quality, Activity Island, and durable Job Center states |
| 4 | Complete photo workflow: Layers, canvas tools, adjustments, comparison, guided teaching, and web export |
| 5 | Complete video workflow: Media/Bins, monitors, timeline editing, waveform and audio controls, range selection, and export presets |
| 6 | Shared History, presets, masks, effects, keyframes, text, vector, font recovery, and batch-operation interfaces |
| 7 | Photo selections, masking, layer structures, transforms, painting, gradients, fills, and retouching workspaces |
| 8 | Detailed photo color, histogram/curve controls, effects, profiles, synchronization, and batch-export feedback |
| 9 | Video motion, compositing, transitions, effects, color, graphics, titles, captions, and keyframe editing |
| 10 | Audio mixing and recording, synchronization analysis, beat assistance, and natural-language proposal/result surfaces |
| 11 | Asset organization, relinking, version recovery, sync conflicts, offline state, and portable-project transfer |
| 12 | Review, roles, comments, annotations, version comparison, locks, publishing, and product-wide accessibility acceptance |

## Ordered implementation sequence

### Phase 1 — Core project, command, and WebMCP contract (1–16)

**Status:** Complete · user-verified 2026-09-02

- **Depends on:** None; this is the root of the implementation graph.
- **Establishes:** Application/project schemas, the non-destructive command graph, persistence and recovery, history identity, WebMCP schema/versioning, validation, permissions, deterministic mutations, transaction IDs, summaries, multi-edit transactions, and dry runs.
- **Exit condition:** A project can be created, mutated through a deterministic WebMCP command, validated, saved, recovered, explained, and undone without media-specific code.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 1 | `SH-001` | Create, open, rename, duplicate, and delete projects | Shared | Foundational | Low |
| 2 | `SH-010` | Non-destructive operation graph | Shared | Foundational | High |
| 3 | `SH-011` | Undo and redo | Shared | Foundational | Moderate |
| 4 | `SH-003` | Explicit save, Save As, and project snapshots | Shared | Foundational | Moderate |
| 5 | `SH-002` | Autosave and crash recovery | Shared | Foundational | Moderate |
| 6 | `SH-004` | Recent projects and recoverable drafts | Shared | Core | Low |
| 7 | `SH-018` | Edit provenance | Shared | Advanced | Moderate |
| 8 | `SH-076` | Capability discovery and schema versioning | Shared | Foundational | Moderate |
| 9 | `SH-064` | Structured project-state inspection tool | Shared | Foundational | Moderate |
| 10 | `SH-077` | Structured validation and actionable errors | Shared | Foundational | Moderate |
| 11 | `SH-079` | Permission gates for upload, external sharing, and destructive edits | Shared | Foundational | Moderate |
| 12 | `SH-066` | Deterministic atomic edit tools | Shared | Foundational | High |
| 13 | `SH-071` | Tool-level undo tokens or transaction IDs | Shared | Foundational | Moderate |
| 14 | `SH-070` | Human-readable change summary | Shared | Foundational | Moderate |
| 15 | `SH-068` | Transactional multi-edit operations | Shared | Core | High |
| 16 | `SH-069` | Dry-run or proposal mode | Shared | Advanced | High |

### Phase 2 — Editor shell and interaction foundation (17–29)

**Status:** Complete · user-verified 2026-09-02

- **Depends on:** Phase 1 project state, command handling, inspection, validation, and transaction identity.
- **Establishes:** The first renderable document, canvas coordinate system, inspector and shell composition, semantic control contract, focus model, input abstraction, guides, preview navigation, and agent-to-UI focus bridge.
- **Exit condition:** An empty image document is operable and inspectable through pointer, keyboard, and WebMCP interactions, with stable focus and semantic controls.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 17 | `PH-001` | Create documents with dimensions, resolution, orientation, and background | Photo | Foundational | Low |
| 18 | `SH-030` | Zoom, pan, rotate view, and fit-to-view | Shared | Foundational | Moderate |
| 19 | `SH-021` | Context-sensitive property inspector | Shared | Foundational | Moderate |
| 20 | `SH-085` | Semantic controls and screen-reader labels | Shared | Foundational | Moderate |
| 21 | `SH-086` | Visible focus and predictable tab order | Shared | Foundational | Moderate |
| 22 | `SH-019` | Resizable and dockable panels | Shared | Core | Moderate |
| 23 | `SH-022` | Contextual task/action bar | Shared | Core | Low |
| 24 | `SH-025` | Keyboard shortcuts | Shared | Core | Moderate |
| 25 | `SH-026` | Mouse, trackpad, touch, and pen input | Shared | Core | High |
| 26 | `SH-029` | Rulers, guides, grids, snapping, and safe areas | Shared | Core | Moderate |
| 27 | `SH-028` | Fullscreen and distraction-free preview | Shared | Core | Low |
| 28 | `SH-073` | Selection and focus tool | Shared | Core | Moderate |
| 29 | `SH-023` | Searchable commands and features | Shared | Core | Moderate |

### Phase 3 — Assets, codecs, preview, and asynchronous jobs (30–42)

- **Depends on:** Phase 1 job/tool contracts and Phase 2 shell, canvas, focus, and document model.
- **Establishes:** Job lifecycle, local ingestion, image codecs, asset identity, thumbnails, metadata, inventory tools, folder ingestion, search, proxies, cache-aware preview quality, agent preview renders, and source relinking.
- **Exit condition:** Images can be imported, indexed, searched, previewed at controlled quality, inspected by an agent, relinked, and exported through observable jobs.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 30 | `SH-078` | Long-running job progress and cancellation | Shared | Core | High |
| 31 | `SH-033` | Local file import via picker and drag-and-drop | Shared | Foundational | Moderate |
| 32 | `PH-062` | JPEG, PNG, WebP, AVIF, and GIF import/export | Photo | Foundational | High |
| 33 | `SH-035` | Asset library with thumbnails | Shared | Foundational | Moderate |
| 34 | `SH-036` | Asset metadata inspection | Shared | Core | Moderate |
| 35 | `SH-065` | Asset inventory and metadata tool | Shared | Foundational | Moderate |
| 36 | `SH-034` | Folder import | Shared | Core | Moderate |
| 37 | `SH-038` | Search and filters | Shared | Core | Moderate |
| 38 | `SH-043` | Proxy/optimized media generation | Shared | Advanced | High |
| 39 | `SH-032` | Multiple preview quality levels | Shared | Core | High |
| 40 | `SH-072` | Preview-render tool | Shared | Foundational | High |
| 41 | `SH-040` | Missing-media detection and relinking | Shared | Core | High |
| 42 | `SH-041` | Replace source while preserving edits | Shared | Core | High |

### Phase 4 — First complete photo editing workflow (43–61)

- **Depends on:** Phases 1–3: project/command graph, canvas, imported assets, image decode/export, previews, jobs, and WebMCP inspection.
- **Establishes:** Raster layers and compositing, core geometry and visibility, resize/crop behavior, basic photographic adjustments and diagnostics, before/after comparison, web export, agent explanation, and guided teaching.
- **Exit condition:** A user or agent can import a photo, perform common non-destructive edits, compare the result, explain or teach the edit, and export a usable image.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 43 | `PH-007` | Pixel layers | Photo | Foundational | High |
| 44 | `SH-044` | Position, scale, rotation, and anchor/origin controls | Shared | Foundational | Moderate |
| 45 | `SH-045` | Crop, fit, fill, and aspect-ratio behavior | Shared | Foundational | Moderate |
| 46 | `SH-046` | Opacity | Shared | Foundational | Low |
| 47 | `SH-048` | Alignment and distribution | Shared | Core | Moderate |
| 48 | `SH-049` | Grouping and nesting | Shared | Core | Moderate |
| 49 | `SH-050` | Lock, hide, solo, mute, and isolate | Shared | Core | Low |
| 50 | `PH-004` | Crop, straighten, rotate, and flip | Photo | Foundational | Moderate |
| 51 | `PH-003` | Resize canvas independently of image | Photo | Core | Moderate |
| 52 | `PH-002` | Resize image with resampling controls | Photo | Core | High |
| 53 | `SH-031` | Pixel grid and actual-size view | Shared | Advanced | Moderate |
| 54 | `PH-030` | Brightness and contrast | Photo | Foundational | Moderate |
| 55 | `PH-034` | White balance and tint | Photo | Core | High |
| 56 | `PH-035` | Hue, saturation, and lightness | Photo | Core | High |
| 57 | `PH-045` | Histogram and clipping warnings | Photo | Core | High |
| 58 | `SH-015` | Before/after comparison | Shared | Core | Moderate |
| 59 | `PH-064` | Export for web with format/quality preview | Photo | Core | High |
| 60 | `SH-074` | Explain-this-edit tool | Shared | Core | Moderate |
| 61 | `SH-075` | Guided teaching/highlight mode | Shared | Advanced | High |

### Phase 5 — First complete video editing workflow (62–91)

- **Depends on:** Phases 1–4, especially asset identity, asynchronous jobs, preview scheduling, shared command/history semantics, compositing, transforms, codecs, and export infrastructure.
- **Establishes:** Video ingest/decode, sequence/timebase model, multi-track timeline, monitors, fundamental edits, clip relationships, project organization, audio preview/mix basics, speed/freeze operations, and range-based render/export.
- **Exit condition:** A user or agent can import clips, assemble and trim a timeline with audio, preview it, and render a selected range using an export preset.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 62 | `VI-069` | Import common MP4/MOV/WebM media | Video | Foundational | High |
| 63 | `VI-001` | Sequence creation with resolution, frame rate, pixel aspect, and audio settings | Video | Foundational | High |
| 64 | `VI-011` | Multi-track video and audio timeline | Video | Foundational | High |
| 65 | `VI-004` | Source and program monitors | Video | Core | High |
| 66 | `VI-007` | Timecode display and navigation | Video | Core | High |
| 67 | `VI-014` | Drag-and-drop append and rearrangement | Video | Foundational | High |
| 68 | `VI-015` | Split/razor and join-through edits | Video | Foundational | High |
| 69 | `VI-012` | Add, delete, rename, reorder, lock, hide, mute, and solo tracks | Video | Core | Moderate |
| 70 | `VI-020` | Snapping and linked selection | Video | Core | High |
| 71 | `VI-021` | Link/unlink audio and video | Video | Core | Moderate |
| 72 | `VI-022` | Group, label, and select related clips | Video | Core | Moderate |
| 73 | `VI-013` | Insert and overwrite edits | Video | Core | High |
| 74 | `VI-016` | Ripple trim | Video | Core | High |
| 75 | `VI-017` | Roll trim | Video | Core | High |
| 76 | `VI-019` | Lift, extract, ripple delete, and close gap | Video | Core | High |
| 77 | `VI-025` | Clip replacement while retaining attributes | Video | Core | High |
| 78 | `VI-005` | In/Out points and subclips | Video | Core | High |
| 79 | `VI-006` | Markers with colors, names, comments, and durations | Video | Core | Moderate |
| 80 | `VI-003` | Bins/folders and freeform storyboard view | Video | Core | Moderate |
| 81 | `VI-002` | Multiple sequences per project | Video | Core | High |
| 82 | `VI-023` | Subsequences and sequence duplication | Video | Advanced | High |
| 83 | `VI-050` | Waveform display and sample-aware scrubbing | Video | Core | High |
| 84 | `VI-051` | Clip gain, track volume, pan, mute, and solo | Video | Core | High |
| 85 | `VI-039` | Audio crossfades | Video | Core | High |
| 86 | `VI-029` | Frame hold/freeze frame | Video | Core | Moderate |
| 87 | `VI-027` | Clip duration and speed controls | Video | Core | High |
| 88 | `VI-028` | Reverse playback | Video | Core | High |
| 89 | `VI-073` | Render selected range, work area, or individual clips | Video | Core | High |
| 90 | `VI-072` | Export presets for social, web, archive, and professional delivery | Video | Core | High |
| 91 | `VI-071` | Audio-only WAV, MP3, AAC, and FLAC export | Video | Core | High |

### Phase 6 — Reusable shared editing systems (92–112)

- **Depends on:** The proven photo and video vertical slices from Phases 4–5.
- **Establishes:** Advanced history, reusable presets/templates, batch commands, generalized effect containers, blending, masking/clipping, animation primitives, typography, vectors, reusable visual styles, font recovery, and SVG interchange.
- **Exit condition:** Photo and video features share the same reusable history, effect, mask, keyframe, text, vector, preset, and batch-operation models rather than maintaining parallel implementations.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 92 | `SH-012` | Multi-step history panel | Shared | Core | Moderate |
| 93 | `SH-013` | Named snapshots/checkpoints | Shared | Core | Moderate |
| 94 | `SH-014` | Selective revert of an operation | Shared | Advanced | High |
| 95 | `SH-016` | Copy and paste edit attributes | Shared | Core | Moderate |
| 96 | `SH-017` | Presets for reusable edit settings | Shared | Core | Moderate |
| 97 | `SH-005` | Project templates | Shared | Core | Low |
| 98 | `SH-067` | Batch edit tools | Shared | Core | High |
| 99 | `SH-053` | Adjustment/effect containers | Shared | Core | High |
| 100 | `SH-047` | Blend modes | Shared | Core | High |
| 101 | `SH-051` | Masks | Shared | Core | High |
| 102 | `SH-052` | Clipping relationships | Shared | Advanced | High |
| 103 | `SH-054` | Keyframeable properties | Shared | Advanced | High |
| 104 | `SH-055` | Motion paths and easing curves | Shared | Advanced | High |
| 105 | `SH-056` | Point text and paragraph text | Shared | Core | Moderate |
| 106 | `SH-057` | Font family, weight, style, size, leading, tracking, and kerning | Shared | Core | High |
| 107 | `SH-042` | Font management and missing-font substitution | Shared | Advanced | High |
| 108 | `SH-058` | Text alignment, indentation, lists, and paragraph spacing | Shared | Advanced | Moderate |
| 109 | `SH-061` | Shapes and vector paths | Shared | Core | High |
| 110 | `SH-062` | Gradients, patterns, and reusable swatches | Shared | Core | Moderate |
| 111 | `SH-060` | Text styles and reusable brand styles | Shared | Core | Moderate |
| 112 | `SH-063` | SVG import and export | Shared | Advanced | High |

### Phase 7 — Deep photo structure, selection, painting, and retouching (113–140)

- **Depends on:** Phase 4 raster/compositor workflow and Phase 6 shared masks, effects, transforms, presets, vectors, and command semantics.
- **Establishes:** Nested photo documents, the complete selection pipeline, raster/vector/clipping masks, adjustment/fill/style layers, channels, geometric correction, brush infrastructure, fills, retouching, and local brush-based corrections.
- **Exit condition:** The photo editor supports structured, masked, selective, paint-based, and retouching workflows without destructive pixel replacement as the default model.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 113 | `PH-008` | Layer groups and nested groups | Photo | Core | Moderate |
| 114 | `PH-016` | Rectangular and elliptical marquee | Photo | Core | Moderate |
| 115 | `PH-017` | Freehand, polygonal, and magnetic lasso | Photo | Core | High |
| 116 | `PH-018` | Magic wand and contiguous color selection | Photo | Core | High |
| 117 | `PH-019` | Color-range and luminance-range selection | Photo | Advanced | High |
| 118 | `PH-021` | Save, load, transform, expand, contract, smooth, and border selections | Photo | Core | High |
| 119 | `PH-022` | Selection from layer transparency or path | Photo | Core | Moderate |
| 120 | `PH-020` | Select-and-mask workspace | Photo | Advanced | High |
| 121 | `PH-009` | Layer masks | Photo | Core | High |
| 122 | `PH-010` | Vector masks | Photo | Advanced | High |
| 123 | `PH-011` | Clipping masks | Photo | Core | High |
| 124 | `PH-012` | Adjustment layers | Photo | Core | High |
| 125 | `PH-013` | Fill layers | Photo | Advanced | Moderate |
| 126 | `PH-014` | Layer styles | Photo | Advanced | High |
| 127 | `PH-015` | Channels and alpha channels | Photo | Advanced | High |
| 128 | `PH-023` | Free transform with numeric controls | Photo | Core | High |
| 129 | `PH-005` | Perspective crop and keystone correction | Photo | Advanced | High |
| 130 | `PH-024` | Warp transform | Photo | Advanced | High |
| 131 | `PH-046` | Manual distortion and perspective correction | Photo | Advanced | High |
| 132 | `PH-050` | Brush, pencil, and eraser tools | Photo | Core | High |
| 133 | `PH-051` | Brush presets | Photo | Core | Moderate |
| 134 | `PH-052` | Pen pressure, tilt, rotation, and velocity dynamics | Photo | Advanced | High |
| 135 | `PH-054` | Gradient tool | Photo | Core | High |
| 136 | `PH-055` | Paint bucket and tolerance-based fill | Photo | Core | High |
| 137 | `PH-026` | Clone stamp | Photo | Core | High |
| 138 | `PH-027` | Red-eye correction | Photo | Core | High |
| 139 | `PH-028` | Dodge, burn, and sponge | Photo | Core | High |
| 140 | `PH-029` | Blur, sharpen, and smudge brushes | Photo | Core | High |

### Phase 8 — Photo color, effects, photographic workflow, and scale (141–161)

- **Depends on:** Phases 3–7: codec/color metadata, non-destructive effects, masks/selections, worker jobs, presets, and batch commands.
- **Establishes:** Detailed tonal/color controls, creative conversions, camera-oriented profiles and sharpening, blur/noise/distortion/stylization families, synchronized multi-photo processing, and batch asset generation.
- **Exit condition:** The photo path supports comprehensive correction and creative treatment, then scales the same deterministic operations across many assets and outputs.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 141 | `PH-031` | Exposure, offset, and gamma | Photo | Core | High |
| 142 | `PH-032` | Levels with per-channel histograms | Photo | Core | High |
| 143 | `PH-033` | Curves | Photo | Core | High |
| 144 | `PH-036` | Vibrance | Photo | Core | High |
| 145 | `PH-037` | Color balance | Photo | Advanced | High |
| 146 | `PH-038` | Selective color | Photo | Advanced | High |
| 147 | `PH-039` | Black-and-white conversion and channel mixing | Photo | Advanced | High |
| 148 | `PH-040` | Gradient map | Photo | Advanced | High |
| 149 | `PH-041` | Photo filter and color lookup/LUT | Photo | Advanced | High |
| 150 | `PH-042` | Shadows/highlights recovery | Photo | Core | High |
| 151 | `PH-043` | Replace color | Photo | Advanced | High |
| 152 | `PH-044` | Posterize, threshold, invert, and equalize | Photo | Advanced | Moderate |
| 153 | `PH-047` | Sharpening and output sharpening | Photo | Core | High |
| 154 | `PH-048` | Camera and creative profiles | Photo | Advanced | High |
| 155 | `PH-057` | Gaussian, box, motion, radial, lens, and surface blur | Photo | Core | High |
| 156 | `PH-058` | Unsharp mask, smart sharpen, and high-pass sharpening | Photo | Core | High |
| 157 | `PH-059` | Add/reduce noise, dust and scratches, median | Photo | Advanced | High |
| 158 | `PH-060` | Distort, ripple, wave, twirl, spherize, and displacement | Photo | Advanced | High |
| 159 | `PH-061` | Pixelate, mosaic, crystallize, and halftone | Photo | Advanced | High |
| 160 | `PH-049` | Batch synchronization across photos | Photo | Advanced | High |
| 161 | `PH-065` | Batch export and asset generation | Photo | Core | High |

### Phase 9 — Video motion, compositing, effects, color, and graphics (162–185)

- **Depends on:** Phase 5 timeline/render path and Phase 6 shared effect, mask, keyframe, typography, vector, style, and preset engines.
- **Establishes:** Timeline adjustment layers, animated transforms, keyframe UI, video masks/mattes/blending, reframing, transitions, effect stacks, color correction/looks, titles, graphics, title animation, and caption tracks/styles.
- **Exit condition:** The video editor can create polished motion, compositing, color, title, graphic, and caption treatments using the same underlying shared primitives as photo editing.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 162 | `VI-024` | Adjustment layers | Video | Advanced | High |
| 163 | `VI-031` | Motion properties: position, scale, rotation, anchor, opacity | Video | Core | High |
| 164 | `VI-032` | Keyframes with linear, hold, bezier, ease-in, and ease-out interpolation | Video | Advanced | High |
| 165 | `VI-033` | Effect controls and keyframe timeline | Video | Advanced | High |
| 166 | `VI-034` | Crop, feather, edge, and opacity masks | Video | Core | High |
| 167 | `VI-035` | Luma key, track matte, and alpha matte | Video | Advanced | High |
| 168 | `VI-036` | Blend modes | Video | Advanced | High |
| 169 | `VI-037` | Reframe/reposition for alternate aspect ratios | Video | Core | High |
| 170 | `VI-038` | Cross dissolve, dip, wipe, slide, push, and zoom transitions | Video | Core | High |
| 171 | `VI-040` | Transition presets and favorites | Video | Core | Moderate |
| 172 | `VI-041` | Blur, sharpen, noise, grain, distort, stylize, and pixelate effects | Video | Advanced | High |
| 173 | `VI-042` | Shadow, glow, bevel, and edge effects | Video | Advanced | High |
| 174 | `VI-043` | Lens distortion, vignette, flare, and chromatic effects | Video | Advanced | High |
| 175 | `VI-044` | Preset stack and effect templates | Video | Core | High |
| 176 | `VI-045` | Basic exposure, contrast, highlights, shadows, whites, and blacks | Video | Core | High |
| 177 | `VI-046` | White balance and tint eyedropper | Video | Core | High |
| 178 | `VI-047` | Saturation and vibrance | Video | Core | High |
| 179 | `VI-048` | LUT import, preview, and export | Video | Advanced | High |
| 180 | `VI-049` | Color presets/looks | Video | Core | High |
| 181 | `VI-058` | Title cards, lower thirds, and editable text overlays | Video | Core | High |
| 182 | `VI-059` | Shapes, icons, logos, images, and grouped graphics | Video | Core | High |
| 183 | `VI-060` | Per-property title animation | Video | Advanced | High |
| 184 | `VI-061` | Manual caption/subtitle tracks | Video | Core | High |
| 185 | `VI-062` | Caption styling and reusable styles | Video | Core | High |

### Phase 10 — Advanced audio, synchronization, and intelligent assistance (186–194)

- **Depends on:** Phase 5 audio/timeline foundation, Phase 6 keyframes and deterministic WebMCP commands, and Phase 9’s mature effect/parameter surfaces.
- **Establishes:** Audio automation, loudness analysis, DSP, voice-over capture, channel mapping, A/V synchronization, beat-aware editing, natural-language parameter editing, and intelligent clip-usage analysis.
- **Exit condition:** Audio and assistant-driven edits can analyze media, propose deterministic changes, execute them transactionally, and return inspectable results.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 186 | `VI-052` | Audio keyframes and automation lanes | Video | Advanced | High |
| 187 | `VI-053` | Loudness meters and normalization | Video | Core | High |
| 188 | `VI-054` | EQ, compressor, limiter, gate, delay, and reverb | Video | Advanced | High |
| 189 | `VI-055` | Voice-over recording | Video | Core | High |
| 190 | `VI-056` | Audio channel mapping | Video | Advanced | High |
| 191 | `VI-030` | Audio/video synchronization by timestamp or timecode | Video | Advanced | High |
| 192 | `VI-063` | Beat detection and cut-to-music assistance | Video | Core | High |
| 193 | `VI-064` | Natural-language effect and parameter editing | Video | Foundational | High |
| 194 | `VI-009` | Duplicate clip and usage detection | Video | Advanced | High |

### Phase 11 — Asset and project robustness (195–200)

- **Depends on:** Stable project, asset, history, codec, permission, and job models exercised by both full editing domains.
- **Establishes:** Rich asset organization, video-specific offline recovery, durable version history, cloud synchronization, offline operation/conflict handling, and portable project packaging.
- **Exit condition:** Large, long-lived projects survive missing media, device changes, offline work, conflicts, version recovery, and transfer without losing edit identity.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 195 | `SH-037` | Tags, ratings, labels, favorites, and collections | Shared | Advanced | Moderate |
| 196 | `VI-010` | Offline media and relinking | Video | Core | High |
| 197 | `SH-007` | Project version history | Shared | Advanced | Moderate |
| 198 | `SH-008` | Cross-device/cloud project sync | Shared | Advanced | High |
| 199 | `SH-009` | Offline editing | Shared | Advanced | High |
| 200 | `SH-006` | Portable project package | Shared | Advanced | High |

### Phase 12 — Collaboration, external delivery, and final accessibility acceptance (201–213)

- **Depends on:** All prior project/revision, preview/render, timeline, cloud sync, permission, caption, teaching, and export capabilities.
- **Establishes:** Read-only review, roles, anchored/timecoded feedback, annotated review links, version comparison, shared-project locking, watermarks/review burns, external publishing, and product-wide accessibility completion.
- **Exit condition:** Finished work can be reviewed, annotated, versioned, shared, protected, published, and operated accessibly across the complete product surface.

| Order | ID | Feature | Domain | Necessity | Browser difficulty |
|---:|---|---|---|---|---|
| 201 | `SH-081` | Shareable read-only preview | Shared | Core | Moderate |
| 202 | `SH-083` | Roles and permissions | Shared | Advanced | High |
| 203 | `SH-082` | Comments anchored to objects, regions, or timecodes | Shared | Advanced | High |
| 204 | `VI-065` | Timecoded comments | Video | Core | High |
| 205 | `VI-066` | Review links with playback and annotations | Video | Core | High |
| 206 | `VI-067` | Version stacks and side-by-side version comparison | Video | Advanced | High |
| 207 | `VI-068` | Shared projects and project locking | Video | Advanced | High |
| 208 | `VI-075` | Watermarking and review burns | Video | Advanced | High |
| 209 | `VI-074` | Direct publishing to social/video platforms | Video | Advanced | High |
| 210 | `SH-084` | Complete keyboard operation | Shared | Foundational | High |
| 211 | `SH-087` | Reduced-motion mode | Shared | Core | Low |
| 212 | `SH-088` | High-contrast mode and non-color status indicators | Shared | Core | Moderate |
| 213 | `SH-089` | Captioned tutorials and accessible media previews | Shared | Core | Moderate |

## Planned end state

The implementation sequence is complete only when all of the following are true:

- All 213 retained features meet the project-wide definition of feature completion in `AGENTS.md`; a placeholder or disconnected mock does not count.
- Every phase’s exit condition has been demonstrated from a known starting state through both the user interface and the applicable WebMCP path.
- Estro remains one coherent product: photo and video reuse the intended shared commands, state, history, effects, text, color, job, permission, accessibility, and feedback systems.
- The implemented interface remains consistent with the approved blueprint, while phase-level design decisions discovered through real use are recorded rather than left implicit.
- Browser, worker, storage, codec, queue, retry, cancellation, and fallback behavior has been verified wherever the relevant feature requires it.
- Product-wide keyboard, semantic, focus, contrast, reduced-motion, caption, error, and status behavior has passed final acceptance.
- Canonical documents, schemas, migrations, tests, and demonstrations describe the product that actually exists.

Completion of this plan does not itself authorize a commit, push, deployment, external upload, paid service, production dependency, Docker execution, or release. Those actions retain the approval boundaries in `AGENTS.md`.

## Completion integrity

- **Total ordered features:** 213
- **Unique feature IDs:** 213
- **Shared capabilities:** 83
- **Photo capabilities:** 60
- **Video capabilities:** 70
- **Omitted or duplicated retained features:** 0

Feature IDs remain stable and intentionally contain gaps corresponding to the sixteen capabilities previously removed from scope.
