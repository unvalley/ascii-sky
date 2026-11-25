import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sunsetGradient } from "./cells.ts";
import { SKY_HEIGHT, SKY_WIDTH, sky, stillSky } from "./index.ts";

describe("stillSky", () => {
  test("stretches the colour map over the cells, centred and repeating sideways", () => {
    const { background, imageRendering, opacity } = stillSky("light", "/sky/");
    assert.equal(
      background,
      `url("/sky/sky-light.webp?v=${sky.version}") center top / ${SKY_WIDTH}px ${SKY_HEIGHT}px repeat-x`,
    );
    assert.equal(imageRendering, "pixelated");
    assert.ok(opacity > 0 && opacity < 1);
  });

  test("finds the files in a folder, with or without its slash, or takes each file's URL", () => {
    assert.ok(
      stillSky("dark", "https://cdn.example/sky").background.includes(
        `"https://cdn.example/sky/sky-dark.webp?v=${sky.version}"`,
      ),
    );
    const own = { text: "/t", light: "/l", dark: "/hashed/dark.bin", near: "/n", far: "/f" };
    assert.ok(stillSky("dark", own).background.startsWith('url("/hashed/dark.bin")'));
  });

  test("the sunset sky is its gradient", () => {
    assert.equal(stillSky("sunset").background, sunsetGradient());
  });
});
