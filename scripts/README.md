# Making the sky

`make-sky.mjs` makes the sky's files from a painted sky: the still sky and the
clouds in `assets/`, and the numbers at the top of `src/index.ts`. What each
cell shows is picked at run time by `src/cells.ts`. It needs
[sharp](https://sharp.pixelplumbing.com) (a dev dependency).

```bash
node scripts/make-sky.mjs sky.png
```

The painting is a blue sky with cumulus, 1536 × 1024 (the one behind this sky
was an impressionist one). The clouds are cut out of it where the list at the
end of `cutClouds` says, and placed in a near and a far layer by `placeClouds`.
Those rectangles fit that painting, so for your own, look at the cut-outs
first:

```bash
node scripts/make-sky.mjs sky.png sprites.png
```

The files' URLs carry `version`, a hash of their content, so they can be cached
for good.

## Where things are set

- `src/cells.ts`: how the wind blows, how much clouds change shape as they go,
  and how each theme shades them.
- `src/air.ts`: how the pointer's air moves, spreads and springs back.
- `src/shade.ts`: the colour of the wind and its streaks, the stars, and how
  many rows a frame works out (`TURNS`).
- `src/engine.ts`: the glyphs' size and how often the sky is drawn.

## Speed

The hot path is written for speed, each choice measured: no allocation in a
frame, typed arrays, a sine table (`sine` in `src/shade.ts`) and a fast `wrap`
(`src/cells.ts`) where `Math.sin` and `%` cost most, and `Math.sqrt` over
`Math.hypot` in the air. `pnpm bench` times a frame with no browser (the real
files, a 1440 px page, a tablet and a phone; drawing on the canvas is not
counted).

Judge the sky in a browser (`pnpm dev`), not from stills alone.
