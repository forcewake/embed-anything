## What this changes

<!-- A short description of the change. -->

## Why

<!-- The problem this solves. Link the issue: Fixes #123 -->

## Fidelity

<!--
Does this change what the reference does?

The initial mosaic is a shuffled, aspect-ratio aware row layout and the
search is an exact cosine retrieval. If the change touches the renderer, the
layout, the camera or the ranking, say so and paste the numbers from the
comparison harness.
-->

- [ ] The initial composition is unchanged
- [ ] The retrieval algorithm is unchanged
- [ ] The GLSL shaders are unchanged (or the visual difference is described below)

Comparison (when the renderer, the layout, the camera or the ranking changed):

```
node scripts/compare-layout.mjs
node scripts/compare.mjs http://localhost:4174/ "http://localhost:5173/?seed=math"
```

```
before: maxRectDelta = ?, differing pixels = ?
after:  maxRectDelta = ?, differing pixels = ?
```

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` (or `--grep-invert @ml` when the model cannot be downloaded)

## Screenshots

<!-- Before / after, when the change is visible. -->
