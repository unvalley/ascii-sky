import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKY_HEIGHT, SKY_WIDTH } from "./mount.ts";
import { stillSky } from "./still.ts";
import { viceGradient } from "./vice.ts";

describe("stillSky", () => {
  test("stretches the colour map over the cells, centred and repeating sideways", () => {
    const { background, imageRendering, opacity } = stillSky("light", "/sky/");
    assert.match(background, /^url\("\/sky\/sky-light\.webp\?v=\w+"\) center top \/ /);
    assert.ok(background.endsWith(`${SKY_WIDTH}px ${SKY_HEIGHT}px repeat-x`), background);
    assert.equal(imageRendering, "pixelated");
    assert.ok(opacity > 0 && opacity < 1);
  });

  test("the night has its own map, the vice theme its gradient", () => {
    assert.match(stillSky("dark").background, /sky-dark\.webp/);
    assert.equal(stillSky("vice").background, viceGradient());
  });
});
