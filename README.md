# Estro

**A photo editor that doesn't assume you already know the words.**

Every editor puts Saturation, Temperature and Hue in front of you and takes for granted that you know what they mean. Most people don't, so they never touch them, and the photograph stays as it came off the phone.

Estro's answer is that you already have somewhere to say what you want: the agent window you are talking in. Estro is the editor it reaches into. Ask for "a bit warmer" and the agent moves the real Temperature control, and the edit arrives carrying its own explanation — which control changed, and what that control actually does.

There is no chat box bolted onto this app, deliberately. A second conversation inside the editor would be a worse copy of the one you are already having, so instead every command is published on `document.modelContext` and every result carries the plain-language sentence the agent can hand straight back to you. Learn it by watching, or never learn it and keep asking. Both work.

Open it, press **Load the sample project**, and there is a photograph on a canvas with layers, adjustments and a history. Nothing is uploaded; the sample is drawn in your browser and imported through the same path your own files take.

## For an agent

Estro registers **56 tools** on `document.modelContext` at module load, before first paint. Start with `list_projects` — nearly every other tool takes a `projectId`, and that is the only way to discover one. If the browser holds no projects, call `manage_project` with `operation: "create_sample"`: a browser cannot open a file without a user gesture, so that call draws three photographs, imports them, and builds a project with a document and a title layer in one step.

Every result is a JSON envelope carrying `ok`, `schemaVersion`, the previous and resulting revision IDs, a `transactionId`, an `undoToken`, `affectedIds`, warnings, and a plain-language `summary`. Colour and layer commands also return an `explanation`: what the term means in ordinary words, so an agent can pass it straight back to someone who did not know it. Every mutation accepts an optional `expectedRevisionId` and is refused with `HISTORY_CONFLICT` if the project has moved on — checked immediately before the commit, not before the call. Errors carry a `code`, a `fieldPath`, a `recoverySuggestion`, and `projectPreserved`.

`resolve_phrase` turns an ordinary phrase — "a bit warmer", "punchier", "black and white" — into a command Estro already has, and **returns it rather than performing it**, together with the sentence describing what it understood and the words it did not recognise. That is deliberately not a language model: an agent can already write JSON, so a second natural-language layer that *guessed* would add nothing but a way to be wrong. What it adds instead is a fixed vocabulary of 81 phrases the agent can resolve against, and a reading a person can be shown before anything happens. `list_phrases` publishes the whole vocabulary.

Agent work is never invisible: every tool surfaces a card in the interface, every committed revision carries an Undo button beside it, and edits worth explaining carry their explanation on the card too.

Testing it needs a WebMCP-capable browser: Chrome 149 or newer with `chrome://flags/#enable-webmcp-testing`, or ChatGPT's in-app browser. `ModelContext` is a secure context, so an `http://` host registers nothing — use HTTPS or `localhost`.

## What it does

**Media.** Import photographs through the file picker, drag-and-drop, or a whole folder. Each import is a cancellable job that validates, stores the original durably, reads it back, probes it, and only then commits a project reference — so history can never point at a file that is not there. Every import gets a real thumbnail. Filter and sort the library, organize it into bins or a freeform storyboard, and tag, rate and collect. When a file goes missing, relink or replace it and every edit that points at it survives, with any loss reported first.

**Editing.** Place photographs on the canvas as layers, then move, scale, rotate, straighten, flip and crop them with a draggable overlay or exact numbers. Stack, group, nest, rename, duplicate, reorder, lock, hide, solo and isolate. Add text and shapes, which land centred and in a colour chosen to be legible against the document. Adjust brightness, contrast, temperature, tint, hue, saturation and lightness non-destructively, with a live per-channel histogram that names which channel is clipping and by how much. Compare against a real earlier revision — the original import, the previous one, or one you pick — in toggle, hold, split or side-by-side view.

**Selecting and painting.** Rectangle, ellipse, freehand and magic-wand selection, drawn by dragging on the canvas with a crawling edge you can see against any picture, plus select-all, deselect, feather and fill. Twelve brushes: paint, pencil and eraser, then heal, clone, dodge, burn, sponge, blur, sharpen, smudge and red-eye. Healing borrows texture from one place and keeps the colour and brightness where you paint, which is why a healed blemish disappears where a cloned one shows as a patch. Strokes are kept as strokes rather than as pixels, so one can be restyled long after it was drawn and still redraws sharply at export size.

**Masks, channels and colour.** Confine any change to a rectangle, an ellipse, or a range of tones, with feather and density. Show, hide or isolate the red, green, blue and alpha channels — a view state applied as a display filter, so it never becomes an edit or lands in Undo. Save a selection as an alpha channel and load it back later. Curves, levels, colour balance, selective colour, channel mixer, gradient maps and photo filters, each as a separate re-orderable effect. Camera profiles and creative looks, each with a strength, whose operations show up as ordinary edits you can read rather than as a black box.

**Corrections and shape.** Perspective lean, levelling, lens distortion, colour fringing and corner brightness. Skew. A warp mesh you bend by picking a control point and nudging it.

**Reuse and batches.** Save a look off one layer and put it on any number of others in a single transaction, so one Undo returns every one of them. Match a whole set of photographs to one you have finished — each keeps its own history and its own Undo step, because each project does. Export a set in several sizes and formats at once as a cancellable background job, costed before it runs.

**Handing it over.** Write a project out whole — every edit, its history, and the photographs if you ask for them — as one file, with an estimate first that names every photograph that will not fit in it. Record that a version went out for review, and keep notes anchored to the revision they were written about, so a note about a version that has since changed says so.

**Text, shapes and SVG.** Text with size, weight, tracking and alignment; rectangles, ellipses and paths; six layer styles. Bring an SVG in as editable objects, one layer per shape, with anything undrawable named rather than dropped, and write the shapes back out. Named colours and gradients shared by everything pointing at them, so changing the brand red is one edit rather than forty.

**Nothing is permanent.** Every change is a transaction on a non-destructive revision. The History panel names who asked for what and when, distinguishes your edits from an agent's, and reverts any of them, with a warning first if something else depends on it.

**Delivery.** Export at a chosen format, size and resampling algorithm, with the file size measured by encoding rather than estimated. Finished outputs are durable records that survive a reload.

## What this browser cannot do

Estro reports these through `get_capabilities` and in the interface rather than failing at the end of a long operation:

- **An agent cannot open a file.** Browsers grant file access only from a user gesture, so the agent focuses the Import or Relink control, says whether an editor was open to receive that focus, and explains why.
- **Formats are probed, not assumed.** Which picture formats can be decoded and encoded is tested in your actual browser; anything unavailable is disabled with its reason rather than failing at the end of an export.
- **Where a browser provides no durable private storage,** an imported file is held for the session only. That is disclosed at import and again in the asset's details.

## Where the compute comes from

All of it runs in the tab. There is no server, no account, and no upload: `remoteCompute` is false and nothing in the app makes a network request after the page loads. Originals live in the origin private file system, project history in IndexedDB, and a 256 MB LRU cache holds derived previews. Thumbnails, resampling, histograms and hashing run in a dedicated worker; compositing runs on the main thread, and a filter whose cost would block it for minutes is refused with the reason rather than attempted.

There are no third-party runtime dependencies beyond React, the router, Dexie, Zod and an icon set. Nothing is bundled under a copyleft licence.


## Scope

Estro was built against a 213-feature plan covering both photographs and video, in twelve dependency-ordered phases. **On 3 September 2026 every video capability was retired and deleted from the codebase rather than hidden.**

What went: sequences and the timeline, clips and tracks, transitions, titles and captions, the Source and Program monitors, video decode and WebCodecs encode, WebM muxing, proxies, the whole audio pipeline — mixing, effects, loudness, beat detection, voice-over, and WAV/MP3/FLAC/AAC/Opus export — platform delivery checks, and media usage reporting. Roughly 12,500 lines, 14 WebMCP tools, five interface panels, and the LGPL-licensed MP3 encoder that was the project's only copyleft dependency. Sequences came out of the project-state schema too.

Why: the argument is that someone who does not know what "saturation" means should still be able to edit a photograph, and should learn the word by watching an agent move the control. That argument is complete in the photo half. The video half doubled the surface, carried the least-verified code in the project, and made the pitch harder to state. One thing done properly beats two things done partly.

Every photo operation the model supports now has a control. The four keyframe operations (`set_keyframe`, `remove_keyframe`, `clear_animation`, `set_track_enabled`) are the one exception: they came from the shared model video needed, they have no job in a photo-only product, and they remain in the domain because the compositor's interpolation still reads them. They are reachable through WebMCP and do nothing visible.

## Running it

Node 22.12 or newer.

```sh
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run test:run
npm run build        # static output in dist/
```

The build is entirely static — no environment variables, no server routes, no external origins. Any static host works with one rewrite of unknown paths to `index.html`; `vercel.json`, `public/_redirects` and `public/_headers` are included for Vercel, Netlify and Cloudflare Pages, and `deploy/nginx.conf` for the container image. HTTPS is required for tool registration.

## Licence

[MIT](./LICENSE). No runtime dependency carries a copyleft obligation.
