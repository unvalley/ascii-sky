import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sky } from "./art.ts";
import { SKY_FILES, skyUrl } from "./files.ts";

describe("skyUrl", () => {
  test("puts a file in a folder, with the files' version", () => {
    assert.equal(skyUrl("/sky", "text"), `/sky/sky.txt?v=${sky.version}`);
    assert.equal(skyUrl("https://cdn.example/sky/", "near"), `https://cdn.example/sky/clouds-near.webp?v=${sky.version}`);
  });

  test("takes each file's own URL as given", () => {
    const own = Object.fromEntries(Object.keys(SKY_FILES).map((k) => [k, `/hashed/${k}.bin`])) as Record<keyof typeof SKY_FILES, string>;
    assert.equal(skyUrl(own, "dark"), "/hashed/dark.bin");
  });
});
