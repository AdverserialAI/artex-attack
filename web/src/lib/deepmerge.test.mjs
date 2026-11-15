import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const deepmerge = require("../../vendor/deepmerge/dist/cjs.js");

test("deepmerge preserves nested merge behavior", () => {
  const merged = deepmerge(
    { theme: { extend: { colors: { red: "1" } } } },
    { theme: { extend: { colors: { blue: "2" } } } },
    { arrayMerge: (_target, source) => source },
  );
  assert.equal(merged.theme.extend.colors.red, "1");
  assert.equal(merged.theme.extend.colors.blue, "2");
});

test("deepmerge rejects prototype-polluting keys", () => {
  for (const payload of [
    '{"__proto__":{"polluted":true}}',
    '{"a":{"__proto__":{"polluted":true}}}',
    '{"constructor":{"prototype":{"polluted":true}}}',
  ]) {
    const merged = deepmerge({}, JSON.parse(payload));
    assert.equal(merged.polluted, undefined);
    assert.equal(Object.getPrototypeOf(merged).polluted, undefined);
    assert.equal({}.polluted, undefined);
  }
});
