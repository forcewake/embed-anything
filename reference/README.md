# The reference bundle

This directory holds the material that was used to *reconstruct* the
application. It is **not** part of the build and is **not** committed.

```
reference/
  embeddinggemma-recovery/     <- the recovery kit (not committed)
```

The recovery kit contains the three production files of the Hugging Face Space
`webml-community/embeddinggemma-2-webgpu` (`index-D4Mcwtca.js`,
`worker-aXRtX6h9.js`, `index-Cszpz8qA.css`), the extracted collection
manifests, the recovered shader sources and the reverse-engineering notes.

## Why it is not committed

The deployed bundle of the Space has **no known open-source license**. Committing
it would redistribute someone else's proprietary build. The code in this
repository is an independent re-implementation written from the observed
behaviour; it contains no code copied from the bundle.

## What you need it for

Only the *comparison tooling* needs the original bundle:

| Script | Needs the kit |
|---|---|
| `scripts/compare-layout.mjs` | yes — it extracts the original layout functions and compares them with the new implementation. |
| `scripts/compare.mjs` | yes — it renders the original bundle next to the recreation. |
| `scripts/compare.mjs` (run) | needs the kit's `static-preview/` served over HTTP. |

Everything else — building the catalog, fetching the assets, running and
testing the app — works **without** it.

## How to restore it

The kit was supplied with the task. If you have it, drop it here:

```bash
cp -r /path/to/embeddinggemma-recovery reference/
```

The public Space files that the tooling needs can also be fetched directly:

```bash
mkdir -p reference/embeddinggemma-recovery/original
curl -L -o reference/embeddinggemma-recovery/original/index-D4Mcwtca.js \
  "https://huggingface.co/spaces/webml-community/embeddinggemma-2-webgpu/resolve/main/assets/index-D4Mcwtca.js"
```

## Note

`scripts/build-catalog.mjs` does **not** need the kit: when the local manifests
are missing it downloads the deployed bundle and extracts the three collection
manifests from it with the TypeScript parser. The result is byte-identical to
the build from the local manifests.
