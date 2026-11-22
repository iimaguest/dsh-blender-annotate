/**
 * Point resolution against a real Blender export (test/fixtures, produced by
 * lib/scene.py from annotate-fixture.blend via make_fixture.py): picks real
 * triangles from the GLB and checks the identities and parameters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "dev", "resolve.js"), "utf8");
const block = source.slice(source.indexOf("\n", source.indexOf("/* @resolve:start")) + 1, source.indexOf("/* @resolve:end"));
const api = new Function(block + "\nreturn { createResolver, selectorOf, describeResolved, yupToZup, faceParameters };")();

const scene = JSON.parse(readFileSync(join(root, "test", "fixtures", "annotate-fixture.json"), "utf8"));
const glb = readFileSync(join(root, "test", "fixtures", "annotate-fixture.glb"));

function parseGlb(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  const bin = buffer.subarray(20 + jsonLength + 8);
  const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3 };
  const accessor = (index) => {
    const a = json.accessors[index];
    const view = json.bufferViews[a.bufferView];
    const Type = types[a.componentType];
    const offset = bin.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0);
    return new Type(bin.buffer.slice(offset, offset + a.count * sizes[a.type] * Type.BYTES_PER_ELEMENT));
  };
  return { json, accessor };
}

function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + w * z) * s[0], 2 * (x * z - w * y) * s[0], 0,
    2 * (x * y - w * z) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + w * x) * s[1], 0,
    2 * (x * z + w * y) * s[2], 2 * (y * z - w * x) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const { json, accessor } = parseGlb(glb);
/** Every triangle in the GLB, in glTF world space, with its ids. */
function triangles(nodeName) {
  const node = json.nodes.find((n) => n.name === nodeName);
  const world = node.matrix ?? compose(node.translation, node.rotation, node.scale);
  const out = [];
  for (const primitive of json.meshes[node.mesh].primitives) {
    const pos = accessor(primitive.attributes.POSITION);
    const face = accessor(primitive.attributes._DSH_FACE);
    const src = accessor(primitive.attributes._DSH_SRC);
    const idx = accessor(primitive.indices);
    for (let t = 0; t < idx.length; t += 3) {
      const corners = [idx[t], idx[t + 1], idx[t + 2]].map((i) => apply(world, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]));
      const point = corners.reduce((acc, c) => acc.map((v, k) => v + c[k] / 3), [0, 0, 0]);
      out.push({ nodeName, nodeWorld: world, point, corners, faceId: face[idx[t]], srcId: src[idx[t]] });
    }
  }
  return out;
}

const resolver = api.createResolver(scene.annotate, scene.unit.millimeters_per_unit);
const meshIndex = (name) => scene.annotate.meshes.findIndex((m) => m.name === name);

test("a point on the flat top of the bevelled body resolves to the cube's +Z face, exactly", () => {
  // Blender +Z is glTF +Y; the cube top sits at z = 2 (location 1 + half size 1).
  const top = triangles("Body").find((tri) => tri.srcId === meshIndex("Cube") + 1 && tri.corners.every((c) => Math.abs(c[1] - 2) < 1e-4));
  assert.ok(top, "found a triangle on the flat top");
  const r = resolver.resolve(top);
  assert.equal(r.object, "Body");
  assert.equal(r.mesh, "Cube");
  assert.equal(r.sourceObject, "Body");
  assert.equal(r.precision, "exact");
  assert.equal(r.faceSides, 4);
  assert.ok(Math.abs(r.offsetMm) < 1e-3, `offset ${r.offsetMm}`);
  assert.equal(r.params.kind, "bilinear");
  assert.ok(r.params.s > 0 && r.params.s < 1 && r.params.t > 0 && r.params.t < 1, JSON.stringify(r.params));
  // Recompute which source face points up and compare.
  const g = scene.annotate.meshes[meshIndex("Cube")].geometry;
  const zOf = (v) => g.co[v * 3 + 2];
  let up = -1;
  for (let f = 0; f < g.loop_start.length; f += 1) {
    const verts = g.loop_vertex.slice(g.loop_start[f], g.loop_start[f] + g.loop_total[f]);
    if (verts.every((v) => zOf(v) > 0.99)) up = f;
  }
  assert.equal(r.face, up);
  assert.ok(Math.abs(r.worldMm[2] - 2000) < 1e-2, `world z ${r.worldMm[2]}`);
  assert.ok(r.edge.index >= 0 && r.edge.t >= 0 && r.edge.t <= 1);
  assert.ok(api.selectorOf(r, "point").startsWith("Body › face " + up + " (quad) › s="));
});

test("the Boolean hole wall is attributed to the cutter object and its own face", () => {
  const wall = triangles("Body").find((tri) => tri.srcId === meshIndex("Cylinder") + 1);
  assert.ok(wall, "found a triangle cut by the cylinder");
  const r = resolver.resolve(wall);
  assert.equal(r.object, "Body");
  assert.equal(r.sourceObject, "Cutter");
  assert.equal(r.mesh, "Cylinder");
  assert.equal(r.precision, "exact", `offset ${r.offsetMm} mm`);
  assert.match(api.describeResolved(r, "face"), /surface created by `Cutter`/);
  assert.match(api.describeResolved(r, "face"), /bpy\.data\.objects\["Cutter"\]\.data; me\.polygons\[/);
});

test("linked duplicates are separate parts with the same source face and local point", () => {
  const a = triangles("Bolt.A");
  const b = triangles("Bolt.B");
  assert.equal(a.length, b.length);
  const ra = resolver.resolve(a[10]);
  const rb = resolver.resolve(b[10]);
  assert.equal(ra.object, "Bolt.A");
  assert.equal(rb.object, "Bolt.B");
  assert.equal(ra.face, rb.face);
  ra.localMm.forEach((v, k) => assert.ok(Math.abs(v - rb.localMm[k]) < 1e-3));
  assert.ok(Math.abs(ra.worldMm[0] - rb.worldMm[0]) > 4000, "different world positions");
  assert.deepEqual(rb.custom, { part_no: "B-100", torque_nm: 12.5 });
  assert.equal(rb.precision, "exact");
});

test("subdivided surfaces still map every triangle to a source face", () => {
  const tris = triangles("Shell");
  const results = tris.slice(0, 400).map((tri) => resolver.resolve(tri));
  assert.ok(results.every((r) => r.face !== null && r.face >= 0 && r.mesh === "Sphere"));
  assert.ok(results.some((r) => r.precision === "modified-surface"), "subsurf moves the surface off the cage");
});

test("snap points for edge and vertex land on the source cage in world space", () => {
  const top = triangles("Body").find((tri) => tri.srcId === meshIndex("Cube") + 1 && tri.corners.every((c) => Math.abs(c[1] - 2) < 1e-4));
  const r = resolver.resolve(top);
  // Cage corners of the unit cube at z=2 are at |x|,|y| = 1 → glTF |x|=1, y=2, |z|=1.
  const v = r.snap.vertexPoint;
  assert.ok(Math.abs(Math.abs(v[0]) - 1) < 1e-4 && Math.abs(v[1] - 2) < 1e-4 && Math.abs(Math.abs(v[2]) - 1) < 1e-4, JSON.stringify(v));
  assert.equal(r.snap.faceOutline.length, 4);
});

test("parameters: triangle barycentric, quad bilinear and n-gon mean-value weights", () => {
  const n = [0, 0, 1];
  const tri = api.faceParameters([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [0.25, 0.25, 0], n);
  assert.deepEqual(tri.weights.map((w) => Math.round(w * 1000) / 1000), [0.5, 0.25, 0.25]);
  const quad = api.faceParameters([[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]], [0.5, 0.75, 0], n);
  assert.ok(Math.abs(quad.s - 0.25) < 1e-9 && Math.abs(quad.t - 0.75) < 1e-9);
  const hex = [0, 1, 2, 3, 4, 5].map((k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3), 0]);
  const center = api.faceParameters(hex, [0, 0, 0], n);
  center.weights.forEach((w) => assert.ok(Math.abs(w - 1 / 6) < 1e-9));
});
