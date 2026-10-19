# Reconstruction map

Every recovered symbol of the reference build, and where it now lives. The
reference names come from `frontend.renderer.extracted.js`,
`frontend.ui.extracted.js` and `worker.application.extracted.js`; the originals
are the minified names inside `original/index-D4Mcwtca.js` and
`original/worker-aXRtX6h9.js`.

The mapping is **behavioural**: the recovered files reference minified symbols
that are defined elsewhere, so they are not importable modules. The new modules
are reconstructions from the observed behaviour, not copies.

## Renderer

| Reference                          | New module                                                                           | Notes                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `Ue`                               | `src/engine/shaders/glass.vert.glsl`                                                 | Byte-equivalent vertex shader.                                                                                        |
| `We`                               | `src/engine/shaders/glass.frag.glsl`                                                 | Byte-equivalent fragment shader.                                                                                      |
| `Je`                               | `src/engine/GlassRenderer.ts`                                                        | WebGL2 context, program, instance buffers, `TEXTURE_2D_ARRAY`, HDR environment, focused texture, draw loop, disposal. |
| `Ge`                               | `GlassRenderer.decodeRadianceHdr`                                                    | Radiance `.hdr` decoder (RLE scanlines).                                                                              |
| `Ke`                               | `GlassRenderer.buildMesh`                                                            | Subdivided quad grid.                                                                                                 |
| `qe`                               | `GlassRenderer.sourceSize`                                                           | Intrinsic size of a canvas image source.                                                                              |
| `st`                               | `src/engine/CameraController.ts`                                                     | Target/current camera, anchored zoom, inertia, orbit, damping.                                                        |
| `$e`, `et`, `tt`, `nt`, `rt`, `Tt` | `src/engine/geometry.ts`                                                             | Orbit matrix, matrix product, transpose, CSS `matrix3d`, quaternion↔matrix.                                           |
| `it`                               | `geometry.spherePlacement`                                                           | Spherical placement of a card.                                                                                        |
| `at`                               | `geometry.screenToSphere`                                                            | Ray/sphere intersection for the zoom anchor.                                                                          |
| `ot`                               | `geometry.projectToScreen`                                                           | World → screen projection.                                                                                            |
| `Nt`                               | `geometry.cardShape`                                                                 | Corner radius, bevel, thickness, rim.                                                                                 |
| `Mt`                               | `geometry.focusShape`                                                                | Shape of the focused card.                                                                                            |
| `Et`                               | `geometry.focusTarget`                                                               | The pose the focused card animates to.                                                                                |
| `Ot`, `Dt`, `kt`                   | `geometry.interpolateCard`, `slerpQuaternion`, `quaternionMultiply`                  | Card and quaternion interpolation.                                                                                    |
| `At`, `jt`, `Ht`, `wt`             | `geometry.applyOrbit`, `applyInverseOrbit`, `rotateQuaternion`, `multiplyMat3Vector` | Orbit application to cards and quaternions.                                                                           |
| `ct`                               | `src/engine/AspectMosaicLayout.ts` → `computeMosaicLayout`                           | Aspect-ratio aware row layout. **Verified numerically identical** to the original (see below).                        |
| `St`                               | `AspectMosaicLayout.computeResultLayout`                                             | The spiral layout used for search hits. **Verified identical.**                                                       |
| `ut`                               | `src/engine/SpatialIndex.ts`                                                         | Viewport query over the laid-out cards.                                                                               |
| `bt`                               | `src/engine/MediaTexturePool.ts`                                                     | Media pool: image queue, video elements, waveform canvases, LRU trimming, frame callbacks.                            |
| `dt`                               | `MediaTexturePool` → `syncPlayback`                                                  | Play/pause with the asynchronous `play()` promise.                                                                    |
| `ft`                               | `src/media/catalog.ts` → `formatDuration`                                            | `m:ss` formatting.                                                                                                    |
| `pt`                               | `src/media/file-ingest.ts` → `probeMedia`                                            | Aspect ratio, duration and poster of an uploaded file.                                                                |
| `mt`                               | `src/media/audio.ts` → `computeWaveform`                                             | Waveform reduction (peak/rms mix).                                                                                    |
| `gt`                               | `src/media/audio.ts` → `readWaveform`                                                | Waveform extraction with the 24 MB / 30 min guard.                                                                    |
| `_t`                               | `src/media/audio.ts` → `downsampleWaveform`                                          | Waveform downsampling for drawing.                                                                                    |
| `vt`                               | `src/media/waveform.ts` → `paintWaveform`                                            | The waveform tile painter.                                                                                            |
| `yt`                               | `src/engine/MediaTexturePool.ts` → `mediaKey`                                        | The media cache key.                                                                                                  |
| `Kt`                               | `src/engine/SpatialField.ts`                                                         | The interactive mosaic: gestures, hover, visibility, focus transition, fallback.                                      |
| `Jt`                               | `src/components/SpatialCanvas.tsx`                                                   | The React bridge to the field.                                                                                        |
| `zt`, `Bt`, `Vt`                   | `SpatialField.entranceTransform`, `departureTransform`, `applyEntrance`              | The entrance spiral and the reflow/departure animation.                                                               |
| `xt`                               | `SpatialField.pickResultCount`                                                       | The "elbow" heuristic that decides how many hits to frame.                                                            |
| `Rt`                               | `SpatialField.hashUnit`                                                              | The FNV-1a hash used by the entrance.                                                                                 |

## User interface

| Reference              | New module                                      | Notes                                                                                                          |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `An`                   | `src/app/App.tsx`                               | The application shell: atlas, brand, omnibox, status, keyboard shortcuts, viewer, drop overlay, camera dialog. |
| `kn`                   | `src/app/useExploreState.ts`                    | App state, search lifecycle, local additions, deletion, microphone recording.                                  |
| `nn`                   | `src/app/useDragDrop.ts`                        | Drag & drop listener and the acceptance overlay state.                                                         |
| `Xt`                   | `src/components/MediaViewer.tsx`                | The focused media viewer.                                                                                      |
| `F`                    | `src/components/Playback.tsx`                   | Audio / video playback controls.                                                                               |
| `Zt`                   | —                                               | The inline audio-description editor was **not** ported (see `LIMITATIONS.md`).                                 |
| `en`                   | `src/components/UploadOverlay.tsx`              | The full-screen drop acceptance state.                                                                         |
| `tn`                   | `src/components/CameraDialog.tsx`               | The permission-aware webcam dialog.                                                                            |
| `Qt`                   | `src/media/file-ingest.ts` → `detectMediaType`  | File type detection.                                                                                           |
| `on`                   | `src/media/audio.ts` → `decodeAudioToMono`      | Mono 16 kHz decoding with the 60 s limit.                                                                      |
| `sn`                   | `src/media/video.ts` → `extractVideoFrames`     | ≤ 32 frames, longest side ≤ 720 px.                                                                            |
| `En`                   | `src/media/shuffle.ts` → `seededShuffle`        | The Fisher-Yates shuffle, with a **seeded** PRNG instead of `Math.random`.                                     |
| `Tn`                   | `src/media/catalog.ts` → `buildCatalogItems`    | Catalog normalization.                                                                                         |
| `gn`, `_n`, `vn`, `yn` | `src/ml/client.ts`                              | The typed, cancellable worker client.                                                                          |
| `rn`                   | `src/ml/client.ts` → `GemmaClient.ensureWorker` | The module worker.                                                                                             |

## Worker

| Reference                          | New module                                                                                                 | Notes                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `YA`                               | `src/ml/protocol.ts` → `MODEL_ID`                                                                          | `onnx-community/embeddinggemma-2-ONNX`.                                     |
| `XA`                               | `src/ml/protocol.ts` → `SEARCH_TASK_PREFIX`                                                                | `task: search result \| query: ` (verbatim).                                |
| `ZA`                               | `src/ml/worker.ts` → `ORT_WASM_MODULE`                                                                     | `ort-wasm-simd-threaded.asyncify`.                                          |
| `hj`                               | `src/ml/worker.ts` → `configureRuntime`                                                                    | Points ONNX Runtime at the local sidecars.                                  |
| `Dj`                               | `src/ml/worker.ts` → `ensureLoaded`                                                                        | Processor + q4/WebGPU model + the three matrices + warm-up.                 |
| `ej`, `tj`, `nj`                   | `src/ml/similarity.ts` → `l2Norm`, `normalizeVector`, `normalizeCorpus`                                    | L2 normalization.                                                           |
| `QA`                               | `src/ml/similarity.ts` → `calibratedScore`                                                                 | The audio score offset.                                                     |
| `ij`                               | `src/ml/similarity.ts` → `rankEmbeddings`                                                                  | The exact top-K cosine ranker (bounded min-heap).                           |
| `fj`                               | `src/ml/fp16.ts` → `decodeFloat16`                                                                         | Little-endian float16 decoder.                                              |
| `cj`                               | `src/media/catalog.ts` → `formatDuration`                                                                  | Duration formatting.                                                        |
| `uj`                               | `src/media/catalog.ts` → `buildCatalogItems`                                                               | The metadata model.                                                         |
| `Mj`                               | `src/ml/worker.ts` → `embed`                                                                               | Text / image / audio / video embedding, plus the re-use of an indexed item. |
| `jj`                               | `src/ml/worker.ts` → `runModel`                                                                            | Inference + `sentence_embedding` extraction + tensor disposal.              |
| `Aj`                               | `src/ml/worker.ts` → `disposeTensors`                                                                      | Recursive tensor disposal.                                                  |
| `Oj`                               | `src/ml/worker.ts` → `serialize`                                                                           | Serializes the inference calls.                                             |
| `Nj`                               | `src/ml/worker.ts` → `dispatch`                                                                            | The request dispatcher.                                                     |
| `yj`                               | `src/ml/worker.ts` → `inFlight`                                                                            | The in-flight request map, cancellation and error reporting.                |
| `bj`, `xj`, `Sj`, `Cj`, `wj`, `Tj` | `src/ml/worker.ts` → `report`, `readableError`, `cancelledError`, `assertNotCancelled`, `fail`, `complete` | Progress and error reporting.                                               |

## Styles

| Reference            | New module                                                                          |
| -------------------- | ----------------------------------------------------------------------------------- |
| `index-Cszpz8qA.css` | `src/styles/app.css` (re-hosted, cleaned up; the font URLs point at `public/fonts`) |

## How the fidelity was verified

`scripts/compare-layout.mjs` extracts the original `ct` and `St` functions out
of `original/index-D4Mcwtca.js` and runs them side by side with the new
implementation on the same catalog:

```text
ORIGINAL: width 42079.16, height 42243.96, rows 81, columns 69
MINE    : width 42079.16, height 42243.96, rows 81, columns 69
row counts equal: true
first items equal: true
result layout equal: true
```

`scripts/compare.mjs` runs the reference bundle and the recreation in two
Chromium pages that share a deterministic `Math.random` (so both produce the
same catalog order, the same layout and therefore the same camera) and then
compares the rendered result:

```text
at 1440×900, zoom 1 : 28 cards, same ids, same rects, maxRectDelta = 0
                      3.7 % differing pixels (animated video + status text)
at 1440×900, min zoom: 201 cards, same ids, same rects, maxRectDelta = 0
                      1.3 % differing pixels
```

The differences are the frames of the playing video tiles and the model status
line, both of which are time-dependent.
