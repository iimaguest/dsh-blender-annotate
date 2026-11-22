/**
 * Independent QA: the shipped lib/client.js must be exactly what
 * scripts/build-client.mjs produces from dev/client-body.js + dev/viewer.js +
 * dev/resolve.js (the other suites test dev/resolve.js directly and the viewer
 * through lib/client.js, so drift would make them test different code).
 * Rebuilt in memory; nothing is written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers/blender.mjs";

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start !== -1 && end > start, `${startMarker} markers present`);
  return source.slice(source.indexOf("\n", start) + 1, end).trimEnd();
}

test("lib/client.js equals the build of the dev sources", () => {
  const viewer = block(readFileSync(join(ROOT, "dev", "viewer.js"), "utf8"), "/* @viewer:start", "/* @viewer:end");
  const resolve = block(readFileSync(join(ROOT, "dev", "resolve.js"), "utf8"), "/* @resolve:start", "/* @resolve:end");
  let out = readFileSync(join(ROOT, "dev", "client-body.js"), "utf8");
  out = out.replace("/* @viewer */", () => viewer);
  out = out.replace("/* @resolve */", () => resolve);
  const shipped = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
  assert.ok(shipped === out, "lib/client.js is stale relative to dev/*; run `npm run build`");
});

test("the shipped viewer can resolve m4invert (pick() depends on the resolver block being in the same scope)", () => {
  const shipped = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
  const viewerAt = shipped.indexOf("function createViewer(");
  const m4At = shipped.indexOf("function m4invert(");
  const factoryAt = shipped.indexOf("factory: (require) =>");
  assert.ok(viewerAt > factoryAt && m4At > factoryAt, "both live inside the same factory closure");
});
