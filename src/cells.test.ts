import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bigClouds,
  type CloudLayer,
  drift,
  GLYPHS,
  hash,
  measureGlyph,
  normaliseShapes,
  OPEN_SKY,
  oklab,
  reachOf,
  SKY_RAMP,
  skyCells,
  THEMES,
  VICE_STOPS,
  viceColours,
  viceGradient,
  WIND,
  wrap,
} from "./cells.ts";

function layer(cloud: number, shade = 0): CloudLayer {
  const width = 64;
  const height = 64;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = shade;
    pixels[i + 1] = cloud;
    pixels[i + 3] = 255;
  }
  return { pixels, width, height };
}

function sky(near: CloudLayer, far = layer(0)) {
  const columns = 20;
  const rows = 8;
  const rgb = new Uint8ClampedArray(columns * rows * 4).fill(180);
  return skyCells({
    still: {
      columns,
      rows,
      cw: 6,
      ch: 10,
      text: Array.from({ length: rows }, () => SKY_RAMP[4].repeat(columns)).join("\n"),
      rgb: { light: rgb, dark: rgb, vice: rgb },
    },
    near,
    far,
    shapes: new Float32Array(GLYPHS.length * 6).fill(0.5),
  });
}

describe("cells", () => {
  test("open sky where there is no cloud, as blue as the painting", () => {
    const cells = sky(layer(0));
    cells.at(3);
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    assert.equal(cells.cell(30, 20, 8, 12, "light", out), OPEN_SKY);
    assert.deepEqual(out.slice(0, 3), [180, 180, 180]);
    assert.equal(out[3], 4 / (SKY_RAMP.length - 1));
  });

  test("inside a cloud, a shading glyph of the theme on a tile", () => {
    for (const theme of ["light"] as const) {
      const cells = sky(layer(255, 0));
      cells.at(0);
      const out = [0, 0, 0, 0, 0, 0, 0, 0];
      const g = cells.cell(40, 40, 8, 12, theme, out);
      assert.ok(g === -1 || THEMES[theme].inside.includes(g), `${theme}: ${GLYPHS[g]}`);
      assert.ok(out[7] > 0.9, "the tile shows");
    }
  });
});

describe("night", () => {
  test("the dark page's sky has no clouds: open sky everywhere", () => {
    const cells = sky(layer(255, 0), layer(255, 0));
    cells.at(0);
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    assert.equal(cells.cell(40, 40, 8, 12, "dark", out), OPEN_SKY);
    assert.notEqual(cells.cell(40, 40, 8, 12, "light", out), OPEN_SKY);
  });
});

describe("vice", () => {
  test("a Vice City sunset has only the near layer's clouds", () => {
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    const farOnly = sky(layer(0), layer(255, 0));
    farOnly.at(0);
    assert.equal(farOnly.cell(40, 40, 8, 12, "vice", out), OPEN_SKY);
    assert.notEqual(farOnly.cell(40, 40, 8, 12, "light", out), OPEN_SKY);
    const near = sky(layer(255, 0));
    near.at(0);
    assert.notEqual(near.cell(40, 40, 8, 12, "vice", out), OPEN_SKY);
  });
});

describe("bigClouds", () => {
  function clouds(...squares: [number, number, number][]): CloudLayer {
    const width = 64;
    const height = 32;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (const [x0, y0, side] of squares) {
      for (let y = y0; y < y0 + side; y++) {
        for (let x = x0; x < x0 + side; x++) {
          const i = (y * width + (x % width)) * 4;
          pixels[i] = 90;
          pixels[i + 1] = 255;
        }
      }
    }
    return { pixels, width, height };
  }
  const cloudAt = (l: CloudLayer, x: number, y: number) => l.pixels[(y * l.width + x) * 4 + 1];

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
    assert.equal(drift(0, WIND.near), 0);
    let last = 0;
    for (let t = 0.1; t < 120; t += 0.1) {
      const d = drift(t, WIND.near);
      assert.ok(d > last, `at ${t.toFixed(1)} s`);
      last = d;
    }
  });

  test("goes at the mean speed over a long while", () => {
    const seconds = 23 * 8.7 * 10;
    assert.ok(Math.abs(drift(seconds, WIND.far) / seconds - WIND.far) < 0.1);
  });
});

describe("glyph shapes", () => {
  test("a full cell is full ink everywhere; an empty one, none", () => {
    const w = 16;
    const h = 24;
    const full = measureGlyph(new Uint8ClampedArray(w * h).fill(255), w, h);
    const empty = measureGlyph(new Uint8ClampedArray(w * h), w, h);
    for (let k = 0; k < 6; k++) {
      assert.ok(Math.abs(full[k] - 1) < 1e-6);
      assert.equal(empty[k], 0);
    }
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
  function slowly(pixels: Uint8ClampedArray, lw: number, lh: number, rx: number, ry: number) {
    const out = new Uint8Array(lw * lh);
    for (let j = 0; j < lh; j++) {
      for (let i = 0; i < lw; i++) {
        let most = 0;
        for (let y = j - ry; y <= j + ry; y++) {
          if (y < 0 || y >= lh) {
            continue;
          }
          for (let x = i - rx; x <= i + rx; x++) {
            const at = (((x % lw) + lw) % lw) + y * lw;
            most = Math.max(most, pixels[at * 4 + 1]);
          }
        }
        out[j * lw + i] = most;
      }
    }
    return out;
  }

  test("is the most cloud near each point, wrapping sideways, clear past top and bottom", () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    for (const [lw, lh, rx, ry] of [
      [37, 23, 0, 0],
      [37, 23, 3, 2],
      [40, 30, 6, 6],
      [29, 31, 9, 4],
      [16, 9, 20, 12],
      [300, 20, 24, 15],
      [257, 12, 6, 6],
    ]) {
      const pixels = new Uint8ClampedArray(lw * lh * 4);
      for (let i = 0; i < lw * lh; i++) {
        pixels[i * 4 + 1] = rand() < 0.08 ? 1 + ((rand() * 254) | 0) : 0;
      }
      const want = slowly(pixels, lw, lh, rx, ry);
      const reach = reachOf({ pixels, width: lw, height: lh }, rx, ry);
      const order = Array.from({ length: lw * lh }, (_, k) => k).sort(() => rand() - 0.5);
      for (const k of order) {
        const i = k % lw;
        const j = Math.floor(k / lw);
        assert.equal(reach(i * 2, j * 2), want[k], `${lw}x${lh} r ${rx},${ry} at ${i},${j}`);
      }
    }
  });
});

describe("hash", () => {
  test("is in [0, 1) and the same each time", () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [-5, 3, 23],
      [2 ** 31 - 1, -(2 ** 31), 37],
      [1e6, 1e6, 5],
    ]) {
      const h = hash(x, y, z);
      assert.ok(h >= 0 && h < 1);
      assert.equal(hash(x, y, z), h);
    }
  });

  test("spreads cells evenly", () => {
    const buckets = new Array(10).fill(0);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        buckets[Math.floor(hash(x, y, 23) * 10)]++;
      }
    }
    for (const b of buckets) {
      assert.ok(b > 850 && b < 1150, `bucket of ${b}`);
    }
  });

  test("gives neighbours and streams unrelated numbers", () => {
    let same = 0;
    for (let x = 0; x < 1000; x++) {
      if (Math.abs(hash(x, 0, 1) - hash(x + 1, 0, 1)) < 0.005) {
        same++;
      }
      if (Math.abs(hash(x, 0, 23) - hash(x, 0, 37)) < 0.005) {
        same++;
      }
    }
    assert.ok(same < 45, `${same} near pairs`);
  });
});

const slow = (x: number, n: number) => {
  let w = x % n;
  if (w < 0) {
    w += n;
  }
  return w;
};

describe("wrap", () => {
  test("is x % n made positive, to the last bit", () => {
    let seed = 1;
    const rand = () => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed / 4_294_967_296;
    };
    for (const n of [128, 1200, 400, 7]) {
      for (let i = 0; i < 20_000; i++) {
        const x = (rand() - 0.5) * 2 ** (1 + (i % 7) * 4);
        assert.ok(wrap(x, n) === slow(x, n), `wrap(${x}, ${n})`);
      }
    }
  });

  test("holds right at the edges", () => {
    for (const n of [128, 1200]) {
      for (const x of [0, n, -n, n - 1e-12, -1e-12, n * 1e6 - 1e-7, -(n * 1e6) + 1e-7, 0.5, -0.5]) {
        assert.ok(wrap(x, n) === slow(x, n), `wrap(${x}, ${n})`);
        assert.ok(wrap(x, n) >= 0 && wrap(x, n) < n);
      }
    }
  });
});

const COLUMNS = 3;
const ROWS = 60;
const CH = 10;
const text = Array.from(
  { length: ROWS },
  () => `${SKY_RAMP[0]}${SKY_RAMP[4]}${SKY_RAMP.at(-1)}`,
).join("\n");
const colours = viceColours(COLUMNS, ROWS, CH, text);
const at = (c: number, r: number) => {
  const o = (r * COLUMNS + c) * 4;
  return [colours[o], colours[o + 1], colours[o + 2], colours[o + 3]];
};
const hue = ([r, g, b]: number[]) => {
  const [, a, bb] = oklab(r, g, b);
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
};

describe("viceColours", () => {
  test("a colour a cell, opaque", () => {
    assert.equal(colours.length, COLUMNS * ROWS * 4);
    for (let r = 0; r < ROWS; r++) {
      assert.equal(at(1, r)[3], 255);
    }
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
    for (const r of [0, 20, 40]) {
      const [light, middle, dense] = [0, 1, 2].map(
        (c) => oklab(...(at(c, r).slice(0, 3) as [number, number, number]))[0],
      );
      assert.ok(light > middle && middle > dense, `row ${r}: ${light} ${middle} ${dense}`);
    }
  });

  test("the page's gradient has the same stops", () => {
    const css = viceGradient();
    for (const [y, c] of VICE_STOPS) {
      assert.ok(css.includes(`${c} ${y}px`), css);
    }
  });
});
