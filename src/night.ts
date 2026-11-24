/**
 * Night: how the sky is drawn on the dark page. Its blue is a night's
 * navy (made with the still sky, see grade.ts), it has no clouds
 * (THEMES.dark in cells.ts), and stars that twinkle and now and then
 * sparkle (shade.ts, sparkle.ts).
 */
import type { Stars } from "./shade.ts";

/** The stars: 3% of open sky's cells, a warm white, sparkling; and the
 * pointer's wind, a pale blue. */
export const NIGHT: Stars = {
  stars: 0.03,
  star: [255, 246, 216],
  glow: [176, 200, 255],
  sparkle: true,
};
