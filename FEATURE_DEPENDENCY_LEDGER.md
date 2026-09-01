# Feature Dependency Ledger

This is the canonical implementation ledger for the retained product scope. It maps every approved feature to the capabilities required to implement it. Duplication is intentional: repeated dependencies are evidence for the component inventory that will be normalized from this document later.

The canonical dependency-aware implementation order is maintained separately in [`FEATURE_IMPLEMENTATION_PLAN.md`](./FEATURE_IMPLEMENTATION_PLAN.md).

All implementation work is governed by [`AGENTS.md`](./AGENTS.md).

The product-wide visual and interaction requirements are defined in [`PRODUCT_DESIGN_BLUEPRINT.md`](./PRODUCT_DESIGN_BLUEPRINT.md).

## Coverage and interpretation

- **Retained features:** 213 (83 shared, 60 photo, 70 video).
- **Scope status:** 16 features judged genuinely excessive have been removed; stable feature IDs are preserved, so gaps identify retired scope rather than missing analysis.
- **Compute is split:** browser/interactive requirements are separated from remote/final-output requirements.
- **Storage is explicit:** project records, originals, derived media, caches, temporary worker files, and exports are treated differently.
- **WebMCP scopes:** `read`, `write`, `navigate`, `teach`, `job`, and `confirm` describe the kinds of agent interaction a feature needs. They do not imply one WebMCP tool per feature; the operations are typed discriminators over shared application commands.
- **Component identifiers are intentionally repeated:** later frequency analysis can turn them into a normalized component inventory and dependency graph.

## Preliminary component vocabulary

| ID | Responsibility |
|---|---|
| `C-APP-SHELL` | Application shell, routing, sessions, and feature availability |
| `C-PROJECT` | Versioned non-destructive project document |
| `C-COMMAND` | Validated command and transaction engine |
| `C-HISTORY` | Undo, redo, snapshots, provenance, and revision history |
| `C-LOCAL-STORE` | IndexedDB/OPFS local persistence and recovery |
| `C-CLOUD-STORE` | Project metadata database and object-storage gateway |
| `C-SYNC` | Offline/cloud synchronization and conflict resolution |
| `C-ASSET` | Asset registry, stable identifiers, references, and lifecycle |
| `C-IMPORT` | File/folder ingestion, probing, validation, and relinking |
| `C-METADATA` | Media metadata extraction, indexing, and search |
| `C-PROXY` | Proxy, thumbnail, waveform, and optimized-media generation |
| `C-CACHE` | Memory/OPFS derived-data cache with eviction and quotas |
| `C-PREVIEW` | Interactive preview scheduler and quality controller |
| `C-CANVAS` | Viewport, canvas navigation, overlays, guides, and hit testing |
| `C-COMPOSITOR` | Ordered layer/track compositor and blend pipeline |
| `C-IMAGE` | Tiled raster image decoder, processor, and renderer |
| `C-VIDEO` | Video demux, decode, frame scheduling, and playback |
| `C-AUDIO` | Audio decode, waveform, playback, processing, and mixing |
| `C-TIMELINE` | Sequence, track, clip, time, trim, and snapping model |
| `C-COLOR` | Color transforms, profiles, histograms, scopes, and LUTs |
| `C-EFFECT` | Parameterised non-destructive image/video effect graph |
| `C-TRANSFORM` | Position, scale, rotation, crop, warp, and coordinate system |
| `C-KEYFRAME` | Time-varying properties, interpolation, easing, and motion paths |
| `C-MASK` | Raster/vector masks, mattes, feathering, and mask evaluation |
| `C-SELECTION` | Selection geometry, pixel selection maps, refinement, and hit testing |
| `C-BRUSH` | Pointer sampling, brush engine, dynamics, and raster strokes |
| `C-VECTOR` | Paths, shapes, SVG, boolean geometry, fills, and strokes |
| `C-TEXT` | Text shaping, layout, fonts, styles, captions, and title rendering |
| `C-EXPORT` | Render-plan compiler, presets, packaging, and output verification |
| `C-CODEC` | Codec/container/image-format capability and conversion layer |
| `C-JOBS` | Asynchronous job API, queue, leases, progress, cancellation, and retry |
| `C-WORKER` | Remote CPU/GPU media worker runtime and sandbox |
| `C-ML` | Model inference, feature extraction, and analysis orchestration |
| `C-WEBMCP` | WebMCP registration, schemas, capability discovery, and results |
| `C-FOCUS` | Selection, focus, UI reveal, highlighting, and teaching bridge |
| `C-PERMISSION` | Authentication, authorization, confirmations, and policy gates |
| `C-COLLAB` | Sharing, comments, roles, project locks, and review revisions |
| `C-A11Y` | Keyboard, semantics, focus, contrast, captions, and reduced motion |
| `C-PRESET` | Templates, presets, styles, and reusable parameter bundles |
| `C-PUBLISH` | External-service OAuth, validation, upload, and publish status |

# Shared capabilities

## Project, document, and persistence model

### SH-001 — Create, open, rename, duplicate, and delete projects

- **Classification:** Shared → Project, document, and persistence model; necessity **Foundational**; browser difficulty **Low**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state. Actor identity, authorization decision, consequence summary, and confirmation/audit state.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`, `C-PERMISSION`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`, `confirm`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. Mark side effects explicitly and return permission/confirmation requirements before transmission, deletion, or publishing.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-002 — Autosave and crash recovery

- **Classification:** Shared → Project, document, and persistence model; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required. Atomic checkpoint writes, debounce, write-ahead/recovery markers, corruption detection, and storage quota monitoring.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. `configure_autosave` and `recover_draft`; expose last durable revision and recovery reason.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-003 — Explicit save, Save As, and project snapshots

- **Classification:** Shared → Project, document, and persistence model; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state. Named revision metadata, parent revision, actor, timestamp, and optional comparison render.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. Include revision selectors and return immutable revision IDs.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-004 — Recent projects and recoverable drafts

- **Classification:** Shared → Project, document, and persistence model; necessity **Core**; browser difficulty **Low**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. Feature discriminator: `operationType="recent_projects_and_recoverable_drafts"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-005 — Project templates

- **Classification:** Shared → Project, document, and persistence model; necessity **Core**; browser difficulty **Low**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`, `C-PRESET`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-006 — Portable project package

- **Classification:** Shared → Project, document, and persistence model; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks. Asynchronous CPU/I/O packaging may collect originals, proxies, fonts, presets, and a manifest with checksums.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage. Temporary archive staging and downloadable package output; preserve relative manifest references.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`, `C-EXPORT`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. `start_package_job` with inclusion policy; return missing/licensing warnings and package asset ID.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-007 — Project version history

- **Classification:** Shared → Project, document, and persistence model; necessity **Advanced**; browser difficulty **Moderate**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state. Named revision metadata, parent revision, actor, timestamp, and optional comparison render.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. Include revision selectors and return immutable revision IDs.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-008 — Cross-device/cloud project sync

- **Classification:** Shared → Project, document, and persistence model; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks. Control-plane synchronization, conflict detection, revision exchange, and resumable media transfer.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage. Cloud revision/object records plus local pending-operation journal.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`, `C-SYNC`, `C-PERMISSION`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. Return synchronization/lock state and explicit conflict objects; never silently overwrite.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

### SH-009 — Offline editing

- **Classification:** Shared → Project, document, and persistence model; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Project identity, schema version, settings, revisions, asset references, ownership, and lifecycle state.
- **Compute — browser/interactive:** Low–moderate browser CPU for serialization, validation, hashing, incremental checkpoints, and recovery; persistence must stay off the rendering hot path.
- **Compute — remote/final:** Low CPU control-plane work; optional archive/package jobs become asynchronous CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Cloud project metadata/revisions when persistence or sharing is enabled; packages may include Original media in local file handles or object storage.
- **UI requirements:** Project dashboard, create/open dialogs, save/version indicators, recovery notices, template chooser, and conflict UI.
- **Application component dependencies:** `C-APP-SHELL`, `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-LOCAL-STORE`, `C-CLOUD-STORE`, `C-SYNC`.
- **Technical/runtime dependencies:** IndexedDB, OPFS, structured cloning/JSON schemas, checksums, service workers where offline behavior is required. Service worker/app shell cache, durable local operation journal, reconnect reconciliation, and offline capability indicators.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_project`, `manage_project`, `list_versions`, `restore_version`, and `focus_ui`; mutations return project/revision IDs and warnings. Expose offline capability/state; queue only operations whose semantics remain safe.
- **Fallback/constraint:** Retain a local-only project mode; disable unavailable cloud/package operations without preventing ordinary editing.

## Non-destructive editing and history

### SH-010 — Non-destructive operation graph

- **Classification:** Shared → Non-destructive editing and history; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. Feature discriminator: `operationType="non_destructive_operation_graph"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-011 — Undo and redo

- **Classification:** Shared → Non-destructive editing and history; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry. Inverse or replayable operation data and transaction dependency checks.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. Return and accept transaction IDs/undo tokens; describe conflicts on selective revert.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-012 — Multi-step history panel

- **Classification:** Shared → Non-destructive editing and history; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry. Non-destructive viewport-only transform and display mode, separate from document transforms. Clip gain, track fader/pan, monitoring mute/solo, channel/bus target, and optional automation.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`, `C-CANVAS`, `C-AUDIO`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits. `apply_audio_mix_operation` requires clip/track ID and parameter; return effective state and clipping warnings.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-013 — Named snapshots/checkpoints

- **Classification:** Shared → Non-destructive editing and history; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry. Named revision metadata, parent revision, actor, timestamp, and optional comparison render.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. Include revision selectors and return immutable revision IDs.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-014 — Selective revert of an operation

- **Classification:** Shared → Non-destructive editing and history; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry. Inverse or replayable operation data and transaction dependency checks.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. Return and accept transaction IDs/undo tokens; describe conflicts on selective revert.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-015 — Before/after comparison

- **Classification:** Shared → Non-destructive editing and history; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation. Dual render states with synchronized viewport/playhead; cache both sides within an explicit memory budget.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels. Split/wipe/A-B controls and clearly labelled revisions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. `compare_revisions` or `render_comparison`; return the exact revision pair.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-016 — Copy and paste edit attributes

- **Classification:** Shared → Non-destructive editing and history; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. Feature discriminator: `operationType="copy_and_paste_edit_attributes"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-017 — Presets for reusable edit settings

- **Classification:** Shared → Non-destructive editing and history; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`, `C-PRESET`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

### SH-018 — Edit provenance

- **Classification:** Shared → Non-destructive editing and history; necessity **Advanced**; browser difficulty **Moderate**.
- **Project/data requirements:** Typed operations, ordered effect/transform graph, transaction boundaries, inverse/replay data, actor, timestamp, and revision ancestry.
- **Compute — browser/interactive:** Moderate browser CPU for immutable state updates, dependency invalidation, replay, diffing, and preview re-evaluation.
- **Compute — remote/final:** Usually none; cloud revision persistence and large comparison previews are low CPU/I/O tasks.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; optional Cloud project metadata/revisions when persistence or sharing is enabled; before/after render caches use Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** History panel, undo/redo controls, snapshot controls, A/B comparison viewport, preset browser, and provenance labels.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-HISTORY`, `C-EFFECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Deterministic operation schemas, immutable/patch-based state, dependency graph invalidation, stable object IDs.
- **WebMCP scope:** `read`, `write`, `teach`. `inspect_history`, `apply_operation`, `apply_transaction`, `undo_transaction`, `compare_revisions`, and `explain_change`; return transaction and revision IDs. Feature discriminator: `operationType="edit_provenance"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** If selective replay cannot be resolved safely, restore a complete snapshot or require a new branch instead of silently merging.

## Workspace and interaction

### SH-019 — Resizable and dockable panels

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Non-destructive viewport-only transform and display mode, separate from document transforms. Clip gain, track fader/pan, monitoring mute/solo, channel/bus target, and optional automation.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-AUDIO`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits. `apply_audio_mix_operation` requires clip/track ID and parameter; return effective state and clipping warnings.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-021 — Context-sensitive property inspector

- **Classification:** Shared → Workspace and interaction; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-TEXT`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-022 — Contextual task/action bar

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **Low**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-TEXT`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-023 — Searchable commands and features

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn. Incremental indexing/querying should run in a worker and avoid decoding full media.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication. Searchable metadata index plus user labels/collections; media remains referenced, not copied.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states. Search box, filter chips/facets, sortable metadata, result counts, and clear-active-filters state.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-METADATA`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. `search_assets_or_commands` with structured filters; return stable IDs and matched fields.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-025 — Keyboard shortcuts

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-026 — Mouse, trackpad, touch, and pen input

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. Feature discriminator: `operationType="mouse_trackpad_touch_and_pen_input"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-028 — Fullscreen and distraction-free preview

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **Low**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Non-destructive viewport-only transform and display mode, separate from document transforms.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn. Bounded, cancellable render request keyed by project revision, viewport/time, quality, and capability profile.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-CACHE`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits. Return revision, time/region, quality, warnings, and a verifiable preview reference rather than claiming success generically.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-029 — Rulers, guides, grids, snapping, and safe areas

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Guide/grid/safe-area geometry, snap targets, thresholds, and alignment reference.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn. Spatial indexing and screen-space snapping/hit testing at pointer frequency.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-TRANSFORM`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. Accept explicit alignment reference/target IDs and return resulting numeric coordinates.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-030 — Zoom, pan, rotate view, and fit-to-view

- **Classification:** Shared → Workspace and interaction; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Non-destructive viewport-only transform and display mode, separate from document transforms. Clip gain, track fader/pan, monitoring mute/solo, channel/bus target, and optional automation.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-AUDIO`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits. `apply_audio_mix_operation` requires clip/track ID and parameter; return effective state and clipping warnings.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-031 — Pixel grid and actual-size view

- **Classification:** Shared → Workspace and interaction; necessity **Advanced**; browser difficulty **Moderate**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Guide/grid/safe-area geometry, snap targets, thresholds, and alignment reference. Non-destructive viewport-only transform and display mode, separate from document transforms.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn. Spatial indexing and screen-space snapping/hit testing at pointer frequency.
- **Compute — remote/final:** None beyond optional preference synchronization.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-TRANSFORM`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. Accept explicit alignment reference/target IDs and return resulting numeric coordinates. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

### SH-032 — Multiple preview quality levels

- **Classification:** Shared → Workspace and interaction; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Workspace layout, selection, active tool, viewport transform, command bindings, panel state, and per-user preferences. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Low–moderate browser CPU; high-frequency pointer/viewport work uses animation-frame scheduling and must avoid main-thread layout churn. Bounded, cancellable render request keyed by project revision, viewport/time, quality, and capability profile.
- **Compute — remote/final:** None beyond optional preference synchronization. CPU media worker can generate resolution/codec-appropriate proxies and thumbnails.
- **Storage and data movement:** Small local preference records; optional account-synced preferences; no media duplication. Proxy-to-original mapping, derivative object, generation settings, and cache eviction metadata.
- **UI requirements:** Editor shell, dock system, toolbar, inspector, command palette, canvas overlays, shortcut editor, and responsive/fullscreen states.
- **Application component dependencies:** `C-APP-SHELL`, `C-CANVAS`, `C-FOCUS`, `C-PREVIEW`, `C-A11Y`, `C-PROXY`, `C-JOBS`, `C-CACHE`, `C-COLOR`, `C-EFFECT`.
- **Technical/runtime dependencies:** Pointer Events, KeyboardEvent, ResizeObserver, Fullscreen API, CSS containment, virtualisation, requestAnimationFrame.
- **WebMCP scope:** `read`, `write`, `navigate`, `teach`. `inspect_workspace`, `set_workspace_preference`, `set_selection`, `focus_ui`, and `explain_control`; return focused target and resulting preference state. `start_proxy_job` and `set_preview_quality`; return derivative ID and original linkage. Return revision, time/region, quality, warnings, and a verifiable preview reference rather than claiming success generically. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Provide fixed-panel and keyboard-accessible alternatives when docking, touch, pen, or fullscreen capabilities are unavailable.

## Assets and media management

### SH-033 — Local file import via picker and drag-and-drop

- **Classification:** Shared → Assets and media management; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. Feature discriminator: `operationType="local_file_import_via_picker_and_drag_and_drop"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-034 — Folder import

- **Classification:** Shared → Assets and media management; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. Feature discriminator: `operationType="folder_import"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-035 — Asset library with thumbnails

- **Classification:** Shared → Assets and media management; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. Feature discriminator: `operationType="asset_library_with_thumbnails"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-036 — Asset metadata inspection

- **Classification:** Shared → Assets and media management; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable. Incremental indexing/querying should run in a worker and avoid decoding full media.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage. Searchable metadata index plus user labels/collections; media remains referenced, not copied.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators. Search box, filter chips/facets, sortable metadata, result counts, and clear-active-filters state.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. `search_assets_or_commands` with structured filters; return stable IDs and matched fields.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-037 — Tags, ratings, labels, favorites, and collections

- **Classification:** Shared → Assets and media management; necessity **Advanced**; browser difficulty **Moderate**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable. Incremental indexing/querying should run in a worker and avoid decoding full media.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage. Small versioned preset/template records locally and optionally in the account database Searchable metadata index plus user labels/collections; media remains referenced, not copied.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators. Search box, filter chips/facets, sortable metadata, result counts, and clear-active-filters state.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`, `C-PRESET`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters. `search_assets_or_commands` with structured filters; return stable IDs and matched fields.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-038 — Search and filters

- **Classification:** Shared → Assets and media management; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable. Incremental indexing/querying should run in a worker and avoid decoding full media.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage. Searchable metadata index plus user labels/collections; media remains referenced, not copied.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators. Search box, filter chips/facets, sortable metadata, result counts, and clear-active-filters state.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. `search_assets_or_commands` with structured filters; return stable IDs and matched fields.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-040 — Missing-media detection and relinking

- **Classification:** Shared → Assets and media management; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state. Stable logical asset ID separated from source locator, plus compatibility mapping for dimensions/duration/channels.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. `relink_asset` or `replace_asset_source`; return compatibility losses and every affected reference.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-041 — Replace source while preserving edits

- **Classification:** Shared → Assets and media management; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state. Stable logical asset ID separated from source locator, plus compatibility mapping for dimensions/duration/channels.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. `relink_asset` or `replace_asset_source`; return compatibility losses and every affected reference.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-042 — Font management and missing-font substitution

- **Classification:** Shared → Assets and media management; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage. Font references and permitted font files; cache glyph atlases rather than duplicating fonts per object.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`, `C-TEXT`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders. FontFace API/web fonts, licensing/embedding policy, metric compatibility, shaping, and deterministic substitution.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. Return missing/substituted font information and require an explicit replacement decision where layout changes.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

### SH-043 — Proxy/optimized media generation

- **Classification:** Shared → Assets and media management; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Stable asset IDs, source handles/URLs, hashes, media type, technical metadata, derivatives, tags, usage references, and availability state.
- **Compute — browser/interactive:** Moderate–high worker CPU for probing, hashing, thumbnails, metadata, relinking, and proxy decisions; decoding must be bounded and cancellable.
- **Compute — remote/final:** Optional CPU media worker for heavyweight proxies, server-side metadata, visual duplicate analysis, and package preparation. CPU media worker can generate resolution/codec-appropriate proxies and thumbnails.
- **Storage and data movement:** Original media in local file handles or object storage; asset metadata in local/project databases; Derived previews/proxies/masks/waveforms in OPFS cache and object storage; hashes and indexes in metadata storage. Proxy-to-original mapping, derivative object, generation settings, and cache eviction metadata.
- **UI requirements:** Import drop zone/file picker, asset grid/list, filters, metadata inspector, relink/replace dialogs, progress, and missing-media indicators.
- **Application component dependencies:** `C-ASSET`, `C-IMPORT`, `C-METADATA`, `C-PROXY`, `C-CACHE`, `C-CODEC`, `C-JOBS`.
- **Technical/runtime dependencies:** File/Directory picker with input fallback, Drag and Drop, Blob/File, OPFS, media probing, hashing, image/video decoders.
- **WebMCP scope:** `read`, `write`, `job`, `navigate`, `teach`. `list_assets`, `inspect_asset`, `import_asset_reference`, `update_asset_metadata`, `replace_or_relink_asset`, and `start_asset_job`; return asset IDs, derivative IDs, and job status. `start_proxy_job` and `set_preview_quality`; return derivative ID and original linkage.
- **Fallback/constraint:** Keep unsupported assets registered but offline; show required conversion and permit cloud proxy generation or manual replacement.

## Common visual primitives

### SH-044 — Position, scale, rotation, and anchor/origin controls

- **Classification:** Shared → Common visual primitives; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. Feature discriminator: `operationType="position_scale_rotation_and_anchor_origin_controls"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-045 — Crop, fit, fill, and aspect-ratio behavior

- **Classification:** Shared → Common visual primitives; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. Feature discriminator: `operationType="crop_fit_fill_and_aspect_ratio_behavior"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-046 — Opacity

- **Classification:** Shared → Common visual primitives; necessity **Foundational**; browser difficulty **Low**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. Feature discriminator: `operationType="opacity"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-047 — Blend modes

- **Classification:** Shared → Common visual primitives; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation. GPU blend shader in a defined working colour space with premultiplied-alpha handling.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution. Final compositor must implement the identical named blend formula and colour policy.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`, `C-COLOR`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. Validate supported blend-mode enum and return preview/final capability differences.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-048 — Alignment and distribution

- **Classification:** Shared → Common visual primitives; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes. Guide/grid/safe-area geometry, snap targets, thresholds, and alignment reference.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation. Spatial indexing and screen-space snapping/hit testing at pointer frequency.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`, `C-CANVAS`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. Accept explicit alignment reference/target IDs and return resulting numeric coordinates.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-049 — Grouping and nesting

- **Classification:** Shared → Common visual primitives; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. Feature discriminator: `operationType="grouping_and_nesting"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-050 — Lock, hide, solo, mute, and isolate

- **Classification:** Shared → Common visual primitives; necessity **Core**; browser difficulty **Low**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes. Clip gain, track fader/pan, monitoring mute/solo, channel/bus target, and optional automation.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`, `C-AUDIO`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. `apply_audio_mix_operation` requires clip/track ID and parameter; return effective state and clipping warnings.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-051 — Masks

- **Classification:** Shared → Common visual primitives; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`, `C-SELECTION`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-052 — Clipping relationships

- **Classification:** Shared → Common visual primitives; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`, `C-SELECTION`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-053 — Adjustment/effect containers

- **Classification:** Shared → Common visual primitives; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. Feature discriminator: `operationType="adjustment_effect_containers"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-054 — Keyframeable properties

- **Classification:** Shared → Common visual primitives; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes. Property path, timestamp/timebase, value, interpolation/tangents, spatial path, and ordering rules.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation. Frame-time interpolation and graph/path rendering; edits invalidate only affected time ranges.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. `set_keyframes` accepts typed property paths and times; return normalized times, values, and transaction ID.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

### SH-055 — Motion paths and easing curves

- **Classification:** Shared → Common visual primitives; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Per-object transforms, bounds, hierarchy, visibility/lock state, opacity, blend/effect references, masks, and optional keyframes. Property path, timestamp/timebase, value, interpolation/tangents, spatial path, and ordering rules. Path commands/shape primitives, viewBox/coordinate space, fills, strokes, transforms, grouping, and import sanitization. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU preview with worker-side scheduling; CPU handles hit testing, matrices, graph invalidation, and keyframe evaluation. Frame-time interpolation and graph/path rendering; edits invalidate only affected time ranges.
- **Compute — remote/final:** CPU/GPU final compositor reproduces the same versioned parameters at output resolution.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Memory/OPFS scratch data governed by quota and LRU eviction for intermediate textures/frames; Rendered outputs in temporary storage followed by object storage/download for final output.
- **UI requirements:** Direct manipulation handles, numeric inspector, hierarchy panel, mask/effect controls, keyframe indicators, guides, and contextual actions.
- **Application component dependencies:** `C-PROJECT`, `C-COMMAND`, `C-COMPOSITOR`, `C-TRANSFORM`, `C-MASK`, `C-EFFECT`, `C-KEYFRAME`, `C-PREVIEW`, `C-EXPORT`, `C-VECTOR`, `C-COLOR`.
- **Technical/runtime dependencies:** Canvas/WebGL2/WebGPU, DOMMatrix, shader pipeline, colour/alpha conventions, coordinate transforms, worker messaging. SVG sanitization, path parsing/tessellation, boolean geometry, antialiasing, and export fidelity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `apply_operation` with typed transform/composite parameters, `set_selection`, `preview_revision`, and `explain_parameter`; return affected IDs and preview revision. `set_keyframes` accepts typed property paths and times; return normalized times, values, and transaction ID. `inspect_vector_object`, `add_or_update_shape`, and `import_or_export_svg`; return bounds and unsupported SVG features. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use reduced-resolution Canvas/WebGL previews or disable unsupported blend/effect variants while preserving their project parameters for remote render.

## Typography, vectors, and graphics

### SH-056 — Point text and paragraph text

- **Classification:** Shared → Typography, vectors, and graphics; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Text runs/paragraphs, font descriptors, layout constraints, paths, shapes, fills, strokes, gradients, swatches, styles, and object transforms. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate browser CPU/GPU for shaping, layout, path tessellation, rasterisation, hit testing, and live style preview.
- **Compute — remote/final:** CPU/GPU final renderer embeds/substitutes fonts and rasterises vector/text content consistently.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; font/vector assets in local or object storage; glyph/path caches use Memory/OPFS scratch data governed by quota and LRU eviction; Small versioned preset/template records locally and optionally in the account database.
- **UI requirements:** Text editor and typography inspector, path/shape tools, swatch/gradient editors, style browser, font warnings, and canvas handles.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PRESET`, `C-ASSET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas text is insufficient alone: font loading/licensing, text shaping, Unicode/bidi, SVG parsing, path tessellation, and consistent server fonts are required.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_graphic`, `apply_text_operation`, `apply_vector_operation`, `apply_style`, `focus_ui`, and `explain_typography`; return object IDs, substitutions, and bounds. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute missing fonts explicitly, preserve original font descriptors, and rasterise unsupported SVG/text effects only as a disclosed fallback.

### SH-057 — Font family, weight, style, size, leading, tracking, and kerning

- **Classification:** Shared → Typography, vectors, and graphics; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Text runs/paragraphs, font descriptors, layout constraints, paths, shapes, fills, strokes, gradients, swatches, styles, and object transforms. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate browser CPU/GPU for shaping, layout, path tessellation, rasterisation, hit testing, and live style preview.
- **Compute — remote/final:** CPU/GPU final renderer embeds/substitutes fonts and rasterises vector/text content consistently.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; font/vector assets in local or object storage; glyph/path caches use Memory/OPFS scratch data governed by quota and LRU eviction; Small versioned preset/template records locally and optionally in the account database. Small versioned preset/template records locally and optionally in the account database Font references and permitted font files; cache glyph atlases rather than duplicating fonts per object.
- **UI requirements:** Text editor and typography inspector, path/shape tools, swatch/gradient editors, style browser, font warnings, and canvas handles.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PRESET`, `C-ASSET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas text is insufficient alone: font loading/licensing, text shaping, Unicode/bidi, SVG parsing, path tessellation, and consistent server fonts are required. FontFace API/web fonts, licensing/embedding policy, metric compatibility, shaping, and deterministic substitution.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_graphic`, `apply_text_operation`, `apply_vector_operation`, `apply_style`, `focus_ui`, and `explain_typography`; return object IDs, substitutions, and bounds. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters. Return missing/substituted font information and require an explicit replacement decision where layout changes. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute missing fonts explicitly, preserve original font descriptors, and rasterise unsupported SVG/text effects only as a disclosed fallback.

### SH-058 — Text alignment, indentation, lists, and paragraph spacing

- **Classification:** Shared → Typography, vectors, and graphics; necessity **Advanced**; browser difficulty **Moderate**.
- **Project/data requirements:** Text runs/paragraphs, font descriptors, layout constraints, paths, shapes, fills, strokes, gradients, swatches, styles, and object transforms. Guide/grid/safe-area geometry, snap targets, thresholds, and alignment reference. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate browser CPU/GPU for shaping, layout, path tessellation, rasterisation, hit testing, and live style preview. Spatial indexing and screen-space snapping/hit testing at pointer frequency.
- **Compute — remote/final:** CPU/GPU final renderer embeds/substitutes fonts and rasterises vector/text content consistently.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; font/vector assets in local or object storage; glyph/path caches use Memory/OPFS scratch data governed by quota and LRU eviction; Small versioned preset/template records locally and optionally in the account database.
- **UI requirements:** Text editor and typography inspector, path/shape tools, swatch/gradient editors, style browser, font warnings, and canvas handles.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PRESET`, `C-ASSET`, `C-EXPORT`, `C-CANVAS`.
- **Technical/runtime dependencies:** Canvas text is insufficient alone: font loading/licensing, text shaping, Unicode/bidi, SVG parsing, path tessellation, and consistent server fonts are required.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_graphic`, `apply_text_operation`, `apply_vector_operation`, `apply_style`, `focus_ui`, and `explain_typography`; return object IDs, substitutions, and bounds. Accept explicit alignment reference/target IDs and return resulting numeric coordinates. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute missing fonts explicitly, preserve original font descriptors, and rasterise unsupported SVG/text effects only as a disclosed fallback.

### SH-060 — Text styles and reusable brand styles

- **Classification:** Shared → Typography, vectors, and graphics; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Text runs/paragraphs, font descriptors, layout constraints, paths, shapes, fills, strokes, gradients, swatches, styles, and object transforms. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate browser CPU/GPU for shaping, layout, path tessellation, rasterisation, hit testing, and live style preview.
- **Compute — remote/final:** CPU/GPU final renderer embeds/substitutes fonts and rasterises vector/text content consistently.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; font/vector assets in local or object storage; glyph/path caches use Memory/OPFS scratch data governed by quota and LRU eviction; Small versioned preset/template records locally and optionally in the account database. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Text editor and typography inspector, path/shape tools, swatch/gradient editors, style browser, font warnings, and canvas handles.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PRESET`, `C-ASSET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas text is insufficient alone: font loading/licensing, text shaping, Unicode/bidi, SVG parsing, path tessellation, and consistent server fonts are required.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_graphic`, `apply_text_operation`, `apply_vector_operation`, `apply_style`, `focus_ui`, and `explain_typography`; return object IDs, substitutions, and bounds. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute missing fonts explicitly, preserve original font descriptors, and rasterise unsupported SVG/text effects only as a disclosed fallback.

### SH-061 — Shapes and vector paths

- **Classification:** Shared → Typography, vectors, and graphics; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Text runs/paragraphs, font descriptors, layout constraints, paths, shapes, fills, strokes, gradients, swatches, styles, and object transforms. Path commands/shape primitives, viewBox/coordinate space, fills, strokes, transforms, grouping, and import sanitization.
- **Compute — browser/interactive:** Moderate browser CPU/GPU for shaping, layout, path tessellation, rasterisation, hit testing, and live style preview.
- **Compute — remote/final:** CPU/GPU final renderer embeds/substitutes fonts and rasterises vector/text content consistently.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; font/vector assets in local or object storage; glyph/path caches use Memory/OPFS scratch data governed by quota and LRU eviction; Small versioned preset/template records locally and optionally in the account database.
- **UI requirements:** Text editor and typography inspector, path/shape tools, swatch/gradient editors, style browser, font warnings, and canvas handles.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PRESET`, `C-ASSET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas text is insufficient alone: font loading/licensing, text shaping, Unicode/bidi, SVG parsing, path tessellation, and consistent server fonts are required. SVG sanitization, path parsing/tessellation, boolean geometry, antialiasing, and export fidelity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_graphic`, `apply_text_operation`, `apply_vector_operation`, `apply_style`, `focus_ui`, and `explain_typography`; return object IDs, substitutions, and bounds. `inspect_vector_object`, `add_or_update_shape`, and `import_or_export_svg`; return bounds and unsupported SVG features.
- **Fallback/constraint:** Substitute missing fonts explicitly, preserve original font descriptors, and rasterise unsupported SVG/text effects only as a disclosed fallback.

### SH-062 — Gradients, patterns, and reusable swatches

- **Classification:** Shared → Typography, vectors, and graphics; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Text runs/paragraphs, font descriptors, layout constraints, paths, shapes, fills, strokes, gradients, swatches, styles, and object transforms. Fill type, colour/gradient stops, transform, tolerance, target region, blend, and opacity.
- **Compute — browser/interactive:** Moderate browser CPU/GPU for shaping, layout, path tessellation, rasterisation, hit testing, and live style preview.
- **Compute — remote/final:** CPU/GPU final renderer embeds/substitutes fonts and rasterises vector/text content consistently.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; font/vector assets in local or object storage; glyph/path caches use Memory/OPFS scratch data governed by quota and LRU eviction; Small versioned preset/template records locally and optionally in the account database. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Text editor and typography inspector, path/shape tools, swatch/gradient editors, style browser, font warnings, and canvas handles.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PRESET`, `C-ASSET`, `C-EXPORT`, `C-BRUSH`.
- **Technical/runtime dependencies:** Canvas text is insufficient alone: font loading/licensing, text shaping, Unicode/bidi, SVG parsing, path tessellation, and consistent server fonts are required.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_graphic`, `apply_text_operation`, `apply_vector_operation`, `apply_style`, `focus_ui`, and `explain_typography`; return object IDs, substitutions, and bounds. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters. `apply_fill` with explicit target, fill definition, and tolerance; return affected bounds/pixels estimate.
- **Fallback/constraint:** Substitute missing fonts explicitly, preserve original font descriptors, and rasterise unsupported SVG/text effects only as a disclosed fallback.

### SH-063 — SVG import and export

- **Classification:** Shared → Typography, vectors, and graphics; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Text runs/paragraphs, font descriptors, layout constraints, paths, shapes, fills, strokes, gradients, swatches, styles, and object transforms. Path commands/shape primitives, viewBox/coordinate space, fills, strokes, transforms, grouping, and import sanitization.
- **Compute — browser/interactive:** Moderate browser CPU/GPU for shaping, layout, path tessellation, rasterisation, hit testing, and live style preview.
- **Compute — remote/final:** CPU/GPU final renderer embeds/substitutes fonts and rasterises vector/text content consistently.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; font/vector assets in local or object storage; glyph/path caches use Memory/OPFS scratch data governed by quota and LRU eviction; Small versioned preset/template records locally and optionally in the account database.
- **UI requirements:** Text editor and typography inspector, path/shape tools, swatch/gradient editors, style browser, font warnings, and canvas handles.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PRESET`, `C-ASSET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Canvas text is insufficient alone: font loading/licensing, text shaping, Unicode/bidi, SVG parsing, path tessellation, and consistent server fonts are required. SVG sanitization, path parsing/tessellation, boolean geometry, antialiasing, and export fidelity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_graphic`, `apply_text_operation`, `apply_vector_operation`, `apply_style`, `focus_ui`, and `explain_typography`; return object IDs, substitutions, and bounds. `inspect_vector_object`, `add_or_update_shape`, and `import_or_export_svg`; return bounds and unsupported SVG features.
- **Fallback/constraint:** Substitute missing fonts explicitly, preserve original font descriptors, and rasterise unsupported SVG/text effects only as a disclosed fallback.

## Automation, WebMCP, and agent collaboration

### SH-064 — Structured project-state inspection tool

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`. `inspect_project` accepts narrow selectors for document, sequence, layers, timeline, selection, effects, and capabilities; it returns stable IDs, schema/revision, bounded summaries, and no binary media.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-065 — Asset inventory and metadata tool

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`. `list_assets` and `inspect_asset` accept type/query/usage filters and return stable asset IDs, technical metadata, availability, derivatives, and bounded thumbnail references.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-066 — Deterministic atomic edit tools

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `write`, `teach`. Typed atomic tools validate explicit target IDs and parameters, call one application command, and return transaction ID, affected IDs, normalized parameters, warnings, and resulting revision.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-067 — Batch edit tools

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results. Ordered parameterised operations, target selection/query, failure policy, per-item result, and reusable preset version.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local. Batch work uses bounded concurrency and resumable per-item jobs when processing is required.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`, `C-PRESET`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `write`, `job`, `teach`. `apply_batch` accepts an explicit target list/query, typed operation, failure/atomicity policy, and dry-run flag; it returns a transaction or asynchronous job with per-item results.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-068 — Transactional multi-edit operations

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `write`, `teach`. `apply_transaction` validates the complete ordered operation set before commit and returns one transaction/undo token, resulting revision, per-operation results, and rollback-safe failure.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-069 — Dry-run or proposal mode

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `teach`. `propose_transaction` performs validation and impact calculation without mutating the project; it returns normalized operations, assumptions, affected IDs/ranges, warnings, preview revision, and an expiring proposal ID.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-070 — Human-readable change summary

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `teach`. `summarize_transaction` returns actor, intent, affected objects/time ranges, before/after parameter values, warnings, and the transaction/undo token in novice-readable language.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-071 — Tool-level undo tokens or transaction IDs

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results. Inverse or replayable operation data and transaction dependency checks.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `write`, `teach`. Every mutation returns an immutable transaction ID; `inspect_transaction` explains it and `undo_transaction` reverts it or returns a structured dependency conflict.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-072 — Preview-render tool

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering. Bounded, cancellable render request keyed by project revision, viewport/time, quality, and capability profile.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`, `C-CACHE`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `job`. `preview_revision` accepts revision, frame/time or image region, size, and quality; it returns a bounded preview immediately or a job ID plus exact revision and capability warnings.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-073 — Selection and focus tool

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`, `C-A11Y`, `C-SELECTION`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `navigate`, `teach`. `inspect_selection`, `set_selection`, and `focus_ui` use stable creative-object and semantic-control IDs; results distinguish selection/navigation from project mutations.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-074 — Explain-this-edit tool

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `teach`, `navigate`. `explain_edit` accepts a transaction, effect, property, or selected object and returns purpose, current value, visual consequence, dependencies, and an optional UI focus target without changing the project.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-075 — Guided teaching/highlight mode

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `teach`, `navigate`. `start_guided_step`, `focus_ui`, and `complete_guided_step` reveal/highlight controls and verify state while keeping edit execution separate unless the user explicitly asks the agent to act.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-076 — Capability discovery and schema versioning

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`. `get_capabilities` returns tool/schema versions, supported operations/formats, local versus remote availability, limits, and required permissions for the current page/project/device.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-077 — Structured validation and actionable errors

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`. All tools return field paths, error codes, expected ranges/enums, capability/permission requirements, conflicting IDs, and safe recovery suggestions; validation itself never mutates state.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-078 — Long-running job progress and cancellation

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results. Job ID/type, inputs, capability requirements, state, progress, lease, cancellation, retry count, outputs, and structured failure.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `write`, `job`. `get_job_status` returns monotonic state, progress/stage, worker capability, retry and outputs; `cancel_job` is idempotent and returns whether cancellation was accepted or work already completed.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

### SH-079 — Permission gates for upload, external sharing, and destructive edits

- **Classification:** Shared → Automation, WebMCP, and agent collaboration; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Tool registry, versioned JSON schemas, capability flags, page/project context, transactions, proposals, permissions, jobs, summaries, and verification results. Actor identity, authorization decision, consequence summary, and confirmation/audit state.
- **Compute — browser/interactive:** Low–moderate browser CPU for schema validation and command dispatch; preview tools may invoke bounded GPU/worker rendering.
- **Compute — remote/final:** Only asynchronous operations delegate to CPU/GPU workers through the job system; tool registration remains page-local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; audit/transaction records in project history; job state in queue/database; previews use Derived previews/proxies/masks/waveforms in OPFS cache and object storage.
- **UI requirements:** Site-tools status, proposal/change review, permission dialogs, progress/cancel UI, highlighted controls, summaries, and undo affordances.
- **Application component dependencies:** `C-WEBMCP`, `C-COMMAND`, `C-HISTORY`, `C-FOCUS`, `C-PERMISSION`, `C-JOBS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Top-level JavaScript WebMCP registration, strict JSON Schema, stable tool names, structured results, application command reuse, and capability detection.
- **WebMCP scope:** `read`, `confirm`. Tools return a structured pending-action summary naming data, destination, consequence, and required permission; the gate cannot be bypassed by another tool result or page-provided instruction.
- **Fallback/constraint:** Without WebMCP support, preserve the complete human interface; reject unavailable tools with structured capability and recovery information.

## Collaboration, review, and accessibility

### SH-081 — Shareable read-only preview

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives. Actor identity, authorization decision, consequence summary, and confirmation/audit state.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work. Bounded, cancellable render request keyed by project revision, viewport/time, quality, and capability profile.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`, `C-CACHE`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`, `confirm`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Mark side effects explicitly and return permission/confirmation requirements before transmission, deletion, or publishing. Return revision, time/region, quality, warnings, and a verifiable preview reference rather than claiming success generically.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-082 — Comments anchored to objects, regions, or timecodes

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives. Comment text, author, status/thread, revision, and object/region/time anchor with migration metadata. Rational time or source/project timecode, duration, name, color, comment, and anchor target.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`, `C-TIMELINE`, `C-METADATA`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. `add_comment`, `reply_or_resolve_comment`, and `list_comments`; return exact anchor and revision. `list_markers`, `add_or_update_marker`, and `navigate_to_time`; return normalized frame/timecode.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-083 — Roles and permissions

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives. Actor identity, authorization decision, consequence summary, and confirmation/audit state.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`, `confirm`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Mark side effects explicitly and return permission/confirmation requirements before transmission, deletion, or publishing.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-084 — Complete keyboard operation

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-085 — Semantic controls and screen-reader labels

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-086 — Visible focus and predictable tab order

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-087 — Reduced-motion mode

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Core**; browser difficulty **Low**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-088 — High-contrast mode and non-color status indicators

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`, `C-COLOR`, `C-EFFECT`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

### SH-089 — Captioned tutorials and accessible media previews

- **Classification:** Shared → Collaboration, review, and accessibility; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Actors, roles, permissions, share tokens, comments/anchors, project revisions, accessibility preferences, focus state, and tutorial alternatives. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Low–moderate browser CPU; anchored visual/time comments and accessible canvas/timeline alternatives add moderate state and overlay work. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents. Bounded, cancellable render request keyed by project revision, viewport/time, quality, and capability profile.
- **Compute — remote/final:** Low CPU/I/O for sharing, permissions, comment persistence, proxy delivery, and optional review renders.
- **Storage and data movement:** Cloud project metadata/revisions when persistence or sharing is enabled; Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies in object storage; accessibility preferences locally and optionally account-synced.
- **UI requirements:** Share/review pages, comment pins and threads, role editor, keyboard alternatives, semantic labels, focus states, contrast controls, and captioned learning UI.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-A11Y`, `C-FOCUS`, `C-PROJECT`, `C-PREVIEW`, `C-TEXT`, `C-CACHE`.
- **Technical/runtime dependencies:** ARIA/semantic HTML, focus management, keyboard command model, prefers-reduced-motion/contrast, signed review URLs, revision-aware anchors.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_review_state`, `manage_comment`, `manage_share`, `set_accessibility_preference`, `focus_ui`, and `explain_control`; return revision/anchor/permission state. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings. Return revision, time/region, quality, warnings, and a verifiable preview reference rather than claiming success generically.
- **Fallback/constraint:** Offer read-only rendered previews and textual object/time descriptions when editable canvas/timeline interaction cannot be made equivalent.

# Photo capabilities

## Document and canvas operations

### PH-001 — Create documents with dimensions, resolution, orientation, and background

- **Classification:** Photo → Document and canvas operations; necessity **Foundational**; browser difficulty **Low**.
- **Project/data requirements:** Photo document dimensions, resolution metadata, orientation, background, canvas bounds, artboards, crop/geometry operations, and resampling parameters.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for resampling and geometry; preview uses reduced-resolution tiles and cancellable updates.
- **Compute — remote/final:** Optional CPU/GPU final image render for large documents, packages, or high-quality resampling.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; tiled/resampled caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** New-document dialog, canvas/artboard panel, crop/straighten overlays, transform handles, numeric size/resolution controls, and comparison preview.
- **Application component dependencies:** `C-PROJECT`, `C-IMAGE`, `C-CANVAS`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Image decoders, Canvas/WebGL/WebGPU, high-quality resampling kernels, colour-aware alpha handling, tile pyramids.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_document`, `apply_document_operation`, `preview_revision`, `focus_ui`, and `explain_parameter`; return new bounds/resolution and transaction ID. Feature discriminator: `operationType="create_documents_with_dimensions_resolution_orientation_and_background"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Cap preview resolution and delegate full-quality processing when memory limits are exceeded; preserve editable parameters.

### PH-002 — Resize image with resampling controls

- **Classification:** Photo → Document and canvas operations; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Photo document dimensions, resolution metadata, orientation, background, canvas bounds, artboards, crop/geometry operations, and resampling parameters.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for resampling and geometry; preview uses reduced-resolution tiles and cancellable updates. Worker/GPU resampling with a quick preview kernel and high-quality final kernel.
- **Compute — remote/final:** Optional CPU/GPU final image render for large documents, packages, or high-quality resampling.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; tiled/resampled caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** New-document dialog, canvas/artboard panel, crop/straighten overlays, transform handles, numeric size/resolution controls, and comparison preview.
- **Application component dependencies:** `C-PROJECT`, `C-IMAGE`, `C-CANVAS`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Image decoders, Canvas/WebGL/WebGPU, high-quality resampling kernels, colour-aware alpha handling, tile pyramids. Nearest, bilinear/bicubic or higher-quality resampling, alpha correctness, downsample prefiltering, and memory tiling.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_document`, `apply_document_operation`, `preview_revision`, `focus_ui`, and `explain_parameter`; return new bounds/resolution and transaction ID. Require target dimensions/resolution and resampling policy; return resulting pixel dimensions and estimate.
- **Fallback/constraint:** Cap preview resolution and delegate full-quality processing when memory limits are exceeded; preserve editable parameters.

### PH-003 — Resize canvas independently of image

- **Classification:** Photo → Document and canvas operations; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Photo document dimensions, resolution metadata, orientation, background, canvas bounds, artboards, crop/geometry operations, and resampling parameters.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for resampling and geometry; preview uses reduced-resolution tiles and cancellable updates.
- **Compute — remote/final:** Optional CPU/GPU final image render for large documents, packages, or high-quality resampling.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; tiled/resampled caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** New-document dialog, canvas/artboard panel, crop/straighten overlays, transform handles, numeric size/resolution controls, and comparison preview.
- **Application component dependencies:** `C-PROJECT`, `C-IMAGE`, `C-CANVAS`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Image decoders, Canvas/WebGL/WebGPU, high-quality resampling kernels, colour-aware alpha handling, tile pyramids.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_document`, `apply_document_operation`, `preview_revision`, `focus_ui`, and `explain_parameter`; return new bounds/resolution and transaction ID. Feature discriminator: `operationType="resize_canvas_independently_of_image"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Cap preview resolution and delegate full-quality processing when memory limits are exceeded; preserve editable parameters.

### PH-004 — Crop, straighten, rotate, and flip

- **Classification:** Photo → Document and canvas operations; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Photo document dimensions, resolution metadata, orientation, background, canvas bounds, artboards, crop/geometry operations, and resampling parameters.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for resampling and geometry; preview uses reduced-resolution tiles and cancellable updates.
- **Compute — remote/final:** Optional CPU/GPU final image render for large documents, packages, or high-quality resampling.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; tiled/resampled caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** New-document dialog, canvas/artboard panel, crop/straighten overlays, transform handles, numeric size/resolution controls, and comparison preview.
- **Application component dependencies:** `C-PROJECT`, `C-IMAGE`, `C-CANVAS`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Image decoders, Canvas/WebGL/WebGPU, high-quality resampling kernels, colour-aware alpha handling, tile pyramids.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_document`, `apply_document_operation`, `preview_revision`, `focus_ui`, and `explain_parameter`; return new bounds/resolution and transaction ID. Feature discriminator: `operationType="crop_straighten_rotate_and_flip"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Cap preview resolution and delegate full-quality processing when memory limits are exceeded; preserve editable parameters.

### PH-005 — Perspective crop and keystone correction

- **Classification:** Photo → Document and canvas operations; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Photo document dimensions, resolution metadata, orientation, background, canvas bounds, artboards, crop/geometry operations, and resampling parameters.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for resampling and geometry; preview uses reduced-resolution tiles and cancellable updates. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling.
- **Compute — remote/final:** Optional CPU/GPU final image render for large documents, packages, or high-quality resampling. Full-resolution worker render avoids browser texture and memory ceilings.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; tiled/resampled caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** New-document dialog, canvas/artboard panel, crop/straighten overlays, transform handles, numeric size/resolution controls, and comparison preview.
- **Application component dependencies:** `C-PROJECT`, `C-IMAGE`, `C-CANVAS`, `C-TRANSFORM`, `C-COMPOSITOR`, `C-PREVIEW`, `C-EXPORT`, `C-EFFECT`.
- **Technical/runtime dependencies:** Image decoders, Canvas/WebGL/WebGPU, high-quality resampling kernels, colour-aware alpha handling, tile pyramids.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_document`, `apply_document_operation`, `preview_revision`, `focus_ui`, and `explain_parameter`; return new bounds/resolution and transaction ID. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings.
- **Fallback/constraint:** Cap preview resolution and delegate full-quality processing when memory limits are exceeded; preserve editable parameters.

## Layers and compositing

### PH-007 — Pixel layers

- **Classification:** Photo → Layers and compositing; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance. Tiled pixel/channel store, dimensions, format/precision, alpha semantics, dirty regions, and layer/channel references.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download. Potentially large tile blobs and change deltas in OPFS; avoid embedding pixel data in project JSON.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. Operate on layer/channel IDs and regions; never transfer complete pixel buffers through tool results.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-008 — Layer groups and nested groups

- **Classification:** Photo → Layers and compositing; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. Feature discriminator: `operationType="layer_groups_and_nested_groups"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-009 — Layer masks

- **Classification:** Photo → Layers and compositing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`, `C-SELECTION`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-010 — Vector masks

- **Classification:** Photo → Layers and compositing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes. Path commands/shape primitives, viewBox/coordinate space, fills, strokes, transforms, grouping, and import sanitization.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`, `C-SELECTION`, `C-VECTOR`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation. SVG sanitization, path parsing/tessellation, boolean geometry, antialiasing, and export fidelity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds. `inspect_vector_object`, `add_or_update_shape`, and `import_or_export_svg`; return bounds and unsupported SVG features.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-011 — Clipping masks

- **Classification:** Photo → Layers and compositing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`, `C-SELECTION`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-012 — Adjustment layers

- **Classification:** Photo → Layers and compositing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. Feature discriminator: `operationType="adjustment_layers"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-013 — Fill layers

- **Classification:** Photo → Layers and compositing; necessity **Advanced**; browser difficulty **Moderate**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance. Fill type, colour/gradient stops, transform, tolerance, target region, blend, and opacity.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`, `C-VECTOR`, `C-BRUSH`, `C-PRESET`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. `apply_fill` with explicit target, fill definition, and tolerance; return affected bounds/pixels estimate.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-014 — Layer styles

- **Classification:** Photo → Layers and compositing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`, `C-PRESET`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

### PH-015 — Channels and alpha channels

- **Classification:** Photo → Layers and compositing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Ordered layer tree, layer type/source, transforms, masks, clipping, blend/effect state, channels, visibility, and group inheritance. Tiled pixel/channel store, dimensions, format/precision, alpha semantics, dirty regions, and layer/channel references.
- **Compute — browser/interactive:** High GPU/worker compute for tiled compositing, masks, blend modes, live effects, and cache invalidation.
- **Compute — remote/final:** CPU/GPU final compositor for full-resolution flattening/export and unsupported effects.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; pixel tiles/channel data in local media/cache; intermediate composites in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download. Potentially large tile blobs and change deltas in OPFS; avoid embedding pixel data in project JSON.
- **UI requirements:** Layers tree, visibility/lock controls, thumbnails, drag reorder/nesting, mask/channel panels, effect inspector, and direct canvas selection.
- **Application component dependencies:** `C-PROJECT`, `C-COMPOSITOR`, `C-IMAGE`, `C-MASK`, `C-EFFECT`, `C-TRANSFORM`, `C-CACHE`, `C-EXPORT`.
- **Technical/runtime dependencies:** Premultiplied-alpha rules, colour-space-aware blending, tiled backing store, GPU texture budgets, hierarchical invalidation.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_layers`, `apply_layer_operation`, `reorder_or_group_layers`, `apply_mask_or_effect`, `set_selection`, and `preview_revision`; return affected layer IDs. Operate on layer/channel IDs and regions; never transfer complete pixel buffers through tool results.
- **Fallback/constraint:** Flatten only for display/export when a layer type is unsupported locally; retain the editable graph for compatible or remote rendering.

## Selection and masking

### PH-016 — Rectangular and elliptical marquee

- **Classification:** Photo → Selection and masking; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Active selection map/path, combination mode, tolerance, feather, refinement settings, saved selections, and mask output target. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for pixel classification, edge following, morphology, feathering, previews, and marching-ants overlays.
- **Compute — remote/final:** Optional GPU/ML worker for high-resolution refinement or intelligent subject/edge analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; selection alpha maps and previews in Memory/OPFS scratch data governed by quota and LRU eviction; saved selections/masks in project/local storage.
- **UI requirements:** Selection toolbar, canvas drawing/handles, tolerance/refinement inspector, overlay modes, select-and-mask workspace, and save/load controls.
- **Application component dependencies:** `C-SELECTION`, `C-MASK`, `C-IMAGE`, `C-CANVAS`, `C-BRUSH`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Worker image kernels, edge detection, colour-distance calculations, morphological operations, vector/raster conversion, GPU overlays.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `create_or_modify_selection`, `selection_to_mask`, `set_selection_target`, `preview_revision`, and `explain_selection`; return bounds, coverage, and transaction ID. Require target layer/composite and explicit add/subtract/intersect mode; return bounds and approximate coverage.
- **Fallback/constraint:** Use manual geometric/lasso selection when advanced edge analysis is unavailable; allow remote refinement without blocking local editing.

### PH-017 — Freehand, polygonal, and magnetic lasso

- **Classification:** Photo → Selection and masking; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Active selection map/path, combination mode, tolerance, feather, refinement settings, saved selections, and mask output target. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for pixel classification, edge following, morphology, feathering, previews, and marching-ants overlays.
- **Compute — remote/final:** Optional GPU/ML worker for high-resolution refinement or intelligent subject/edge analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; selection alpha maps and previews in Memory/OPFS scratch data governed by quota and LRU eviction; saved selections/masks in project/local storage.
- **UI requirements:** Selection toolbar, canvas drawing/handles, tolerance/refinement inspector, overlay modes, select-and-mask workspace, and save/load controls.
- **Application component dependencies:** `C-SELECTION`, `C-MASK`, `C-IMAGE`, `C-CANVAS`, `C-BRUSH`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Worker image kernels, edge detection, colour-distance calculations, morphological operations, vector/raster conversion, GPU overlays.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `create_or_modify_selection`, `selection_to_mask`, `set_selection_target`, `preview_revision`, and `explain_selection`; return bounds, coverage, and transaction ID. Require target layer/composite and explicit add/subtract/intersect mode; return bounds and approximate coverage.
- **Fallback/constraint:** Use manual geometric/lasso selection when advanced edge analysis is unavailable; allow remote refinement without blocking local editing.

### PH-018 — Magic wand and contiguous color selection

- **Classification:** Photo → Selection and masking; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Active selection map/path, combination mode, tolerance, feather, refinement settings, saved selections, and mask output target. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for pixel classification, edge following, morphology, feathering, previews, and marching-ants overlays.
- **Compute — remote/final:** Optional GPU/ML worker for high-resolution refinement or intelligent subject/edge analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; selection alpha maps and previews in Memory/OPFS scratch data governed by quota and LRU eviction; saved selections/masks in project/local storage.
- **UI requirements:** Selection toolbar, canvas drawing/handles, tolerance/refinement inspector, overlay modes, select-and-mask workspace, and save/load controls.
- **Application component dependencies:** `C-SELECTION`, `C-MASK`, `C-IMAGE`, `C-CANVAS`, `C-BRUSH`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Worker image kernels, edge detection, colour-distance calculations, morphological operations, vector/raster conversion, GPU overlays.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `create_or_modify_selection`, `selection_to_mask`, `set_selection_target`, `preview_revision`, and `explain_selection`; return bounds, coverage, and transaction ID. Require target layer/composite and explicit add/subtract/intersect mode; return bounds and approximate coverage.
- **Fallback/constraint:** Use manual geometric/lasso selection when advanced edge analysis is unavailable; allow remote refinement without blocking local editing.

### PH-019 — Color-range and luminance-range selection

- **Classification:** Photo → Selection and masking; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Active selection map/path, combination mode, tolerance, feather, refinement settings, saved selections, and mask output target. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for pixel classification, edge following, morphology, feathering, previews, and marching-ants overlays.
- **Compute — remote/final:** Optional GPU/ML worker for high-resolution refinement or intelligent subject/edge analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; selection alpha maps and previews in Memory/OPFS scratch data governed by quota and LRU eviction; saved selections/masks in project/local storage.
- **UI requirements:** Selection toolbar, canvas drawing/handles, tolerance/refinement inspector, overlay modes, select-and-mask workspace, and save/load controls.
- **Application component dependencies:** `C-SELECTION`, `C-MASK`, `C-IMAGE`, `C-CANVAS`, `C-BRUSH`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Worker image kernels, edge detection, colour-distance calculations, morphological operations, vector/raster conversion, GPU overlays.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `create_or_modify_selection`, `selection_to_mask`, `set_selection_target`, `preview_revision`, and `explain_selection`; return bounds, coverage, and transaction ID. Require target layer/composite and explicit add/subtract/intersect mode; return bounds and approximate coverage.
- **Fallback/constraint:** Use manual geometric/lasso selection when advanced edge analysis is unavailable; allow remote refinement without blocking local editing.

### PH-020 — Select-and-mask workspace

- **Classification:** Photo → Selection and masking; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Active selection map/path, combination mode, tolerance, feather, refinement settings, saved selections, and mask output target. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for pixel classification, edge following, morphology, feathering, previews, and marching-ants overlays. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** Optional GPU/ML worker for high-resolution refinement or intelligent subject/edge analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; selection alpha maps and previews in Memory/OPFS scratch data governed by quota and LRU eviction; saved selections/masks in project/local storage.
- **UI requirements:** Selection toolbar, canvas drawing/handles, tolerance/refinement inspector, overlay modes, select-and-mask workspace, and save/load controls.
- **Application component dependencies:** `C-SELECTION`, `C-MASK`, `C-IMAGE`, `C-CANVAS`, `C-BRUSH`, `C-COMMAND`, `C-PREVIEW`, `C-COMPOSITOR`.
- **Technical/runtime dependencies:** Worker image kernels, edge detection, colour-distance calculations, morphological operations, vector/raster conversion, GPU overlays.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `create_or_modify_selection`, `selection_to_mask`, `set_selection_target`, `preview_revision`, and `explain_selection`; return bounds, coverage, and transaction ID. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds.
- **Fallback/constraint:** Use manual geometric/lasso selection when advanced edge analysis is unavailable; allow remote refinement without blocking local editing.

### PH-021 — Save, load, transform, expand, contract, smooth, and border selections

- **Classification:** Photo → Selection and masking; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Active selection map/path, combination mode, tolerance, feather, refinement settings, saved selections, and mask output target. Non-destructive viewport-only transform and display mode, separate from document transforms. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID. Clip gain, track fader/pan, monitoring mute/solo, channel/bus target, and optional automation.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for pixel classification, edge following, morphology, feathering, previews, and marching-ants overlays.
- **Compute — remote/final:** Optional GPU/ML worker for high-resolution refinement or intelligent subject/edge analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; selection alpha maps and previews in Memory/OPFS scratch data governed by quota and LRU eviction; saved selections/masks in project/local storage.
- **UI requirements:** Selection toolbar, canvas drawing/handles, tolerance/refinement inspector, overlay modes, select-and-mask workspace, and save/load controls.
- **Application component dependencies:** `C-SELECTION`, `C-MASK`, `C-IMAGE`, `C-CANVAS`, `C-BRUSH`, `C-COMMAND`, `C-PREVIEW`, `C-AUDIO`.
- **Technical/runtime dependencies:** Worker image kernels, edge detection, colour-distance calculations, morphological operations, vector/raster conversion, GPU overlays.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `create_or_modify_selection`, `selection_to_mask`, `set_selection_target`, `preview_revision`, and `explain_selection`; return bounds, coverage, and transaction ID. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits. Require target layer/composite and explicit add/subtract/intersect mode; return bounds and approximate coverage. `apply_audio_mix_operation` requires clip/track ID and parameter; return effective state and clipping warnings.
- **Fallback/constraint:** Use manual geometric/lasso selection when advanced edge analysis is unavailable; allow remote refinement without blocking local editing.

### PH-022 — Selection from layer transparency or path

- **Classification:** Photo → Selection and masking; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Active selection map/path, combination mode, tolerance, feather, refinement settings, saved selections, and mask output target. Path commands/shape primitives, viewBox/coordinate space, fills, strokes, transforms, grouping, and import sanitization. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID.
- **Compute — browser/interactive:** Moderate–high worker CPU/GPU for pixel classification, edge following, morphology, feathering, previews, and marching-ants overlays.
- **Compute — remote/final:** Optional GPU/ML worker for high-resolution refinement or intelligent subject/edge analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; selection alpha maps and previews in Memory/OPFS scratch data governed by quota and LRU eviction; saved selections/masks in project/local storage.
- **UI requirements:** Selection toolbar, canvas drawing/handles, tolerance/refinement inspector, overlay modes, select-and-mask workspace, and save/load controls.
- **Application component dependencies:** `C-SELECTION`, `C-MASK`, `C-IMAGE`, `C-CANVAS`, `C-BRUSH`, `C-COMMAND`, `C-PREVIEW`, `C-VECTOR`.
- **Technical/runtime dependencies:** Worker image kernels, edge detection, colour-distance calculations, morphological operations, vector/raster conversion, GPU overlays. SVG sanitization, path parsing/tessellation, boolean geometry, antialiasing, and export fidelity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_selection`, `create_or_modify_selection`, `selection_to_mask`, `set_selection_target`, `preview_revision`, and `explain_selection`; return bounds, coverage, and transaction ID. `inspect_vector_object`, `add_or_update_shape`, and `import_or_export_svg`; return bounds and unsupported SVG features. Require target layer/composite and explicit add/subtract/intersect mode; return bounds and approximate coverage.
- **Fallback/constraint:** Use manual geometric/lasso selection when advanced edge analysis is unavailable; allow remote refinement without blocking local editing.

## Transform, distortion, and geometry

### PH-023 — Free transform with numeric controls

- **Classification:** Photo → Transform, distortion, and geometry; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Transform matrices, pivot, interpolation, warp mesh/control points, perspective geometry, source bounds, and repeat/duplication operation.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for mesh generation, inverse mapping, resampling, and hit testing.
- **Compute — remote/final:** CPU/GPU full-resolution resampling for final output or memory-heavy warps.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; transformed tile caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Transform bounding box, pivot and mesh handles, numeric inspector, mode controls, commit/cancel, and before/after preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-IMAGE`, `C-CANVAS`, `C-COMMAND`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Matrix math, mesh warping, inverse sampling, antialiasing, high-quality interpolation, GPU texture/render targets.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_transform`, `apply_transform`, `repeat_transform`, `preview_revision`, `focus_ui`, and `explain_parameter`; return matrix/mesh and affected IDs. Feature discriminator: `operationType="free_transform_with_numeric_controls"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Preview with a lower-resolution mesh and delegate high-quality rasterisation when local memory/GPU limits are reached.

### PH-024 — Warp transform

- **Classification:** Photo → Transform, distortion, and geometry; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Transform matrices, pivot, interpolation, warp mesh/control points, perspective geometry, source bounds, and repeat/duplication operation.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for mesh generation, inverse mapping, resampling, and hit testing. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling.
- **Compute — remote/final:** CPU/GPU full-resolution resampling for final output or memory-heavy warps. Full-resolution worker render avoids browser texture and memory ceilings.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; transformed tile caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Transform bounding box, pivot and mesh handles, numeric inspector, mode controls, commit/cancel, and before/after preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-IMAGE`, `C-CANVAS`, `C-COMMAND`, `C-PREVIEW`, `C-EXPORT`, `C-EFFECT`.
- **Technical/runtime dependencies:** Matrix math, mesh warping, inverse sampling, antialiasing, high-quality interpolation, GPU texture/render targets.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_transform`, `apply_transform`, `repeat_transform`, `preview_revision`, `focus_ui`, and `explain_parameter`; return matrix/mesh and affected IDs. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings.
- **Fallback/constraint:** Preview with a lower-resolution mesh and delegate high-quality rasterisation when local memory/GPU limits are reached.

## Retouching and restoration

### PH-026 — Clone stamp

- **Classification:** Photo → Retouching and restoration; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stroke path, brush settings, sampled source/target, affected layer, tonal range, strength, and non-destructive retouch layer or patch data. Sample source point/layer, alignment behavior, stroke path, brush dynamics, and target retouch layer.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for brush dabs, local sampling/filtering, tile invalidation, and responsive stroke preview.
- **Compute — remote/final:** Optional GPU/ML worker for expensive detection or full-resolution replay; deterministic brush replay can remain local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; stroke/patch records plus touched pixel tiles in local storage; brush/tile caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Retouch toolbar, brush cursor, sample-point overlays, brush/strength inspector, pressure controls, and before/after preview.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Pointer Events, pressure data, tiled raster operations, sampling/interpolation, local image kernels, GPU texture updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_retouch_state`, `apply_retouch_stroke_or_region`, `set_sample_source`, `preview_revision`, and `explain_tool`; return stroke/patch and transaction IDs. Prefer region/path-based clone operations with source/target coordinates; freehand collaborative teaching can use UI focus rather than huge point arrays.
- **Fallback/constraint:** Offer manual controls when automatic detection is unavailable; cap brush resolution and replay strokes at full quality during export.

### PH-027 — Red-eye correction

- **Classification:** Photo → Retouching and restoration; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stroke path, brush settings, sampled source/target, affected layer, tonal range, strength, and non-destructive retouch layer or patch data.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for brush dabs, local sampling/filtering, tile invalidation, and responsive stroke preview. Small-region detection/correction in a worker with manual pupil size/darkening override.
- **Compute — remote/final:** Optional GPU/ML worker for expensive detection or full-resolution replay; deterministic brush replay can remain local. Optional vision worker for robust detection; not required for manual correction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; stroke/patch records plus touched pixel tiles in local storage; brush/tile caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Retouch toolbar, brush cursor, sample-point overlays, brush/strength inspector, pressure controls, and before/after preview.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-COMMAND`, `C-PREVIEW`, `C-ML`.
- **Technical/runtime dependencies:** Pointer Events, pressure data, tiled raster operations, sampling/interpolation, local image kernels, GPU texture updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_retouch_state`, `apply_retouch_stroke_or_region`, `set_sample_source`, `preview_revision`, and `explain_tool`; return stroke/patch and transaction IDs. `detect_red_eye` may propose regions; `apply_red_eye_correction` requires accepted regions and parameters.
- **Fallback/constraint:** Offer manual controls when automatic detection is unavailable; cap brush resolution and replay strokes at full quality during export.

### PH-028 — Dodge, burn, and sponge

- **Classification:** Photo → Retouching and restoration; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stroke path, brush settings, sampled source/target, affected layer, tonal range, strength, and non-destructive retouch layer or patch data. Target, stroke samples, pressure/dynamics, brush tip, spacing, strength/exposure, blend, and affected bounds.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for brush dabs, local sampling/filtering, tile invalidation, and responsive stroke preview.
- **Compute — remote/final:** Optional GPU/ML worker for expensive detection or full-resolution replay; deterministic brush replay can remain local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; stroke/patch records plus touched pixel tiles in local storage; brush/tile caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Retouch toolbar, brush cursor, sample-point overlays, brush/strength inspector, pressure controls, and before/after preview.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Pointer Events, pressure data, tiled raster operations, sampling/interpolation, local image kernels, GPU texture updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_retouch_state`, `apply_retouch_stroke_or_region`, `set_sample_source`, `preview_revision`, and `explain_tool`; return stroke/patch and transaction IDs. Use compact semantic stroke/region operations; return affected bounds and transaction ID, with `focus_ui` for teaching manual technique.
- **Fallback/constraint:** Offer manual controls when automatic detection is unavailable; cap brush resolution and replay strokes at full quality during export.

### PH-029 — Blur, sharpen, and smudge brushes

- **Classification:** Photo → Retouching and restoration; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stroke path, brush settings, sampled source/target, affected layer, tonal range, strength, and non-destructive retouch layer or patch data. Target, stroke samples, pressure/dynamics, brush tip, spacing, strength/exposure, blend, and affected bounds. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for brush dabs, local sampling/filtering, tile invalidation, and responsive stroke preview. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** Optional GPU/ML worker for expensive detection or full-resolution replay; deterministic brush replay can remain local.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; stroke/patch records plus touched pixel tiles in local storage; brush/tile caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Retouch toolbar, brush cursor, sample-point overlays, brush/strength inspector, pressure controls, and before/after preview.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-COMMAND`, `C-PREVIEW`, `C-EFFECT`.
- **Technical/runtime dependencies:** Pointer Events, pressure data, tiled raster operations, sampling/interpolation, local image kernels, GPU texture updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_retouch_state`, `apply_retouch_stroke_or_region`, `set_sample_source`, `preview_revision`, and `explain_tool`; return stroke/patch and transaction IDs. Use compact semantic stroke/region operations; return affected bounds and transaction ID, with `focus_ui` for teaching manual technique. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Offer manual controls when automatic detection is unavailable; cap brush resolution and replay strokes at full quality during export.

## Tonal and color adjustment

### PH-030 — Brightness and contrast

- **Classification:** Photo → Tonal and color adjustment; necessity **Foundational**; browser difficulty **Moderate**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`, `C-A11Y`, `C-FOCUS`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-031 — Exposure, offset, and gamma

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-032 — Levels with per-channel histograms

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Tiled pixel/channel store, dimensions, format/precision, alpha semantics, dirty regions, and layer/channel references. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews. Worker/GPU reduction over the visible frame/selection or audio window; cache by source revision and range.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download. Potentially large tile blobs and change deltas in OPFS; avoid embedding pixel data in project JSON.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`, `C-METADATA`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Operate on layer/channel IDs and regions; never transfer complete pixel buffers through tool results. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings. `inspect_histogram_or_meter` returns summarized bins/measurements and clipping/target diagnostics, not raw media.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-033 — Curves

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-034 — White balance and tint

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-035 — Hue, saturation, and lightness

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-036 — Vibrance

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-037 — Color balance

- **Classification:** Photo → Tonal and color adjustment; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-038 — Selective color

- **Classification:** Photo → Tonal and color adjustment; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-039 — Black-and-white conversion and channel mixing

- **Classification:** Photo → Tonal and color adjustment; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Tiled pixel/channel store, dimensions, format/precision, alpha semantics, dirty regions, and layer/channel references. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download. Potentially large tile blobs and change deltas in OPFS; avoid embedding pixel data in project JSON.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Operate on layer/channel IDs and regions; never transfer complete pixel buffers through tool results. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-040 — Gradient map

- **Classification:** Photo → Tonal and color adjustment; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Fill type, colour/gradient stops, transform, tolerance, target region, blend, and opacity. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`, `C-VECTOR`, `C-BRUSH`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. `apply_fill` with explicit target, fill definition, and tolerance; return affected bounds/pixels estimate. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-041 — Photo filter and color lookup/LUT

- **Classification:** Photo → Tonal and color adjustment; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-042 — Shadows/highlights recovery

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-043 — Replace color

- **Classification:** Photo → Tonal and color adjustment; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-044 — Posterize, threshold, invert, and equalize

- **Classification:** Photo → Tonal and color adjustment; necessity **Advanced**; browser difficulty **Moderate**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

### PH-045 — Histogram and clipping warnings

- **Classification:** Photo → Tonal and color adjustment; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Versioned adjustment node, colour space/profile, channel/range targeting, parameters, masks, histogram data, and clipping diagnostics. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** Moderate–high GPU for real-time shaders; worker CPU/GPU computes histograms and cached previews. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches. Worker/GPU reduction over the visible frame/selection or audio window; cache by source revision and range.
- **Compute — remote/final:** CPU/GPU full-resolution colour pipeline for export, large files, and exact parity with server rendering.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; histogram/preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; LUT/profile assets locally or in object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Adjustment inspector, sliders/curves/eyedroppers, histogram, channel/range selectors, presets, clipping overlays, and A/B preview.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`, `C-MASK`, `C-SELECTION`, `C-METADATA`.
- **Technical/runtime dependencies:** Linear/perceptual colour math, ICC/profile transforms, GPU shaders, histogram reduction, LUT parsing/interpolation, precision and gamut policy.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `apply_color_adjustment`, `sample_color`, `apply_color_preset`, `preview_revision`, and `explain_parameter`; return adjustment node and diagnostics. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds. `inspect_histogram_or_meter` returns summarized bins/measurements and clipping/target diagnostics, not raw media.
- **Fallback/constraint:** Use sRGB and reduced-resolution preview when advanced colour management is unavailable, while preserving parameters for full-quality export.

## RAW, lens, and photographic workflow

### PH-046 — Manual distortion and perspective correction

- **Classification:** Photo → RAW, lens, and photographic workflow; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Source profile, camera/creative profile, lens/perspective parameters, sharpening settings, synchronization selection, and per-photo overrides.
- **Compute — browser/interactive:** High worker CPU/GPU for RAW decode where available, lens geometry, sharpening, profile transforms, and batch preview generation. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling.
- **Compute — remote/final:** CPU/GPU worker is the reliable path for unsupported RAW formats, large batches, and final-quality processing. Full-resolution worker render avoids browser texture and memory ceilings.
- **Storage and data movement:** Original media in local file handles or object storage; profile/lens data and previews in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; settings in project state; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Photographic adjustment panel, profile browser, lens/geometry overlay, sharpening preview, filmstrip, and batch-sync dialog.
- **Application component dependencies:** `C-IMPORT`, `C-CODEC`, `C-IMAGE`, `C-COLOR`, `C-TRANSFORM`, `C-PROXY`, `C-JOBS`, `C-WORKER`, `C-EFFECT`.
- **Technical/runtime dependencies:** RAW decoder/WASM or server library, camera/lens profile database, high-bit-depth pipeline, resampling and sharpening kernels.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_photo_metadata`, `apply_photo_profile_or_geometry`, `synchronize_adjustments`, `start_photo_process_job`, and `preview_revision`; return per-asset results. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings.
- **Fallback/constraint:** Generate a compatible proxy when RAW decode is unavailable locally; retain the RAW original for worker-side export.

### PH-047 — Sharpening and output sharpening

- **Classification:** Photo → RAW, lens, and photographic workflow; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Source profile, camera/creative profile, lens/perspective parameters, sharpening settings, synchronization selection, and per-photo overrides. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High worker CPU/GPU for RAW decode where available, lens geometry, sharpening, profile transforms, and batch preview generation. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU worker is the reliable path for unsupported RAW formats, large batches, and final-quality processing.
- **Storage and data movement:** Original media in local file handles or object storage; profile/lens data and previews in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; settings in project state; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Photographic adjustment panel, profile browser, lens/geometry overlay, sharpening preview, filmstrip, and batch-sync dialog.
- **Application component dependencies:** `C-IMPORT`, `C-CODEC`, `C-IMAGE`, `C-COLOR`, `C-TRANSFORM`, `C-PROXY`, `C-JOBS`, `C-WORKER`, `C-EFFECT`.
- **Technical/runtime dependencies:** RAW decoder/WASM or server library, camera/lens profile database, high-bit-depth pipeline, resampling and sharpening kernels.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_photo_metadata`, `apply_photo_profile_or_geometry`, `synchronize_adjustments`, `start_photo_process_job`, and `preview_revision`; return per-asset results. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Generate a compatible proxy when RAW decode is unavailable locally; retain the RAW original for worker-side export.

### PH-048 — Camera and creative profiles

- **Classification:** Photo → RAW, lens, and photographic workflow; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Source profile, camera/creative profile, lens/perspective parameters, sharpening settings, synchronization selection, and per-photo overrides.
- **Compute — browser/interactive:** High worker CPU/GPU for RAW decode where available, lens geometry, sharpening, profile transforms, and batch preview generation.
- **Compute — remote/final:** CPU/GPU worker is the reliable path for unsupported RAW formats, large batches, and final-quality processing.
- **Storage and data movement:** Original media in local file handles or object storage; profile/lens data and previews in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; settings in project state; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Photographic adjustment panel, profile browser, lens/geometry overlay, sharpening preview, filmstrip, and batch-sync dialog.
- **Application component dependencies:** `C-IMPORT`, `C-CODEC`, `C-IMAGE`, `C-COLOR`, `C-TRANSFORM`, `C-PROXY`, `C-JOBS`, `C-WORKER`.
- **Technical/runtime dependencies:** RAW decoder/WASM or server library, camera/lens profile database, high-bit-depth pipeline, resampling and sharpening kernels.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_photo_metadata`, `apply_photo_profile_or_geometry`, `synchronize_adjustments`, `start_photo_process_job`, and `preview_revision`; return per-asset results. Feature discriminator: `operationType="camera_and_creative_profiles"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Generate a compatible proxy when RAW decode is unavailable locally; retain the RAW original for worker-side export.

### PH-049 — Batch synchronization across photos

- **Classification:** Photo → RAW, lens, and photographic workflow; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Source profile, camera/creative profile, lens/perspective parameters, sharpening settings, synchronization selection, and per-photo overrides. Ordered parameterised operations, target selection/query, failure policy, per-item result, and reusable preset version.
- **Compute — browser/interactive:** High worker CPU/GPU for RAW decode where available, lens geometry, sharpening, profile transforms, and batch preview generation. Metadata/timecode alignment is light; waveform correlation is worker CPU and bounded by proxy audio.
- **Compute — remote/final:** CPU/GPU worker is the reliable path for unsupported RAW formats, large batches, and final-quality processing. Control-plane synchronization, conflict detection, revision exchange, and resumable media transfer. Batch work uses bounded concurrency and resumable per-item jobs when processing is required. CPU worker may correlate long audio or many sources.
- **Storage and data movement:** Original media in local file handles or object storage; profile/lens data and previews in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; settings in project state; Rendered outputs in temporary storage followed by object storage/download. Cloud revision/object records plus local pending-operation journal.
- **UI requirements:** Photographic adjustment panel, profile browser, lens/geometry overlay, sharpening preview, filmstrip, and batch-sync dialog.
- **Application component dependencies:** `C-IMPORT`, `C-CODEC`, `C-IMAGE`, `C-COLOR`, `C-TRANSFORM`, `C-PROXY`, `C-JOBS`, `C-WORKER`, `C-SYNC`, `C-CLOUD-STORE`, `C-PERMISSION`, `C-PRESET`, `C-COMMAND`, `C-AUDIO`, `C-METADATA`, `C-TIMELINE`.
- **Technical/runtime dependencies:** RAW decoder/WASM or server library, camera/lens profile database, high-bit-depth pipeline, resampling and sharpening kernels.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_photo_metadata`, `apply_photo_profile_or_geometry`, `synchronize_adjustments`, `start_photo_process_job`, and `preview_revision`; return per-asset results. Return synchronization/lock state and explicit conflict objects; never silently overwrite. `apply_batch` with dry-run, an explicit target set, an atomicity policy, and per-item results. `analyze_sync` returns proposed offsets/confidence; `apply_sync` commits explicit offsets transactionally.
- **Fallback/constraint:** Generate a compatible proxy when RAW decode is unavailable locally; retain the RAW original for worker-side export.

## Painting, brushes, and fills

### PH-050 — Brush, pencil, and eraser tools

- **Classification:** Photo → Painting, brushes, and fills; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stroke paths, brush-tip/preset parameters, dynamics, fill and gradient definitions, target layer, blend, and opacity. Target, stroke samples, pressure/dynamics, brush tip, spacing, strength/exposure, blend, and affected bounds.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for dab generation, rasterisation, gradients, fills, tolerance search, and tile updates.
- **Compute — remote/final:** Usually none; optional CPU/GPU full-resolution stroke replay for oversized documents or final export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; brush presets in Small versioned preset/template records locally and optionally in the account database; stroke records and pixel tiles locally; working caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Brush/fill toolbar, brush cursor and preview, preset browser, dynamics inspector, gradient handles, and colour controls.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-SELECTION`, `C-PRESET`, `C-CANVAS`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Pointer Events/pen data, spacing/interpolation, deterministic randomness, flood fill, gradient sampling, tiled raster updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_paint_state`, `apply_stroke`, `apply_fill_or_gradient`, `set_brush_preset`, `focus_ui`, and `explain_brush`; return stroke/fill operation and bounds. Use compact semantic stroke/region operations; return affected bounds and transaction ID, with `focus_ui` for teaching manual technique.
- **Fallback/constraint:** Ignore unsupported pen dynamics gracefully, preserve the stroke, and use mouse/touch controls or simplified brushes.

### PH-051 — Brush presets

- **Classification:** Photo → Painting, brushes, and fills; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Stroke paths, brush-tip/preset parameters, dynamics, fill and gradient definitions, target layer, blend, and opacity. Target, stroke samples, pressure/dynamics, brush tip, spacing, strength/exposure, blend, and affected bounds.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for dab generation, rasterisation, gradients, fills, tolerance search, and tile updates.
- **Compute — remote/final:** Usually none; optional CPU/GPU full-resolution stroke replay for oversized documents or final export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; brush presets in Small versioned preset/template records locally and optionally in the account database; stroke records and pixel tiles locally; working caches in Memory/OPFS scratch data governed by quota and LRU eviction. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Brush/fill toolbar, brush cursor and preview, preset browser, dynamics inspector, gradient handles, and colour controls.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-SELECTION`, `C-PRESET`, `C-CANVAS`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Pointer Events/pen data, spacing/interpolation, deterministic randomness, flood fill, gradient sampling, tiled raster updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_paint_state`, `apply_stroke`, `apply_fill_or_gradient`, `set_brush_preset`, `focus_ui`, and `explain_brush`; return stroke/fill operation and bounds. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters. Use compact semantic stroke/region operations; return affected bounds and transaction ID, with `focus_ui` for teaching manual technique.
- **Fallback/constraint:** Ignore unsupported pen dynamics gracefully, preserve the stroke, and use mouse/touch controls or simplified brushes.

### PH-052 — Pen pressure, tilt, rotation, and velocity dynamics

- **Classification:** Photo → Painting, brushes, and fills; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Stroke paths, brush-tip/preset parameters, dynamics, fill and gradient definitions, target layer, blend, and opacity.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for dab generation, rasterisation, gradients, fills, tolerance search, and tile updates.
- **Compute — remote/final:** Usually none; optional CPU/GPU full-resolution stroke replay for oversized documents or final export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; brush presets in Small versioned preset/template records locally and optionally in the account database; stroke records and pixel tiles locally; working caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Brush/fill toolbar, brush cursor and preview, preset browser, dynamics inspector, gradient handles, and colour controls.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-SELECTION`, `C-PRESET`, `C-CANVAS`, `C-COMMAND`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Pointer Events/pen data, spacing/interpolation, deterministic randomness, flood fill, gradient sampling, tiled raster updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_paint_state`, `apply_stroke`, `apply_fill_or_gradient`, `set_brush_preset`, `focus_ui`, and `explain_brush`; return stroke/fill operation and bounds. Feature discriminator: `operationType="pen_pressure_tilt_rotation_and_velocity_dynamics"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Ignore unsupported pen dynamics gracefully, preserve the stroke, and use mouse/touch controls or simplified brushes.

### PH-054 — Gradient tool

- **Classification:** Photo → Painting, brushes, and fills; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stroke paths, brush-tip/preset parameters, dynamics, fill and gradient definitions, target layer, blend, and opacity. Fill type, colour/gradient stops, transform, tolerance, target region, blend, and opacity.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for dab generation, rasterisation, gradients, fills, tolerance search, and tile updates.
- **Compute — remote/final:** Usually none; optional CPU/GPU full-resolution stroke replay for oversized documents or final export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; brush presets in Small versioned preset/template records locally and optionally in the account database; stroke records and pixel tiles locally; working caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Brush/fill toolbar, brush cursor and preview, preset browser, dynamics inspector, gradient handles, and colour controls.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-SELECTION`, `C-PRESET`, `C-CANVAS`, `C-COMMAND`, `C-PREVIEW`, `C-VECTOR`.
- **Technical/runtime dependencies:** Pointer Events/pen data, spacing/interpolation, deterministic randomness, flood fill, gradient sampling, tiled raster updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_paint_state`, `apply_stroke`, `apply_fill_or_gradient`, `set_brush_preset`, `focus_ui`, and `explain_brush`; return stroke/fill operation and bounds. `apply_fill` with explicit target, fill definition, and tolerance; return affected bounds/pixels estimate.
- **Fallback/constraint:** Ignore unsupported pen dynamics gracefully, preserve the stroke, and use mouse/touch controls or simplified brushes.

### PH-055 — Paint bucket and tolerance-based fill

- **Classification:** Photo → Painting, brushes, and fills; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Stroke paths, brush-tip/preset parameters, dynamics, fill and gradient definitions, target layer, blend, and opacity. Fill type, colour/gradient stops, transform, tolerance, target region, blend, and opacity.
- **Compute — browser/interactive:** High-frequency GPU/worker compute for dab generation, rasterisation, gradients, fills, tolerance search, and tile updates.
- **Compute — remote/final:** Usually none; optional CPU/GPU full-resolution stroke replay for oversized documents or final export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; brush presets in Small versioned preset/template records locally and optionally in the account database; stroke records and pixel tiles locally; working caches in Memory/OPFS scratch data governed by quota and LRU eviction.
- **UI requirements:** Brush/fill toolbar, brush cursor and preview, preset browser, dynamics inspector, gradient handles, and colour controls.
- **Application component dependencies:** `C-BRUSH`, `C-IMAGE`, `C-SELECTION`, `C-PRESET`, `C-CANVAS`, `C-COMMAND`, `C-PREVIEW`, `C-VECTOR`.
- **Technical/runtime dependencies:** Pointer Events/pen data, spacing/interpolation, deterministic randomness, flood fill, gradient sampling, tiled raster updates.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_paint_state`, `apply_stroke`, `apply_fill_or_gradient`, `set_brush_preset`, `focus_ui`, and `explain_brush`; return stroke/fill operation and bounds. `apply_fill` with explicit target, fill definition, and tolerance; return affected bounds/pixels estimate.
- **Fallback/constraint:** Ignore unsupported pen dynamics gracefully, preserve the stroke, and use mouse/touch controls or simplified brushes.

## Filters and effects

### PH-057 — Gaussian, box, motion, radial, lens, and surface blur

- **Classification:** Photo → Filters and effects; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Ordered filter nodes, parameters, target layer/selection/mask, edge behavior, seed where stochastic, and cached intermediate dependencies. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU/worker compute for convolution, transforms, noise, displacement, and large-radius kernels; previews must be tiled and cancellable. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU worker handles full resolution, unsupported shaders, large kernels, and batch/final renders.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; filter intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; displacement/pattern assets in source storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Filter gallery/search, parameter inspector, canvas controls where geometric, live preview toggle, presets, progress, and A/B comparison.
- **Application component dependencies:** `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-PREVIEW`, `C-EXPORT`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU shaders/compute, separable convolution, FFT or multiscale algorithms where useful, seeded noise, tile halos, precision policy.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_filter`, `reorder_effect`, `preview_revision`, and `start_high_quality_render`; return effect node, warnings, and job ID when remote. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Use reduced-radius/resolution previews and preserve unsupported filter nodes for worker-side rendering.

### PH-058 — Unsharp mask, smart sharpen, and high-pass sharpening

- **Classification:** Photo → Filters and effects; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Ordered filter nodes, parameters, target layer/selection/mask, edge behavior, seed where stochastic, and cached intermediate dependencies. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU/worker compute for convolution, transforms, noise, displacement, and large-radius kernels; previews must be tiled and cancellable. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU worker handles full resolution, unsupported shaders, large kernels, and batch/final renders.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; filter intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; displacement/pattern assets in source storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Filter gallery/search, parameter inspector, canvas controls where geometric, live preview toggle, presets, progress, and A/B comparison.
- **Application component dependencies:** `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-PREVIEW`, `C-EXPORT`, `C-WORKER`, `C-MASK`, `C-SELECTION`.
- **Technical/runtime dependencies:** GPU shaders/compute, separable convolution, FFT or multiscale algorithms where useful, seeded noise, tile halos, precision policy.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_filter`, `reorder_effect`, `preview_revision`, and `start_high_quality_render`; return effect node, warnings, and job ID when remote. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Use reduced-radius/resolution previews and preserve unsupported filter nodes for worker-side rendering.

### PH-059 — Add/reduce noise, dust and scratches, median

- **Classification:** Photo → Filters and effects; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Ordered filter nodes, parameters, target layer/selection/mask, edge behavior, seed where stochastic, and cached intermediate dependencies. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU/worker compute for convolution, transforms, noise, displacement, and large-radius kernels; previews must be tiled and cancellable. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU worker handles full resolution, unsupported shaders, large kernels, and batch/final renders.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; filter intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; displacement/pattern assets in source storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Filter gallery/search, parameter inspector, canvas controls where geometric, live preview toggle, presets, progress, and A/B comparison.
- **Application component dependencies:** `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-PREVIEW`, `C-EXPORT`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU shaders/compute, separable convolution, FFT or multiscale algorithms where useful, seeded noise, tile halos, precision policy.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_filter`, `reorder_effect`, `preview_revision`, and `start_high_quality_render`; return effect node, warnings, and job ID when remote. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Use reduced-radius/resolution previews and preserve unsupported filter nodes for worker-side rendering.

### PH-060 — Distort, ripple, wave, twirl, spherize, and displacement

- **Classification:** Photo → Filters and effects; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Ordered filter nodes, parameters, target layer/selection/mask, edge behavior, seed where stochastic, and cached intermediate dependencies. Container/format, codec, stream/image properties, alpha/profile/metadata support, capability result, and conversion policy.
- **Compute — browser/interactive:** High GPU/worker compute for convolution, transforms, noise, displacement, and large-radius kernels; previews must be tiled and cancellable. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling. Probe support before decode/encode; demux/mux and format libraries run in a worker where browser-native support is incomplete.
- **Compute — remote/final:** CPU/GPU worker handles full resolution, unsupported shaders, large kernels, and batch/final renders. Full-resolution worker render avoids browser texture and memory ceilings. CPU media worker supplies the authoritative compatibility path and consistent encoding.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; filter intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; displacement/pattern assets in source storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Filter gallery/search, parameter inspector, canvas controls where geometric, live preview toggle, presets, progress, and A/B comparison.
- **Application component dependencies:** `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-PREVIEW`, `C-EXPORT`, `C-WORKER`, `C-TRANSFORM`, `C-CODEC`, `C-IMPORT`.
- **Technical/runtime dependencies:** GPU shaders/compute, separable convolution, FFT or multiscale algorithms where useful, seeded noise, tile halos, precision policy.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_filter`, `reorder_effect`, `preview_revision`, and `start_high_quality_render`; return effect node, warnings, and job ID when remote. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings. `inspect_format_support`, `import_media`, or `start_export_job`; return detected streams, substitutions/conversions, and output ID.
- **Fallback/constraint:** Use reduced-radius/resolution previews and preserve unsupported filter nodes for worker-side rendering.

### PH-061 — Pixelate, mosaic, crystallize, and halftone

- **Classification:** Photo → Filters and effects; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Ordered filter nodes, parameters, target layer/selection/mask, edge behavior, seed where stochastic, and cached intermediate dependencies. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU/worker compute for convolution, transforms, noise, displacement, and large-radius kernels; previews must be tiled and cancellable. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU worker handles full resolution, unsupported shaders, large kernels, and batch/final renders.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; filter intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; displacement/pattern assets in source storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Filter gallery/search, parameter inspector, canvas controls where geometric, live preview toggle, presets, progress, and A/B comparison.
- **Application component dependencies:** `C-EFFECT`, `C-IMAGE`, `C-COMPOSITOR`, `C-CACHE`, `C-PREVIEW`, `C-EXPORT`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU shaders/compute, separable convolution, FFT or multiscale algorithms where useful, seeded noise, tile halos, precision policy.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_filter`, `reorder_effect`, `preview_revision`, and `start_high_quality_render`; return effect node, warnings, and job ID when remote. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Use reduced-radius/resolution previews and preserve unsupported filter nodes for worker-side rendering.

## Photo formats, export, and print

### PH-062 — JPEG, PNG, WebP, AVIF, and GIF import/export

- **Classification:** Photo → Photo formats, export, and print; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Import/export specification, asset/frame selection, dimensions, colour/profile, alpha, format, quality, metadata, naming, and batch destinations. Container/format, codec, stream/image properties, alpha/profile/metadata support, capability result, and conversion policy.
- **Compute — browser/interactive:** Moderate–high worker CPU for encode/decode, resizing, previews, and packaging; hardware/browser support is capability-dependent. Probe support before decode/encode; demux/mux and format libraries run in a worker where browser-native support is incomplete.
- **Compute — remote/final:** CPU worker provides consistent format coverage, batch processing, large files, and final-quality encoding. CPU media worker supplies the authoritative compatibility path and consistent encoding.
- **Storage and data movement:** Original media in local file handles or object storage; export previews in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download; batch manifests and job state in project/database.
- **UI requirements:** Import options, export dialog, format/quality comparison, size estimate, batch naming/destination controls, progress, and download/print handoff.
- **Application component dependencies:** `C-IMPORT`, `C-CODEC`, `C-EXPORT`, `C-COLOR`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`.
- **Technical/runtime dependencies:** Image encoders/decoders, colour profiles, metadata writer, browser download/print APIs, and server codecs.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_export_capabilities`, `configure_export`, `preview_export`, `start_export_job`, `get_job_status`, and `cancel_job`; return size estimate, job, and output asset. `inspect_format_support`, `import_media`, or `start_export_job`; return detected streams, substitutions/conversions, and output ID.
- **Fallback/constraint:** Offer a universally supported PNG/JPEG path locally and route unsupported formats or oversized jobs to a worker.

### PH-064 — Export for web with format/quality preview

- **Classification:** Photo → Photo formats, export, and print; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Import/export specification, asset/frame selection, dimensions, colour/profile, alpha, format, quality, metadata, naming, and batch destinations.
- **Compute — browser/interactive:** Moderate–high worker CPU for encode/decode, resizing, previews, and packaging; hardware/browser support is capability-dependent. Bounded, cancellable render request keyed by project revision, viewport/time, quality, and capability profile.
- **Compute — remote/final:** CPU worker provides consistent format coverage, batch processing, large files, and final-quality encoding.
- **Storage and data movement:** Original media in local file handles or object storage; export previews in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download; batch manifests and job state in project/database.
- **UI requirements:** Import options, export dialog, format/quality comparison, size estimate, batch naming/destination controls, progress, and download/print handoff.
- **Application component dependencies:** `C-IMPORT`, `C-CODEC`, `C-EXPORT`, `C-COLOR`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PREVIEW`, `C-CACHE`.
- **Technical/runtime dependencies:** Image encoders/decoders, colour profiles, metadata writer, browser download/print APIs, and server codecs.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_export_capabilities`, `configure_export`, `preview_export`, `start_export_job`, `get_job_status`, and `cancel_job`; return size estimate, job, and output asset. Return revision, time/region, quality, warnings, and a verifiable preview reference rather than claiming success generically.
- **Fallback/constraint:** Offer a universally supported PNG/JPEG path locally and route unsupported formats or oversized jobs to a worker.

### PH-065 — Batch export and asset generation

- **Classification:** Photo → Photo formats, export, and print; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Import/export specification, asset/frame selection, dimensions, colour/profile, alpha, format, quality, metadata, naming, and batch destinations. Ordered parameterised operations, target selection/query, failure policy, per-item result, and reusable preset version.
- **Compute — browser/interactive:** Moderate–high worker CPU for encode/decode, resizing, previews, and packaging; hardware/browser support is capability-dependent.
- **Compute — remote/final:** CPU worker provides consistent format coverage, batch processing, large files, and final-quality encoding. Batch work uses bounded concurrency and resumable per-item jobs when processing is required.
- **Storage and data movement:** Original media in local file handles or object storage; export previews in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download; batch manifests and job state in project/database.
- **UI requirements:** Import options, export dialog, format/quality comparison, size estimate, batch naming/destination controls, progress, and download/print handoff.
- **Application component dependencies:** `C-IMPORT`, `C-CODEC`, `C-EXPORT`, `C-COLOR`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PRESET`, `C-COMMAND`.
- **Technical/runtime dependencies:** Image encoders/decoders, colour profiles, metadata writer, browser download/print APIs, and server codecs.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_export_capabilities`, `configure_export`, `preview_export`, `start_export_job`, `get_job_status`, and `cancel_job`; return size estimate, job, and output asset. `apply_batch` with dry-run, an explicit target set, an atomicity policy, and per-item results.
- **Fallback/constraint:** Offer a universally supported PNG/JPEG path locally and route unsupported formats or oversized jobs to a worker.

# Video capabilities

## Project, sequence, and media organization

### VI-001 — Sequence creation with resolution, frame rate, pixel aspect, and audio settings

- **Classification:** Video → Project, sequence, and media organization; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status. Rational frame rate/timebase, dimensions, pixel aspect, field/colour settings, audio sample rate/channel layout, and default track configuration.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`, `C-AUDIO`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. `create_sequence` requires explicit settings or a named preset and returns the normalized timebase/settings.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-002 — Multiple sequences per project

- **Classification:** Video → Project, sequence, and media organization; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. Feature discriminator: `operationType="multiple_sequences_per_project"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-003 — Bins/folders and freeform storyboard view

- **Classification:** Video → Project, sequence, and media organization; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. Feature discriminator: `operationType="bins_folders_and_freeform_storyboard_view"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-004 — Source and program monitors

- **Classification:** Video → Project, sequence, and media organization; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing. Two bounded playback/decode contexts with independent source and timeline time, shared cache budgeting, and A/V clocks.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`, `C-AUDIO`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. `set_monitor_time_or_range` and `inspect_monitor_state`; navigation only unless an edit command is separately invoked.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-005 — In/Out points and subclips

- **Classification:** Video → Project, sequence, and media organization; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. Feature discriminator: `operationType="in_out_points_and_subclips"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-006 — Markers with colors, names, comments, and durations

- **Classification:** Video → Project, sequence, and media organization; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status. Comment text, author, status/thread, revision, and object/region/time anchor with migration metadata. Rational time or source/project timecode, duration, name, color, comment, and anchor target.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`, `C-COLLAB`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. `add_comment`, `reply_or_resolve_comment`, and `list_comments`; return exact anchor and revision. `list_markers`, `add_or_update_marker`, and `navigate_to_time`; return normalized frame/timecode.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-007 — Timecode display and navigation

- **Classification:** Video → Project, sequence, and media organization; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status. Rational time or source/project timecode, duration, name, color, comment, and anchor target.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. `list_markers`, `add_or_update_marker`, and `navigate_to_time`; return normalized frame/timecode.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-009 — Duplicate clip and usage detection

- **Classification:** Video → Project, sequence, and media organization; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing. Cryptographic hashing for exact duplicates; optional perceptual hashes/features in a bounded worker.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction. Optional CPU/GPU visual similarity analysis for large libraries.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`, `C-ML`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. `find_duplicates` returns groups, confidence/method, and usage warnings without deleting anything.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

### VI-010 — Offline media and relinking

- **Classification:** Video → Project, sequence, and media organization; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence settings, bins/storyboard positions, source/program monitor state, source ranges/subclips, markers, timecode, metadata, usage, and offline status. Stable logical asset ID separated from source locator, plus compatibility mapping for dimensions/duration/channels.
- **Compute — browser/interactive:** Moderate–high worker CPU/media decode for probing, thumbnails, source monitoring, timecode calculations, and duplicate/usage indexing.
- **Compute — remote/final:** Optional CPU worker for proxies, unsupported media probing, duplicate analysis, and metadata extraction.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; Original media in local file handles or object storage; thumbnails/proxies in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; metadata/search indexes locally and optionally in cloud.
- **UI requirements:** Project/bin panel, storyboard, source/program monitors, marker/timecode controls, metadata inspector, search, and relink/status dialogs.
- **Application component dependencies:** `C-PROJECT`, `C-ASSET`, `C-METADATA`, `C-VIDEO`, `C-PROXY`, `C-TIMELINE`, `C-PREVIEW`, `C-SYNC`, `C-LOCAL-STORE`, `C-IMPORT`.
- **Technical/runtime dependencies:** Media probing/demux, WebCodecs/video element fallback, timebase/rational arithmetic, virtualised grids, stable asset references. Service worker/app shell cache, durable local operation journal, reconnect reconciliation, and offline capability indicators.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_sequence_or_asset`, `manage_sequence`, `set_source_range`, `manage_marker`, `update_metadata`, `relink_asset`, and `focus_ui`; return IDs/time ranges. Expose offline capability/state; queue only operations whose semantics remain safe. `relink_asset` or `replace_asset_source`; return compatibility losses and every affected reference.
- **Fallback/constraint:** Register unsupported/offline media and provide proxy/conversion or relinking without losing sequence references.

## Timeline and fundamental editing

### VI-011 — Multi-track video and audio timeline

- **Classification:** Video → Timeline and fundamental editing; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. Feature discriminator: `operationType="multi_track_video_and_audio_timeline"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-012 — Add, delete, rename, reorder, lock, hide, mute, and solo tracks

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Clip gain, track fader/pan, monitoring mute/solo, channel/bus target, and optional automation.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `apply_audio_mix_operation` requires clip/track ID and parameter; return effective state and clipping warnings.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-013 — Insert and overwrite edits

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-014 — Drag-and-drop append and rearrangement

- **Classification:** Video → Timeline and fundamental editing; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-015 — Split/razor and join-through edits

- **Classification:** Video → Timeline and fundamental editing; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-016 — Ripple trim

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker. Full-resolution worker render avoids browser texture and memory ceilings.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`, `C-TRANSFORM`, `C-EFFECT`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-017 — Roll trim

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-019 — Lift, extract, ripple delete, and close gap

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker. Full-resolution worker render avoids browser texture and memory ceilings.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`, `C-TRANSFORM`, `C-EFFECT`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-020 — Snapping and linked selection

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Guide/grid/safe-area geometry, snap targets, thresholds, and alignment reference. Selection representation, combination mode, bounds, feather/tolerance, source sampling policy, and saved-selection ID.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Spatial indexing and screen-space snapping/hit testing at pointer frequency.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`, `C-CANVAS`, `C-TRANSFORM`, `C-SELECTION`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. Accept explicit alignment reference/target IDs and return resulting numeric coordinates. Require target layer/composite and explicit add/subtract/intersect mode; return bounds and approximate coverage.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-021 — Link/unlink audio and video

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-022 — Group, label, and select related clips

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Incremental indexing/querying should run in a worker and avoid decoding full media. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export. Searchable metadata index plus user labels/collections; media remains referenced, not copied.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands. Search box, filter chips/facets, sortable metadata, result counts, and clear-active-filters state.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`, `C-METADATA`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `search_assets_or_commands` with structured filters; return stable IDs and matched fields. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-023 — Subsequences and sequence duplication

- **Classification:** Video → Timeline and fundamental editing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-024 — Adjustment layers

- **Classification:** Video → Timeline and fundamental editing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. Feature discriminator: `operationType="adjustment_layers"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

### VI-025 — Clip replacement while retaining attributes

- **Classification:** Video → Timeline and fundamental editing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Sequence timebase, ordered tracks, clips, source ranges, timeline ranges, links/groups, track states, transitions/effects, and edit transactions. Stable logical asset ID separated from source locator, plus compatibility mapping for dimensions/duration/channels.
- **Compute — browser/interactive:** Moderate browser CPU for interval/index updates, snapping, ripple propagation, hit testing, and virtualised timeline rendering; decode remains separate.
- **Compute — remote/final:** None for edit decisions; final composition is delegated to the render worker.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; thumbnails/waveforms in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; no new source media until export.
- **UI requirements:** Multi-track timeline, track headers, playhead, trim handles, source/program monitors, snapping feedback, context menus, inspector, and keyboard commands.
- **Application component dependencies:** `C-TIMELINE`, `C-COMMAND`, `C-HISTORY`, `C-ASSET`, `C-PREVIEW`, `C-VIDEO`, `C-AUDIO`, `C-IMPORT`.
- **Technical/runtime dependencies:** Rational time arithmetic, interval trees/indexes, virtualisation, deterministic ripple/roll/slip algorithms, transaction-safe multi-object edits.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_timeline`, `apply_timeline_edit`, `apply_transaction`, `set_selection`, `preview_at_time`, and `explain_edit`; return changed clip/track IDs and ranges. `relink_asset` or `replace_asset_source`; return compatibility losses and every affected reference.
- **Fallback/constraint:** Disable edits that require unavailable linked media while preserving timeline state; use textual/numeric controls when drag interaction is unsuitable.

## Time, speed, synchronization, and multicamera

### VI-027 — Clip duration and speed controls

- **Classification:** Video → Time, speed, synchronization, and multicamera; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip playback rate/time mapping, duration, direction, hold frame, pitch policy, source/project timestamps, timecode, and synchronization offsets. Source-to-timeline time mapping, rate/direction/hold frame, duration policy, audio pitch policy, and ripple behavior.
- **Compute — browser/interactive:** High worker/media CPU for seeking, reverse caching, audio time-stretch/pitch preservation, frame interpolation decisions, and sync analysis.
- **Compute — remote/final:** CPU/GPU media worker performs final retiming, reverse decode, audio processing, and large synchronization analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; reverse/retime frame caches and sync analysis in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Speed/duration dialog, rate/hold controls, timeline retime visualization, sync source chooser, offset display, and preview quality indicator.
- **Application component dependencies:** `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-PREVIEW`, `C-CODEC`, `C-EXPORT`, `C-WORKER`.
- **Technical/runtime dependencies:** Timestamp/timecode normalization, keyframe-aware decode, resampling/time-stretch, bounded reverse frame cache, A/V clock synchronization.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_clip_timing`, `apply_retime_or_hold`, `synchronize_assets`, `preview_at_time`, and `start_analysis_or_render_job`; return mapping/offset and warnings. Require explicit rate/duration/ripple/pitch settings and return normalized source/timeline mapping.
- **Fallback/constraint:** Use frame dropping/duplication and muted or unpitched audio preview locally; preserve high-quality retiming for worker export.

### VI-028 — Reverse playback

- **Classification:** Video → Time, speed, synchronization, and multicamera; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip playback rate/time mapping, duration, direction, hold frame, pitch policy, source/project timestamps, timecode, and synchronization offsets. Source-to-timeline time mapping, rate/direction/hold frame, duration policy, audio pitch policy, and ripple behavior.
- **Compute — browser/interactive:** High worker/media CPU for seeking, reverse caching, audio time-stretch/pitch preservation, frame interpolation decisions, and sync analysis.
- **Compute — remote/final:** CPU/GPU media worker performs final retiming, reverse decode, audio processing, and large synchronization analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; reverse/retime frame caches and sync analysis in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Speed/duration dialog, rate/hold controls, timeline retime visualization, sync source chooser, offset display, and preview quality indicator.
- **Application component dependencies:** `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-PREVIEW`, `C-CODEC`, `C-EXPORT`, `C-WORKER`.
- **Technical/runtime dependencies:** Timestamp/timecode normalization, keyframe-aware decode, resampling/time-stretch, bounded reverse frame cache, A/V clock synchronization.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_clip_timing`, `apply_retime_or_hold`, `synchronize_assets`, `preview_at_time`, and `start_analysis_or_render_job`; return mapping/offset and warnings. Require explicit rate/duration/ripple/pitch settings and return normalized source/timeline mapping.
- **Fallback/constraint:** Use frame dropping/duplication and muted or unpitched audio preview locally; preserve high-quality retiming for worker export.

### VI-029 — Frame hold/freeze frame

- **Classification:** Video → Time, speed, synchronization, and multicamera; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Clip playback rate/time mapping, duration, direction, hold frame, pitch policy, source/project timestamps, timecode, and synchronization offsets. Source-to-timeline time mapping, rate/direction/hold frame, duration policy, audio pitch policy, and ripple behavior.
- **Compute — browser/interactive:** High worker/media CPU for seeking, reverse caching, audio time-stretch/pitch preservation, frame interpolation decisions, and sync analysis.
- **Compute — remote/final:** CPU/GPU media worker performs final retiming, reverse decode, audio processing, and large synchronization analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; reverse/retime frame caches and sync analysis in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Speed/duration dialog, rate/hold controls, timeline retime visualization, sync source chooser, offset display, and preview quality indicator.
- **Application component dependencies:** `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-PREVIEW`, `C-CODEC`, `C-EXPORT`, `C-WORKER`.
- **Technical/runtime dependencies:** Timestamp/timecode normalization, keyframe-aware decode, resampling/time-stretch, bounded reverse frame cache, A/V clock synchronization.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_clip_timing`, `apply_retime_or_hold`, `synchronize_assets`, `preview_at_time`, and `start_analysis_or_render_job`; return mapping/offset and warnings. Require explicit rate/duration/ripple/pitch settings and return normalized source/timeline mapping.
- **Fallback/constraint:** Use frame dropping/duplication and muted or unpitched audio preview locally; preserve high-quality retiming for worker export.

### VI-030 — Audio/video synchronization by timestamp or timecode

- **Classification:** Video → Time, speed, synchronization, and multicamera; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Clip playback rate/time mapping, duration, direction, hold frame, pitch policy, source/project timestamps, timecode, and synchronization offsets. Rational time or source/project timecode, duration, name, color, comment, and anchor target.
- **Compute — browser/interactive:** High worker/media CPU for seeking, reverse caching, audio time-stretch/pitch preservation, frame interpolation decisions, and sync analysis. Metadata/timecode alignment is light; waveform correlation is worker CPU and bounded by proxy audio.
- **Compute — remote/final:** CPU/GPU media worker performs final retiming, reverse decode, audio processing, and large synchronization analysis. Control-plane synchronization, conflict detection, revision exchange, and resumable media transfer. CPU worker may correlate long audio or many sources.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; reverse/retime frame caches and sync analysis in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download. Cloud revision/object records plus local pending-operation journal.
- **UI requirements:** Speed/duration dialog, rate/hold controls, timeline retime visualization, sync source chooser, offset display, and preview quality indicator.
- **Application component dependencies:** `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-PREVIEW`, `C-CODEC`, `C-EXPORT`, `C-WORKER`, `C-SYNC`, `C-CLOUD-STORE`, `C-PERMISSION`, `C-METADATA`.
- **Technical/runtime dependencies:** Timestamp/timecode normalization, keyframe-aware decode, resampling/time-stretch, bounded reverse frame cache, A/V clock synchronization.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_clip_timing`, `apply_retime_or_hold`, `synchronize_assets`, `preview_at_time`, and `start_analysis_or_render_job`; return mapping/offset and warnings. Return synchronization/lock state and explicit conflict objects; never silently overwrite. `list_markers`, `add_or_update_marker`, and `navigate_to_time`; return normalized frame/timecode. `analyze_sync` returns proposed offsets/confidence; `apply_sync` commits explicit offsets transactionally.
- **Fallback/constraint:** Use frame dropping/duplication and muted or unpitched audio preview locally; preserve high-quality retiming for worker export.

## Motion, animation, compositing, and tracking

### VI-031 — Motion properties: position, scale, rotation, anchor, opacity

- **Classification:** Video → Motion, animation, compositing, and tracking; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip transform/opacity, keyframes, interpolation, masks/mattes, blend state, aspect-ratio targets, and optional analysis/tracking data.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for keyframe evaluation, masking, mattes, stacked compositing, seeking, and subject-aware analysis.
- **Compute — remote/final:** CPU/GPU worker performs deterministic full-resolution composition and optional ML subject tracking/reframe analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; mask/tracking/preview caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Program monitor handles, effect/keyframe panel, graph/motion editor, mask tools, matte selectors, aspect presets, tracking/reframe controls, and preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-KEYFRAME`, `C-MASK`, `C-COMPOSITOR`, `C-VIDEO`, `C-EFFECT`, `C-ML`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU compositing/shaders, frame-accurate keyframe evaluation, path interpolation, mask rasterisation, alpha/luma conventions, optional vision models.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_motion_state`, `apply_motion_or_composite_operation`, `set_keyframes`, `start_tracking_or_reframe_job`, and `preview_at_time`; return keyframes/masks/job data. Feature discriminator: `operationType="motion_properties_position_scale_rotation_anchor_opacity"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Allow manual keyframes/masks when tracking or GPU paths are unavailable; use proxy previews and worker-side final composition.

### VI-032 — Keyframes with linear, hold, bezier, ease-in, and ease-out interpolation

- **Classification:** Video → Motion, animation, compositing, and tracking; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Clip transform/opacity, keyframes, interpolation, masks/mattes, blend state, aspect-ratio targets, and optional analysis/tracking data. Property path, timestamp/timebase, value, interpolation/tangents, spatial path, and ordering rules.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for keyframe evaluation, masking, mattes, stacked compositing, seeking, and subject-aware analysis. Frame-time interpolation and graph/path rendering; edits invalidate only affected time ranges.
- **Compute — remote/final:** CPU/GPU worker performs deterministic full-resolution composition and optional ML subject tracking/reframe analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; mask/tracking/preview caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Program monitor handles, effect/keyframe panel, graph/motion editor, mask tools, matte selectors, aspect presets, tracking/reframe controls, and preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-KEYFRAME`, `C-MASK`, `C-COMPOSITOR`, `C-VIDEO`, `C-EFFECT`, `C-ML`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU compositing/shaders, frame-accurate keyframe evaluation, path interpolation, mask rasterisation, alpha/luma conventions, optional vision models.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_motion_state`, `apply_motion_or_composite_operation`, `set_keyframes`, `start_tracking_or_reframe_job`, and `preview_at_time`; return keyframes/masks/job data. `set_keyframes` accepts typed property paths and times; return normalized times, values, and transaction ID.
- **Fallback/constraint:** Allow manual keyframes/masks when tracking or GPU paths are unavailable; use proxy previews and worker-side final composition.

### VI-033 — Effect controls and keyframe timeline

- **Classification:** Video → Motion, animation, compositing, and tracking; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Clip transform/opacity, keyframes, interpolation, masks/mattes, blend state, aspect-ratio targets, and optional analysis/tracking data. Property path, timestamp/timebase, value, interpolation/tangents, spatial path, and ordering rules.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for keyframe evaluation, masking, mattes, stacked compositing, seeking, and subject-aware analysis. Frame-time interpolation and graph/path rendering; edits invalidate only affected time ranges.
- **Compute — remote/final:** CPU/GPU worker performs deterministic full-resolution composition and optional ML subject tracking/reframe analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; mask/tracking/preview caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Program monitor handles, effect/keyframe panel, graph/motion editor, mask tools, matte selectors, aspect presets, tracking/reframe controls, and preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-KEYFRAME`, `C-MASK`, `C-COMPOSITOR`, `C-VIDEO`, `C-EFFECT`, `C-ML`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU compositing/shaders, frame-accurate keyframe evaluation, path interpolation, mask rasterisation, alpha/luma conventions, optional vision models.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_motion_state`, `apply_motion_or_composite_operation`, `set_keyframes`, `start_tracking_or_reframe_job`, and `preview_at_time`; return keyframes/masks/job data. `set_keyframes` accepts typed property paths and times; return normalized times, values, and transaction ID.
- **Fallback/constraint:** Allow manual keyframes/masks when tracking or GPU paths are unavailable; use proxy previews and worker-side final composition.

### VI-034 — Crop, feather, edge, and opacity masks

- **Classification:** Video → Motion, animation, compositing, and tracking; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip transform/opacity, keyframes, interpolation, masks/mattes, blend state, aspect-ratio targets, and optional analysis/tracking data. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for keyframe evaluation, masking, mattes, stacked compositing, seeking, and subject-aware analysis. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** CPU/GPU worker performs deterministic full-resolution composition and optional ML subject tracking/reframe analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; mask/tracking/preview caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Program monitor handles, effect/keyframe panel, graph/motion editor, mask tools, matte selectors, aspect presets, tracking/reframe controls, and preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-KEYFRAME`, `C-MASK`, `C-COMPOSITOR`, `C-VIDEO`, `C-EFFECT`, `C-ML`, `C-WORKER`, `C-SELECTION`.
- **Technical/runtime dependencies:** GPU compositing/shaders, frame-accurate keyframe evaluation, path interpolation, mask rasterisation, alpha/luma conventions, optional vision models.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_motion_state`, `apply_motion_or_composite_operation`, `set_keyframes`, `start_tracking_or_reframe_job`, and `preview_at_time`; return keyframes/masks/job data. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds.
- **Fallback/constraint:** Allow manual keyframes/masks when tracking or GPU paths are unavailable; use proxy previews and worker-side final composition.

### VI-035 — Luma key, track matte, and alpha matte

- **Classification:** Video → Motion, animation, compositing, and tracking; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Clip transform/opacity, keyframes, interpolation, masks/mattes, blend state, aspect-ratio targets, and optional analysis/tracking data. Mask/matte source, target, raster/vector representation, feather/density/invert, transform linkage, and optional keyframes.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for keyframe evaluation, masking, mattes, stacked compositing, seeking, and subject-aware analysis. GPU mask evaluation plus worker rasterisation/refinement and bounded alpha-map caches.
- **Compute — remote/final:** CPU/GPU worker performs deterministic full-resolution composition and optional ML subject tracking/reframe analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; mask/tracking/preview caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Program monitor handles, effect/keyframe panel, graph/motion editor, mask tools, matte selectors, aspect presets, tracking/reframe controls, and preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-KEYFRAME`, `C-MASK`, `C-COMPOSITOR`, `C-VIDEO`, `C-EFFECT`, `C-ML`, `C-WORKER`, `C-SELECTION`.
- **Technical/runtime dependencies:** GPU compositing/shaders, frame-accurate keyframe evaluation, path interpolation, mask rasterisation, alpha/luma conventions, optional vision models.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_motion_state`, `apply_motion_or_composite_operation`, `set_keyframes`, `start_tracking_or_reframe_job`, and `preview_at_time`; return keyframes/masks/job data. `inspect_mask`, `apply_mask_operation`, and `set_matte_source`; require source/target IDs and return mask bounds.
- **Fallback/constraint:** Allow manual keyframes/masks when tracking or GPU paths are unavailable; use proxy previews and worker-side final composition.

### VI-036 — Blend modes

- **Classification:** Video → Motion, animation, compositing, and tracking; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Clip transform/opacity, keyframes, interpolation, masks/mattes, blend state, aspect-ratio targets, and optional analysis/tracking data.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for keyframe evaluation, masking, mattes, stacked compositing, seeking, and subject-aware analysis. GPU blend shader in a defined working colour space with premultiplied-alpha handling.
- **Compute — remote/final:** CPU/GPU worker performs deterministic full-resolution composition and optional ML subject tracking/reframe analysis. Final compositor must implement the identical named blend formula and colour policy.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; mask/tracking/preview caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Program monitor handles, effect/keyframe panel, graph/motion editor, mask tools, matte selectors, aspect presets, tracking/reframe controls, and preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-KEYFRAME`, `C-MASK`, `C-COMPOSITOR`, `C-VIDEO`, `C-EFFECT`, `C-ML`, `C-WORKER`, `C-COLOR`.
- **Technical/runtime dependencies:** GPU compositing/shaders, frame-accurate keyframe evaluation, path interpolation, mask rasterisation, alpha/luma conventions, optional vision models.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_motion_state`, `apply_motion_or_composite_operation`, `set_keyframes`, `start_tracking_or_reframe_job`, and `preview_at_time`; return keyframes/masks/job data. Validate supported blend-mode enum and return preview/final capability differences.
- **Fallback/constraint:** Allow manual keyframes/masks when tracking or GPU paths are unavailable; use proxy previews and worker-side final composition.

### VI-037 — Reframe/reposition for alternate aspect ratios

- **Classification:** Video → Motion, animation, compositing, and tracking; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip transform/opacity, keyframes, interpolation, masks/mattes, blend state, aspect-ratio targets, and optional analysis/tracking data.
- **Compute — browser/interactive:** High GPU preview plus worker CPU for keyframe evaluation, masking, mattes, stacked compositing, seeking, and subject-aware analysis.
- **Compute — remote/final:** CPU/GPU worker performs deterministic full-resolution composition and optional ML subject tracking/reframe analysis.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; mask/tracking/preview caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Program monitor handles, effect/keyframe panel, graph/motion editor, mask tools, matte selectors, aspect presets, tracking/reframe controls, and preview.
- **Application component dependencies:** `C-TRANSFORM`, `C-KEYFRAME`, `C-MASK`, `C-COMPOSITOR`, `C-VIDEO`, `C-EFFECT`, `C-ML`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU compositing/shaders, frame-accurate keyframe evaluation, path interpolation, mask rasterisation, alpha/luma conventions, optional vision models.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_motion_state`, `apply_motion_or_composite_operation`, `set_keyframes`, `start_tracking_or_reframe_job`, and `preview_at_time`; return keyframes/masks/job data. Feature discriminator: `operationType="reframe_reposition_for_alternate_aspect_ratios"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Allow manual keyframes/masks when tracking or GPU paths are unavailable; use proxy previews and worker-side final composition.

## Transitions and visual effects

### VI-038 — Cross dissolve, dip, wipe, slide, push, and zoom transitions

- **Classification:** Video → Transitions and visual effects; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Transition/effect node, clip/track targets, duration/alignment, ordered parameters, keyframes, presets, masks, and cached frame dependencies. Non-destructive viewport-only transform and display mode, separate from document transforms. Explicit source/sequence IDs, track/range, selected clips, collision/ripple policy, link/group semantics, and transaction result. Transition type, adjacent clip IDs, boundary, duration, alignment, direction/easing, and audio curve where relevant.
- **Compute — browser/interactive:** High GPU/media compute for two-sided frame decode, shaders, convolution, temporal access, and real-time parameter preview. Deterministic interval updates and ripple propagation; preview invalidates only affected ranges. Decode both sides around the cut and composite/mix over the transition window.
- **Compute — remote/final:** CPU/GPU render worker handles full resolution, temporal effects, unsupported shaders, and deterministic export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; effect/transition presets in Small versioned preset/template records locally and optionally in the account database; frame intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Effects browser with previews/search/favorites, timeline transition handles, parameter/keyframe inspector, program-monitor controls, and render indicators.
- **Application component dependencies:** `C-EFFECT`, `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-WORKER`, `C-CANVAS`, `C-COMMAND`, `C-HISTORY`.
- **Technical/runtime dependencies:** GPU shaders, temporal frame windows, audio curves, convolution/noise, deterministic seeds, proxy/full render parity.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_transition_or_effect`, `apply_preset`, `preview_at_time`, and `start_preview_or_render_job`; return node/range and capability warnings. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits. `apply_timeline_edit` uses a typed edit enum and explicit IDs/times; return every changed clip/range in one transaction. `apply_transition` requires boundary/clip IDs and parameters; return adjusted handles/duration and insufficient-media warnings.
- **Fallback/constraint:** Preview at reduced quality or with a simplified effect; preserve exact parameters and render unsupported effects remotely.

### VI-039 — Audio crossfades

- **Classification:** Video → Transitions and visual effects; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Transition/effect node, clip/track targets, duration/alignment, ordered parameters, keyframes, presets, masks, and cached frame dependencies. Transition type, adjacent clip IDs, boundary, duration, alignment, direction/easing, and audio curve where relevant.
- **Compute — browser/interactive:** High GPU/media compute for two-sided frame decode, shaders, convolution, temporal access, and real-time parameter preview. Decode both sides around the cut and composite/mix over the transition window.
- **Compute — remote/final:** CPU/GPU render worker handles full resolution, temporal effects, unsupported shaders, and deterministic export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; effect/transition presets in Small versioned preset/template records locally and optionally in the account database; frame intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Effects browser with previews/search/favorites, timeline transition handles, parameter/keyframe inspector, program-monitor controls, and render indicators.
- **Application component dependencies:** `C-EFFECT`, `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU shaders, temporal frame windows, audio curves, convolution/noise, deterministic seeds, proxy/full render parity.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_transition_or_effect`, `apply_preset`, `preview_at_time`, and `start_preview_or_render_job`; return node/range and capability warnings. `apply_transition` requires boundary/clip IDs and parameters; return adjusted handles/duration and insufficient-media warnings.
- **Fallback/constraint:** Preview at reduced quality or with a simplified effect; preserve exact parameters and render unsupported effects remotely.

### VI-040 — Transition presets and favorites

- **Classification:** Video → Transitions and visual effects; necessity **Core**; browser difficulty **Moderate**.
- **Project/data requirements:** Transition/effect node, clip/track targets, duration/alignment, ordered parameters, keyframes, presets, masks, and cached frame dependencies. Transition type, adjacent clip IDs, boundary, duration, alignment, direction/easing, and audio curve where relevant.
- **Compute — browser/interactive:** High GPU/media compute for two-sided frame decode, shaders, convolution, temporal access, and real-time parameter preview. Decode both sides around the cut and composite/mix over the transition window.
- **Compute — remote/final:** CPU/GPU render worker handles full resolution, temporal effects, unsupported shaders, and deterministic export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; effect/transition presets in Small versioned preset/template records locally and optionally in the account database; frame intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Effects browser with previews/search/favorites, timeline transition handles, parameter/keyframe inspector, program-monitor controls, and render indicators.
- **Application component dependencies:** `C-EFFECT`, `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU shaders, temporal frame windows, audio curves, convolution/noise, deterministic seeds, proxy/full render parity.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_transition_or_effect`, `apply_preset`, `preview_at_time`, and `start_preview_or_render_job`; return node/range and capability warnings. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters. `apply_transition` requires boundary/clip IDs and parameters; return adjusted handles/duration and insufficient-media warnings.
- **Fallback/constraint:** Preview at reduced quality or with a simplified effect; preserve exact parameters and render unsupported effects remotely.

### VI-041 — Blur, sharpen, noise, grain, distort, stylize, and pixelate effects

- **Classification:** Video → Transitions and visual effects; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Transition/effect node, clip/track targets, duration/alignment, ordered parameters, keyframes, presets, masks, and cached frame dependencies. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU/media compute for two-sided frame decode, shaders, convolution, temporal access, and real-time parameter preview. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU render worker handles full resolution, temporal effects, unsupported shaders, and deterministic export. Full-resolution worker render avoids browser texture and memory ceilings.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; effect/transition presets in Small versioned preset/template records locally and optionally in the account database; frame intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Effects browser with previews/search/favorites, timeline transition handles, parameter/keyframe inspector, program-monitor controls, and render indicators.
- **Application component dependencies:** `C-EFFECT`, `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-WORKER`, `C-TRANSFORM`.
- **Technical/runtime dependencies:** GPU shaders, temporal frame windows, audio curves, convolution/noise, deterministic seeds, proxy/full render parity.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_transition_or_effect`, `apply_preset`, `preview_at_time`, and `start_preview_or_render_job`; return node/range and capability warnings. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Preview at reduced quality or with a simplified effect; preserve exact parameters and render unsupported effects remotely.

### VI-042 — Shadow, glow, bevel, and edge effects

- **Classification:** Video → Transitions and visual effects; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Transition/effect node, clip/track targets, duration/alignment, ordered parameters, keyframes, presets, masks, and cached frame dependencies. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU/media compute for two-sided frame decode, shaders, convolution, temporal access, and real-time parameter preview. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU render worker handles full resolution, temporal effects, unsupported shaders, and deterministic export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; effect/transition presets in Small versioned preset/template records locally and optionally in the account database; frame intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Effects browser with previews/search/favorites, timeline transition handles, parameter/keyframe inspector, program-monitor controls, and render indicators.
- **Application component dependencies:** `C-EFFECT`, `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU shaders, temporal frame windows, audio curves, convolution/noise, deterministic seeds, proxy/full render parity.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_transition_or_effect`, `apply_preset`, `preview_at_time`, and `start_preview_or_render_job`; return node/range and capability warnings. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Preview at reduced quality or with a simplified effect; preserve exact parameters and render unsupported effects remotely.

### VI-043 — Lens distortion, vignette, flare, and chromatic effects

- **Classification:** Video → Transitions and visual effects; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Transition/effect node, clip/track targets, duration/alignment, ordered parameters, keyframes, presets, masks, and cached frame dependencies. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU/media compute for two-sided frame decode, shaders, convolution, temporal access, and real-time parameter preview. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU render worker handles full resolution, temporal effects, unsupported shaders, and deterministic export. Full-resolution worker render avoids browser texture and memory ceilings.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; effect/transition presets in Small versioned preset/template records locally and optionally in the account database; frame intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Effects browser with previews/search/favorites, timeline transition handles, parameter/keyframe inspector, program-monitor controls, and render indicators.
- **Application component dependencies:** `C-EFFECT`, `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-WORKER`, `C-TRANSFORM`.
- **Technical/runtime dependencies:** GPU shaders, temporal frame windows, audio curves, convolution/noise, deterministic seeds, proxy/full render parity.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_transition_or_effect`, `apply_preset`, `preview_at_time`, and `start_preview_or_render_job`; return node/range and capability warnings. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Preview at reduced quality or with a simplified effect; preserve exact parameters and render unsupported effects remotely.

### VI-044 — Preset stack and effect templates

- **Classification:** Video → Transitions and visual effects; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Transition/effect node, clip/track targets, duration/alignment, ordered parameters, keyframes, presets, masks, and cached frame dependencies.
- **Compute — browser/interactive:** High GPU/media compute for two-sided frame decode, shaders, convolution, temporal access, and real-time parameter preview.
- **Compute — remote/final:** CPU/GPU render worker handles full resolution, temporal effects, unsupported shaders, and deterministic export.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; effect/transition presets in Small versioned preset/template records locally and optionally in the account database; frame intermediates in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Effects browser with previews/search/favorites, timeline transition handles, parameter/keyframe inspector, program-monitor controls, and render indicators.
- **Application component dependencies:** `C-EFFECT`, `C-TIMELINE`, `C-VIDEO`, `C-AUDIO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-WORKER`.
- **Technical/runtime dependencies:** GPU shaders, temporal frame windows, audio curves, convolution/noise, deterministic seeds, proxy/full render parity.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_effect_stack`, `apply_transition_or_effect`, `apply_preset`, `preview_at_time`, and `start_preview_or_render_job`; return node/range and capability warnings. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters.
- **Fallback/constraint:** Preview at reduced quality or with a simplified effect; preserve exact parameters and render unsupported effects remotely.

## Color correction and color management

### VI-045 — Basic exposure, contrast, highlights, shadows, whites, and blacks

- **Classification:** Video → Color correction and color management; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip/track colour nodes, input/output colour spaces, tone parameters, samples, LUT references, preset intensity, masks, and optional keyframes. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes. Effect type, radius/amount/threshold/seed and feature-specific parameters, target/mask, order, and optional keyframes.
- **Compute — browser/interactive:** High GPU preview for colour shaders plus worker reductions for scopes/sampling; frame decode must remain bounded. Low compute, but every dynamic state change needs semantic/focus synchronization and non-pointer equivalents. GPU shader or worker kernel with tile halo, quality scaling, and cancellable preview.
- **Compute — remote/final:** CPU/GPU worker applies the versioned colour pipeline at final resolution and handles unsupported profiles/LUT formats.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; LUT/profile assets in local/object storage; scope and preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Colour workspace, sliders/wheels/eyedropper, LUT and look browser, scopes, clipping/gamut warnings, per-clip/track target, and A/B view.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-VIDEO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`, `C-A11Y`, `C-FOCUS`.
- **Technical/runtime dependencies:** Colour-space transforms, LUT interpolation, high-precision GPU shaders, scope/histogram reductions, tone mapping, server parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `sample_frame_color`, `apply_color_adjustment_or_look`, `preview_at_time`, and `explain_parameter`; return node, sample, and warnings. Expose semantic target IDs and accessibility preferences; teaching actions focus/highlight without mutating creative state. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings. `apply_effect` validates effect-specific schema and returns node ID, affected target, and preview capability.
- **Fallback/constraint:** Use an sRGB proxy preview when advanced colour paths are unavailable and preserve the full transform for worker export.

### VI-046 — White balance and tint eyedropper

- **Classification:** Video → Color correction and color management; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip/track colour nodes, input/output colour spaces, tone parameters, samples, LUT references, preset intensity, masks, and optional keyframes. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** High GPU preview for colour shaders plus worker reductions for scopes/sampling; frame decode must remain bounded.
- **Compute — remote/final:** CPU/GPU worker applies the versioned colour pipeline at final resolution and handles unsupported profiles/LUT formats.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; LUT/profile assets in local/object storage; scope and preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Colour workspace, sliders/wheels/eyedropper, LUT and look browser, scopes, clipping/gamut warnings, per-clip/track target, and A/B view.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-VIDEO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Colour-space transforms, LUT interpolation, high-precision GPU shaders, scope/histogram reductions, tone mapping, server parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `sample_frame_color`, `apply_color_adjustment_or_look`, `preview_at_time`, and `explain_parameter`; return node, sample, and warnings. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use an sRGB proxy preview when advanced colour paths are unavailable and preserve the full transform for worker export.

### VI-047 — Saturation and vibrance

- **Classification:** Video → Color correction and color management; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip/track colour nodes, input/output colour spaces, tone parameters, samples, LUT references, preset intensity, masks, and optional keyframes. Adjustment type, numeric/channel/range parameters, working colour space, target/mask, ordering, and optional preset/keyframes.
- **Compute — browser/interactive:** High GPU preview for colour shaders plus worker reductions for scopes/sampling; frame decode must remain bounded.
- **Compute — remote/final:** CPU/GPU worker applies the versioned colour pipeline at final resolution and handles unsupported profiles/LUT formats.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; LUT/profile assets in local/object storage; scope and preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Colour workspace, sliders/wheels/eyedropper, LUT and look browser, scopes, clipping/gamut warnings, per-clip/track target, and A/B view.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-VIDEO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Colour-space transforms, LUT interpolation, high-precision GPU shaders, scope/histogram reductions, tone mapping, server parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `sample_frame_color`, `apply_color_adjustment_or_look`, `preview_at_time`, and `explain_parameter`; return node, sample, and warnings. Use typed `apply_color_adjustment` parameters with documented ranges; return normalized values, target, and clipping/gamut warnings.
- **Fallback/constraint:** Use an sRGB proxy preview when advanced colour paths are unavailable and preserve the full transform for worker export.

### VI-048 — LUT import, preview, and export

- **Classification:** Video → Color correction and color management; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Clip/track colour nodes, input/output colour spaces, tone parameters, samples, LUT references, preset intensity, masks, and optional keyframes.
- **Compute — browser/interactive:** High GPU preview for colour shaders plus worker reductions for scopes/sampling; frame decode must remain bounded. Bounded, cancellable render request keyed by project revision, viewport/time, quality, and capability profile.
- **Compute — remote/final:** CPU/GPU worker applies the versioned colour pipeline at final resolution and handles unsupported profiles/LUT formats.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; LUT/profile assets in local/object storage; scope and preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Colour workspace, sliders/wheels/eyedropper, LUT and look browser, scopes, clipping/gamut warnings, per-clip/track target, and A/B view.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-VIDEO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`, `C-CACHE`.
- **Technical/runtime dependencies:** Colour-space transforms, LUT interpolation, high-precision GPU shaders, scope/histogram reductions, tone mapping, server parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `sample_frame_color`, `apply_color_adjustment_or_look`, `preview_at_time`, and `explain_parameter`; return node, sample, and warnings. Return revision, time/region, quality, warnings, and a verifiable preview reference rather than claiming success generically.
- **Fallback/constraint:** Use an sRGB proxy preview when advanced colour paths are unavailable and preserve the full transform for worker export.

### VI-049 — Color presets/looks

- **Classification:** Video → Color correction and color management; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Clip/track colour nodes, input/output colour spaces, tone parameters, samples, LUT references, preset intensity, masks, and optional keyframes.
- **Compute — browser/interactive:** High GPU preview for colour shaders plus worker reductions for scopes/sampling; frame decode must remain bounded.
- **Compute — remote/final:** CPU/GPU worker applies the versioned colour pipeline at final resolution and handles unsupported profiles/LUT formats.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; LUT/profile assets in local/object storage; scope and preview caches in Memory/OPFS scratch data governed by quota and LRU eviction; Rendered outputs in temporary storage followed by object storage/download. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Colour workspace, sliders/wheels/eyedropper, LUT and look browser, scopes, clipping/gamut warnings, per-clip/track target, and A/B view.
- **Application component dependencies:** `C-COLOR`, `C-EFFECT`, `C-VIDEO`, `C-COMPOSITOR`, `C-PRESET`, `C-PREVIEW`, `C-EXPORT`.
- **Technical/runtime dependencies:** Colour-space transforms, LUT interpolation, high-precision GPU shaders, scope/histogram reductions, tone mapping, server parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_color_state`, `sample_frame_color`, `apply_color_adjustment_or_look`, `preview_at_time`, and `explain_parameter`; return node, sample, and warnings. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters.
- **Fallback/constraint:** Use an sRGB proxy preview when advanced colour paths are unavailable and preserve the full transform for worker export.

## Audio editing and mixing

### VI-050 — Waveform display and sample-aware scrubbing

- **Classification:** Video → Audio editing and mixing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Decoded audio references, channel layout, clip gain, track mix state, automation/keyframes, effects, recording takes, loudness data, and final-mix settings. Multiresolution peak data keyed by asset/channel/range and source revision. Container/format, codec, stream/image properties, alpha/profile/metadata support, capability result, and conversion policy.
- **Compute — browser/interactive:** High worker/audio compute for decoding, waveform peaks, scrubbing, DSP, metering, recording, automation, and low-latency playback. Inverse-mapped GPU geometry/effect preview with mesh/grid controls and tile-aware sampling. Probe support before decode/encode; demux/mux and format libraries run in a worker where browser-native support is incomplete.
- **Compute — remote/final:** CPU audio worker provides offline mixdown, loudness analysis/normalization, channel mapping, and codec-complete final-mix export. Full-resolution worker render avoids browser texture and memory ceilings. CPU media worker supplies the authoritative compatibility path and consistent encoding.
- **Storage and data movement:** Original media in local file handles or object storage; waveform/loudness caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; recorded takes as source assets; Rendered outputs in temporary storage followed by object storage/download. Waveform peak files in local/object derived storage; raw audio remains in source storage.
- **UI requirements:** Waveform timeline, mixer/track controls, meters, automation lanes, effect rack, channel map, recording/countdown/monitoring, and final-mix export controls.
- **Application component dependencies:** `C-AUDIO`, `C-TIMELINE`, `C-KEYFRAME`, `C-EFFECT`, `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-TRANSFORM`, `C-PROXY`, `C-CACHE`, `C-IMPORT`.
- **Technical/runtime dependencies:** Web Audio/AudioWorklet, media decode, DSP graphs, LUFS/true-peak measurement, resampling, microphone capture, offline server DSP.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_audio_state`, `apply_audio_operation`, `set_audio_automation`, `record_voiceover`, `analyze_or_normalize_audio`, and `start_audio_export_job`; return meters/takes/jobs. Accept explicit control points/mesh/effect parameters and return normalized geometry plus clipped-area warnings. `inspect_audio_range` and `navigate_to_audio_time`; return peaks/summary or focused time, not full samples. `inspect_format_support`, `import_media`, or `start_export_job`; return detected streams, substitutions/conversions, and output ID.
- **Fallback/constraint:** Fall back to waveform-level editing and basic gain/pan when advanced DSP or recording is unavailable; render the full mix remotely.

### VI-051 — Clip gain, track volume, pan, mute, and solo

- **Classification:** Video → Audio editing and mixing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Decoded audio references, channel layout, clip gain, track mix state, automation/keyframes, effects, recording takes, loudness data, and final-mix settings. Non-destructive viewport-only transform and display mode, separate from document transforms. Clip gain, track fader/pan, monitoring mute/solo, channel/bus target, and optional automation.
- **Compute — browser/interactive:** High worker/audio compute for decoding, waveform peaks, scrubbing, DSP, metering, recording, automation, and low-latency playback.
- **Compute — remote/final:** CPU audio worker provides offline mixdown, loudness analysis/normalization, channel mapping, and codec-complete final-mix export.
- **Storage and data movement:** Original media in local file handles or object storage; waveform/loudness caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; recorded takes as source assets; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Waveform timeline, mixer/track controls, meters, automation lanes, effect rack, channel map, recording/countdown/monitoring, and final-mix export controls.
- **Application component dependencies:** `C-AUDIO`, `C-TIMELINE`, `C-KEYFRAME`, `C-EFFECT`, `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-CANVAS`, `C-PREVIEW`.
- **Technical/runtime dependencies:** Web Audio/AudioWorklet, media decode, DSP graphs, LUFS/true-peak measurement, resampling, microphone capture, offline server DSP.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_audio_state`, `apply_audio_operation`, `set_audio_automation`, `record_voiceover`, `analyze_or_normalize_audio`, and `start_audio_export_job`; return meters/takes/jobs. Use `set_viewport`/`focus_ui`; clearly distinguish view changes from edits. `apply_audio_mix_operation` requires clip/track ID and parameter; return effective state and clipping warnings.
- **Fallback/constraint:** Fall back to waveform-level editing and basic gain/pan when advanced DSP or recording is unavailable; render the full mix remotely.

### VI-052 — Audio keyframes and automation lanes

- **Classification:** Video → Audio editing and mixing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Decoded audio references, channel layout, clip gain, track mix state, automation/keyframes, effects, recording takes, loudness data, and final-mix settings. Property path, timestamp/timebase, value, interpolation/tangents, spatial path, and ordering rules.
- **Compute — browser/interactive:** High worker/audio compute for decoding, waveform peaks, scrubbing, DSP, metering, recording, automation, and low-latency playback. Frame-time interpolation and graph/path rendering; edits invalidate only affected time ranges.
- **Compute — remote/final:** CPU audio worker provides offline mixdown, loudness analysis/normalization, channel mapping, and codec-complete final-mix export.
- **Storage and data movement:** Original media in local file handles or object storage; waveform/loudness caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; recorded takes as source assets; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Waveform timeline, mixer/track controls, meters, automation lanes, effect rack, channel map, recording/countdown/monitoring, and final-mix export controls.
- **Application component dependencies:** `C-AUDIO`, `C-TIMELINE`, `C-KEYFRAME`, `C-EFFECT`, `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`.
- **Technical/runtime dependencies:** Web Audio/AudioWorklet, media decode, DSP graphs, LUFS/true-peak measurement, resampling, microphone capture, offline server DSP.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_audio_state`, `apply_audio_operation`, `set_audio_automation`, `record_voiceover`, `analyze_or_normalize_audio`, and `start_audio_export_job`; return meters/takes/jobs. `set_keyframes` accepts typed property paths and times; return normalized times, values, and transaction ID.
- **Fallback/constraint:** Fall back to waveform-level editing and basic gain/pan when advanced DSP or recording is unavailable; render the full mix remotely.

### VI-053 — Loudness meters and normalization

- **Classification:** Video → Audio editing and mixing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Decoded audio references, channel layout, clip gain, track mix state, automation/keyframes, effects, recording takes, loudness data, and final-mix settings.
- **Compute — browser/interactive:** High worker/audio compute for decoding, waveform peaks, scrubbing, DSP, metering, recording, automation, and low-latency playback. Worker/GPU reduction over the visible frame/selection or audio window; cache by source revision and range.
- **Compute — remote/final:** CPU audio worker provides offline mixdown, loudness analysis/normalization, channel mapping, and codec-complete final-mix export.
- **Storage and data movement:** Original media in local file handles or object storage; waveform/loudness caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; recorded takes as source assets; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Waveform timeline, mixer/track controls, meters, automation lanes, effect rack, channel map, recording/countdown/monitoring, and final-mix export controls.
- **Application component dependencies:** `C-AUDIO`, `C-TIMELINE`, `C-KEYFRAME`, `C-EFFECT`, `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-METADATA`.
- **Technical/runtime dependencies:** Web Audio/AudioWorklet, media decode, DSP graphs, LUFS/true-peak measurement, resampling, microphone capture, offline server DSP.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_audio_state`, `apply_audio_operation`, `set_audio_automation`, `record_voiceover`, `analyze_or_normalize_audio`, and `start_audio_export_job`; return meters/takes/jobs. `inspect_histogram_or_meter` returns summarized bins/measurements and clipping/target diagnostics, not raw media.
- **Fallback/constraint:** Fall back to waveform-level editing and basic gain/pan when advanced DSP or recording is unavailable; render the full mix remotely.

### VI-054 — EQ, compressor, limiter, gate, delay, and reverb

- **Classification:** Video → Audio editing and mixing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Decoded audio references, channel layout, clip gain, track mix state, automation/keyframes, effects, recording takes, loudness data, and final-mix settings. Ordered audio processor graph with typed parameters, bypass, wet/dry, target, and optional automation.
- **Compute — browser/interactive:** High worker/audio compute for decoding, waveform peaks, scrubbing, DSP, metering, recording, automation, and low-latency playback. AudioWorklet/Web Audio DSP for monitoring; UI metering must not block the audio thread.
- **Compute — remote/final:** CPU audio worker provides offline mixdown, loudness analysis/normalization, channel mapping, and codec-complete final-mix export. Offline CPU DSP with parameter parity for export.
- **Storage and data movement:** Original media in local file handles or object storage; waveform/loudness caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; recorded takes as source assets; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Waveform timeline, mixer/track controls, meters, automation lanes, effect rack, channel map, recording/countdown/monitoring, and final-mix export controls.
- **Application component dependencies:** `C-AUDIO`, `C-TIMELINE`, `C-KEYFRAME`, `C-EFFECT`, `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`.
- **Technical/runtime dependencies:** Web Audio/AudioWorklet, media decode, DSP graphs, LUFS/true-peak measurement, resampling, microphone capture, offline server DSP.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_audio_state`, `apply_audio_operation`, `set_audio_automation`, `record_voiceover`, `analyze_or_normalize_audio`, and `start_audio_export_job`; return meters/takes/jobs. `apply_audio_effect` uses processor-specific schema and returns node/order plus latency or clipping information.
- **Fallback/constraint:** Fall back to waveform-level editing and basic gain/pan when advanced DSP or recording is unavailable; render the full mix remotely.

### VI-055 — Voice-over recording

- **Classification:** Video → Audio editing and mixing; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Decoded audio references, channel layout, clip gain, track mix state, automation/keyframes, effects, recording takes, loudness data, and final-mix settings. Microphone device/permission, countdown, monitoring, sequence start, take asset, latency offset, and channel settings.
- **Compute — browser/interactive:** High worker/audio compute for decoding, waveform peaks, scrubbing, DSP, metering, recording, automation, and low-latency playback.
- **Compute — remote/final:** CPU audio worker provides offline mixdown, loudness analysis/normalization, channel mapping, and codec-complete final-mix export.
- **Storage and data movement:** Original media in local file handles or object storage; waveform/loudness caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; recorded takes as source assets; Rendered outputs in temporary storage followed by object storage/download. Recorded take stored as a new local/source asset with resumable upload only when needed.
- **UI requirements:** Waveform timeline, mixer/track controls, meters, automation lanes, effect rack, channel map, recording/countdown/monitoring, and final-mix export controls.
- **Application component dependencies:** `C-AUDIO`, `C-TIMELINE`, `C-KEYFRAME`, `C-EFFECT`, `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-ASSET`, `C-PERMISSION`.
- **Technical/runtime dependencies:** Web Audio/AudioWorklet, media decode, DSP graphs, LUFS/true-peak measurement, resampling, microphone capture, offline server DSP.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`, `confirm`. `inspect_audio_state`, `apply_audio_operation`, `set_audio_automation`, `record_voiceover`, `analyze_or_normalize_audio`, and `start_audio_export_job`; return meters/takes/jobs. Tool may prepare/focus recording controls, but microphone permission and recording start require appropriate user involvement; return take ID and timing.
- **Fallback/constraint:** Fall back to waveform-level editing and basic gain/pan when advanced DSP or recording is unavailable; render the full mix remotely.

### VI-056 — Audio channel mapping

- **Classification:** Video → Audio editing and mixing; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Decoded audio references, channel layout, clip gain, track mix state, automation/keyframes, effects, recording takes, loudness data, and final-mix settings. Tiled pixel/channel store, dimensions, format/precision, alpha semantics, dirty regions, and layer/channel references.
- **Compute — browser/interactive:** High worker/audio compute for decoding, waveform peaks, scrubbing, DSP, metering, recording, automation, and low-latency playback.
- **Compute — remote/final:** CPU audio worker provides offline mixdown, loudness analysis/normalization, channel mapping, and codec-complete final-mix export.
- **Storage and data movement:** Original media in local file handles or object storage; waveform/loudness caches in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; recorded takes as source assets; Rendered outputs in temporary storage followed by object storage/download. Potentially large tile blobs and change deltas in OPFS; avoid embedding pixel data in project JSON.
- **UI requirements:** Waveform timeline, mixer/track controls, meters, automation lanes, effect rack, channel map, recording/countdown/monitoring, and final-mix export controls.
- **Application component dependencies:** `C-AUDIO`, `C-TIMELINE`, `C-KEYFRAME`, `C-EFFECT`, `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-IMAGE`, `C-COMPOSITOR`.
- **Technical/runtime dependencies:** Web Audio/AudioWorklet, media decode, DSP graphs, LUFS/true-peak measurement, resampling, microphone capture, offline server DSP.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_audio_state`, `apply_audio_operation`, `set_audio_automation`, `record_voiceover`, `analyze_or_normalize_audio`, and `start_audio_export_job`; return meters/takes/jobs. Operate on layer/channel IDs and regions; never transfer complete pixel buffers through tool results.
- **Fallback/constraint:** Fall back to waveform-level editing and basic gain/pan when advanced DSP or recording is unavailable; render the full mix remotely.

## Titles, graphics, captions, and transcription

### VI-058 — Title cards, lower thirds, and editable text overlays

- **Classification:** Video → Titles, graphics, captions, and transcription; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Timed graphic/caption objects, text runs/styles, font/shape/media references, safe-area placement, animation keyframes, language/speaker, and caption cues. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate–high CPU/GPU for text shaping, vector/raster composition, cue layout, animation, and frame preview.
- **Compute — remote/final:** CPU/GPU worker renders titles/captions consistently and performs transcription only when an analysis feature requires it.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; fonts/graphics as assets; style presets in Small versioned preset/template records locally and optionally in the account database; caption/transcript text in project/database; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Title/caption tool, text/graphics inspector, safe-area overlays, style browser, animation controls, caption track/table, cue timing, and preview.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TIMELINE`, `C-KEYFRAME`, `C-COMPOSITOR`, `C-PRESET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Unicode shaping/bidi, font loading/licensing, subtitle cue model/formats, safe-area rules, frame-accurate animation and server font parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_titles_or_captions`, `add_or_edit_title`, `manage_caption_cue`, `apply_text_style`, `preview_at_time`, and optional `start_transcription_job`; return object/cue IDs. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute fonts explicitly and retain editable caption text; burn captions remotely when local rendering cannot reproduce the style.

### VI-059 — Shapes, icons, logos, images, and grouped graphics

- **Classification:** Video → Titles, graphics, captions, and transcription; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Timed graphic/caption objects, text runs/styles, font/shape/media references, safe-area placement, animation keyframes, language/speaker, and caption cues. Path commands/shape primitives, viewBox/coordinate space, fills, strokes, transforms, grouping, and import sanitization.
- **Compute — browser/interactive:** Moderate–high CPU/GPU for text shaping, vector/raster composition, cue layout, animation, and frame preview.
- **Compute — remote/final:** CPU/GPU worker renders titles/captions consistently and performs transcription only when an analysis feature requires it.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; fonts/graphics as assets; style presets in Small versioned preset/template records locally and optionally in the account database; caption/transcript text in project/database; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Title/caption tool, text/graphics inspector, safe-area overlays, style browser, animation controls, caption track/table, cue timing, and preview.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TIMELINE`, `C-KEYFRAME`, `C-COMPOSITOR`, `C-PRESET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Unicode shaping/bidi, font loading/licensing, subtitle cue model/formats, safe-area rules, frame-accurate animation and server font parity. SVG sanitization, path parsing/tessellation, boolean geometry, antialiasing, and export fidelity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_titles_or_captions`, `add_or_edit_title`, `manage_caption_cue`, `apply_text_style`, `preview_at_time`, and optional `start_transcription_job`; return object/cue IDs. `inspect_vector_object`, `add_or_update_shape`, and `import_or_export_svg`; return bounds and unsupported SVG features.
- **Fallback/constraint:** Substitute fonts explicitly and retain editable caption text; burn captions remotely when local rendering cannot reproduce the style.

### VI-060 — Per-property title animation

- **Classification:** Video → Titles, graphics, captions, and transcription; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Timed graphic/caption objects, text runs/styles, font/shape/media references, safe-area placement, animation keyframes, language/speaker, and caption cues. Property path, timestamp/timebase, value, interpolation/tangents, spatial path, and ordering rules. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate–high CPU/GPU for text shaping, vector/raster composition, cue layout, animation, and frame preview. Frame-time interpolation and graph/path rendering; edits invalidate only affected time ranges.
- **Compute — remote/final:** CPU/GPU worker renders titles/captions consistently and performs transcription only when an analysis feature requires it.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; fonts/graphics as assets; style presets in Small versioned preset/template records locally and optionally in the account database; caption/transcript text in project/database; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Title/caption tool, text/graphics inspector, safe-area overlays, style browser, animation controls, caption track/table, cue timing, and preview.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TIMELINE`, `C-KEYFRAME`, `C-COMPOSITOR`, `C-PRESET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Unicode shaping/bidi, font loading/licensing, subtitle cue model/formats, safe-area rules, frame-accurate animation and server font parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_titles_or_captions`, `add_or_edit_title`, `manage_caption_cue`, `apply_text_style`, `preview_at_time`, and optional `start_transcription_job`; return object/cue IDs. `set_keyframes` accepts typed property paths and times; return normalized times, values, and transaction ID. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute fonts explicitly and retain editable caption text; burn captions remotely when local rendering cannot reproduce the style.

### VI-061 — Manual caption/subtitle tracks

- **Classification:** Video → Titles, graphics, captions, and transcription; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Timed graphic/caption objects, text runs/styles, font/shape/media references, safe-area placement, animation keyframes, language/speaker, and caption cues. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate–high CPU/GPU for text shaping, vector/raster composition, cue layout, animation, and frame preview.
- **Compute — remote/final:** CPU/GPU worker renders titles/captions consistently and performs transcription only when an analysis feature requires it.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; fonts/graphics as assets; style presets in Small versioned preset/template records locally and optionally in the account database; caption/transcript text in project/database; Rendered outputs in temporary storage followed by object storage/download.
- **UI requirements:** Title/caption tool, text/graphics inspector, safe-area overlays, style browser, animation controls, caption track/table, cue timing, and preview.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TIMELINE`, `C-KEYFRAME`, `C-COMPOSITOR`, `C-PRESET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Unicode shaping/bidi, font loading/licensing, subtitle cue model/formats, safe-area rules, frame-accurate animation and server font parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_titles_or_captions`, `add_or_edit_title`, `manage_caption_cue`, `apply_text_style`, `preview_at_time`, and optional `start_transcription_job`; return object/cue IDs. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute fonts explicitly and retain editable caption text; burn captions remotely when local rendering cannot reproduce the style.

### VI-062 — Caption styling and reusable styles

- **Classification:** Video → Titles, graphics, captions, and transcription; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Timed graphic/caption objects, text runs/styles, font/shape/media references, safe-area placement, animation keyframes, language/speaker, and caption cues. Editable text content, language/direction, font/style runs, layout box/path, accessibility text, and optional timing.
- **Compute — browser/interactive:** Moderate–high CPU/GPU for text shaping, vector/raster composition, cue layout, animation, and frame preview.
- **Compute — remote/final:** CPU/GPU worker renders titles/captions consistently and performs transcription only when an analysis feature requires it.
- **Storage and data movement:** Local project document and revision log in IndexedDB/OPFS; fonts/graphics as assets; style presets in Small versioned preset/template records locally and optionally in the account database; caption/transcript text in project/database; Rendered outputs in temporary storage followed by object storage/download. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Title/caption tool, text/graphics inspector, safe-area overlays, style browser, animation controls, caption track/table, cue timing, and preview.
- **Application component dependencies:** `C-TEXT`, `C-VECTOR`, `C-TIMELINE`, `C-KEYFRAME`, `C-COMPOSITOR`, `C-PRESET`, `C-EXPORT`.
- **Technical/runtime dependencies:** Unicode shaping/bidi, font loading/licensing, subtitle cue model/formats, safe-area rules, frame-accurate animation and server font parity.
- **WebMCP scope:** `read`, `write`, `teach`, `navigate`. `inspect_titles_or_captions`, `add_or_edit_title`, `manage_caption_cue`, `apply_text_style`, `preview_at_time`, and optional `start_transcription_job`; return object/cue IDs. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters. `inspect_text`, `add_or_update_text`, `apply_text_style`, and `focus_text_editor`; return object/cue IDs and layout warnings.
- **Fallback/constraint:** Substitute fonts explicitly and retain editable caption text; burn captions remotely when local rendering cannot reproduce the style.

## AI-assisted video capabilities

### VI-063 — Beat detection and cut-to-music assistance

- **Classification:** Video → AI-assisted video capabilities; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Analysis request, source/time range, model/version, extracted features or proposals, confidence, editable resulting operations, and approval/transaction state. Audio asset/range, analysis version, beat/downbeat/section timestamps, confidence, and proposed snap/cut operations.
- **Compute — browser/interactive:** Low–moderate local worker analysis for lightweight audio features or intent translation; never block UI and always emit inspectable proposals/operations.
- **Compute — remote/final:** CPU/GPU/ML worker for reliable beat/section analysis or model inference; results are small metadata/operation payloads.
- **Storage and data movement:** Original media in local file handles or object storage when remote analysis is approved; analysis features/proposals in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; accepted edits in Local project document and revision log in IndexedDB/OPFS.
- **UI requirements:** Analysis controls and progress, proposal/compare panel, confidence markers, editable parameters, accept/reject, and one-step undo.
- **Application component dependencies:** `C-ML`, `C-JOBS`, `C-WORKER`, `C-COMMAND`, `C-HISTORY`, `C-WEBMCP`, `C-TIMELINE`, `C-AUDIO`.
- **Technical/runtime dependencies:** Audio feature extraction/model runtime, structured-output validation, deterministic command translation, job orchestration, model/version provenance.
- **WebMCP scope:** `read`, `write`, `job`, `confirm`, `teach`. `inspect_analysis_context`, `propose_ai_edit`, `start_analysis_job`, `apply_transaction`, `get_job_status`, and `explain_proposal`; return confidence, operations, and transaction ID. `start_beat_analysis`, `inspect_beats`, and `propose_cut_to_music`; applying cuts is a separate explicit transaction.
- **Fallback/constraint:** Provide manual markers/parameter editing when analysis is unavailable; never conceal the explicit operations produced by AI.

### VI-064 — Natural-language effect and parameter editing

- **Classification:** Video → AI-assisted video capabilities; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Analysis request, source/time range, model/version, extracted features or proposals, confidence, editable resulting operations, and approval/transaction state. Resolved deterministic operations, target IDs, normalized parameters, assumptions, proposal/commit state, and provenance.
- **Compute — browser/interactive:** Low–moderate local worker analysis for lightweight audio features or intent translation; never block UI and always emit inspectable proposals/operations.
- **Compute — remote/final:** CPU/GPU/ML worker for reliable beat/section analysis or model inference; results are small metadata/operation payloads.
- **Storage and data movement:** Original media in local file handles or object storage when remote analysis is approved; analysis features/proposals in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; accepted edits in Local project document and revision log in IndexedDB/OPFS.
- **UI requirements:** Analysis controls and progress, proposal/compare panel, confidence markers, editable parameters, accept/reject, and one-step undo.
- **Application component dependencies:** `C-ML`, `C-JOBS`, `C-WORKER`, `C-COMMAND`, `C-HISTORY`, `C-WEBMCP`, `C-TIMELINE`.
- **Technical/runtime dependencies:** Audio feature extraction/model runtime, structured-output validation, deterministic command translation, job orchestration, model/version provenance.
- **WebMCP scope:** `read`, `write`, `job`, `confirm`, `teach`. `inspect_analysis_context`, `propose_ai_edit`, `start_analysis_job`, `apply_transaction`, `get_job_status`, and `explain_proposal`; return confidence, operations, and transaction ID. Natural language itself is not the editing primitive: translate it into existing inspectable WebMCP operations and return the complete operation list.
- **Fallback/constraint:** Provide manual markers/parameter editing when analysis is unavailable; never conceal the explicit operations produced by AI.

## Collaboration and review for video

### VI-065 — Timecoded comments

- **Classification:** Video → Collaboration and review for video; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Project/review revision, share token, reviewer role, time/frame/range anchors, annotations, version stack, lock owner, and lock expiry. Comment text, author, status/thread, revision, and object/region/time anchor with migration metadata. Rational time or source/project timecode, duration, name, color, comment, and anchor target.
- **Compute — browser/interactive:** Moderate browser CPU for playback-aligned annotations, overlays, comparisons, and revision-aware anchor updates.
- **Compute — remote/final:** CPU/I/O for secure proxy generation/streaming, version preparation, permission enforcement, and comment persistence.
- **Storage and data movement:** Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies/versions in object storage; project locks and permissions in database; no duplicate originals unless required.
- **UI requirements:** Review player, timeline comment pins, drawing/annotation overlay, thread panel, version selector/comparison, share/role controls, and lock status.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-PROJECT`, `C-VIDEO`, `C-PREVIEW`, `C-CLOUD-STORE`, `C-TIMELINE`, `C-METADATA`.
- **Technical/runtime dependencies:** Signed URLs, proxy streaming, frame/time anchors, revision identity, optimistic concurrency/leases, annotation geometry.
- **WebMCP scope:** `read`, `write`, `confirm`, `teach`, `navigate`. `inspect_review_state`, `add_or_resolve_time_comment`, `manage_review_link`, `compare_versions`, and `acquire_or_release_project_lock`; return anchor/revision/permission status. `add_comment`, `reply_or_resolve_comment`, and `list_comments`; return exact anchor and revision. `list_markers`, `add_or_update_marker`, and `navigate_to_time`; return normalized frame/timecode.
- **Fallback/constraint:** Use a rendered read-only review page when editable media or synchronized comparison is unavailable.

### VI-066 — Review links with playback and annotations

- **Classification:** Video → Collaboration and review for video; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Project/review revision, share token, reviewer role, time/frame/range anchors, annotations, version stack, lock owner, and lock expiry. Comment text, author, status/thread, revision, and object/region/time anchor with migration metadata.
- **Compute — browser/interactive:** Moderate browser CPU for playback-aligned annotations, overlays, comparisons, and revision-aware anchor updates.
- **Compute — remote/final:** CPU/I/O for secure proxy generation/streaming, version preparation, permission enforcement, and comment persistence.
- **Storage and data movement:** Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies/versions in object storage; project locks and permissions in database; no duplicate originals unless required.
- **UI requirements:** Review player, timeline comment pins, drawing/annotation overlay, thread panel, version selector/comparison, share/role controls, and lock status.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-PROJECT`, `C-VIDEO`, `C-PREVIEW`, `C-CLOUD-STORE`.
- **Technical/runtime dependencies:** Signed URLs, proxy streaming, frame/time anchors, revision identity, optimistic concurrency/leases, annotation geometry.
- **WebMCP scope:** `read`, `write`, `confirm`, `teach`, `navigate`. `inspect_review_state`, `add_or_resolve_time_comment`, `manage_review_link`, `compare_versions`, and `acquire_or_release_project_lock`; return anchor/revision/permission status. `add_comment`, `reply_or_resolve_comment`, and `list_comments`; return exact anchor and revision.
- **Fallback/constraint:** Use a rendered read-only review page when editable media or synchronized comparison is unavailable.

### VI-067 — Version stacks and side-by-side version comparison

- **Classification:** Video → Collaboration and review for video; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Project/review revision, share token, reviewer role, time/frame/range anchors, annotations, version stack, lock owner, and lock expiry. Named revision metadata, parent revision, actor, timestamp, and optional comparison render.
- **Compute — browser/interactive:** Moderate browser CPU for playback-aligned annotations, overlays, comparisons, and revision-aware anchor updates. Dual render states with synchronized viewport/playhead; cache both sides within an explicit memory budget.
- **Compute — remote/final:** CPU/I/O for secure proxy generation/streaming, version preparation, permission enforcement, and comment persistence.
- **Storage and data movement:** Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies/versions in object storage; project locks and permissions in database; no duplicate originals unless required.
- **UI requirements:** Review player, timeline comment pins, drawing/annotation overlay, thread panel, version selector/comparison, share/role controls, and lock status. Split/wipe/A-B controls and clearly labelled revisions.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-PROJECT`, `C-VIDEO`, `C-PREVIEW`, `C-CLOUD-STORE`, `C-HISTORY`.
- **Technical/runtime dependencies:** Signed URLs, proxy streaming, frame/time anchors, revision identity, optimistic concurrency/leases, annotation geometry.
- **WebMCP scope:** `read`, `write`, `confirm`, `teach`, `navigate`. `inspect_review_state`, `add_or_resolve_time_comment`, `manage_review_link`, `compare_versions`, and `acquire_or_release_project_lock`; return anchor/revision/permission status. Include revision selectors and return immutable revision IDs. `compare_revisions` or `render_comparison`; return the exact revision pair.
- **Fallback/constraint:** Use a rendered read-only review page when editable media or synchronized comparison is unavailable.

### VI-068 — Shared projects and project locking

- **Classification:** Video → Collaboration and review for video; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Project/review revision, share token, reviewer role, time/frame/range anchors, annotations, version stack, lock owner, and lock expiry. Actor identity, authorization decision, consequence summary, and confirmation/audit state.
- **Compute — browser/interactive:** Moderate browser CPU for playback-aligned annotations, overlays, comparisons, and revision-aware anchor updates.
- **Compute — remote/final:** CPU/I/O for secure proxy generation/streaming, version preparation, permission enforcement, and comment persistence. Control-plane synchronization, conflict detection, revision exchange, and resumable media transfer.
- **Storage and data movement:** Comment, anchor, actor, permission, and revision records in the collaboration database; review proxies/versions in object storage; project locks and permissions in database; no duplicate originals unless required. Cloud revision/object records plus local pending-operation journal.
- **UI requirements:** Review player, timeline comment pins, drawing/annotation overlay, thread panel, version selector/comparison, share/role controls, and lock status.
- **Application component dependencies:** `C-COLLAB`, `C-PERMISSION`, `C-PROJECT`, `C-VIDEO`, `C-PREVIEW`, `C-CLOUD-STORE`, `C-SYNC`.
- **Technical/runtime dependencies:** Signed URLs, proxy streaming, frame/time anchors, revision identity, optimistic concurrency/leases, annotation geometry.
- **WebMCP scope:** `read`, `write`, `confirm`, `teach`, `navigate`. `inspect_review_state`, `add_or_resolve_time_comment`, `manage_review_link`, `compare_versions`, and `acquire_or_release_project_lock`; return anchor/revision/permission status. Return synchronization/lock state and explicit conflict objects; never silently overwrite. Mark side effects explicitly and return permission/confirmation requirements before transmission, deletion, or publishing.
- **Fallback/constraint:** Use a rendered read-only review page when editable media or synchronized comparison is unavailable.

## Video formats, rendering, and delivery

### VI-069 — Import common MP4/MOV/WebM media

- **Classification:** Video → Video formats, rendering, and delivery; necessity **Foundational**; browser difficulty **High**.
- **Project/data requirements:** Import/export capability, source streams, sequence/range, render graph revision, format/container/codec/audio/caption settings, preset, naming, destination, and publish metadata. Container/format, codec, stream/image properties, alpha/profile/metadata support, capability result, and conversion policy.
- **Compute — browser/interactive:** High worker/media CPU and optional hardware encode for local probing, decoding, preview estimates, and small compatible exports. Probe support before decode/encode; demux/mux and format libraries run in a worker where browser-native support is incomplete.
- **Compute — remote/final:** CPU/GPU media worker is primary for deterministic final composition, muxing, codec coverage, watermarks, and platform delivery. CPU media worker supplies the authoritative compatibility path and consistent encoding.
- **Storage and data movement:** Original media in local file handles or object storage; proxies/intermediates in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download; resumable upload and job records in object/database storage.
- **UI requirements:** Import diagnostics, export/preset dialog, range selector, codec/quality controls, size estimate, progress/cancel/retry, output preview, download, and publish confirmation.
- **Application component dependencies:** `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PUBLISH`, `C-COMPOSITOR`, `C-VIDEO`, `C-AUDIO`, `C-IMPORT`.
- **Technical/runtime dependencies:** Demux/mux, FFmpeg or equivalent worker runtime, WebCodecs capability detection, image/audio encoders, resumable object storage, OAuth for publishing.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_media_or_export_capabilities`, `configure_export`, `start_render_job`, `get_job_status`, `cancel_job`, and `publish_output`; return validation, progress, output asset, and publish receipt. `inspect_format_support`, `import_media`, or `start_export_job`; return detected streams, substitutions/conversions, and output ID.
- **Fallback/constraint:** Offer compatible proxy import and baseline MP4/WebM or audio output; queue unsupported formats and full-quality renders for a worker.

### VI-071 — Audio-only WAV, MP3, AAC, and FLAC export

- **Classification:** Video → Video formats, rendering, and delivery; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Import/export capability, source streams, sequence/range, render graph revision, format/container/codec/audio/caption settings, preset, naming, destination, and publish metadata. Container/format, codec, stream/image properties, alpha/profile/metadata support, capability result, and conversion policy.
- **Compute — browser/interactive:** High worker/media CPU and optional hardware encode for local probing, decoding, preview estimates, and small compatible exports. Probe support before decode/encode; demux/mux and format libraries run in a worker where browser-native support is incomplete.
- **Compute — remote/final:** CPU/GPU media worker is primary for deterministic final composition, muxing, codec coverage, watermarks, and platform delivery. CPU media worker supplies the authoritative compatibility path and consistent encoding.
- **Storage and data movement:** Original media in local file handles or object storage; proxies/intermediates in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download; resumable upload and job records in object/database storage.
- **UI requirements:** Import diagnostics, export/preset dialog, range selector, codec/quality controls, size estimate, progress/cancel/retry, output preview, download, and publish confirmation.
- **Application component dependencies:** `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PUBLISH`, `C-COMPOSITOR`, `C-VIDEO`, `C-AUDIO`, `C-IMPORT`.
- **Technical/runtime dependencies:** Demux/mux, FFmpeg or equivalent worker runtime, WebCodecs capability detection, image/audio encoders, resumable object storage, OAuth for publishing.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_media_or_export_capabilities`, `configure_export`, `start_render_job`, `get_job_status`, `cancel_job`, and `publish_output`; return validation, progress, output asset, and publish receipt. `inspect_format_support`, `import_media`, or `start_export_job`; return detected streams, substitutions/conversions, and output ID.
- **Fallback/constraint:** Offer compatible proxy import and baseline MP4/WebM or audio output; queue unsupported formats and full-quality renders for a worker.

### VI-072 — Export presets for social, web, archive, and professional delivery

- **Classification:** Video → Video formats, rendering, and delivery; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Import/export capability, source streams, sequence/range, render graph revision, format/container/codec/audio/caption settings, preset, naming, destination, and publish metadata.
- **Compute — browser/interactive:** High worker/media CPU and optional hardware encode for local probing, decoding, preview estimates, and small compatible exports.
- **Compute — remote/final:** CPU/GPU media worker is primary for deterministic final composition, muxing, codec coverage, watermarks, and platform delivery.
- **Storage and data movement:** Original media in local file handles or object storage; proxies/intermediates in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download; resumable upload and job records in object/database storage. Small versioned preset/template records locally and optionally in the account database
- **UI requirements:** Import diagnostics, export/preset dialog, range selector, codec/quality controls, size estimate, progress/cancel/retry, output preview, download, and publish confirmation.
- **Application component dependencies:** `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PUBLISH`, `C-COMPOSITOR`, `C-VIDEO`, `C-AUDIO`, `C-PRESET`.
- **Technical/runtime dependencies:** Demux/mux, FFmpeg or equivalent worker runtime, WebCodecs capability detection, image/audio encoders, resumable object storage, OAuth for publishing.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_media_or_export_capabilities`, `configure_export`, `start_render_job`, `get_job_status`, `cancel_job`, and `publish_output`; return validation, progress, output asset, and publish receipt. `list_presets`, `apply_preset`, and `save_preset`; return preset version and expanded parameters.
- **Fallback/constraint:** Offer compatible proxy import and baseline MP4/WebM or audio output; queue unsupported formats and full-quality renders for a worker.

### VI-073 — Render selected range, work area, or individual clips

- **Classification:** Video → Video formats, rendering, and delivery; necessity **Core**; browser difficulty **High**.
- **Project/data requirements:** Import/export capability, source streams, sequence/range, render graph revision, format/container/codec/audio/caption settings, preset, naming, destination, and publish metadata.
- **Compute — browser/interactive:** High worker/media CPU and optional hardware encode for local probing, decoding, preview estimates, and small compatible exports.
- **Compute — remote/final:** CPU/GPU media worker is primary for deterministic final composition, muxing, codec coverage, watermarks, and platform delivery.
- **Storage and data movement:** Original media in local file handles or object storage; proxies/intermediates in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download; resumable upload and job records in object/database storage.
- **UI requirements:** Import diagnostics, export/preset dialog, range selector, codec/quality controls, size estimate, progress/cancel/retry, output preview, download, and publish confirmation.
- **Application component dependencies:** `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PUBLISH`, `C-COMPOSITOR`, `C-VIDEO`, `C-AUDIO`.
- **Technical/runtime dependencies:** Demux/mux, FFmpeg or equivalent worker runtime, WebCodecs capability detection, image/audio encoders, resumable object storage, OAuth for publishing.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_media_or_export_capabilities`, `configure_export`, `start_render_job`, `get_job_status`, `cancel_job`, and `publish_output`; return validation, progress, output asset, and publish receipt. Feature discriminator: `operationType="render_selected_range_work_area_or_individual_clips"`; inspect and mutate only through the category command schema, returning affected IDs and a transaction/revision.
- **Fallback/constraint:** Offer compatible proxy import and baseline MP4/WebM or audio output; queue unsupported formats and full-quality renders for a worker.

### VI-074 — Direct publishing to social/video platforms

- **Classification:** Video → Video formats, rendering, and delivery; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Import/export capability, source streams, sequence/range, render graph revision, format/container/codec/audio/caption settings, preset, naming, destination, and publish metadata. Actor identity, authorization decision, consequence summary, and confirmation/audit state. Destination account, OAuth grant reference, output asset, title/description/privacy/thumbnail, platform validation, and publish receipt.
- **Compute — browser/interactive:** High worker/media CPU and optional hardware encode for local probing, decoding, preview estimates, and small compatible exports.
- **Compute — remote/final:** CPU/GPU media worker is primary for deterministic final composition, muxing, codec coverage, watermarks, and platform delivery. Server upload/publish task with resumable transfer, platform rate limits, and status polling.
- **Storage and data movement:** Original media in local file handles or object storage; proxies/intermediates in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download; resumable upload and job records in object/database storage.
- **UI requirements:** Import diagnostics, export/preset dialog, range selector, codec/quality controls, size estimate, progress/cancel/retry, output preview, download, and publish confirmation.
- **Application component dependencies:** `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PUBLISH`, `C-COMPOSITOR`, `C-VIDEO`, `C-AUDIO`, `C-PERMISSION`.
- **Technical/runtime dependencies:** Demux/mux, FFmpeg or equivalent worker runtime, WebCodecs capability detection, image/audio encoders, resumable object storage, OAuth for publishing.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`, `confirm`. `inspect_media_or_export_capabilities`, `configure_export`, `start_render_job`, `get_job_status`, `cancel_job`, and `publish_output`; return validation, progress, output asset, and publish receipt. Mark side effects explicitly and return permission/confirmation requirements before transmission, deletion, or publishing. `validate_publish_request` then `publish_output`; transmission and representational side effects require explicit confirmation and return destination receipt.
- **Fallback/constraint:** Offer compatible proxy import and baseline MP4/WebM or audio output; queue unsupported formats and full-quality renders for a worker.

### VI-075 — Watermarking and review burns

- **Classification:** Video → Video formats, rendering, and delivery; necessity **Advanced**; browser difficulty **High**.
- **Project/data requirements:** Import/export capability, source streams, sequence/range, render graph revision, format/container/codec/audio/caption settings, preset, naming, destination, and publish metadata. Watermark/review overlay type, text/image source, placement, opacity, timecode/date/version tokens, and output range.
- **Compute — browser/interactive:** High worker/media CPU and optional hardware encode for local probing, decoding, preview estimates, and small compatible exports.
- **Compute — remote/final:** CPU/GPU media worker is primary for deterministic final composition, muxing, codec coverage, watermarks, and platform delivery.
- **Storage and data movement:** Original media in local file handles or object storage; proxies/intermediates in Derived previews/proxies/masks/waveforms in OPFS cache and object storage; Rendered outputs in temporary storage followed by object storage/download; resumable upload and job records in object/database storage.
- **UI requirements:** Import diagnostics, export/preset dialog, range selector, codec/quality controls, size estimate, progress/cancel/retry, output preview, download, and publish confirmation.
- **Application component dependencies:** `C-CODEC`, `C-EXPORT`, `C-JOBS`, `C-WORKER`, `C-CLOUD-STORE`, `C-PUBLISH`, `C-COMPOSITOR`, `C-VIDEO`, `C-AUDIO`, `C-TEXT`.
- **Technical/runtime dependencies:** Demux/mux, FFmpeg or equivalent worker runtime, WebCodecs capability detection, image/audio encoders, resumable object storage, OAuth for publishing.
- **WebMCP scope:** `read`, `write`, `job`, `teach`, `navigate`. `inspect_media_or_export_capabilities`, `configure_export`, `start_render_job`, `get_job_status`, `cancel_job`, and `publish_output`; return validation, progress, output asset, and publish receipt. `configure_review_burn` or export overlay operation; return expanded token preview and output settings.
- **Fallback/constraint:** Offer compatible proxy import and baseline MP4/WebM or audio output; queue unsupported formats and full-quality renders for a worker.

# Validation summary

- Mapped feature records: **229**
- Shared: **89**
- Photo: **65**
- Video: **75**
- Every feature record contains project/data, browser compute, remote compute, storage/data movement, UI, component dependencies, runtime dependencies, WebMCP scope/operations, and fallback fields.
