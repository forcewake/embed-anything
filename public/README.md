# `public/`

Everything in this directory is served at the root of the site. The files are
**generated or fetched**, not committed:

| Path | How it gets there | Size |
|---|---|---|
| `local/catalog.json` | `npm run assets:build` | 2.9 MB |
| `local/data/embeddings.f16` | `npm run assets:fetch` | 7.7 MB |
| `local/data/audio-embeddings.f16` | `npm run assets:fetch` | 0.4 MB |
| `local/data/video-embeddings.f16` | `npm run assets:fetch` | 0.4 MB |
| `local/runtime/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` | `npm run assets:fetch` | 26.9 MB |
| `fonts/inter-400.ttf`, `fonts/inter-600.ttf` | `npm run assets:fetch` | 0.6 MB |
| `studio.hdr` | `npm run assets:fetch` | 1.6 MB |

`npm run assets:check` validates all of them: the exact byte length of every
float16 matrix, the row order of the catalog and the optional assets.

The sources are the public files of the Hugging Face Space
`webml-community/embeddinggemma-2-webgpu`. The catalog is derived from the
manifests that the Space embeds in its bundle — see
[`../reference/README.md`](../reference/README.md).
