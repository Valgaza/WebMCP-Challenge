# Project Agent Operating Instructions

These instructions apply to every agent working anywhere in this project. Read them before beginning any phase, feature, refactor, investigation, or infrastructure task.

The goal is not merely to produce code. The goal is to build a browser-based photo and video editor whose user interface and WebMCP capabilities share one reliable, non-destructive editing system.

## 1. Non-negotiable project principles

1. **Treat WebMCP as a foundational application layer.** Do not build the editor first and attach WebMCP afterward. Every new editable capability must be designed for both direct user interaction and structured agent interaction from the beginning.
2. **Use one command system for humans and agents.** UI actions and WebMCP tools must invoke the same validated domain commands, history system, permission checks, and project-state transitions.
3. **Preserve non-destructive editing.** Store source media separately from edit instructions. Do not mutate original assets as the normal editing model.
4. **Build on the approved scope.** The retained scope contains exactly 213 features. Do not add, remove, merge, split, or reorder features without explicit user approval.
5. **Treat each phase as a demonstrable product milestone.** A phase is not complete because its individual checkboxes exist. It is complete when its features work together to produce the phase exit condition and a repeatable demonstration.
6. **Use simple, straightforward terminology.** Explain outcomes, decisions, errors, and user actions in plain language. Introduce technical terminology only when it helps the user make a decision.
7. **Do not silently assume.** Inspect the repository and documentation first. If a material fact still cannot be established, ask the user instead of inventing an answer or choosing silently.
8. **Stay within the requested work.** Do not branch into unrelated enhancements, plans, or recommendations. Raise unrequested matters only when they block the task or would materially damage the project.

## 2. Sources of truth

Use these sources in this order:

1. The user's latest explicit instruction.
2. This `AGENTS.md` operating contract.
3. [`FEATURE_IMPLEMENTATION_PLAN.md`](./FEATURE_IMPLEMENTATION_PLAN.md) for phase order, phase dependencies, feature order, and phase exit conditions.
4. [`PRODUCT_DESIGN_BLUEPRINT.md`](./PRODUCT_DESIGN_BLUEPRINT.md) for visual identity, information architecture, interaction language, UI placement, loading feedback, accessibility, and feature-to-interface coverage.
5. [`FEATURE_DEPENDENCY_LEDGER.md`](./FEATURE_DEPENDENCY_LEDGER.md) for each feature's compute, storage, UI, application-component, runtime, WebMCP, and fallback requirements.
6. The current code, configuration, tests, and runtime behavior for what actually exists today.

The plan describes intended sequencing. The ledger describes intended requirements. The codebase describes current reality. If they disagree, do not hide the conflict or silently rewrite a canonical document. Explain the conflict, identify its effect, and ask the user before changing scope or architectural intent.

## 3. Mandatory reorientation before every phase

Do not rely on memory, a previous agent's summary, or an earlier conversation alone. Before starting a phase:

1. Re-read this entire file from disk.
2. Re-open `FEATURE_IMPLEMENTATION_PLAN.md` and read:
   - the ordering rules;
   - the dependency backbone;
   - the current phase;
   - the preceding phase's exit condition;
   - the following phase's dependency expectations.
3. Re-open `FEATURE_DEPENDENCY_LEDGER.md` and read:
   - coverage and interpretation;
   - the component vocabulary;
   - every ledger entry assigned to the current phase;
   - every earlier feature named or implied as a prerequisite;
   - any other entries that use the same application components.
4. Re-open `PRODUCT_DESIGN_BLUEPRINT.md` and read:
   - the experience and visual principles;
   - the editor-shell and route model;
   - the design-system and motion rules;
   - the WebMCP feedback state machine and wait-duration ladder;
   - the coverage rows for every feature in the current phase;
   - the unresolved design decisions, confirming that none are being silently assumed.
5. Inspect the live codebase rather than assuming its structure. At minimum, check:
   - repository status and existing user changes;
   - the file tree and relevant modules;
   - package manifests and lockfiles;
   - build, test, lint, formatting, and type-check configuration;
   - environment-variable examples and configuration loaders;
   - storage schemas and migrations;
   - WebMCP registrations and schemas;
   - worker, media, container, and deployment configuration;
   - existing tests and known failure output.
6. Trace the current implementation of the phase's prerequisite features. A document saying a prerequisite exists is not proof that its implementation works.
7. Confirm that the preceding phase's exit condition is demonstrably satisfied. If it is not, report the gap before depending on it.
8. Search for existing implementations before creating new components. Reuse or extend established project patterns when they are suitable.

## 4. Required phase brief before implementation

Before changing code for a phase, write a short phase brief in the conversation. It must contain:

- **Phase:** number, title, sequence range, and feature IDs.
- **Demonstrable goal:** one plain-language sentence describing what a user or agent will be able to accomplish when the phase works.
- **Entry state:** the prerequisite behavior that has been verified in the current codebase.
- **Implementation slices:** the smallest end-to-end increments that combine UI, domain logic, persistence, compute, and WebMCP behavior.
- **WebMCP coverage:** inspection, mutation, validation, results, undo/transaction handling, preview/focus, jobs, and permissions relevant to the phase.
- **Acceptance evidence:** tests, observable state changes, and the exact demonstration that will prove completion.
- **Expected user actions:** credentials, environment variables, Docker commands, external-service setup, device permissions, or decisions that only the user can provide.
- **Non-goals:** nearby features or infrastructure explicitly outside the current phase.
- **Open decisions:** anything material that cannot be established from the repository or canonical documents.

Do not treat this brief as permission to expand scope. Do not begin an affected implementation branch while a material decision or required user action remains unresolved.

## 5. Define a demonstrable goal for every phase

For each phase, turn its documented exit condition into a repeatable demonstration with:

1. A known starting state.
2. A small, legal test asset or fixture when media is required.
3. The user-interface actions.
4. The equivalent WebMCP inspection and editing actions.
5. The expected project-state or revision changes.
6. The expected preview or rendered output.
7. The expected undo, retry, cancellation, error, and fallback behavior where relevant.
8. Clear pass/fail criteria.

Prefer a narrow end-to-end demonstration over disconnected component demos. A phase demonstration must exercise the systems together, not only show that each module can be called in isolation.

## 6. WebMCP implementation rules

Apply these rules whenever a feature exposes or changes user-visible state:

1. Register WebMCP capability alongside the feature, not in a later cleanup pass.
2. Use stable project, asset, layer, track, clip, operation, revision, and job identifiers. Never make an agent depend on screen coordinates, visual guessing, or unstable list positions.
3. Use versioned, typed input and output schemas with explicit units, ranges, defaults, target IDs, and failure conditions.
4. Separate inspection from mutation. Read tools must not mutate state as a side effect.
5. Route mutations through the same command and transaction engine as the UI.
6. Make edits deterministic. Identical inputs against the same project revision must have a predictable result.
7. Return useful structured results: affected IDs, changed ranges or bounds, new revision, transaction or undo token, warnings, substitutions, and validation errors.
8. Support dry-run or proposal behavior for multi-step, ambiguous, expensive, destructive, or externally visible operations.
9. Require explicit confirmation for destructive edits, uploads, external sharing, publishing, or other material side effects.
10. Never let WebMCP bypass permissions, validation, history, provenance, storage rules, or project locks.
11. Expose long-running work as jobs with status, progress, cancellation, retry information, and final output identifiers.
12. Register only capabilities that actually work in the current runtime. Capability discovery must accurately reflect browser, codec, worker, and account availability.
13. Provide preview, focus, and explanation hooks when the user needs to inspect or learn from the proposed change.
14. Keep human-readable summaries paired with machine-readable results.
15. Test UI and WebMCP parity: the same edit performed through either path must produce equivalent project state and history.

## 7. Architecture and browser-performance rules

1. Follow the compute and storage boundaries in the ledger. Do not silently move a browser task to a server or a remote task into the browser.
2. Keep interaction-critical work off blocking paths. Heavy decode, encode, analysis, proxy generation, waveform generation, and full-quality rendering must not freeze the browser's main thread.
3. Use browser workers, WebCodecs, WebAssembly, GPU paths, remote workers, or fallbacks only after checking actual runtime support.
4. Use bounded memory. Prefer tiles, chunks, streams, proxies, incremental processing, cache quotas, eviction, and cancellation over loading full-resolution media indiscriminately.
5. Treat original media as immutable input. Treat derived previews, thumbnails, waveforms, masks, and proxies as reproducible cache data. Treat exports as separate outputs.
6. Keep project documents small by storing stable asset references and edit instructions rather than duplicating large media.
7. Version persistent schemas and serialized commands from the beginning. Provide migrations or explicit incompatibility errors when schemas change.
8. Reuse shared engines for transforms, masks, effects, presets, text, color, history, and commands. Do not create unrelated photo and video implementations when the plan identifies a shared component.
9. Use capability detection and documented fallback behavior. Do not assume a codec, GPU feature, file-system API, browser API, or hardware encoder is available.
10. Measure performance-sensitive behavior with representative media. Do not call something optimized based only on intuition or a trivial fixture.
11. Do not hardcode a developer laptop, worker address, storage bucket, API host, filesystem path, or deployment environment into application logic.
12. Do not assume remote compute, a queue, object storage, authentication, or an external provider exists until the repository and user confirm it.

## 8. No-silent-assumption protocol

Before making a material choice, first try to establish the answer from the repository, canonical documents, existing configuration, tests, and runtime output.

Do not assume:

- framework, language, package manager, or directory structure;
- browser support or target browser versions;
- available CPU, GPU, memory, disk, network, or worker capacity;
- codec, FFmpeg, WebAssembly, WebCodecs, or native-library availability;
- API contracts, WebMCP schemas, endpoints, ports, domains, or callback URLs;
- authentication, authorization, tenancy, privacy, or retention behavior;
- database, queue, object-storage, cloud, or deployment provider;
- environment-variable names or the presence of credentials;
- the meaning of an ambiguous design decision;
- that a mock, stub, placeholder, or happy-path prototype satisfies a feature;
- that existing tests prove behavior they do not actually exercise.

A hypothesis may guide investigation, but it must not quietly become implementation truth. When evidence cannot resolve a consequential choice, ask one focused question, explain why it matters, and pause only the affected work.

## 9. Actions that require explicit user approval

Do not perform any of the following without explicit approval for the exact action:

- committing or pushing Git changes;
- creating, deleting, renaming, checking out, rebasing, merging, or force-updating branches or tags;
- opening, updating, merging, or closing a pull request;
- discarding, resetting, stashing, or overwriting user changes;
- deploying, publishing, releasing, or changing a live environment;
- provisioning, modifying, or deleting cloud resources;
- uploading media or project data to an external service;
- enabling a paid service or action that may incur cost;
- adding a production dependency, external SDK, hosted service, or model provider not already approved;
- changing the canonical 213-feature scope or implementation order;
- running a data migration, destructive seed, bulk mutation, or cleanup against persistent data;
- changing authentication, authorization, sharing, privacy, or retention policy;
- installing system-wide software or changing machine-level configuration.

Approval for one action does not imply approval for later similar actions. Never use force push, destructive reset, or broad deletion unless the user explicitly requests the exact operation and target.

## 10. Docker, services, credentials, and other user-run actions

The agent may write or edit a `Dockerfile`, Compose file, container configuration, scripts, or documentation when the task requires it. **The agent must not build, run, start, stop, restart, or remove Docker containers or Compose services.** Ask the user to perform those actions.

When Docker execution is needed:

1. Finish and verify the configuration statically as far as possible.
2. Give the user the exact command to run.
3. Explain what it will do and whether it changes persistent data.
4. State the expected successful output or health check.
5. Ask the user to return the relevant output, with secrets removed.
6. Wait for the result before claiming the containerized path works.

When an API key, token, credential, OAuth connection, certificate, or secret is required:

1. Define and document the expected environment-variable name and purpose.
2. Use placeholders in examples; never invent a real value.
3. Ask the user to add the value to the appropriate local or hosted secret store.
4. Never ask the user to paste the secret into chat.
5. Never print, read back, log, commit, or expose the value.
6. Confirm availability only through a safe redacted check or the resulting authenticated behavior.

Ask the user to perform actions that require personal login, billing acceptance, OAuth consent, device permissions, cloud-console access, DNS changes, app-store access, or other human authority. Do not work around those boundaries.

Group foreseeable user actions into one clear request when possible. Use this format:

- **Action required:** what the user must do.
- **Why:** which implementation or verification step requires it.
- **Exact steps:** commands or interface actions.
- **Expected result:** what success looks like.
- **Return to the agent:** the non-sensitive output needed to continue.
- **Risk or side effect:** cost, data changes, network exposure, or service impact.

## 11. Source-control and workspace safety

1. Inspect repository status before editing and again before reporting completion.
2. Treat all pre-existing changes as user-owned. Preserve them and work around unrelated edits.
3. Do not rewrite, reformat, rename, or clean unrelated files.
4. Do not use destructive Git or filesystem commands to make the workspace look clean.
5. Do not commit or push without explicit user approval, even if a phase is complete.
6. Do not assume the directory is a Git repository. Verify first.
7. Use narrow, reviewable changes. Avoid broad mechanical rewrites unless they are necessary and explained.
8. Keep secrets, generated media, large binaries, caches, local databases, and build artifacts out of version control unless the project explicitly requires a tracked fixture.
9. Before any approved commit, show the intended files and a concise change summary. Before any approved push, state the exact branch and remote.

## 12. Security, privacy, and media safety

Even during a hackathon, do not introduce obvious unsafe behavior.

1. Validate file type, size, dimensions, duration, container structure, names, and metadata before processing untrusted media.
2. Treat filenames, metadata, captions, project files, SVG, URLs, and WebMCP inputs as untrusted data.
3. Prevent path traversal, script injection, unsafe SVG execution, arbitrary command execution, and unrestricted remote URL fetching.
4. Do not upload user media without an explicit action and clear destination.
5. Use least-privilege permissions for storage, jobs, workers, publishing, and collaboration.
6. Do not log secrets, signed URLs, private media content, access tokens, or unnecessary personal data.
7. Separate temporary worker files and derived caches from durable originals and exported results.
8. Make deletion, external sharing, and publishing consequences explicit and confirm them when required.
9. Use media fixtures that the project has permission to use. Do not add copyrighted or personal test media casually.
10. Report security concerns that materially affect the requested work, but do not expand into unrelated production-hardening work without approval.

## 13. Testing and verification

1. Do not claim a feature or phase works without evidence.
2. Add or update tests with the implementation, at the appropriate levels:
   - schema and validation tests;
   - command, history, undo, and persistence tests;
   - component and interaction tests;
   - WebMCP contract and UI-parity tests;
   - worker, job, retry, cancellation, and fallback tests;
   - import/export and round-trip tests;
   - accessibility and keyboard tests;
   - end-to-end phase demonstration tests where practical.
3. Run safe, relevant local checks available in the repository. Do not run Docker under any circumstance; use the user-action protocol instead.
4. Test failure paths, unsupported capabilities, invalid input, missing media, cancellation, and recovery—not only the happy path.
5. Test persistent changes across reload or restart when persistence is part of the feature.
6. Compare UI and WebMCP results at the project-state level, not only by screenshot.
7. Use representative media sizes for performance checks and record the test conditions.
8. If a check cannot be run, state exactly why, what remains unverified, and the precise user action needed.
9. A mock or stub may support incremental development, but label it clearly and do not count the real feature as complete.

## 14. Definition of feature completion

A feature is complete only when all applicable conditions are met:

- its approved user outcome works;
- it uses the intended shared application components;
- its state model is non-destructive and versioned where required;
- its UI is operable and provides clear feedback;
- its WebMCP inspection and mutation behavior is registered and validated;
- UI and WebMCP operations have equivalent domain results;
- undo, history, summaries, permissions, and confirmations behave correctly;
- compute and storage placement follow the ledger;
- progress, cancellation, retry, and fallbacks exist when applicable;
- errors are structured, actionable, and safe;
- relevant accessibility behavior exists;
- tests and a demonstration provide evidence;
- no placeholder is being represented as the final implementation;
- documentation and schemas affected by the implementation are current.

## 15. Definition of phase completion

A phase is complete only when:

1. Every feature ID assigned to the phase meets the feature-completion criteria.
2. The phase's prerequisites remain working.
3. The documented phase exit condition is satisfied.
4. The phase demonstration runs from its known starting state to its expected result.
5. Both the user-interface path and relevant WebMCP path are demonstrated.
6. Cross-feature behavior works; the phase is not a collection of isolated controls.
7. Persistence, undo, errors, fallbacks, and long-running job behavior are demonstrated where relevant.
8. Relevant automated checks pass.
9. Any user-run checks have been completed and their non-sensitive results recorded.
10. Known limitations, deviations, and unverified behavior are explicitly reported.

Do not mark a phase complete merely because time expired, code was written, the happy path rendered once, or individual feature stubs exist.

## 16. Communication rules

1. Lead with the outcome or current blocker.
2. Use short, plain sentences and straightforward terminology.
3. Distinguish verified facts, open questions, user decisions, and unverified hypotheses.
4. Explain why a user action is required and provide exact instructions.
5. Do not overwhelm the user with raw logs; quote only the relevant output and summarize the rest.
6. Do not quietly continue past a failed prerequisite, test, migration, service start, or user action.
7. Do not propose unrelated future work. Mention an unrequested issue only if it blocks progress or is materially detrimental to the project.
8. Do not claim completion when work remains, a required service was not run, credentials are absent, or verification was delegated to the user.
9. When architecture or scope must change, explain the evidence, affected feature IDs, dependency consequences, and available choices before editing canonical documents.

## 17. Required phase handoff report

At the end of phase work, report:

- the demonstrable outcome achieved;
- feature IDs completed, partially completed, or blocked;
- important architectural decisions made with user approval;
- files and schemas changed;
- WebMCP capabilities added or changed;
- tests and demonstrations run, with results;
- performance conditions and observed results where relevant;
- user-run actions completed or still required;
- known limitations, fallbacks, and unverified behavior;
- repository status;
- confirmation that no commit or push was performed unless explicitly approved.

Keep the report self-contained and easy to verify.

## 18. Pre-work checklist

Before writing code, confirm all of the following:

- [ ] I re-read `AGENTS.md` from disk.
- [ ] I re-opened the implementation plan, product design blueprint, and dependency ledger.
- [ ] I inspected the current codebase, configuration, tests, and repository status.
- [ ] I verified the preceding phase's exit condition or reported the gap.
- [ ] I identified the current phase's feature IDs and shared components.
- [ ] I wrote a demonstrable phase goal and acceptance evidence.
- [ ] I accounted for WebMCP in the design.
- [ ] I identified required user actions without requesting sensitive values.
- [ ] I identified material unknowns and asked instead of assuming.
- [ ] I confirmed that the proposed work does not silently change scope or phase order.

## 19. Pre-completion checklist

Before saying the work is complete, confirm all of the following:

- [ ] The phase exit condition is demonstrably satisfied.
- [ ] UI and WebMCP paths produce equivalent validated domain state.
- [ ] Undo, persistence, permissions, errors, and fallbacks were checked where applicable.
- [ ] Relevant tests pass, or every unrun check is clearly identified.
- [ ] Docker-dependent verification was performed by the user, not by the agent.
- [ ] No secret was requested, exposed, logged, or committed.
- [ ] Existing user changes remain intact.
- [ ] Canonical documents still match the implementation, or discrepancies were approved and documented.
- [ ] Repository status was inspected.
- [ ] No commit, push, deployment, upload, or external side effect occurred without explicit approval.
