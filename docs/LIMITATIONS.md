# Limitations, risks and known gaps

## Not implemented

| Item                                                                | Impact   | Notes                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The inline audio-description editor (`Zt`)                          | Low      | The audio viewer shows the description read-only. The reference lets the user rewrite the description of a _local_ clip. The state plumbing (`updateItem`) exists, only the editor UI is missing.                           |
| The reference's `micro-labels` caption scaling is pixel-approximate | Very low | The class names and thresholds are ported; the exact `cqw` typography of the original was not re-derived.                                                                                                                   |
| `fetch('./studio.hdr')` uses a relative URL                         | Very low | The original resolves the environment map relative to the document. The recreation does the same; if the file is missing the shader falls back to a 1×1 placeholder and the scene still renders (with flatter reflections). |

## Environment dependent

| Item                                                                          | Impact                  | Notes                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebGPU is required for the semantic search.**                               | High for the AI feature | The model runs on the WebGPU execution provider of ONNX Runtime Web. Without WebGPU the worker reports an error, the status line says so, and the mosaic stays fully browsable. There is no CPU fallback (that would change the reference's behaviour and be far slower). |
| **The model is downloaded on first use.**                                     | High for the first run  | `onnx-community/embeddinggemma-2-ONNX` in `q4` is roughly 1 GB of weights plus the vision and audio encoders. The download happens once per browser profile; the browser's HTTP cache serves it afterwards.                                                               |
| **The three `.f16` matrices and the ORT sidecars are not in the repository.** | Medium                  | They are fetched with `npm run assets:fetch` (public Hugging Face Space files) and live in `public/local/`. The application refuses to fake them: without the matrices the worker cannot search and says so.                                                              |
| **The corpus media is hosted by third parties.**                              | Medium                  | The 5,000 images come from the Unsplash CDN, the audio and video from Wikimedia / Pexels / Pixabay. A blocked or rate-limited CDN shows placeholder glass tiles.                                                                                                          |
| **Local audio and posters are optional.**                                     | Low                     | 23 audio files and 10 video posters are served from the Space's `local/data/`; they are fetched with `--all`. The remaining 262 audio items and 248 video posters are remote.                                                                                             |
| **The environment map is optional.**                                          | Low                     | Without `studio.hdr` the reflections flatten but the refraction, bevel and Fresnel remain.                                                                                                                                                                                |

## Licensing and redistribution

- The **application source** of the reference Space has no known open-source
  license. This repository is a re-implementation written from the observed
  behaviour; it contains no code copied from the original bundles.
- The **catalog manifests** contain metadata that describes Unsplash photos,
  Wikimedia audio, Pexels videos and Pixabay audio. The photographs are
  subject to the [Unsplash license](https://unsplash.com/license), the
  Wikimedia files to their individual licenses (mostly CC BY-SA / public
  domain), the Pexels videos to the Pexels license and the Pixabay audio to
  the Pixabay content license. **Check the license of every item before
  publishing a clone.**
- The **model** `onnx-community/embeddinggemma-2-ONNX` is distributed under the
  Gemma terms of use; the weights are not redistributed here.
- The **Inter** fonts are bundled under the SIL Open Font License.
- `public/local/**` and `public/studio.hdr` are fetched from the public Space
  and are therefore _not_ covered by this repository's license.

## Performance characteristics

Measured on the development machine (macOS, Chromium, 1440×900):

| Metric                        | Observation                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cards in the DOM              | 16–201 depending on the zoom, never 5,543 — the rest are GPU-only.                                                                                                                   |
| Visible cards drawn per frame | Bounded by the viewport query, ~30–200.                                                                                                                                              |
| Frame time                    | Not measured with a profiler in this environment; the renderer draws at most 1,000 instances per frame and uploads the instance buffer only when it changed.                         |
| Texture memory                | 96 layers × 640 × 480 × 4 B = 118 MB at full resolution, 59 MB at the reduced resolution. The array switches to the reduced resolution when more than 95 distinct cards are visible. |
| Corpus memory                 | 5,543 × 768 × 4 B = 17 MB for the normalized float32 matrix, plus the decoded float16 buffer during the load.                                                                        |
| Search latency                | ~600–800 ms for the embedding plus the exact scan of 5,543 × 768 products, measured in the browser.                                                                                  |

The texture-array memory figure is the one number worth watching: the
reference has the same behaviour, and the reduced-resolution mode is what keeps
a fully zoomed-out field inside a reasonable budget.

## Not verified here

- The **Firefox and Safari** rendering of the WebGL2 path. The shaders are
  GLSL ES 3.00 and the code paths are standard, but only Chromium was exercised
  in this environment.
- **Touch gestures on real hardware.** The pointer, pinch and drag code paths
  are implemented and the mobile layout is exercised at 390×844, but no
  physical multi-touch device was available.
- **The camera and microphone on real hardware.** The permission flows and the
  error messages are implemented and the dialog opens; a physical camera and
  microphone were not available in this environment.
- **Long-run memory stability.** The disposal paths are implemented and
  unit-reachable, but a multi-hour session was not profiled.

## The two bugs this recreation found in the port

Both were found by the pixel-level comparison against the reference bundle and
are worth recording because they are easy to reintroduce:

1. **Row height from the wrong aspect array.** The row height must be derived
   from the _raw_ aspect ratios; the gap padding only participates in the total
   that sets the layout width. Using the padded values made every row 4.8 %
   too short and the whole mosaic slightly misaligned.
2. **Swapped mesh buffers.** The renderer keeps two meshes (a 24×18 grid for
   large cards and an 8×6 grid for small ones). Binding the wrong buffer pair
   made small cards draw only the first 48 triangles of the wrong grid — a thin
   strip at the top of each card instead of the full tile. It only appeared
   when the cards were small enough to use the low-resolution mesh, i.e. when
   the field was zoomed out.
