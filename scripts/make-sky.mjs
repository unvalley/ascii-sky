import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  BYTE_MAX,
  CENTRE,
  fromOklab,
  HERMITE,
  hex,
  oklab,
  RGB,
  range,
  SKY_RAMP,
  smoothstep,
  span,
} from "../src/cells.ts";

const ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const SKY_BLOCK = /export const sky = \{[^}]*\};/u;
const VERSION_LENGTH = 10;
const SKY_WIDTH = 2400;
const SKY_HEIGHT = 700;
const CELL_WIDTH = 6;
const CELL_HEIGHT = 9.75;
const PAINTING_WIDTH = 1536;
const UINT32_RANGE = 4_294_967_296;
const DEGREES_PER_HALF_TURN = 180;
const QUAD = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };
const CHROMA_EDGE = { from: 0.2, to: 0.42 };

const BAND = { stretched: 1920, overlap: 320 };
const CLEAR = {
  lightFrom: 0.62,
  lightTo: 0.8,
  softRadius: 2,
  cloudyFrom: 0.02,
  cloudyTo: 0.2,
  holeRadius: 6,
  holeGain: 2.5,
  holeEdge: 0.01,
  detailRadius: 5,
  donorClear: 0.05,
};
const REPEATS = 3;
const DONORS = [{ offset: 523 }, { offset: 811 }, { offset: 1129 }, { offset: 277 }];
const SIDE = { left: 0, top: 1, right: 2, bottom: 3 };

const NIGHT = { light: 0.41, dense: 0.29, hueTurn: 14, chroma: 0.75 };
const SKY_LOOK = {
  light: { hue: -13, chroma: 0.9, least: Number.NEGATIVE_INFINITY, most: 0.73 },
  dark: { hue: -8, chroma: 1.05, least: 0.66, most: Number.POSITIVE_INFINITY },
};
const CLOUD_LOOK = {
  light: ["#c3d2e8", "#9db3d6", "#7690c2", "#5a76ae"],
  dark: ["#ffffff", "#e6eefa", "#c2d1ea", "#93a8cf"],
};
const PAGE = { light: "#fafafa", dark: "#171717" };
const LAST_STOP_MARGIN = 1.0001;

const SAMPLES = { across: 4, down: 6 };
const INK = { lumBelow: 0.9, chromaFrom: 40, coverageFrom: 0.2 };
const SHADE_CHROMA_BELOW = 70;
const NEIGHBOURHOOD = { across: 5, down: 3 };
const SURROUND_DARKEN = 0.15;
const DARK_RANGE = { low: 0.04, high: 0.97 };
const GLYPH_STEPS = { sky: 7, shade: 5 };
const SHADOW = { offset: 0.06, span: 0.3 };
const THIN_COVERAGE = 0.45;

const CUT = { lightFrom: 0.62, lightTo: 0.82, white: 0.96, shadeSpan: 0.26 };
const WAVE_LENGTH = 38;
const KNUTH = {
  seedStep: 7919,
  multiplier: 2_654_435_761,
  mix: 2_246_822_519,
  firstShift: 15,
  lastShift: 13,
};
const SEED_STRIDE = 31;
const FRINGE = { least: 0.35, spread: 1.3 };
const VIGNETTE = { radius: 0.62, from: 0.82 };
const SOFTEN = { wide: 10, narrow: 5 };
const FILL = { keep: 0.7, from: 0.28, to: 0.55 };
const DETAIL = { radius: 5, sharpen: 1.8, rankedFrom: 0.4, rankMix: 0.7 };

const SHEET = { column: 520, margin: 10, label: 18, gap: 8, perRow: 2 };
const SHEET_SKY = "#4096e6";
const CLOUD_INK = { r: 140, g: 115, b: 70 };

const LAYER_SCALE = 2;
const QUANTISE = { levels: 63, step: 4.05 };
const VISIBLE_FROM = 0.04;

const CUT_OUTS = [
  {
    name: "big",
    box: { left: 819, top: 26, right: 1536, bottom: 610 },
    fade: { left: 0, top: 0, right: 110, bottom: 40 },
  },
  {
    name: "crown",
    box: { left: 1090, top: 0, right: 1430, bottom: 300 },
    fade: { left: 70, top: 0, right: 60, bottom: 90 },
  },
  {
    name: "base",
    box: { left: 800, top: 380, right: 1290, bottom: 610 },
    fade: { left: 0, top: 80, right: 60, bottom: 30 },
  },
  {
    name: "heap",
    box: { left: 0, top: 490, right: 320, bottom: 790 },
    fade: { left: 80, top: 0, right: 70, bottom: 30 },
  },
  {
    name: "flat",
    box: { left: 280, top: 615, right: 600, bottom: 800 },
    fade: { left: 60, top: 0, right: 0, bottom: 20 },
  },
  {
    name: "left",
    box: { left: 0, top: 493, right: 572, bottom: 815 },
    fade: { left: 90, top: 0, right: 0, bottom: 30 },
  },
  {
    name: "row",
    box: { left: 990, top: 690, right: 1400, bottom: 875 },
    fade: { left: 0, top: 0, right: 50, bottom: 30 },
  },
  {
    name: "rowEnd",
    box: { left: 1380, top: 690, right: 1536, bottom: 820 },
    fade: { left: 50, top: 0, right: 70, bottom: 20 },
  },
  {
    name: "topLeft",
    box: { left: 150, top: 0, right: 460, bottom: 205 },
    fade: { left: 40, top: 70, right: 0, bottom: 0 },
  },
  {
    name: "puffs",
    box: { left: 55, top: 855, right: 345, bottom: 965 },
    fade: { left: 0, top: 0, right: 0, bottom: 20 },
  },
  {
    name: "lowMid",
    box: { left: 650, top: 840, right: 995, bottom: 958 },
    fade: { left: 0, top: 0, right: 0, bottom: 30 },
  },
  {
    name: "wisp1",
    box: { left: 425, top: 220, right: 650, bottom: 330 },
    fade: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  {
    name: "wisp2",
    box: { left: 0, top: 352, right: 240, bottom: 440 },
    fade: { left: 50, top: 0, right: 0, bottom: 0 },
  },
  {
    name: "wisp3",
    box: { left: 1205, top: 540, right: 1360, bottom: 615 },
    fade: { left: 0, top: 0, right: 0, bottom: 0 },
  },
];

const NEAR = [
  { cutOut: "big", x: 330, base: 330, scale: 0.42, wide: 1, flip: false },
  { cutOut: "wisp1", x: 760, base: 95, scale: 0.9, wide: 1.3, flip: false },
  { cutOut: "flat", x: 820, base: 255, scale: 0.6, wide: 1, flip: false },
  { cutOut: "row", x: 1180, base: 335, scale: 0.62, flip: true, wide: 1 },
  { cutOut: "crown", x: 1540, base: 215, scale: 0.55, wide: 1.3, flip: false },
  { cutOut: "left", x: 1960, base: 320, scale: 0.5, wide: 1.15, flip: false },
  { cutOut: "wisp2", x: 2290, base: 140, scale: 0.75, wide: 1.4, flip: false },
  { cutOut: "heap", x: 160, base: 640, scale: 0.42, wide: 1.35, flip: false },
  { cutOut: "lowMid", x: 1000, base: 560, scale: 0.7, wide: 1, flip: false },
  { cutOut: "row", x: 1760, base: 660, scale: 0.5, wide: 1, flip: false },
];
const FAR = [
  { cutOut: "topLeft", x: 110, base: 115, scale: 0.3, wide: 1, flip: false },
  { cutOut: "puffs", x: 540, base: 175, scale: 0.42, wide: 1.2, flip: false },
  { cutOut: "rowEnd", x: 900, base: 80, scale: 0.45, wide: 1, flip: false },
  { cutOut: "base", x: 1270, base: 150, scale: 0.32, flip: true, wide: 1 },
  { cutOut: "lowMid", x: 1660, base: 60, scale: 0.36, flip: true, wide: 0.85 },
  { cutOut: "heap", x: 2010, base: 160, scale: 0.26, flip: true, wide: 1.35 },
  { cutOut: "wisp3", x: 2310, base: 105, scale: 0.7, wide: 1.5, flip: false },
  { cutOut: "flat", x: 620, base: 470, scale: 0.36, flip: true, wide: 1 },
  { cutOut: "puffs", x: 1500, base: 520, scale: 0.45, flip: true, wide: 1 },
  { cutOut: "rowEnd", x: 2200, base: 430, scale: 0.5, flip: true, wide: 1 },
];

const raw = (pixels, width, height) => sharp(pixels, { raw: { width, height, channels: RGB } });

const band = async (painting) => {
  const { stretched, overlap } = BAND;
  const width = stretched - overlap;
  const rows = Math.round(SKY_HEIGHT / (stretched / PAINTING_WIDTH));
  const img = await sharp(painting)
    .extract({ left: 0, top: 0, width: PAINTING_WIDTH, height: rows })
    .resize(stretched, SKY_HEIGHT, { kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const tile = Uint8Array.from({ length: width * SKY_HEIGHT * RGB }, (_, q) => {
    const c = q % RGB;
    const i = (q - c) / RGB;
    const x = i % width;
    const y = (i - x) / width;
    const here = img[(y * stretched + x) * RGB + c];
    if (x >= overlap) {
      return here;
    }
    const t = smoothstep(0, 1, x / overlap);
    return Math.round(img[(y * stretched + x + width) * RGB + c] * (1 - t) + here * t);
  });
  return { img: tile, width, height: SKY_HEIGHT };
};

const clearSky = ({ img, width: P, height: H }) => {
  const lum = (i) =>
    (LUMA.r * img[i * RGB] + LUMA.g * img[i * RGB + 1] + LUMA.b * img[i * RGB + 2]) / BYTE_MAX;
  const chroma = (i) =>
    (Math.max(img[i * RGB], img[i * RGB + 1], img[i * RGB + 2]) -
      Math.min(img[i * RGB], img[i * RGB + 1], img[i * RGB + 2])) /
    BYTE_MAX;
  const alpha = Float32Array.from(
    { length: P * H },
    (_, i) =>
      smoothstep(CLEAR.lightFrom, CLEAR.lightTo, lum(i)) *
      (1 - smoothstep(CHROMA_EDGE.from, CHROMA_EDGE.to, chroma(i))),
  );
  const blurX = (src, r) => {
    const taps = span(-r, r);
    return Float32Array.from({ length: P * H }, (_, i) => {
      const x = i % P;
      return taps.reduce((s, d) => s + src[i - x + ((x + d + P) % P)], 0) / (2 * r + 1);
    });
  };
  const blurY = (src, r) => {
    const taps = span(-r, r);
    return Float32Array.from({ length: P * H }, (_, i) => {
      const x = i % P;
      const y = (i - x) / P;
      const sum = taps.reduce(
        (s, d) => (y + d >= 0 && y + d < H ? s + src[(y + d) * P + x] : s),
        0,
      );
      return sum / (Math.min(H - 1, y + r) - Math.max(0, y - r) + 1);
    });
  };
  const cloudy = blurY(blurX(alpha, CLEAR.softRadius), CLEAR.softRadius).map((v) =>
    smoothstep(CLEAR.cloudyFrom, CLEAR.cloudyTo, v),
  );
  const hole = blurY(
    blurX(
      cloudy.map((v) => (v > CLEAR.cloudyFrom ? 1 : 0)),
      CLEAR.holeRadius,
    ),
    CLEAR.holeRadius,
  ).map((v) => Math.min(1, v * CLEAR.holeGain));
  const pushPull = (values, weights, w, h) => {
    if (w <= 2 || h <= 2) {
      return values;
    }
    const w2 = Math.ceil(w / 2);
    const h2 = Math.ceil(h / 2);
    const under = Array.from({ length: w2 * h2 }, (_, j) => {
      const jx = j % w2;
      const jy = (j - jx) / w2;
      return QUAD.filter(([dx, dy]) => 2 * jx + dx < w && 2 * jy + dy < h).map(
        ([dx, dy]) => (2 * jy + dy) * w + 2 * jx + dx,
      );
    });
    const k2 = Float32Array.from(under, (from) =>
      from.reduce((s, i) => Math.fround(s + weights[i]), 0),
    );
    const v2 = Float32Array.from({ length: w2 * h2 * RGB }, (_, q) => {
      const c = q % RGB;
      const j = (q - c) / RGB;
      const sum = under[j].reduce((s, i) => Math.fround(s + values[i * RGB + c] * weights[i]), 0);
      return k2[j] > 0 ? sum / k2[j] : sum;
    });
    const coarse = pushPull(
      v2,
      k2.map((v) => Math.min(1, v)),
      w2,
      h2,
    );
    const at = (xx, yy, c) =>
      coarse[
        (Math.min(h2 - 1, Math.max(0, yy)) * w2 + Math.min(w2 - 1, Math.max(0, xx))) * RGB + c
      ];
    return Float32Array.from({ length: w * h * RGB }, (_, q) => {
      const c = q % RGB;
      const i = (q - c) / RGB;
      const x = i % w;
      const y = (i - x) / w;
      const k = Math.min(1, weights[i]);
      const fx = (x + CENTRE) / 2 - CENTRE;
      const fy = (y + CENTRE) / 2 - CENTRE;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const u = fx - x0;
      const v = fy - y0;
      const up =
        (at(x0, y0, c) * (1 - u) + at(x0 + 1, y0, c) * u) * (1 - v) +
        (at(x0, y0 + 1, c) * (1 - u) + at(x0 + 1, y0 + 1, c) * u) * v;
      return values[i * RGB + c] * k + up * (1 - k);
    });
  };
  const wide = P * REPEATS;
  const repeated = (i) => {
    const x = i % wide;
    return ((i - x) / wide) * P + (x % P);
  };
  const filled = pushPull(
    Float32Array.from({ length: wide * H * RGB }, (_, q) => {
      const c = q % RGB;
      const i = (q - c) / RGB;
      return img[repeated(i) * RGB + c];
    }),
    Float32Array.from({ length: wide * H }, (_, i) => (hole[repeated(i)] > CLEAR.holeEdge ? 0 : 1)),
    wide,
    H,
  );
  const base = Float32Array.from({ length: P * H * RGB }, (_, q) => {
    const c = q % RGB;
    const i = (q - c) / RGB;
    const x = i % P;
    return filled[(((i - x) / P) * wide + x + P) * RGB + c];
  });
  const blurred = range(RGB).map((c) =>
    blurY(
      blurX(
        Float32Array.from({ length: P * H }, (_, i) => img[i * RGB + c]),
        CLEAR.detailRadius,
      ),
      CLEAR.detailRadius,
    ),
  );
  const donorOf = Int32Array.from({ length: P * H }, (_, i) => {
    const x = i % P;
    return (
      DONORS.map(({ offset }) => i - x + ((x + offset) % P)).find(
        (j) => hole[j] < CLEAR.donorClear,
      ) ?? -1
    );
  });
  const sky = Uint8Array.from({ length: P * H * RGB }, (_, q) => {
    const c = q % RGB;
    const i = (q - c) / RGB;
    const h = hole[i];
    const donor = donorOf[i];
    const detail = donor >= 0 ? img[donor * RGB + c] - blurred[c][donor] : 0;
    const fill = base[i * RGB + c] + detail;
    return Math.round(Math.min(BYTE_MAX, Math.max(0, img[i * RGB + c] * (1 - h) + fill * h)));
  });
  const shift = (((P - (SKY_WIDTH - P) / 2) % P) + P) % P;
  return Uint8Array.from({ length: SKY_WIDTH * H * RGB }, (_, q) => {
    const c = q % RGB;
    const i = (q - c) / RGB;
    const x = i % SKY_WIDTH;
    return sky[(((i - x) / SKY_WIDTH) * P + ((x + shift) % P)) * RGB + c];
  });
};

const turn = (a, b, degrees) => {
  const t = (degrees * Math.PI) / DEGREES_PER_HALF_TURN;
  return [a * Math.cos(t) - b * Math.sin(t), a * Math.sin(t) + b * Math.cos(t)];
};

const toNight = (pixels, columns, rows, text) => {
  const lines = text.split("\n");
  return Uint8Array.from(
    range(columns * rows).flatMap((k) => {
      const c = k % columns;
      const line = lines[(k - c) / columns];
      const rgb = [pixels[k * RGB], pixels[k * RGB + 1], pixels[k * RGB + 2]];
      if (line === undefined) {
        return rgb;
      }
      const d = Math.max(0, SKY_RAMP.indexOf(line[c] ?? ".")) / (SKY_RAMP.length - 1);
      const [, a0, b0] = oklab(...rgb);
      const [a, b] = turn(a0, b0, NIGHT.hueTurn);
      return fromOklab(
        NIGHT.light + (NIGHT.dense - NIGHT.light) * d,
        a * NIGHT.chroma,
        b * NIGHT.chroma,
      );
    }),
  );
};

const colourOf = (cell, mode) => {
  if (!cell) {
    return hex(PAGE[mode]);
  }
  if (cell.part === "sky") {
    const [L, a0, b0] = oklab(...cell.mean);
    const { hue, chroma, least, most } = SKY_LOOK[mode];
    const [a, b] = turn(a0, b0, hue);
    return fromOklab(Math.min(Math.max(L, least), most), a * chroma, b * chroma);
  }
  const stops = CLOUD_LOOK[mode];
  const p = Math.min(
    stops.length - LAST_STOP_MARGIN,
    Math.max(0, cell.shadow * (stops.length - 1)),
  );
  const i = Math.floor(p);
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  return a.map((v, k) => v + (b[k] - v) * (p - i));
};

const convert = async (clear) => {
  const columns = SKY_WIDTH / CELL_WIDTH;
  const rows = Math.floor(SKY_HEIGHT / CELL_HEIGHT);
  const sampledWidth = columns * SAMPLES.across;
  const sampledHeight = rows * SAMPLES.down;
  const data = await raw(clear, SKY_WIDTH, SKY_HEIGHT)
    .extract({ left: 0, top: 0, width: SKY_WIDTH, height: Math.floor(rows * CELL_HEIGHT) })
    .resize(sampledWidth, sampledHeight, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const px = (x, y) => {
    const i =
      (Math.min(sampledHeight - 1, Math.max(0, y)) * sampledWidth +
        Math.min(sampledWidth - 1, Math.max(0, x))) *
      RGB;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const lum = ([r, g, b]) => (LUMA.r * r + LUMA.g * g + LUMA.b * b) / BYTE_MAX;
  const chromaOf = (c) => Math.max(...c) - Math.min(...c);
  const perCell = SAMPLES.across * SAMPLES.down;

  const inkedCell = (r, c, inked, coverage) => {
    const mean = inked
      .reduce((sum, p) => sum.map((v, i) => v + p[i]), [0, 0, 0])
      .map((v) => v / inked.length);
    return { r, c, coverage, mean, part: chromaOf(mean) < SHADE_CHROMA_BELOW ? "shade" : "sky" };
  };

  const found = range(rows * columns).map((k) => {
    const c = k % columns;
    const r = (k - c) / columns;
    const inked = range(perCell)
      .map((s) =>
        px(
          c * SAMPLES.across + (s % SAMPLES.across),
          r * SAMPLES.down + Math.floor(s / SAMPLES.across),
        ),
      )
      .filter((p) => lum(p) < INK.lumBelow || chromaOf(p) >= INK.chromaFrom);
    const coverage = inked.length / perCell;
    return coverage < INK.coverageFrom ? undefined : inkedCell(r, c, inked, coverage);
  });

  const { across, down } = NEIGHBOURHOOD;
  const around = span(-down, down).flatMap((dr) => span(-across, across).map((dc) => [dr, dc]));
  const weightOf = ([dr, dc]) =>
    Math.exp(-(dr * dr) / (2 * (down / 2) ** 2) - (dc * dc) / (2 * (across / 2) ** 2));
  const darkOf = (cell) => {
    const near = around
      .map(([dr, dc]) => {
        const o = found[(cell.r + dr) * columns + cell.c + dc];
        const isInside =
          cell.r + dr >= 0 && cell.r + dr < rows && cell.c + dc >= 0 && cell.c + dc < columns;
        return o && o.part === cell.part && isInside ? { o, k: weightOf([dr, dc]) } : undefined;
      })
      .filter(Boolean);
    const s = near.reduce((sum, { o, k }) => sum + k * lum(o.mean), 0);
    const w = near.reduce((sum, { k }) => sum + k, 0);
    const mean = w ? s / w : lum(cell.mean);
    return mean - lum(cell.mean) + (1 - mean) * SURROUND_DARKEN;
  };
  const darkened = found.map((cell) => cell && { ...cell, dark: darkOf(cell) });
  const live = darkened.filter(Boolean);
  const spread = Object.fromEntries(
    Object.keys(GLYPH_STEPS).map((part) => {
      const darks = live
        .filter((c) => c.part === part)
        .map((c) => c.dark)
        .sort((a, b) => a - b);
      const q = (p) => darks[Math.floor(p * (darks.length - 1))];
      return [part, { low: q(DARK_RANGE.low), high: q(DARK_RANGE.high) }];
    }),
  );
  const shaded = (cell) => {
    const { low, high } = spread[cell.part];
    const t = Math.max(0, Math.min(1, (cell.dark - low) / (high - low || 1)));
    const i = Math.round(t * GLYPH_STEPS[cell.part]);
    return {
      ...cell,
      shadow: Math.max(0, Math.min(1, (1 - lum(cell.mean) - SHADOW.offset) / SHADOW.span)),
      glyph: SKY_RAMP[cell.coverage < THIN_COVERAGE ? Math.min(i, 1) : i],
    };
  };
  const cells = darkened.map((cell) => (cell === undefined ? undefined : shaded(cell)));

  const mapFor = (mode) =>
    Uint8Array.from(cells.flatMap((cell) => colourOf(cell, mode).map((v) => Math.round(v))));
  const text = range(rows)
    .map((r) =>
      cells
        .slice(r * columns, (r + 1) * columns)
        .map((cell) => (cell ? cell.glyph : " "))
        .join("")
        .trimEnd(),
    )
    .join("\n");
  return {
    text,
    columns,
    rows,
    maps: { light: mapFor("light"), dark: toNight(mapFor("dark"), columns, rows, text) },
  };
};

const boxBlur = (src, w, h, r) => {
  const taps = span(-r, r);
  const across = Float32Array.from({ length: w * h }, (_, i) => {
    const x = i % w;
    const sum = taps.reduce((s, d) => (x + d >= 0 && x + d < w ? s + src[i + d] : s), 0);
    return sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
  });
  return Float32Array.from({ length: w * h }, (_, i) => {
    const x = i % w;
    const y = (i - x) / w;
    const sum = taps.reduce((s, d) => (y + d >= 0 && y + d < h ? s + across[i + d * w] : s), 0);
    return sum / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
  });
};

const wave = (t, seed) => {
  const u = t / WAVE_LENGTH;
  const i = Math.floor(u);
  const r = (k) => {
    const a = Math.imul(k + seed * KNUTH.seedStep, KNUTH.multiplier) >>> 0;
    const b = Math.imul(a ^ (a >>> KNUTH.firstShift), KNUTH.mix) >>> 0;
    return ((b ^ (b >>> KNUTH.lastShift)) >>> 0) / UINT32_RANGE;
  };
  const f = u - i;
  return r(i) + (r(i + 1) - r(i)) * f * f * (HERMITE.square - HERMITE.cube * f);
};

const cutClouds = async (painting) => {
  const { data: img, info } = await sharp(painting)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const paintingWidth = info.width;
  const rgbAt = (i) => [
    img[i * RGB] / BYTE_MAX,
    img[i * RGB + 1] / BYTE_MAX,
    img[i * RGB + 2] / BYTE_MAX,
  ];
  const lumOf = ([r, g, b]) => LUMA.r * r + LUMA.g * g + LUMA.b * b;
  const alpha = Float32Array.from({ length: paintingWidth * info.height }, (_, i) => {
    const rgb = rgbAt(i);
    return (
      smoothstep(CUT.lightFrom, CUT.lightTo, lumOf(rgb)) *
      (1 - smoothstep(CHROMA_EDGE.from, CHROMA_EDGE.to, Math.max(...rgb) - Math.min(...rgb)))
    );
  });
  const shade = Float32Array.from({ length: paintingWidth * info.height }, (_, i) =>
    Math.min(1, Math.max(0, (CUT.white - lumOf(rgbAt(i))) / CUT.shadeSpan)),
  );

  const cutOut = ({ name, box: { left: x0, top: y0, right: x1, bottom: y1 }, fade: fades }) => {
    const w = x1 - x0;
    const h = y1 - y0;
    const fade = [fades.left, fades.top, fades.right, fades.bottom];
    const seed = x0 * SEED_STRIDE + y0;
    const reach = (side, t) => fade[side] * (FRINGE.least + FRINGE.spread * wave(t, seed + side));
    const edges = [
      (x, y) => smoothstep(0, reach(SIDE.left, y), x),
      (x, y) => smoothstep(0, reach(SIDE.top, x), y),
      (x, y) => smoothstep(0, reach(SIDE.right, y), w - 1 - x),
      (x, y) => smoothstep(0, reach(SIDE.bottom, x), h - 1 - y),
    ];
    const from = (k) => {
      const x = k % w;
      return (y0 + (k - x) / w) * paintingWidth + x0 + x;
    };
    const cut = Float32Array.from({ length: w * h }, (_, k) => {
      const x = k % w;
      const y = (k - x) / w;
      const faded = edges.reduce((f, edge, side) => (fade[side] ? f * edge(x, y) : f), 1);
      const ex = (x - w / 2) / (w * VIGNETTE.radius);
      const ey = (y - h / 2) / (h * VIGNETTE.radius);
      return alpha[from(k)] * (faded * (1 - smoothstep(VIGNETTE.from, 1, Math.hypot(ex, ey))));
    });
    const s = Float32Array.from({ length: w * h }, (_, k) => shade[from(k)]);
    const soft = boxBlur(boxBlur(cut, w, h, SOFTEN.wide), w, h, SOFTEN.narrow);
    const a = cut.map((v, k) => Math.max(v * FILL.keep, smoothstep(FILL.from, FILL.to, soft[k])));
    const blur = boxBlur(s, w, h, DETAIL.radius);
    const detail = blur.map((b, k) => Math.min(1, Math.max(0, b + DETAIL.sharpen * (s[k] - b))));
    const ranked = [...detail].filter((_, k) => a[k] > DETAIL.rankedFrom).sort((p, q) => p - q);
    const below = (v, lo, hi) => {
      if (lo >= hi) {
        return lo;
      }
      const mid = (lo + hi) >> 1;
      return ranked[mid] < v ? below(v, mid + 1, hi) : below(v, lo, mid);
    };
    const rank = (v) => (ranked.length > 0 ? below(v, 0, ranked.length) / ranked.length : 0);
    const mix = DETAIL.rankMix;
    return { name, w, h, a, s: detail.map((d) => d * (1 - mix) + rank(d) * mix) };
  };

  return Object.fromEntries(CUT_OUTS.map((spec) => [spec.name, cutOut(spec)]));
};

const cloudColour = (a, s) => {
  const cloud = [
    BYTE_MAX - s * CLOUD_INK.r,
    BYTE_MAX - s * CLOUD_INK.g,
    BYTE_MAX - s * CLOUD_INK.b,
  ];
  return hex(SHEET_SKY).map((sky, c) => Math.round(sky * (1 - a) + cloud[c] * a));
};

const writeSheet = async (cutOuts, file) => {
  const { column, margin, label: labelHeight, gap, perRow } = SHEET;
  const pieces = await Promise.all(
    Object.values(cutOuts).map(async (sp) => {
      const scale = Math.min(1, (column - margin) / sp.w);
      const w = Math.round(sp.w * scale);
      const h = Math.round(sp.h * scale);
      const colours = Uint8Array.from(
        range(sp.w * sp.h).flatMap((k) => cloudColour(sp.a[k], sp.s[k])),
      );
      const cutout = await raw(colours, sp.w, sp.h).resize(w, h).png().toBuffer();
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${labelHeight}"><text x="2" y="14" font-family="Menlo" font-size="13">${sp.name} ${sp.w}x${sp.h}</text></svg>`,
      );
      return { cutout, label, h };
    }),
  );
  const rows = range(Math.ceil(pieces.length / perRow)).map((r) =>
    pieces.slice(r * perRow, (r + 1) * perRow),
  );
  const heights = rows.map((row) => Math.max(0, ...row.map(({ h }) => h + labelHeight + gap)));
  const topOf = (r) => heights.slice(0, r).reduce((sum, h) => sum + h, 0);
  await sharp({
    create: {
      width: column * perRow,
      height: topOf(rows.length),
      channels: RGB,
      background: "#fff",
    },
  })
    .composite(
      rows.flatMap((row, r) =>
        row.flatMap(({ cutout, label }, col) => [
          { input: cutout, top: topOf(r) + labelHeight, left: col * column },
          { input: label, top: topOf(r), left: col * column },
        ]),
      ),
    )
    .png()
    .toFile(file);
};

const place = (layer, sp, { x, base, scale, wide, flip }) => {
  const w = Math.round(sp.w * scale * wide);
  const h = Math.round(sp.h * scale);
  const left = Math.round(x - w / 2);
  const top = Math.round(base - h);
  const dropAt = (k) => {
    const px = k % SKY_WIDTH;
    const y = (k - px) / SKY_WIDTH - top;
    const xx = (((px - left) % SKY_WIDTH) + SKY_WIDTH) % SKY_WIDTH;
    if (y < 0 || y >= h || xx >= w) {
      return;
    }
    const sx0 = (xx / w) * sp.w;
    const sx1 = ((xx + 1) / w) * sp.w;
    const sy0 = (y / h) * sp.h;
    const sy1 = ((y + 1) / h) * sp.h;
    const box = span(Math.floor(sy0), Math.ceil(sy1) - 1).flatMap((sy) =>
      span(Math.floor(sx0), Math.ceil(sx1) - 1).map(
        (sx) => sy * sp.w + (flip ? sp.w - 1 - sx : sx),
      ),
    );
    const a = box.reduce((sum, i) => sum + sp.a[i], 0) / box.length;
    const as = box.reduce((sum, i) => sum + sp.a[i] * sp.s[i], 0);
    return a > 0 ? { a, s: as / box.length / a } : undefined;
  };
  const first = Math.max(0, top);
  const rows = Math.max(0, Math.min(SKY_HEIGHT, top + h) - first);
  const drops = Array.from({ length: rows * SKY_WIDTH }, (_, b) => dropAt(first * SKY_WIDTH + b));
  const mixed = (from, under) =>
    Float32Array.from(drops, (drop, b) => {
      const k = first * SKY_WIDTH + b;
      return drop === undefined ? from[k] : under(drop, k);
    });
  const a = layer.a.slice();
  const s = layer.s.slice();
  a.set(
    mixed(layer.a, (drop, k) => drop.a + layer.a[k] * (1 - drop.a)),
    first * SKY_WIDTH,
  );
  s.set(
    mixed(layer.s, (drop, k) => {
      const under = layer.a[k];
      const total = drop.a + under * (1 - drop.a);
      return total > 0 ? (drop.s * drop.a + layer.s[k] * under * (1 - drop.a)) / total : 0;
    }),
    first * SKY_WIDTH,
  );
  return { a, s };
};

const placeClouds = (cutOuts) => {
  const laid = (spots) =>
    spots.reduce((layer, spot) => place(layer, cutOuts[spot.cutOut], spot), {
      a: new Float32Array(SKY_WIDTH * SKY_HEIGHT),
      s: new Float32Array(SKY_WIDTH * SKY_HEIGHT),
    });
  const width = SKY_WIDTH / LAYER_SCALE;
  const height = SKY_HEIGHT / LAYER_SCALE;
  const quantised = (v) => Math.min(BYTE_MAX, Math.round(v * QUANTISE.levels) * QUANTISE.step) | 0;
  const halve = (layer) =>
    Uint8Array.from(
      range(width * height).flatMap((p) => {
        const i = p % width;
        const j = (p - i) / width;
        const ks = QUAD.map(([dx, dy]) => (j * 2 + dy) * SKY_WIDTH + i * 2 + dx);
        const a = ks.reduce((sum, k) => sum + layer.a[k], 0) / QUAD.length;
        const as = ks.reduce((sum, k) => sum + layer.a[k] * layer.s[k], 0);
        const s = a > 0 ? as / QUAD.length / a : 0;
        const cover = smoothstep(VISIBLE_FROM, 1, a);
        return [cover > 0 ? quantised(s) : 0, quantised(cover), 0];
      }),
    );
  return { width, height, near: halve(laid(NEAR)), far: halve(laid(FAR)) };
};

const ASSET_FILES = [
  "sky.txt",
  "sky-light.webp",
  "sky-dark.webp",
  "clouds-near.webp",
  "clouds-far.webp",
];

const main = async ([input, sheet]) => {
  if (!input) {
    console.error("usage: node scripts/make-sky.mjs sky.png [sprites.png]");
    process.exitCode = 1;
    return;
  }
  const sprites = await cutClouds(input);
  if (sheet) {
    await writeSheet(sprites, sheet);
    console.log(`cut-outs in ${sheet}`);
    return;
  }
  const still = await convert(clearSky(await band(input)));
  const clouds = placeClouds(sprites);

  await writeFile(`${ASSETS}sky.txt`, still.text);
  await Promise.all([
    ...["light", "dark"].map((mode) =>
      raw(still.maps[mode], still.columns, still.rows)
        .webp({ quality: 90, smartSubsample: true })
        .toFile(`${ASSETS}sky-${mode}.webp`),
    ),
    ...["near", "far"].map((layer) =>
      raw(clouds[layer], clouds.width, clouds.height)
        .webp({ lossless: true, effort: 6 })
        .toFile(`${ASSETS}clouds-${layer}.webp`),
    ),
  ]);
  const written = await Promise.all(ASSET_FILES.map((file) => readFile(`${ASSETS}${file}`)));
  const version = written
    .reduce((hash, data) => hash.update(data), createHash("sha256"))
    .digest("hex")
    .slice(0, VERSION_LENGTH);
  const block = `export const sky = {
  columns: ${still.columns},
  rows: ${still.rows},
  cellWidth: ${CELL_WIDTH},
  cellHeight: ${CELL_HEIGHT},
  version: "${version}",
};`;
  await writeFile(INDEX, (await readFile(INDEX, "utf8")).replace(SKY_BLOCK, block));
  console.log(`assets/ and src/index.ts written, version ${version}`);
};

await main(process.argv.slice(2));
