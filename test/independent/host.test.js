/**
 * Independent QA: Host half (lib/route.js, lib/blender.js, lib/config.js).
 * Uses a fake Blender (fixtures/fake_blender.mjs) for deterministic cache,
 * concurrency, timeout and pruning behaviour, plus one end-to-end run of the
 * route against the real Blender.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BlendExporter } from "../../lib/blender.js";
import { resolveConfig } from "../../lib/config.js";
import { registerBlendRoute } from "../../lib/route.js";
import { BLENDER, FIXTURES, SKIP_NO_BLENDER, buildScenes, removeDir, sha256, tempDir } from "./helpers/blender.mjs";

/** A fake Blender in its own temp dir; `calls()` lists invocations. */
function makeFake() {
  const dir = tempDir("fakeblender");
  copyFileSync(join(FIXTURES, "fake_blender.mjs"), join(dir, "fake_blender.mjs"));
  const bin = join(dir, "blender");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${join(dir, "fake_blender.mjs")}" "$@"\n`);
  chmodSync(bin, 0o755);
  return {
    dir,
    bin,
    calls: () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    cleanup() {
      if (existsSync(join(dir, "pids.log"))) {
        for (const pid of readFileSync(join(dir, "pids.log"), "utf8").split("\n").filter(Boolean)) {
          try { process.kill(Number(pid), "SIGKILL"); } catch { /* gone */ }
        }
      }
      removeDir(dir);
    },
  };
}

function exporterWith(fake, cacheDir, overrides = {}) {
  return new BlendExporter({ ...resolveConfig({ blenderPath: fake.bin, cacheDir }), timeoutMs: 20_000, ...overrides });
}

function writeBlend(path, spec = {}) {
  writeFileSync(path, JSON.stringify(spec));
  return path;
}

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: no answer within ${ms} ms`)), ms))]);

// ------------------------------------------------------------------ route validation
describe("route: request validation", () => {
  let dir;
  let route;
  const calls = [];
  before(() => {
    dir = tempDir("route");
    writeFileSync(join(dir, "ok.blend"), "x");
    writeFileSync(join(dir, "UPPER.BLEND"), "x");
    mkdirSync(join(dir, "folder.blend"));
    const ctx = { connection: { fetch: { register: (r) => { route = r; return () => {}; } } } };
    const exporter = {
      export: async (path, options) => {
        calls.push({ path, signal: options.signal });
        return { key: "k", glbPath: join(dir, "ok.blend"), glbBytes: 1, elapsedMs: 0, cached: true, blender: "B", source: { bytes: 1, mtimeMs: 1 }, info: { file: path, file_name: "ok.blend" } };
      },
    };
    registerBlendRoute(ctx, exporter, resolveConfig({}));
  });
  after(() => removeDir(dir));

  const get = (query, method = "GET") => route.fetch(new Request(`http://127.0.0.1/api/blender-annotate?${query}`, { method }));
  const body = async (res) => JSON.parse(await res.text());
  const q = (path, kind = "info") => `path=${encodeURIComponent(path)}&kind=${kind}`;

  it("registers GET|HEAD at the configured /api path", () => {
    assert.equal(route.path, "/api/blender-annotate");
    assert.deepEqual(route.methods, ["GET", "HEAD"]);
  });

  it("rejects missing, relative, home-relative and NUL-containing paths with 400 before converting", async () => {
    calls.length = 0;
    const cases = [
      ["kind=info", "BLEND_PATH_REQUIRED"],
      [q("scene.blend"), "BLEND_PATH_INVALID"],
      [q("./scene.blend"), "BLEND_PATH_INVALID"],
      [q("~/scene.blend"), "BLEND_PATH_INVALID"],
      [q(join(dir, "ok\0.blend")), "BLEND_PATH_INVALID"],
      [q(join(dir, "ok.blend") + "\0"), "BLEND_PATH_INVALID"],
    ];
    for (const [query, code] of cases) {
      const res = await get(query);
      assert.equal(res.status, 400, query);
      assert.equal((await body(res)).error.code, code, query);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(calls.length, 0);
  });

  it("rejects wrong suffixes (.blend1 backups, no suffix, trailing slash, other types) and bad kinds", async () => {
    calls.length = 0;
    for (const p of [join(dir, "ok.blend1"), join(dir, "ok.txt"), join(dir, "blend"), join(dir, "ok.blend") + "/", join(dir, "ok.blend.png")]) {
      const res = await get(q(p));
      assert.equal(res.status, 400, p);
      assert.equal((await body(res)).error.code, "BLEND_SUFFIX_INVALID", p);
    }
    const res = await get(q(join(dir, "ok.blend"), "obj"));
    assert.equal(res.status, 400);
    assert.equal((await body(res)).error.code, "BLEND_KIND_INVALID");
    assert.equal(calls.length, 0);
  });

  it("a directory named *.blend is 403 BLEND_NOT_A_FILE; a missing file is 404 BLEND_NOT_FOUND; neither converts", async () => {
    calls.length = 0;
    let res = await get(q(join(dir, "folder.blend")));
    assert.equal(res.status, 403);
    assert.equal((await body(res)).error.code, "BLEND_NOT_A_FILE");
    res = await get(q(join(dir, "missing.blend")));
    assert.equal(res.status, 404);
    assert.equal((await body(res)).error.code, "BLEND_NOT_FOUND");
    assert.equal(calls.length, 0);
  });

  it("accepts an upper-case .BLEND suffix and forwards the request's abort signal to the exporter", async () => {
    calls.length = 0;
    const res = await get(q(join(dir, "UPPER.BLEND")));
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].signal instanceof AbortSignal);
  });

  it("HEAD on glb answers headers (length, type, etag) without a body", async () => {
    const res = await get(q(join(dir, "ok.blend"), "glb"), "HEAD");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "model/gltf-binary");
    assert.equal(res.headers.get("content-length"), "1");
    assert.equal(res.headers.get("etag"), 'W/"k-glb"');
    assert.equal(res.body, null);
  });

  it("a disabled plugin config answers 503 for every request", async () => {
    let disabledRoute;
    registerBlendRoute({ connection: { fetch: { register: (r) => { disabledRoute = r; } } } }, { export: () => assert.fail("must not convert") }, { ...resolveConfig({}), enabled: false });
    const res = await disabledRoute.fetch(new Request(`http://127.0.0.1/api/blender-annotate?${q(join(dir, "ok.blend"))}`));
    assert.equal(res.status, 503);
  });
});

// ------------------------------------------------------------------ cache + processes
describe("exporter: cache keying, sharing, timeouts and pruning (fake Blender)", () => {
  let fake;
  let work;
  before(() => {
    fake = makeFake();
    work = tempDir("exporter");
  });
  after(() => {
    fake.cleanup();
    removeDir(work);
  });

  it("converts once, then answers from cache without spawning Blender", async () => {
    const cacheDir = join(work, "c1");
    const blend = writeBlend(join(work, "a.blend"), { n: 1 });
    const ex = exporterWith(fake, cacheDir);
    const first = await ex.export(blend);
    const second = await ex.export(blend);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.key, first.key);
    assert.equal(fake.calls().filter((c) => c.blend.endsWith("/a.blend")).length, 1);
    // A brand-new exporter instance (plugin restart) also reuses the disk cache.
    const third = await exporterWith(fake, cacheDir).export(blend);
    assert.equal(third.cached, true);
    assert.equal(fake.calls().filter((c) => c.blend.endsWith("/a.blend")).length, 1);
  });

  it("re-converts when the file changes (same size + new mtime, or new size) and when applyModifiers flips", async () => {
    const cacheDir = join(work, "c2");
    const blend = writeBlend(join(work, "b.blend"), { v: "aaaa" });
    const ex = exporterWith(fake, cacheDir);
    const k1 = (await ex.export(blend)).key;
    writeBlend(blend, { v: "bbbb" }); // same size
    const t = statSync(blend).mtimeMs / 1000 + 5;
    utimesSync(blend, t, t);
    const r2 = await ex.export(blend);
    assert.equal(r2.cached, false);
    assert.notEqual(r2.key, k1);
    assert.match(r2.info.fake.content, /bbbb/, "fresh content was converted");
    writeBlend(blend, { v: "cccccc" }); // new size
    const r3 = await ex.export(blend);
    assert.equal(r3.cached, false);
    const noApply = exporterWith(fake, cacheDir, { applyModifiers: false });
    const r4 = await noApply.export(blend);
    assert.equal(r4.cached, false);
    assert.notEqual(r4.key, r3.key);
    const last = fake.calls().filter((c) => c.blend.endsWith("/b.blend")).pop();
    assert.equal(last.apply, "0", "applyModifiers=false reaches scene.py as 0");
    assert.equal(last.args[1], "--disable-autoexec", "scripts in the .blend never run");
  });

  it("concurrent requests for one file version share a single Blender process", async () => {
    const cacheDir = join(work, "c3");
    const blend = writeBlend(join(work, "c.blend"), { delayMs: 400 });
    const ex = exporterWith(fake, cacheDir);
    const results = await Promise.all(Array.from({ length: 6 }, () => ex.export(blend)));
    assert.equal(new Set(results.map((r) => r.key)).size, 1);
    assert.equal(fake.calls().filter((c) => c.blend.endsWith("/c.blend")).length, 1);
  });

  it("one caller aborting rejects only that caller; the shared conversion still completes for the others", async () => {
    const cacheDir = join(work, "c4");
    const blend = writeBlend(join(work, "d.blend"), { delayMs: 500 });
    const ex = exporterWith(fake, cacheDir);
    const controller = new AbortController();
    const aborted = ex.export(blend, { signal: controller.signal });
    const others = [ex.export(blend), ex.export(blend)];
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(aborted, (e) => e.code === "BLEND_ABORTED");
    const done = await Promise.all(others);
    assert.ok(done.every((r) => r.cached === false));
    assert.equal(fake.calls().filter((c) => c.blend.endsWith("/d.blend")).length, 1);
  });

  it("a torn cache entry (corrupt scene.json) is re-converted instead of served", async () => {
    const cacheDir = join(work, "c5");
    const blend = writeBlend(join(work, "e.blend"), {});
    const ex = exporterWith(fake, cacheDir);
    const first = await ex.export(blend);
    writeFileSync(join(first.directory, "scene.json"), "{ truncated");
    const second = await ex.export(blend);
    assert.equal(second.cached, false);
    assert.equal(fake.calls().filter((c) => c.blend.endsWith("/e.blend")).length, 2);
  });

  it("typed failures: empty file, too large, non-zero exit (with log tail), invalid GLB magic", async () => {
    const cacheDir = join(work, "c6");
    const ex = exporterWith(fake, cacheDir, { maxBytes: 200 });
    writeFileSync(join(work, "empty.blend"), "");
    await assert.rejects(ex.export(join(work, "empty.blend")), (e) => e.code === "BLEND_EMPTY");
    writeFileSync(join(work, "big.blend"), "x".repeat(201));
    await assert.rejects(ex.export(join(work, "big.blend")), (e) => e.code === "BLEND_TOO_LARGE");
    writeBlend(join(work, "crash.blend"), { exitCode: 3, stderr: "Traceback: boom\n" });
    await assert.rejects(ex.export(join(work, "crash.blend")), (e) => e.code === "BLEND_EXPORT_FAILED" && /boom/.test(e.detail));
    writeBlend(join(work, "magic.blend"), { badMagic: true });
    await assert.rejects(ex.export(join(work, "magic.blend")), (e) => e.code === "BLEND_OUTPUT_INVALID");
  });

  it("a symlink and its target share one cache entry", async () => {
    const cacheDir = join(work, "c7");
    const blend = writeBlend(join(work, "real.blend"), {});
    symlinkSync(blend, join(work, "alias.blend"));
    const ex = exporterWith(fake, cacheDir);
    const a = await ex.export(blend);
    const b = await ex.export(join(work, "alias.blend"));
    assert.equal(b.key, a.key);
    assert.equal(b.cached, true);
  });

  it("a hung Blender is reported as BLEND_TIMEOUT and a retry starts a fresh process", async () => {
    const cacheDir = join(work, "c8");
    const blend = writeBlend(join(work, "slow.blend"), { delayMs: 30_000 });
    const ex = exporterWith(fake, cacheDir, { timeoutMs: 400 });
    const started = Date.now();
    await assert.rejects(withTimeout(ex.export(blend), 5000, "timeout"), (e) => e.code === "BLEND_TIMEOUT");
    assert.ok(Date.now() - started < 3000);
    await assert.rejects(withTimeout(ex.export(blend), 5000, "retry"), (e) => e.code === "BLEND_TIMEOUT");
    assert.equal(fake.calls().filter((c) => c.blend.endsWith("/slow.blend")).length, 2, "pending job was released");
  });

  it("a Blender that ignores SIGTERM after the timeout still yields BLEND_TIMEOUT (no request hangs forever)", async () => {
    const cacheDir = join(work, "c9");
    const blend = writeBlend(join(work, "stubborn.blend"), { delayMs: 60_000, ignoreTerm: true });
    const ex = exporterWith(fake, cacheDir, { timeoutMs: 400 });
    try {
      await assert.rejects(withTimeout(ex.export(blend), 5000, "SIGTERM-ignoring Blender"), (e) => e.code === "BLEND_TIMEOUT");
    } finally {
      ex.dispose();
    }
  });

  it("pruning keeps at most cacheEntries complete entries, newest first", async () => {
    const cacheDir = join(work, "c10");
    const ex = exporterWith(fake, cacheDir, { cacheEntries: 2 });
    const keys = [];
    for (const n of ["p1", "p2", "p3", "p4"]) {
      keys.push((await ex.export(writeBlend(join(work, `${n}.blend`), { n }))).key);
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual(readdirSync(cacheDir).sort(), keys.slice(2).sort());
  });

  it("pruning never deletes the directory of another conversion that is still running", async () => {
    const cacheDir = join(work, "c11");
    const ex = exporterWith(fake, cacheDir, { cacheEntries: 2 });
    // Fill the cache to its limit with complete entries.
    await ex.export(writeBlend(join(work, "old1.blend"), {}));
    await ex.export(writeBlend(join(work, "old2.blend"), {}));
    // A slow conversion is in flight while a fast one finishes and prunes.
    const slow = ex.export(writeBlend(join(work, "slowpr.blend"), { delayMs: 800 }));
    await new Promise((r) => setTimeout(r, 150));
    await ex.export(writeBlend(join(work, "fast.blend"), {}));
    const result = await slow.then((v) => v, (e) => e);
    assert.ok(!(result instanceof Error), `in-flight conversion failed: ${result && result.code} ${result && result.message}\n${result && result.detail}`);
  });
});

// ------------------------------------------------------------------ config
describe("config normalization", () => {
  it("routePath always stays strictly under /api/ (the authenticated fence)", () => {
    for (const input of ["/api/", "/api//", "api/", "/api///"]) {
      const out = resolveConfig({ routePath: input }).routePath;
      assert.ok(out.startsWith("/api/") && out.length > "/api/".length, `${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    }
  });

  it("valid route paths are normalized; paths outside /api fall back to the default", () => {
    assert.equal(resolveConfig({ routePath: "api/custom/" }).routePath, "/api/custom");
    assert.equal(resolveConfig({ routePath: "/apix" }).routePath, "/api/blender-annotate");
    assert.equal(resolveConfig({ routePath: "/other/api/x" }).routePath, "/api/blender-annotate");
  });

  it("numbers are clamped and suffixes normalized", () => {
    const c = resolveConfig({ timeoutMs: 1, maxBytes: -5, cacheEntries: 10_000, extensions: [".BLEND", "blend", " .Blend1 ", 3, ""] });
    assert.equal(c.timeoutMs, 5000);
    assert.equal(c.maxBytes, 1);
    assert.equal(c.cacheEntries, 500);
    assert.deepEqual(c.extensions, ["blend", "blend1"]);
    assert.equal(resolveConfig({ timeoutMs: "abc" }).timeoutMs, 180_000);
    assert.equal(resolveConfig({ applyModifiers: "yes" }).applyModifiers, false);
  });
});

// ------------------------------------------------------------------ real Blender, end to end
describe("route + real Blender end to end", { skip: SKIP_NO_BLENDER }, () => {
  let dir;
  let route;
  let blend;
  before(async () => {
    dir = tempDir("e2e");
    mkdirSync(join(dir, "scenes"));
    blend = (await buildScenes(join(dir, "scenes"), ["mm"])).mm;
    const config = resolveConfig({ blenderPath: BLENDER, cacheDir: join(dir, "cache") });
    const ctx = { connection: { fetch: { register: (r) => { route = r; return () => {}; } } } };
    registerBlendRoute(ctx, new BlendExporter(config), config);
  });
  after(() => removeDir(dir));

  it("info then glb: one conversion, scene.annotate present, GLB streamed with exact length, .blend untouched", async () => {
    const before = sha256(blend);
    const url = (kind) => `http://127.0.0.1/api/blender-annotate?path=${encodeURIComponent(blend)}&kind=${kind}`;
    const [infoRes, glbRes] = await Promise.all([route.fetch(new Request(url("info"))), route.fetch(new Request(url("glb")))]);
    assert.equal(infoRes.status, 200);
    const info = JSON.parse(await infoRes.text());
    assert.equal(info.ok, true);
    assert.equal(info.scene.unit.millimeters_per_unit, 1);
    assert.deepEqual(Object.keys(info.scene.annotate.objects).sort(), ["Block", "Plate"]);
    assert.equal(glbRes.status, 200);
    const bytes = Buffer.from(await glbRes.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "glTF");
    assert.equal(String(bytes.length), glbRes.headers.get("content-length"));
    const again = JSON.parse(await (await route.fetch(new Request(url("info")))).text());
    assert.equal(again.cache.cached, true);
    assert.equal(again.cache.key, info.cache.key);
    assert.equal(readdirSync(join(dir, "cache")).length, 1, "both kinds shared one conversion");
    assert.equal(sha256(blend), before);
  });
});
