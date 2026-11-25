import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BLANK,
  bigClouds,
  type CloudLayer,
  createLook,
  drift,
  GLYPHS,
  hash,
  type Look,
  measureGlyph,
  normaliseShapes,
  OPEN_SKY,
  oklab,
  range,
  reachOf,
  SKY_RAMP,
  type SkyCells,
  type SkyTheme,
  SUNSET_STOPS,
  skyCells,
  span,
  sunsetColours,
  sunsetGradient,
  THEMES,
  WIND,
  wrap,
} from "./cells.ts";

const layer = (cloud: number, shade = 0): CloudLayer => {
  const width = 64;
  const height = 64;
  const pixel = [shade, cloud, 0, 255];
  return {
    pixels: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => pixel[i % 4]),
    width,
    height,
  };
};

const sky = (near: CloudLayer, far = layer(0)): SkyCells => {
  const columns = 20;
  const rows = 8;
  const rgb = new Uint8ClampedArray(columns * rows * 4).fill(180);
  return skyCells({
    still: {
      columns,
      rows,
      cellWidth: 6,
      cellHeight: 10,
      text: Array.from({ length: rows }, () => SKY_RAMP[4].repeat(columns)).join("\n"),
      rgb: { light: rgb, dark: rgb, sunset: rgb },
    },
    near,
    far,
    shapes: new Float32Array(GLYPHS.length * 6).fill(0.5),
  });
};

const CELL_WIDTH = 8;
const CELL_HEIGHT = 12;
const shadeAt = (
  cells: SkyCells,
  seconds: number,
  theme: SkyTheme,
  x: number,
  y: number,
): { code: number; look: Look } => {
  const look = createLook();
  const index = cells.indexAt(x + CELL_WIDTH / 2, y + CELL_HEIGHT / 2);
  const code = cells.at(seconds, theme)(x, y, CELL_WIDTH, CELL_HEIGHT, look, index, BLANK, 0, 0);
  return { code, look };
};

describe("cells", () => {
  test("open sky where there is no cloud, as blue as the painting", () => {
    const { code, look } = shadeAt(sky(layer(0)), 3, "light", 30, 20);
    assert.equal(code, OPEN_SKY);
    assert.deepEqual([...look.glyph], [180, 180, 180]);
    assert.equal(look.density, 4 / (SKY_RAMP.length - 1));
  });

  test("inside a cloud, a shading glyph of the theme on a tile", () => {
    const { code: g, look } = shadeAt(sky(layer(255, 0)), 0, "light", 40, 40);
    assert.ok(g === -1 || THEMES.light.inside.includes(g), GLYPHS[g]);
    assert.ok(look.tileAlpha > 0.9, "the tile shows");
  });
});

describe("night", () => {
  test("the dark page's sky has no clouds: open sky everywhere", () => {
    const cells = sky(layer(255, 0), layer(255, 0));
    assert.equal(shadeAt(cells, 0, "dark", 40, 40).code, OPEN_SKY);
    assert.notEqual(shadeAt(cells, 0, "light", 40, 40).code, OPEN_SKY);
  });
});

describe("sunset", () => {
  test("a sunset has only the near layer's clouds", () => {
    const farOnly = sky(layer(0), layer(255, 0));
    assert.equal(shadeAt(farOnly, 0, "sunset", 40, 40).code, OPEN_SKY);
    assert.notEqual(shadeAt(farOnly, 0, "light", 40, 40).code, OPEN_SKY);
    assert.notEqual(shadeAt(sky(layer(255, 0)), 0, "sunset", 40, 40).code, OPEN_SKY);
  });
});

describe("bigClouds", () => {
  const clouds = (...squares: [number, number, number][]): CloudLayer => {
    const width = 64;
    const height = 32;
    const isInside = (x: number, y: number): boolean =>
      squares.some(
        ([x0, y0, side]) => y >= y0 && y < y0 + side && (((x - x0) % width) + width) % width < side,
      );
    const cloud = [90, 255, 0, 0];
    return {
      pixels: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => {
        const k = Math.floor(i / 4);
        return isInside(k % width, Math.floor(k / width)) ? cloud[i % 4] : 0;
      }),
      width,
      height,
    };
  };
  const cloudAt = (l: CloudLayer, x: number, y: number): number =>
    l.pixels[(y * l.width + x) * 4 + 1];

  test("leaves out clouds smaller than asked and keeps the rest as they were", () => {
    const both = clouds([2, 2, 3], [20, 10, 10]);
    const big = bigClouds(both, 100);
    assert.equal(cloudAt(big, 3, 3), 0);
    assert.equal(big.pixels[(3 * 64 + 3) * 4], 0, "its shade too");
    assert.equal(cloudAt(big, 25, 15), 255);
    assert.equal(big.pixels[(15 * 64 + 25) * 4], 90);
    assert.equal(cloudAt(both, 3, 3), 255, "the layer itself is left as it is");
  });

  test("counts a cloud across the layer's seam as one", () => {
    const big = bigClouds(clouds([58, 5, 10]), 300);
    assert.equal(cloudAt(big, 60, 8), 255);
    assert.equal(cloudAt(big, 2, 8), 255);
  });

  test("keeps everything when nothing is too small", () => {
    const small = clouds([2, 2, 3]);
    assert.deepEqual(bigClouds(small, 0).pixels, small.pixels);
  });
});

describe("drift", () => {
  test("starts still and only ever moves on: the wind never stops", () => {
    assert.equal(drift(0, WIND.near, 0), 0);
    const times = range(1200).map((i) => i / 10);
    const drifts = times.map((t) => drift(t, WIND.near, 0));
    drifts.slice(1).forEach((d, i) => {
      assert.ok(d > drifts[i], `at ${times[i + 1].toFixed(1)} s`);
    });
  });

  test("goes at the mean speed over a long while", () => {
    const seconds = 23 * 8.7 * 10;
    assert.ok(Math.abs(drift(seconds, WIND.far, 0) / seconds - WIND.far) < 0.1);
  });
});

describe("glyph shapes", () => {
  test("a full cell is full ink everywhere; an empty one, none", () => {
    const w = 16;
    const h = 24;
    const full = measureGlyph(new Uint8ClampedArray(w * h).fill(255), w, h);
    const empty = measureGlyph(new Uint8ClampedArray(w * h), w, h);
    assert.ok(full.every((v) => Math.abs(v - 1) < 1e-6));
    assert.deepEqual([...empty], [0, 0, 0, 0, 0, 0]);
  });

  test("shapes are scaled so the most ink in a region is 1", () => {
    const shapes = normaliseShapes([
      Float32Array.of(0.2, 0.4, 0, 0, 0, 0.5),
      Float32Array.of(0.1, 0.8, 0, 0, 0, 1),
    ]);
    assert.deepEqual([...shapes.subarray(0, 6)], [1, 0.5, 0, 0, 0, 0.5]);
    assert.deepEqual([...shapes.subarray(6, 12)], [0.5, 1, 0, 0, 0, 1]);
  });
});

describe("reachOf", () => {
  const slowly = (
    pixels: Uint8ClampedArray,
    lw: number,
    lh: number,
    rx: number,
    ry: number,
  ): Uint8Array<ArrayBuffer> =>
    Uint8Array.from({ length: lw * lh }, (_, k) => {
      const i = k % lw;
      const j = (k - i) / lw;
      return span(j - ry, j + ry)
        .filter((y) => y >= 0 && y < lh)
        .flatMap((y) =>
          span(i - rx, i + rx).map((x) => pixels[((((x % lw) + lw) % lw) + y * lw) * 4 + 1]),
        )
        .reduce((most, v) => Math.max(most, v), 0);
    });

  test("is the most cloud near each point, wrapping sideways, clear past top and bottom", () => {
    [
      [37, 23, 0, 0],
      [37, 23, 3, 2],
      [40, 30, 6, 6],
      [29, 31, 9, 4],
      [16, 9, 20, 12],
      [300, 20, 24, 15],
      [257, 12, 6, 6],
    ].forEach(([lw, lh, rx, ry]) => {
      const pixels = Uint8ClampedArray.from({ length: lw * lh * 4 }, (_, p) =>
        p % 4 === 1 && hash(p, lw, 5) < 0.08 ? 1 + ((hash(p, lw, 6) * 254) | 0) : 0,
      );
      const want = slowly(pixels, lw, lh, rx, ry);
      const reach = reachOf({ pixels, width: lw, height: lh }, rx, ry);
      const order = range(lw * lh).sort((a, b) => hash(a, lh, 7) - hash(b, lh, 7));
      order.forEach((k) => {
        const i = k % lw;
        const j = Math.floor(k / lw);
        assert.equal(reach(i * 2, j * 2), want[k], `${lw}x${lh} r ${rx},${ry} at ${i},${j}`);
      });
    });
  });
});

describe("hash", () => {
  test("is in [0, 1) and the same each time", () => {
    [
      [0, 0, 0],
      [-5, 3, 23],
      [2 ** 31 - 1, -(2 ** 31), 37],
      [1e6, 1e6, 5],
    ].forEach(([x, y, z]) => {
      const h = hash(x, y, z);
      assert.ok(h >= 0 && h < 1);
      assert.equal(hash(x, y, z), h);
    });
  });

  test("spreads cells evenly", () => {
    const tenths = range(10_000).map((i) =>
      Math.floor(hash(i % 100, Math.floor(i / 100), 23) * 10),
    );
    range(10).forEach((bucket) => {
      const b = tenths.filter((t) => t === bucket).length;
      assert.ok(b > 850 && b < 1150, `bucket of ${b}`);
    });
  });

  test("gives neighbours and streams unrelated numbers", () => {
    const isClose = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;
    const same =
      range(1000).filter((x) => isClose(hash(x, 0, 1), hash(x + 1, 0, 1))).length +
      range(1000).filter((x) => isClose(hash(x, 0, 23), hash(x, 0, 37))).length;
    assert.ok(same < 45, `${same} near pairs`);
  });
});

const slow = (x: number, n: number): number => {
  const w = x % n;
  return w < 0 ? w + n : w;
};

describe("wrap", () => {
  test("is x % n made positive, to the last bit", () => {
    [128, 1200, 400, 7].forEach((n) => {
      range(20_000).forEach((i) => {
        const x = (hash(i, n, 3) - 0.5) * 2 ** (1 + (i % 7) * 4);
        assert.ok(wrap(x, n) === slow(x, n), `wrap(${x}, ${n})`);
      });
    });
  });

  test("holds right at the edges", () => {
    [128, 1200].forEach((n) => {
      [0, n, -n, n - 1e-12, -1e-12, n * 1e6 - 1e-7, -(n * 1e6) + 1e-7, 0.5, -0.5].forEach((x) => {
        assert.ok(wrap(x, n) === slow(x, n), `wrap(${x}, ${n})`);
        assert.ok(wrap(x, n) >= 0 && wrap(x, n) < n);
      });
    });
  });
});

const COLUMNS = 3;
const ROWS = 60;
const CH = 10;
const text = Array.from(
  { length: ROWS },
  () => `${SKY_RAMP[0]}${SKY_RAMP[4]}${SKY_RAMP.at(-1)}`,
).join("\n");
const colours = sunsetColours(COLUMNS, ROWS, CH, text);
const at = (c: number, r: number): number[] => {
  const o = (r * COLUMNS + c) * 4;
  return [colours[o], colours[o + 1], colours[o + 2], colours[o + 3]];
};
const hue = ([r, g, b]: number[]): number => {
  const [, a, bb] = oklab(r, g, b);
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
};

describe("sunsetColours", () => {
  test("a colour a cell, opaque", () => {
    assert.equal(colours.length, COLUMNS * ROWS * 4);
    assert.ok(range(ROWS).every((r) => at(1, r)[3] === 255));
  });

  test("runs from violet at the top to orange low down", () => {
    const top = at(1, 0);
    const low = at(1, 33);
    assert.ok(top[2] > top[1] && top[2] > 150, `violet top: ${top}`);
    assert.ok(low[0] > 230 && low[0] > low[1] && low[1] > low[2], `orange low: ${low}`);
    assert.ok(hue(top) > 260 && hue(top) < 320, `top hue ${hue(top)}`);
    assert.ok(hue(low) > 30 && hue(low) < 80, `low hue ${hue(low)}`);
  });

  test("is deeper where the painting's blue is denser", () => {
    [0, 20, 40].forEach((r) => {
      const [light, middle, dense] = [0, 1, 2].map((c) => {
        const [red, green, blue] = at(c, r);
        return oklab(red, green, blue)[0];
      });
      assert.ok(light > middle && middle > dense, `row ${r}: ${light} ${middle} ${dense}`);
    });
  });

  test("the page's gradient has the same stops", () => {
    const css = sunsetGradient();
    assert.ok(
      SUNSET_STOPS.every(({ at: y, colour }) => css.includes(`${colour} ${y}px`)),
      css,
    );
  });
});
