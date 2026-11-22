/**
 * Stand-in for the Blender binary used by the host tests. Invoked exactly like
 * Blender by lib/blender.js:
 *   <bin> --background --disable-autoexec --python-exit-code 1 <blend> --python <script> -- <glb> <json> <0|1>
 * The .blend file's content is a JSON spec controlling behaviour:
 *   { delayMs, ignoreTerm, exitCode, badMagic, stderr }
 * Every invocation is appended to <dir of this file>/calls.log; the pid goes to <dir>/pids.log.
 * Like the real exporter, outputs are written through a temporary name and renamed,
 * so a missing output directory makes the "export" fail.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("Blender 9.9.9 (fake)\n");
  process.exit(0);
}
const blend = args[4];
const [glb, json, apply] = args.slice(args.indexOf("--") + 1);
let spec = {};
try {
  spec = JSON.parse(readFileSync(blend, "utf8"));
} catch {
  /* plain bytes */
}
appendFileSync(join(here, "pids.log"), `${process.pid}\n`);
appendFileSync(join(here, "calls.log"), JSON.stringify({ blend, glb, json, apply, args, pid: process.pid }) + "\n");
if (spec.ignoreTerm) process.on("SIGTERM", () => process.stderr.write("ignoring SIGTERM\n"));
if (spec.stderr) process.stderr.write(spec.stderr);

setTimeout(() => {
  try {
    if (spec.exitCode) process.exit(spec.exitCode);
    const magic = spec.badMagic ? "NOPE" : "glTF";
    const body = Buffer.alloc(64);
    body.write(magic, 0, "latin1");
    const glbTmp = glb.replace(/\.glb$/, ".part.glb");
    writeFileSync(glbTmp, body);
    renameSync(glbTmp, glb);
    const info = {
      recipe: 2,
      blender: "9.9.9",
      file: blend,
      file_name: blend.split("/").pop(),
      scene: "Scene",
      unit: { millimeters_per_unit: 1000 },
      annotate: { version: 1, meshes: [], objects: {} },
      fake: { apply, content: readFileSync(blend, "utf8").slice(0, 200) },
    };
    writeFileSync(json + ".part", JSON.stringify(info));
    renameSync(json + ".part", json);
    process.stdout.write("BLEND_PREVIEW_OK 0.01\n");
    process.exit(0);
  } catch (error) {
    process.stderr.write(String(error && error.stack ? error.stack : error));
    process.exit(1);
  }
}, spec.delayMs || 0);
if (spec.ignoreTerm) setInterval(() => {}, 1000);
