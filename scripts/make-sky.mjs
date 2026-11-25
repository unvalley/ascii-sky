import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fromOklab, oklab, range, SKY_RAMP, smooth, span } from "../src/cells.ts";

const ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const SKY_BLOCK = /export const sky = \{[^}]*\};/u;
const WIDTH = 2400;
const HEIGHT = 700;
const CW = 6;
const CH = 9.75;
const QUAD = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

const raw = (pixels, width, height, channels = 3) =>
  sharp(pixels, { raw: { width, height, channels } });

const band = async (painting) => {
  const full = 1920;
  const overlap = 320;
  const p = full - overlap;
  const rows = Math.round(HEIGHT / (full / 1536));
  const img = await sharp(painting)
    .extract({ left: 0, top: 0, width: 1536, height: rows })
    .resize(full, HEIGHT, { kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const tile = Uint8Array.from({ length: p * HEIGHT * 3 }, (_, q) => {
    const c = q % 3;
    const i = (q - c) / 3;
    const x = i % p;
    const y = (i - x) / p;
    const here = img[(y * full + x) * 3 + c];
    if (x >= overlap) {
      return here;
    }
    const t = smooth(0, 1, x / overlap);
    return Math.round(img[(y * full + x + p) * 3 + c] * (1 - t) + here * t);
  });
  return { img: tile, width: p, height: HEIGHT };
};

const clearSky = ({ img, width: P, height: H }) => {
  const lum = (i) =>
    (0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2]) / 255;
  const chroma = (i) =>
    (Math.max(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]) -
      Math.min(img[i * 3], img[i * 3 + 1], img[i * 3 + 2])) /
    255;
  const alpha = Float32Array.from(
    { length: P * H },
    (_, i) => smooth(0.62, 0.8, lum(i)) * (1 - smooth(0.2, 0.42, chroma(i))),
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
  const cloudy = blurY(blurX(alpha, 2), 2).map((v) => smooth(0.02, 0.2, v));
  const hole = blurY(
    blurX(
      cloudy.map((v) => (v > 0.02 ? 1 : 0)),
      6,
    ),
    6,
  ).map((v) => Math.min(1, v * 2.5));
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
    const v2 = Float32Array.from({ length: w2 * h2 * 3 }, (_, q) => {
      const c = q % 3;
      const j = (q - c) / 3;
      const sum = under[j].reduce((s, i) => Math.fround(s + values[i * 3 + c] * weights[i]), 0);
      return k2[j] > 0 ? sum / k2[j] : sum;
    });
    const coarse = pushPull(
      v2,
      k2.map((v) => Math.min(1, v)),
      w2,
      h2,
    );
    const at = (xx, yy, c) =>
      coarse[(Math.min(h2 - 1, Math.max(0, yy)) * w2 + Math.min(w2 - 1, Math.max(0, xx))) * 3 + c];
    return Float32Array.from({ length: w * h * 3 }, (_, q) => {
      const c = q % 3;
      const i = (q - c) / 3;
      const x = i % w;
      const y = (i - x) / w;
      const k = Math.min(1, weights[i]);
      const fx = (x + 0.5) / 2 - 0.5;
      const fy = (y + 0.5) / 2 - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const u = fx - x0;
      const v = fy - y0;
      const up =
        (at(x0, y0, c) * (1 - u) + at(x0 + 1, y0, c) * u) * (1 - v) +
        (at(x0, y0 + 1, c) * (1 - u) + at(x0 + 1, y0 + 1, c) * u) * v;
      return values[i * 3 + c] * k + up * (1 - k);
    });
  };
  const P3 = P * 3;
  const repeated = (i) => {
    const x = i % P3;
    return ((i - x) / P3) * P + (x % P);
  };
  const filled3 = pushPull(
    Float32Array.from({ length: P3 * H * 3 }, (_, q) => {
      const c = q % 3;
      const i = (q - c) / 3;
      return img[repeated(i) * 3 + c];
    }),
    Float32Array.from({ length: P3 * H }, (_, i) => (hole[repeated(i)] > 0.01 ? 0 : 1)),
    P3,
    H,
  );
  const base = Float32Array.from({ length: P * H * 3 }, (_, q) => {
    const c = q % 3;
    const i = (q - c) / 3;
    const x = i % P;
    return filled3[(((i - x) / P) * P3 + x + P) * 3 + c];
  });
  const blurred = [0, 1, 2].map((c) =>
    blurY(
      blurX(
        Float32Array.from({ length: P * H }, (_, i) => img[i * 3 + c]),
        5,
      ),
      5,
    ),
  );
  const donors = [523, 811, 1129, 277];
  const donorOf = Int32Array.from({ length: P * H }, (_, i) => {
    const x = i % P;
    return donors.map((d) => i - x + ((x + d) % P)).find((j) => hole[j] < 0.05) ?? -1;
  });
  const sky = Uint8Array.from({ length: P * H * 3 }, (_, q) => {
    const c = q % 3;
    const i = (q - c) / 3;
    const h = hole[i];
    const donor = donorOf[i];
    const detail = donor >= 0 ? img[donor * 3 + c] - blurred[c][donor] : 0;
    const filled = base[i * 3 + c] + detail;
    return Math.round(Math.min(255, Math.max(0, img[i * 3 + c] * (1 - h) + filled * h)));
  });
  const shift = (((P - (WIDTH - P) / 2) % P) + P) % P;
  return Uint8Array.from({ length: WIDTH * H * 3 }, (_, q) => {
    const c = q % 3;
    const i = (q - c) / 3;
    const x = i % WIDTH;
    return sky[(((i - x) / WIDTH) * P + ((x + shift) % P)) * 3 + c];
  });
};

const turn = (a, b, degrees) => {
  const t = (degrees * Math.PI) / 180;
  return [a * Math.cos(t) - b * Math.sin(t), a * Math.sin(t) + b * Math.cos(t)];
};

const toNight = (pixels, columns, rows, text) => {
  const light = 0.41;
  const dense = 0.29;
  const lines = text.split("\n");
  return Uint8Array.from(
    range(columns * rows).flatMap((k) => {
      const c = k % columns;
      const line = lines[(k - c) / columns];
      const rgb = [pixels[k * 3], pixels[k * 3 + 1], pixels[k * 3 + 2]];
      if (line === undefined) {
        return rgb;
      }
      const d = Math.max(0, SKY_RAMP.indexOf(line[c] ?? ".")) / (SKY_RAMP.length - 1);
      const [, a0, b0] = oklab(...rgb);
      const [a, b] = turn(a0, b0, 14);
      return fromOklab(light + (dense - light) * d, a * 0.75, b * 0.75);
    }),
  );
};

const SKY = {
  light: { hue: -13, chroma: 0.9, lightness: (L) => Math.min(L, 0.73) },
  dark: { hue: -8, chroma: 1.05, lightness: (L) => Math.max(L, 0.66) },
};
const CLOUD = {
  light: ["#c3d2e8", "#9db3d6", "#7690c2", "#5a76ae"],
  dark: ["#ffffff", "#e6eefa", "#c2d1ea", "#93a8cf"],
};
const PAGE = { light: [250, 250, 250], dark: [23, 23, 23] };
const GLYPH_STEPS = { sky: 7, shade: 5 };
const hexRgb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

const colourOf = (cell, mode) => {
  if (!cell) {
    return PAGE[mode];
  }
  if (cell.part === "sky") {
    const [L, a0, b0] = oklab(...cell.mean);
    const { hue, chroma, lightness } = SKY[mode];
    const [a, b] = turn(a0, b0, hue);
    return fromOklab(lightness(L), a * chroma, b * chroma);
  }
  const stops = CLOUD[mode];
  const p = Math.min(stops.length - 1.0001, Math.max(0, cell.shadow * (stops.length - 1)));
  const i = Math.floor(p);
  const a = hexRgb(stops[i]);
  const b = hexRgb(stops[i + 1]);
  return a.map((v, k) => v + (b[k] - v) * (p - i));
};

const convert = async (clear) => {
  const sx = 4;
  const sy = 6;
  const columns = WIDTH / CW;
  const rows = Math.floor(HEIGHT / CH);
  const sw = columns * sx;
  const sh = rows * sy;
  const data = await raw(clear, WIDTH, HEIGHT)
    .extract({ left: 0, top: 0, width: WIDTH, height: Math.floor(rows * CH) })
    .resize(sw, sh, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const px = (x, y) => {
    const i = (Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const chromaOf = (c) => Math.max(...c) - Math.min(...c);

  const found = range(rows * columns).map((k) => {
    const c = k % columns;
    const r = (k - c) / columns;
    const inked = range(sx * sy)
      .map((s) => px(c * sx + (s % sx), r * sy + Math.floor(s / sx)))
      .filter((p) => lum(p) < 0.9 || chromaOf(p) >= 40);
    const coverage = inked.length / (sx * sy);
    if (coverage < 0.2) {
      return null;
    }
    const mean = inked
      .reduce((sum, p) => sum.map((v, i) => v + p[i]), [0, 0, 0])
      .map((v) => v / inked.length);
    return { r, c, coverage, mean, part: chromaOf(mean) < 70 ? "shade" : "sky" };
  });

  const reachX = 5;
  const reachY = 3;
  const around = span(-reachY, reachY).flatMap((dr) => span(-reachX, reachX).map((dc) => [dr, dc]));
  const weightOf = ([dr, dc]) =>
    Math.exp(-(dr * dr) / (2 * (reachY / 2) ** 2) - (dc * dc) / (2 * (reachX / 2) ** 2));
  const darkOf = (cell) => {
    const near = around
      .map(([dr, dc]) => {
        const o = found[(cell.r + dr) * columns + cell.c + dc];
        const inside =
          cell.r + dr >= 0 && cell.r + dr < rows && cell.c + dc >= 0 && cell.c + dc < columns;
        return o && o.part === cell.part && inside ? { o, k: weightOf([dr, dc]) } : null;
      })
      .filter(Boolean);
    const s = near.reduce((sum, { o, k }) => sum + k * lum(o.mean), 0);
    const w = near.reduce((sum, { k }) => sum + k, 0);
    const mean = w ? s / w : lum(cell.mean);
    return mean - lum(cell.mean) + (1 - mean) * 0.15;
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
      return [part, [q(0.04), q(0.97)]];
    }),
  );
  const cells = darkened.map((cell) => {
    if (!cell) {
      return null;
    }
    const [d0, d1] = spread[cell.part];
    const t = Math.max(0, Math.min(1, (cell.dark - d0) / (d1 - d0 || 1)));
    const i = Math.round(t * GLYPH_STEPS[cell.part]);
    return {
      ...cell,
      shadow: Math.max(0, Math.min(1, (1 - lum(cell.mean) - 0.06) / 0.3)),
      glyph: SKY_RAMP[cell.coverage < 0.45 ? Math.min(i, 1) : i],
    };
  });

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
  const u = t / 38;
  const i = Math.floor(u);
  const r = (k) => {
    const a = Math.imul(k + seed * 7919, 2_654_435_761) >>> 0;
    const b = Math.imul(a ^ (a >>> 15), 2_246_822_519) >>> 0;
    return ((b ^ (b >>> 13)) >>> 0) / 4_294_967_296;
  };
  const f = u - i;
  return r(i) + (r(i + 1) - r(i)) * f * f * (3 - 2 * f);
};

const cutClouds = async (painting) => {
  const { data: img, info } = await sharp(painting)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const Iw = info.width;
  const rgbAt = (i) => [img[i * 3] / 255, img[i * 3 + 1] / 255, img[i * 3 + 2] / 255];
  const lumOf = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const alpha = Float32Array.from({ length: Iw * info.height }, (_, i) => {
    const rgb = rgbAt(i);
    return (
      smooth(0.62, 0.82, lumOf(rgb)) * (1 - smooth(0.2, 0.42, Math.max(...rgb) - Math.min(...rgb)))
    );
  });
  const shade = Float32Array.from({ length: Iw * info.height }, (_, i) =>
    Math.min(1, Math.max(0, (0.96 - lumOf(rgbAt(i))) / 0.26)),
  );

  const sprite = (name, [x0, y0, x1, y1], fade = [0, 0, 0, 0]) => {
    const w = x1 - x0;
    const h = y1 - y0;
    const seed = x0 * 31 + y0;
    const reach = (side, t) => fade[side] * (0.35 + 1.3 * wave(t, seed + side));
    const edges = [
      (x, y) => smooth(0, reach(0, y), x),
      (x, y) => smooth(0, reach(1, x), y),
      (x, y) => smooth(0, reach(2, y), w - 1 - x),
      (x, y) => smooth(0, reach(3, x), h - 1 - y),
    ];
    const from = (k) => {
      const x = k % w;
      return (y0 + (k - x) / w) * Iw + x0 + x;
    };
    const cut = Float32Array.from({ length: w * h }, (_, k) => {
      const x = k % w;
      const y = (k - x) / w;
      const faded = edges.reduce((f, edge, side) => (fade[side] ? f * edge(x, y) : f), 1);
      const ex = (x - w / 2) / (w * 0.62);
      const ey = (y - h / 2) / (h * 0.62);
      return alpha[from(k)] * (faded * (1 - smooth(0.82, 1, Math.hypot(ex, ey))));
    });
    const s = Float32Array.from({ length: w * h }, (_, k) => shade[from(k)]);
    const soft = boxBlur(boxBlur(cut, w, h, 10), w, h, 5);
    const a = cut.map((v, k) => Math.max(v * 0.7, smooth(0.28, 0.55, soft[k])));
    const blur = boxBlur(s, w, h, 5);
    const detail = blur.map((b, k) => Math.min(1, Math.max(0, b + 1.8 * (s[k] - b))));
    const ranked = [...detail].filter((_, k) => a[k] > 0.4).sort((p, q) => p - q);
    const below = (v, lo, hi) => {
      if (lo >= hi) {
        return lo;
      }
      const mid = (lo + hi) >> 1;
      return ranked[mid] < v ? below(v, mid + 1, hi) : below(v, lo, mid);
    };
    const rank = (v) => (ranked.length > 0 ? below(v, 0, ranked.length) / ranked.length : 0);
    const mix = 0.7;
    return { name, w, h, a, s: detail.map((d) => d * (1 - mix) + rank(d) * mix) };
  };

  return {
    big: sprite("big", [819, 26, 1536, 610], [0, 0, 110, 40]),
    crown: sprite("crown", [1090, 0, 1430, 300], [70, 0, 60, 90]),
    base: sprite("base", [800, 380, 1290, 610], [0, 80, 60, 30]),
    heap: sprite("heap", [0, 490, 320, 790], [80, 0, 70, 30]),
    flat: sprite("flat", [280, 615, 600, 800], [60, 0, 0, 20]),
    left: sprite("left", [0, 493, 572, 815], [90, 0, 0, 30]),
    row: sprite("row", [990, 690, 1400, 875], [0, 0, 50, 30]),
    rowEnd: sprite("rowEnd", [1380, 690, 1536, 820], [50, 0, 70, 20]),
    topLeft: sprite("topLeft", [150, 0, 460, 205], [40, 70, 0, 0]),
    puffs: sprite("puffs", [55, 855, 345, 965], [0, 0, 0, 20]),
    lowMid: sprite("lowMid", [650, 840, 995, 958], [0, 0, 0, 30]),
    wisp1: sprite("wisp1", [425, 220, 650, 330]),
    wisp2: sprite("wisp2", [0, 352, 240, 440], [50, 0, 0, 0]),
    wisp3: sprite("wisp3", [1205, 540, 1360, 615]),
  };
};

const cloudColour = (a, s) => {
  const cloud = [255 - s * 140, 255 - s * 115, 255 - s * 70];
  return [64, 150, 230].map((sky, c) => Math.round(sky * (1 - a) + cloud[c] * a));
};

const writeSheet = async (cutOuts, file) => {
  const column = 520;
  const pieces = await Promise.all(
    Object.values(cutOuts).map(async (sp) => {
      const scale = Math.min(1, (column - 10) / sp.w);
      const w = Math.round(sp.w * scale);
      const h = Math.round(sp.h * scale);
      const colours = Uint8Array.from(
        range(sp.w * sp.h).flatMap((k) => cloudColour(sp.a[k], sp.s[k])),
      );
      const cutout = await raw(colours, sp.w, sp.h).resize(w, h).png().toBuffer();
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18"><text x="2" y="14" font-family="Menlo" font-size="13">${sp.name} ${sp.w}x${sp.h}</text></svg>`,
      );
      return { cutout, label, h };
    }),
  );
  const rows = range(Math.ceil(pieces.length / 2)).map((r) => pieces.slice(r * 2, r * 2 + 2));
  const heights = rows.map((row) => Math.max(0, ...row.map(({ h }) => h + 26)));
  const topOf = (r) => heights.slice(0, r).reduce((sum, h) => sum + h, 0);
  await sharp({
    create: { width: column * 2, height: topOf(rows.length), channels: 3, background: "#fff" },
  })
    .composite(
      rows.flatMap((row, r) =>
        row.flatMap(({ cutout, label }, col) => [
          { input: cutout, top: topOf(r) + 18, left: col * column },
          { input: label, top: topOf(r), left: col * column },
        ]),
      ),
    )
    .png()
    .toFile(file);
};

const NEAR = [
  ["big", 330, 330, 0.42],
  ["wisp1", 760, 95, 0.9, { wide: 1.3 }],
  ["flat", 820, 255, 0.6],
  ["row", 1180, 335, 0.62, { flip: true }],
  ["crown", 1540, 215, 0.55, { wide: 1.3 }],
  ["left", 1960, 320, 0.5, { wide: 1.15 }],
  ["wisp2", 2290, 140, 0.75, { wide: 1.4 }],
  ["heap", 160, 640, 0.42, { wide: 1.35 }],
  ["lowMid", 1000, 560, 0.7],
  ["row", 1760, 660, 0.5],
];
const FAR = [
  ["topLeft", 110, 115, 0.3],
  ["puffs", 540, 175, 0.42, { wide: 1.2 }],
  ["rowEnd", 900, 80, 0.45],
  ["base", 1270, 150, 0.32, { flip: true }],
  ["lowMid", 1660, 60, 0.36, { flip: true, wide: 0.85 }],
  ["heap", 2010, 160, 0.26, { flip: true, wide: 1.35 }],
  ["wisp3", 2310, 105, 0.7, { wide: 1.5 }],
  ["flat", 620, 470, 0.36, { flip: true }],
  ["puffs", 1500, 520, 0.45, { flip: true }],
  ["rowEnd", 2200, 430, 0.5, { flip: true }],
];

const place = (layer, sp, x, base, scale, { wide = 1, flip = false } = {}) => {
  const w = Math.round(sp.w * scale * wide);
  const h = Math.round(sp.h * scale);
  const left = Math.round(x - w / 2);
  const top = Math.round(base - h);
  const dropAt = (k) => {
    const px = k % WIDTH;
    const y = (k - px) / WIDTH - top;
    const xx = (((px - left) % WIDTH) + WIDTH) % WIDTH;
    if (y < 0 || y >= h || xx >= w) {
      return null;
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
    return a > 0 ? { a, s: as / box.length / a } : null;
  };
  const first = Math.max(0, top);
  const rows = Math.max(0, Math.min(HEIGHT, top + h) - first);
  const drops = Array.from({ length: rows * WIDTH }, (_, b) => dropAt(first * WIDTH + b));
  const mixed = (from, under) =>
    Float32Array.from(drops, (drop, b) => {
      const k = first * WIDTH + b;
      return drop ? under(drop, k) : from[k];
    });
  const a = layer.a.slice();
  const s = layer.s.slice();
  a.set(
    mixed(layer.a, (drop, k) => drop.a + layer.a[k] * (1 - drop.a)),
    first * WIDTH,
  );
  s.set(
    mixed(layer.s, (drop, k) => {
      const under = layer.a[k];
      const total = drop.a + under * (1 - drop.a);
      return total > 0 ? (drop.s * drop.a + layer.s[k] * under * (1 - drop.a)) / total : 0;
    }),
    first * WIDTH,
  );
  return { a, s };
};

const placeClouds = (cutOuts) => {
  const laid = (spots) =>
    spots.reduce(
      (layer, [name, x, base, scale, options]) =>
        place(layer, cutOuts[name], x, base, scale, options),
      { a: new Float32Array(WIDTH * HEIGHT), s: new Float32Array(WIDTH * HEIGHT) },
    );
  const lw = WIDTH / 2;
  const lh = HEIGHT / 2;
  const q = (v) => Math.min(255, Math.round(v * 63) * 4.05) | 0;
  const halve = (layer) =>
    Uint8Array.from(
      range(lw * lh).flatMap((p) => {
        const i = p % lw;
        const j = (p - i) / lw;
        const ks = QUAD.map(([dx, dy]) => (j * 2 + dy) * WIDTH + i * 2 + dx);
        const a = ks.reduce((sum, k) => sum + layer.a[k], 0) / 4;
        const as = ks.reduce((sum, k) => sum + layer.a[k] * layer.s[k], 0);
        const s = a > 0 ? as / 4 / a : 0;
        const ac = smooth(0.04, 1, a);
        return [ac > 0 ? q(s) : 0, q(ac), 0];
      }),
    );
  return { width: lw, height: lh, near: halve(laid(NEAR)), far: halve(laid(FAR)) };
};

const [input, sheet] = process.argv.slice(2);
if (!input) {
  console.error("usage: node scripts/make-sky.mjs sky.png [sprites.png]");
  process.exit(1);
}
const sprites = await cutClouds(input);
if (sheet) {
  await writeSheet(sprites, sheet);
  console.log(`cut-outs in ${sheet}`);
  process.exit(0);
}
const still = await convert(clearSky(await band(input)));
const clouds = placeClouds(sprites);

writeFileSync(`${ASSETS}sky.txt`, still.text);
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
const version = [
  "sky.txt",
  "sky-light.webp",
  "sky-dark.webp",
  "clouds-near.webp",
  "clouds-far.webp",
]
  .reduce((hash, file) => hash.update(readFileSync(`${ASSETS}${file}`)), createHash("sha256"))
  .digest("hex")
  .slice(0, 10);
const block = `export const sky = {
  columns: ${still.columns},
  rows: ${still.rows},
  cellWidth: ${CW},
  cellHeight: ${CH},
  version: "${version}",
};`;
writeFileSync(INDEX, readFileSync(INDEX, "utf8").replace(SKY_BLOCK, block));
console.log(`assets/ and src/index.ts written, version ${version}`);
