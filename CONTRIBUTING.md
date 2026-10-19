# Contributing

Thanks for helping to make this project better. This is a **reconstruction**
of an existing demo, so the bar for changes is high: the reference behaviour is
the specification.

## The rule

> **Fidelity first.** If a change alters what the reference does — the layout,
> the glass, the ranking, the interactions — it must be a deliberate,
> documented decision, and the fidelity tooling must show the difference.

## Workflow

```bash
npm install
npm run assets:fetch && npm run assets:build && npm run assets:check
npm run dev
```

Before you open a pull request:

```bash
npm run typecheck     # must be clean
npm test              # 78 unit tests
npm run build         # must succeed
npm run test:e2e      # functional + visual + the ML search
```

`npm run test:e2e` downloads the model (~1 GB) the first time. If you cannot,
run it with `--grep-invert @ml`; the rest of the suite does not need it.

## Style

- **TypeScript strict** — `noUnusedLocals`, `noUnusedParameters` and
  `noImplicitAny` are on. `npm run typecheck` is the linter.
- **Prettier** owns the formatting: `npx prettier --write .`.
- **ESLint** owns the lint rules: `npm run lint`.
- Comments explain _why_, not _what_. Every module has a header that states what
  it owns and which recovered symbol it corresponds to.
- The GLSL shaders are **byte-equivalent** to the recovered ones. Do not
  reformat them; if you must change the optics, say so in the pull request and
  explain the visual difference.

## Verifying a change

The repository ships the harness that was used to prove the recreation matches
the original. If you touch the renderer, the layout, the camera or the
ranking, run it and include the numbers in the pull request:

```bash
# The reference bundle must be available under reference/embeddinggemma-recovery.
python3 -m http.server 4174 --directory reference/embeddinggemma-recovery/static-preview
npm run dev &

node scripts/compare-layout.mjs
node scripts/compare.mjs http://localhost:4174/ "http://localhost:5173/?seed=math"
node scripts/pixel-diff.mjs artifacts/compare-reference.png artifacts/compare-mine.png
```

The expected result is `maxRectDelta = 0` and a pixel delta of a few percent
(a playing video frame and the status line move between the two runs).

## Adding a feature

Optional ideas — semantic clustering, custom collections, local persistence —
are welcome, but they must be **additive**: the initial mosaic stays a shuffled
aspect-ratio row layout, and the search stays an exact cosine retrieval. New
features must not change the primary experience, and they must not require the
model to be present.

## Reporting a bug

Please include:

- the browser and its version, and whether **WebGL2** and **WebGPU** are
  available;
- the command you ran and the full output;
- a screenshot when it is a visual problem.

If the problem is a _fidelity_ problem — the recreation differs from the
reference — that is the most valuable kind of report. Please say which one and
what the reference does instead.
