import { sha256Hex } from "./sha256.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const cases = [
  "",
  "abc",
  "ARTEX runtime attestation",
  "多字节 UTF-8 输入 ✓",
  "a".repeat(55),
  "a".repeat(56),
  "a".repeat(63),
  "a".repeat(64),
  "a".repeat(65),
  JSON.stringify({ compose: "image@sha256:" + "ab".repeat(32), nested: [1, true, null] }),
];

for (const [index, value] of cases.entries()) {
  test(`SHA-256 matches Node without Web Crypto (${index})`, () => {
    assert.equal(sha256Hex(value), createHash("sha256").update(value, "utf8").digest("hex"));
  });
}
