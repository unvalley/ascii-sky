# Remaking the sky

These scripts make the sky's files from a painted sky: the still sky in
`assets/` and the numbers in `src/art.ts`. What each cell shows is picked
at run time by `src/cells.ts`. They need [sharp](https://sharp.pixelplumbing.com)
(a dev dependency).

The files' URLs carry `art.ts`'s `version`, a hash of their content, so
they can be cached for good. Change them only through `write.mjs`, which
writes a new version.

The source is a painted blue sky with cumulus, 1536 × 1024 (the one
behind this sky was an impressionist one). Run the scripts in this order on
your `sky.png`, with a work folder of your choice:

```bash
# 1. The top of the painting as a band that tiles sideways.
node scripts/tile-compose.mjs sky.png work/t1/band.png
# 2. The band without its clouds, widened to 2400 page pixels.
node scripts/cloud-layers.mjs work/t1/band.png work/c1
# 3. The still sky as glyphs and colour maps, 6 × 9.75 page pixels a cell,
#    the cells the sky is drawn on. The dark map is a night's (src/grade.ts).
#    The blue is lightened towards a pale sky blue (*_SKY_L, *_SKY_C, *_SKY_HUE).
CW=6 CH=9.75 LOCAL=1 BROAD=0.15 SKY_LO=0 SKY_HI=7 INK_L=0.9 INK_CHROMA=40 LOCAL_RX=5 LOCAL_RY=3 NOFADE=1 \
  LIGHT_SKY_L=0.73 LIGHT_SKY_DROP=0 LIGHT_SKY_C=0.9 LIGHT_SKY_HUE=-13 DARK_SKY_L=0.66 DARK_SKY_C=1.05 DARK_SKY_HUE=-8 \
  node scripts/sky-convert.mjs work/c1/sky-still.png work/c1/conv6
# 4. The clouds, cut from the painting and placed in a near and a far layer.
#    Add `sheet` to see the cut-outs instead.
node scripts/paint-clouds.mjs sky.png work/p1
# 5. Into assets/ and src/art.ts.
node scripts/write.mjs work/c1/conv6 work/p1
```

To change only the clouds, run step 4 and write them with `-` in place of
the still sky's folder, which leaves the still sky as it is:

```bash
node scripts/write.mjs - work/p1
```

## Where things are set

- How the wind blows (its speeds and gusts), how much clouds change shape
  as they go, and how each theme shades them: the top of `src/cells.ts`.
- The glyphs' size: `src/atlas.ts`.
- The colour of the pointer's wind and its streaks, and how many rows a
  frame works out (`TURNS`): `src/shade.ts`.
- How the air moves, spreads and springs back: the top of `src/air.ts`.
- How often the sky is drawn: `src/clock.ts`.
- Which parts of the painting are cut out as clouds: the `SPRITES` list in
  `paint-clouds.mjs`; where each sits, how large, how much it is stretched
  sideways and whether it is mirrored, near its end. Each cloud in view
  should be a different kind, so no shape repeats on screen.

## Speed

The hot path is written for speed, each choice measured: no allocation in
a frame, typed arrays, a sine table (`src/wave.ts`) and a fast wrap
(`src/wrap.ts`) where `Math.sin` and `%` cost most, and `Math.sqrt` over
`Math.hypot` in the air. `pnpm bench` times a frame with no browser (the
real files, a 1440 px page, a tablet and a phone; drawing on the canvas is
not counted).

Judge the sky in a browser (`pnpm dev`), not from stills alone. A headless
browser can record it, for instance:

```bash
agent-browser open http://localhost:5173/
agent-browser record start wind.webm
agent-browser wait 10000
agent-browser record stop
```
