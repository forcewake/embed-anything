# Feature parity

Legend: **Parity** = verified against the reference bundle or the recovered
source. **Ported** = implemented from the recovered behaviour, verified by the
unit and end-to-end suites but not diffed against the original binary.
**Partial** = a documented subset of the reference behaviour.

## Rendering

| Feature                                                                     | Status     | Evidence                                                                                |
| --------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| WebGL2 instanced renderer with the recovered GLSL 300 ES shaders            | **Parity** | `scripts/compare.mjs`: identical card ids and screen rects, 1.3–3.7 % differing pixels  |
| Rounded-rectangle SDF, bevel, spherical curvature, RGB-separated refraction | **Parity** | Byte-identical shaders (`glass.vert.glsl`, `glass.frag.glsl`)                           |
| HDR environment reflections (Radiance `.hdr`)                               | **Parity** | `studio.hdr` decoded by the ported `Ge` reader and uploaded                             |
| Fresnel rim, hover lift, gamma conversion                                   | **Parity** | Byte-identical shader                                                                   |
| Aspect-ratio aware row layout with staggered rows                           | **Parity** | `scripts/compare-layout.mjs`: identical width, height, rows, columns and item positions |
| Infinite tiling of the layout                                               | **Parity** | Same tile offsets and viewport queries                                                  |
| Spatial culling (only visible cards are drawn)                              | **Parity** | Identical visible sets (201/201 ids at min zoom)                                        |
| `TEXTURE_2D_ARRAY` cache with LRU eviction and resize                       | **Parity** | Same thresholds, same layer allocation                                                  |
| CSS/DOM fallback when WebGL2 is unavailable                                 | **Parity** | Playwright test: `data-renderer="css"`, the mosaic stays interactive                    |
| WebGL context-loss handling                                                 | **Parity** | The field switches to the CSS fallback instead of blanking                              |

## Interaction

| Feature                                                      | Status     | Evidence                                                                              |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| Drag to pan with momentum and damping                        | **Parity** | Same velocity model (`0.88^ratio` decay)                                              |
| Wheel / pinch zoom anchored on the pointer                   | **Parity** | Same sphere re-projection, same zoom clamp `0.18 … 2.5`                               |
| Mouse-driven subtle orbit and velocity lean                  | **Parity** | Same matrices, same coefficients                                                      |
| Hover highlight, detail preloading                           | **Parity** | Same 100 ms debounce and priority scheme                                              |
| Focus transition out of the field and back                   | **Parity** | Same 840 ms open / 620 ms close, same shape interpolation                             |
| Viewer: previous / next, close, attribution, relevance score | **Parity** | Playwright test: viewer opens, `is-presenting`, Escape closes                         |
| Audio / video playback with seeking and mute                 | **Ported** | Real media element, seek bar, mute toggle                                             |
| Keyboard: `/`, `Cmd/Ctrl+K`, `Escape`, `+`, `-`, `0`, arrows | **Parity** | Playwright test                                                                       |
| Drag & drop with a full-screen acceptance state              | **Ported** | `useDragDrop` + `UploadOverlay`                                                       |
| Webcam capture with permission handling                      | **Ported** | `CameraDialog` with `NotAllowedError` / `NotFoundError` / `NotReadableError` messages |
| Microphone recording (≤ 60 s)                                | **Ported** | `useExploreState.toggleRecording`                                                     |
| `prefers-reduced-motion`                                     | **Parity** | The camera and the entrance animation both respect it                                 |

## Semantic search

| Feature                                                                  | Status     | Evidence                                                                            |
| ------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| EmbeddingGemma 2 ONNX q4 on WebGPU                                       | **Parity** | Same model id, `dtype`, `device` and warm-up query                                  |
| Exact retrieval prompt `task: search result \| query: `                  | **Parity** | `SEARCH_TASK_PREFIX`                                                                |
| The three float16 matrices, exact byte validation, L2 normalization      | **Parity** | `scripts/validate-assets.mjs`, `tests/fp16.test.ts`, `tests/similarity.test.ts`     |
| Exact cosine scan over all 5,543 rows                                    | **Parity** | `tests/similarity.test.ts` (21 assertions)                                          |
| Audio score offset `0.08`, threshold `0.65`, top `60`, stable tie-breaks | **Parity** | Same algorithm, unit-tested                                                         |
| Text query                                                               | **Parity** | Live: "a snowy mountain landscape" returns the same 60 hits as the reference bundle |
| Image query                                                              | **Parity** | Same processor path (`processor(null, RawImage)`)                                   |
| Audio query (16 kHz mono, ≤ 60 s)                                        | **Parity** | Same decode path                                                                    |
| Video query (≤ 32 frames, ≤ 720 px)                                      | **Parity** | Same processor path (`processor(null, null, null, RawVideo)`)                       |
| Re-use of an indexed item's embedding                                    | **Parity** | `embed({ itemId })` reads the stored row                                            |
| Cancellable requests, stale results ignored                              | **Parity** | `AbortController` + request ids in the client and the worker                        |
| Result-driven re-layout and framing                                      | **Parity** | Identical spiral layout and framing                                                 |
| Relevance score shown on the tiles and in the viewer                     | **Parity** | `tile-similarity`, `viewer-score`                                                   |
| Latency shown in the status line                                         | **Parity** | "60 connections · 804 ms" vs. 798 ms for the reference                              |

## Data

| Feature                                              | Status     | Evidence                                               |
| ---------------------------------------------------- | ---------- | ------------------------------------------------------ |
| 5,000 images + 285 audio + 258 video = 5,543         | **Parity** | `tests/catalog.test.ts`, `scripts/validate-assets.mjs` |
| Stable row order (images → audio → video)            | **Parity** | Asserted per collection in `tests/catalog.test.ts`     |
| The index is never used to address the display order | **Parity** | Asserted in `tests/catalog.test.ts`                    |

## Deliberate deviations

| Deviation                                                             | Why                                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The shuffle uses a seeded PRNG instead of `Math.random()`             | Makes the composition reproducible and the visual regression meaningful. `?seed=math` restores the reference's behaviour; `?seed=<n>` selects a fixed order. |
| The model is loaded once per page session                             | The reference behaves the same; the client memoises the initialization promise.                                                                              |
| The inline audio-description editor is not implemented                | It only affected the audio viewer's description text, which the recreation renders read-only.                                                                |
| The reference's `micro-labels` / `compact-labels` thresholds are kept | They switch the tile captions on and off while zooming.                                                                                                      |
