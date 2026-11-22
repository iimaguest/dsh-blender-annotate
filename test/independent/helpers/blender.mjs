/**
 * Headless Blender helpers for the QA suite: locate Blender, build scenes with
 * fixtures/gen_scenes.py, export them with the plugin's lib/scene.py exactly as
 * the Host does, and ask fixtures/oracle.py (running inside Blender on the
 * ORIGINAL .blend) for ground truth.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..", "..");
export const FIXTURES = join(here, "..", "fixtures");
export const SCENE_PY = join(ROOT, "lib", "scene.py");

export function findBlenderBinary() {
  const candidates = [
    process.env.DSH_BLENDER,
    process.env.BLENDER_PATH,
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "/usr/bin/blender",
    "/usr/local/bin/blender",
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}
export const BLENDER = findBlenderBinary();
/** Pass as the `skip` option of node:test when Blender is not installed. */
export const SKIP_NO_BLENDER = BLENDER === null ? "Blender is not installed (set DSH_BLENDER)" : false;

export function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `dshqa-${prefix}-`));
}
export function removeDir(dir) {
  if (dir && dir.includes("dshqa-")) rmSync(dir, { recursive: true, force: true });
}
export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function run(binary, args, { timeoutMs = 240_000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, env: { ...process.env, PYTHONUTF8: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Build the named scenes into `dir` (one Blender process). Returns {name: path}. */
export async function buildScenes(dir, names) {
  const result = await run(BLENDER, ["-b", "--factory-startup", "--python-exit-code", "1", "--python", join(FIXTURES, "gen_scenes.py"), "--", dir, ...names]);
  if (result.code !== 0) throw new Error(`gen_scenes failed (${result.code}):\n${result.stdout.slice(-3000)}\n${result.stderr.slice(-3000)}`);
  const out = {};
  for (const name of names) {
    const path = join(dir, `${name}.blend`);
    if (!existsSync(path)) throw new Error(`gen_scenes did not write ${path}`);
    out[name] = path;
  }
  return out;
}

/** Export one .blend exactly as lib/blender.js invokes Blender. */
export async function exportScene(blendPath, outDir, applyModifiers = true, tag = "") {
  const stem = blendPath.split("/").pop().replace(/\.blend$/, "") + (tag ? `-${tag}` : "") + (applyModifiers ? "" : "-noapply");
  const glbPath = join(outDir, `${stem}.glb`);
  const jsonPath = join(outDir, `${stem}.json`);
  const before = { hash: sha256(blendPath), mtimeMs: statSync(blendPath).mtimeMs, size: statSync(blendPath).size };
  const result = await run(BLENDER, [
    "--background", "--disable-autoexec", "--python-exit-code", "1", blendPath,
    "--python", SCENE_PY, "--", glbPath, jsonPath, applyModifiers ? "1" : "0",
  ]);
  const after = { hash: sha256(blendPath), mtimeMs: statSync(blendPath).mtimeMs, size: statSync(blendPath).size };
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    glbPath,
    jsonPath,
    before,
    after,
    info: existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : null,
  };
}

/** Run async tasks with bounded concurrency. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Build scenes and export each (modifiers applied, plus `noapply` ones with 0).
 * Returns { dir, blends, exports: {name: export}, noapply: {name: export} }.
 */
export async function prepareCorpus(prefix, names, noapplyNames = []) {
  const dir = tempDir(prefix);
  const sceneDir = join(dir, "scenes");
  const outDir = join(dir, "out");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(sceneDir);
  mkdirSync(outDir);
  const blends = await buildScenes(sceneDir, names);
  const { readdirSync } = await import("node:fs");
  const filesBefore = {};
  for (const f of readdirSync(sceneDir)) filesBefore[f] = { hash: sha256(join(sceneDir, f)), mtimeMs: statSync(join(sceneDir, f)).mtimeMs };
  const jobs = [...names.map((n) => [n, true]), ...noapplyNames.map((n) => [n, false])];
  const results = await pool(jobs, 4, ([n, applyMods]) => exportScene(blends[n], outDir, applyMods));
  const exports = {};
  const noapply = {};
  jobs.forEach(([n, applyMods], i) => { (applyMods ? exports : noapply)[n] = results[i]; });
  return { dir, sceneDir, outDir, blends, exports, noapply, filesBefore };
}

/** Run fixtures/oracle.py inside Blender on `blendPath` with a query document. */
export async function oracle(blendPath, queries, workDir) {
  const qPath = join(workDir, `oracle-q-${Math.random().toString(36).slice(2)}.json`);
  const aPath = qPath.replace("oracle-q-", "oracle-a-");
  writeFileSync(qPath, JSON.stringify(queries));
  const result = await run(BLENDER, ["-b", "--disable-autoexec", "--python-exit-code", "1", blendPath, "--python", join(FIXTURES, "oracle.py"), "--", qPath, aPath]);
  if (result.code !== 0 || !existsSync(aPath)) throw new Error(`oracle failed (${result.code}):\n${result.stdout.slice(-3000)}\n${result.stderr.slice(-3000)}`);
  return JSON.parse(readFileSync(aPath, "utf8"));
}
