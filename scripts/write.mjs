import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const [dir, cloudDir] = process.argv.slice(2);
const OUT = `${ROOT}/assets`;
mkdirSync(OUT, { recursive: true });
const keepStill = dir === "-";
const meta = keepStill
  ? (await import(`${ROOT}/src/art.ts`)).sky
  : JSON.parse(readFileSync(path.join(dir, "sky.json"), "utf8"));
if (!keepStill) {
  writeFileSync(`${OUT}/sky.txt`, readFileSync(path.join(dir, "sky.txt"), "utf8"));
  for (const mode of ["light", "dark"]) {
    await sharp(path.join(dir, `sky-${mode}.png`))
      .webp({ quality: 90, smartSubsample: true })
      .toFile(`${OUT}/sky-${mode}.webp`);
  }
}
for (const layer of ["near", "far"]) {
  await sharp(path.join(cloudDir, `clouds-${layer}.png`))
    .removeAlpha()
    .webp({ lossless: true, effort: 6 })
    .toFile(`${OUT}/clouds-${layer}.webp`);
}
rmSync(`${OUT}/clouds.webp`, { force: true });
const cm = await sharp(path.join(cloudDir, "clouds-near.png")).metadata();
const files = ["sky.txt", "sky-light.webp", "sky-dark.webp", "clouds-near.webp", "clouds-far.webp"];
const hash = createHash("sha256");
for (const f of files) {
  hash.update(readFileSync(`${OUT}/${f}`));
}
const version = hash.digest("hex").slice(0, 10);
const ts = `export const sky = {
  columns: ${meta.columns},
  rows: ${meta.rows},
  cellWidth: ${meta.cellWidth},
  cellHeight: ${meta.cellHeight},
  period: ${cm.width * 2},
  cloudWidth: ${cm.width},
  cloudHeight: ${cm.height},
  version: "${version}",
};
`;
writeFileSync(`${ROOT}/src/art.ts`, ts);
console.log(
  "written, version",
  version,
  files.map((f) => `${f} ${readFileSync(`${OUT}/${f}`).length}`).join(", "),
);
