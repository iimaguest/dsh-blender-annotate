/**
 * Final independent regressions. All expectations use handmade geometry or
 * explicit numeric values, not the implementation's own transform/GLB math.
 * Runs Node only: no Blender, browser, profile access, installs or temp files.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  arrayBufferOf, canvasStub, loadResolver, loadShippedViewer,
} from "../independent/helpers/blocks.mjs";

const bundle = readFileSync(new URL("../../lib/client.js", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
function section(start, end) {
  const from = bundle.indexOf(start);
  const to = bundle.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `shipped helper markers: ${start} / ${end}`);
  return bundle.slice(from, to);
}
const shippedResolverSource = section("function yupToZup(p)", "/** This package's copy namespace.");
const shippedResolver = new Function(shippedResolverSource + "\nreturn {createResolver};")();
const resolverAPIs = [loadResolver(), shippedResolver];
function uiHelpers(document) {
  return new Function("document", shippedResolverSource + "\n" +
    section("function overlayFor(viewer, item)", "function canvasToFile(canvas, stem)") + "\n" +
    section("function payloadUnit(item)", "function drawSketchShape(context, shape,") +
    "\nreturn {buildMessage, overlayFor, snapshotWithPins};")(document);
}
const ui = uiHelpers();
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rows = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
function close(actual, expected, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon,
    `component ${index}: ${value} != ${expected[index]} (epsilon ${epsilon})`));
}
function object(name, mesh, extra = {}) {
  return { name, mesh, type: "MESH", matrix_world: rows.map((r) => r.slice()),
    library: null, collections: [], modifiers: [], custom: {}, ...extra };
}
function baseHit(extra = {}) {
  return { nodeName: "Body", nodeIndex: 7, nodePath: ["Scene", "Body"], nodeWorld: I.slice(),
    point: [0.37, 0, -0.23], normal: [0, 1, 0], faceId: 0, srcId: 0,
    meshPrimitive: 2, triangle: 11, barycentric: [0.123456789123, 0.333333333337, 0.54320987754],
    uv: [0.37, 0.23], ...extra };
}
function triangleMesh(name, tagged) {
  return { name, tagged, faces: 1, geometry: {
    co: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    loop_start: [0], loop_total: [3], loop_vertex: [0, 1, 2], loop_edge: [0, 1, 2],
    edge_vertices: [0, 1, 1, 2, 2, 0], material_index: [0], materials: [],
  } };
}

test("GN instance rotated/scaled at owner's origin preserves evaluated world point AND normal", () => {
  const c = Math.SQRT1_2;
  // glTF R_y(45 degrees) * S(2,3,4), with exactly the owner's origin.
  const nodeWorld = [2*c, 0, -2*c, 0, 0, 3, 0, 0, 4*c, 0, 4*c, 0, 0, 0, 0, 1];
  const hit = baseHit({ nodeName: "Host", nodePath: ["Host", "Host"], nodeWorld,
    point: [3*c, 0.75, -c], normal: [c, 0, c] });
  const annotate = { meshes: [], objects: { Host: object("Host", -1) }, collections: {} };
  for (const api of resolverAPIs) {
    const r = api.createResolver(annotate, 1000).resolve(hit);
    close(r.worldMm, [3000*c, 1000*c, 750]);
    close(r.normal, [c, -c, 0]);
    close(r.localMm, [1000, -250, 250]);
    assert.equal(r.object, "Host");
    assert.equal(r.face, null);
    close(r.evaluated.gltfWorld, hit.point);
  }
});

test("read-only linked untagged owner cannot inherit stale source/face IDs of unrelated local mesh", () => {
  const annotate = { meshes: [triangleMesh("LocalMesh", true), triangleMesh("LinkedMesh", false)],
    objects: { A_Local: object("A_Local", 0), Linked: object("Linked", 1, { library: "/assets/linked.blend" }) }, collections: {} };
  const hit = baseHit({ nodeName: "Linked", nodePath: ["Linked"], faceId: 1, srcId: 1 });
  for (const api of resolverAPIs) {
    const r = api.createResolver(annotate, 1000).resolve(hit);
    assert.equal(r.object, "Linked");
    assert.equal(r.library, "/assets/linked.blend");
    for (const field of ["face", "mesh", "sourceObject", "params", "edge", "vertex", "snap"]) {
      assert.equal(r[field], null, `${field} must remain object-only, never A_Local`);
    }
    assert.equal(r.precision, "object");
  }
});

test("resolver preserves arbitrary evaluated identity exactly and copies mutable hit arrays", () => {
  for (const api of resolverAPIs) {
    const hit = baseHit();
    const expected = { nodeIndex: 7, nodePath: ["Scene", "Body"], meshPrimitive: 2, triangle: 11,
      barycentric: hit.barycentric.slice(), gltfWorld: hit.point.slice() };
    const r = api.createResolver({}, 1000).resolve(hit);
    assert.deepEqual(r.evaluated, expected);
    hit.barycentric[0] = 99;
    hit.nodePath[0] = "mutated";
    hit.point[0] = 99;
    assert.deepEqual(r.evaluated, expected);
    close(r.worldMm, [370, 230, 0]);
  }
});

/** Tiny valid GLB writer. Buffer views are padded/aligned independently. */
function glbBuilder() {
  const json = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = [];
  let size = 0;
  function view(typed) {
    const padding = (4 - size % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); size += padding; }
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const index = json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: bytes.length }) - 1;
    chunks.push(bytes); size += bytes.length;
    return index;
  }
  function accessor(typed, componentType, type, width, extra = {}) {
    return json.accessors.push({ bufferView: view(typed), componentType, type,
      count: typed.length / width, ...extra }) - 1;
  }
  function finish() {
    const binary = Buffer.concat(chunks);
    json.buffers = [{ byteLength: binary.length }];
    const text = Buffer.from(JSON.stringify(json));
    const jp = Buffer.alloc((text.length + 3) & ~3, 0x20); text.copy(jp);
    const bp = Buffer.alloc((binary.length + 3) & ~3); binary.copy(bp);
    const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jp.length + 8 + bp.length, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(jp.length); jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(bp.length); bh.writeUInt32LE(0x004e4942, 4);
    return arrayBufferOf(Buffer.concat([header, jh, jp, bh, bp]));
  }
  return { json, view, accessor, finish };
}
function sparseMorphGlb({ base = false, nodeWeight, meshWeight = 1 } = {}) {
  const b = glbBuilder();
  const positions = b.accessor(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, "VEC3", 3,
    { min: [-1, 0, 0], max: [1, 1, 0] });
  const indices = b.accessor(new Uint16Array([0, 1, 2]), 5123, "SCALAR", 1);
  const target = { componentType: 5126, count: 3, type: "VEC3",
    min: [0, 0, 0], max: [base ? 0.25 : 0, 0, 2] };
  if (base) target.bufferView = b.view(new Float32Array([0.25, 0, 0, 0, 0, 0, 9, 9, 9]));
  // Nonzero sparse byte offsets exercise both accessor and buffer-view offsets.
  target.sparse = { count: 1,
    indices: { bufferView: b.view(new Uint8Array([255, 2])), byteOffset: 1, componentType: 5121 },
    values: { bufferView: b.view(new Float32Array([123, 0, 0, 2])), byteOffset: 4 } };
  const morph = b.json.accessors.push(target) - 1;
  b.json.nodes = [{ name: "Morphed", mesh: 0, ...(nodeWeight === undefined ? {} : { weights: [nodeWeight] }) }];
  b.json.meshes = [{ weights: [meshWeight], primitives: [{ attributes: { POSITION: positions }, indices,
    targets: [{ POSITION: morph }] }] }];
  return b.finish();
}
function withViewer(glb, fn, canvasOptions) {
  const shipped = loadShippedViewer();
  const canvas = canvasStub(canvasOptions);
  const viewer = shipped.createViewer(canvas);
  try { viewer.setModel(glb); shipped.flush(); return fn(viewer, shipped, canvas); }
  finally { viewer.dispose(); }
}

test("shipped viewer applies sparse-only morph POSITION accessor without a base bufferView (mesh weight)", () => {
  withViewer(sparseMorphGlb(), (viewer) => {
    close(Array.from(viewer.trianglesOf(0, 0, null)), [-1, 0, 0, 1, 0, 0, 0, 1, 2]);
  });
});

test("shipped viewer patches sparse morph over dense base rather than adding to or discarding base values", () => {
  withViewer(sparseMorphGlb({ base: true, nodeWeight: 1 }), (viewer) => {
    close(Array.from(viewer.trianglesOf(0, 0, null)), [-0.75, 0, 0, 1, 0, 0, 0, 1, 2]);
  });
});

test("shipped viewer node morph weights override mesh defaults, including zero", () => {
  for (const weight of [0.25, 0]) {
    withViewer(sparseMorphGlb({ nodeWeight: weight, meshWeight: 1 }), (viewer) => {
      close(Array.from(viewer.trianglesOf(0, 0, null)), [-1, 0, 0, 1, 0, 0, 0, 1, 2*weight]);
    });
  }
});

function pickGlb() {
  const b = glbBuilder();
  const far = b.accessor(new Float32Array([-6,-1,0, -5,-1,0, -6,0,0]), 5126, "VEC3", 3,
    { min: [-6,-1,0], max: [-5,0,0] });
  const farIndices = b.accessor(new Uint16Array([0,1,2]), 5123, "SCALAR", 1);
  const square = b.accessor(new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]), 5126, "VEC3", 3,
    { min: [-1,-1,0], max: [1,1,0] });
  const squareIndices = b.accessor(new Uint16Array([0,1,2, 0,2,3]), 5123, "SCALAR", 1);
  const faces = b.accessor(new Uint16Array([9,9,9,9]), 5123, "SCALAR", 1);
  const sources = b.accessor(new Uint16Array([4,4,4,4]), 5123, "SCALAR", 1);
  const verts = b.accessor(new Uint16Array([1,2,3,4]), 5123, "SCALAR", 1);
  const uvs = b.accessor(new Float32Array([0,0, 1,0, 1,1, 0,1]), 5126, "VEC2", 2);
  b.json.nodes = [{ name: "Root", translation: [2,-1,0], children: [1] },
    { name: "Surface", mesh: 0, translation: [0.5,0,0.25], scale: [2,3,1] }];
  b.json.meshes = [{ primitives: [
    { attributes: { POSITION: far }, indices: farIndices },
    { attributes: { POSITION: square, _DSH_FACE: faces, _DSH_SRC: sources, _DSH_VERT: verts,
      TEXCOORD_0: uvs }, indices: squareIndices },
  ] }];
  return b.finish();
}
const pickWeights = [0.19, 0.28, 0.53];
const worldTriangle = [[0.5,-4,0.25], [4.5,2,0.25], [0.5,2,0.25]];
const weighted = (vertices, weights) => [0,1,2].map((axis) =>
  vertices.reduce((sum, vertex, index) => sum + vertex[axis]*weights[index], 0));
function knownPick(fn) {
  return withViewer(pickGlb(), (viewer, shipped) => {
    viewer.setView({ yaw: 0, pitch: 0, distance: 12, target: [2.5,-1,0.25] });
    shipped.flush();
    const screen = viewer.project(weighted(worldTriangle, pickWeights));
    assert.equal(screen.visible, true);
    const hit = viewer.pick(screen.x + 17, screen.y + 29);
    assert.ok(hit, "interior known triangle must be hit");
    fn(hit, viewer);
  }, { width: 800, height: 600, left: 17, top: 29 });
}

test("shipped pick barycentric weights reconstruct the actual point on a transformed known triangle", () => {
  knownPick((hit) => {
    close(hit.barycentric, pickWeights, 2e-5);
    assert.ok(Math.abs(hit.barycentric.reduce((a,b) => a+b, 0) - 1) < 1e-12);
    close(hit.point, weighted(worldTriangle, hit.barycentric), 2e-6);
    close(hit.point, weighted(worldTriangle, pickWeights), 2e-5);
    close(hit.uv, [0.28, 0.19], 2e-5);
    close(hit.normal, [0,0,1]);
  });
});

test("shipped pick reports original node path/index, nonzero primitive/triangle, IDs and world matrix", () => {
  knownPick((hit) => {
    assert.equal(hit.nodeName, "Surface");
    assert.deepEqual(plain(hit.nodePath), ["Root", "Surface"]);
    assert.equal(hit.nodeIndex, 1);
    assert.equal(hit.meshPrimitive, 1);
    assert.equal(hit.triangle, 1);
    assert.equal(hit.faceId, 9);
    assert.equal(hit.srcId, 4);
    assert.deepEqual(plain(hit.vertIds), [1,3,4]);
    close(hit.nodeWorld, [2,0,0,0, 0,3,0,0, 0,0,1,0, 2.5,-1,0.25,1]);
  });
});

function annotation(extra = {}) {
  const hit = baseHit();
  return { id: "qa-precision", target: "point", comment: "Keep exact click — not rounded", stale: false,
    source: { path: "/QA/a special.blend", version: "mtime:1700000000.123456:size:4097", cacheKey: "sha256:9f01",
      bytes: 4097, mtimeMs: 1700000000123.456, mmPerUnit: 1, recipe: 9, frame: 23 },
    hit, resolved: shippedResolver.createResolver({}, 1).resolve(hit), anchor: hit.point.slice(),
    view: { yaw: 0.123456789, pitch: -0.987654321, distance: 12.3456789, target: [0.1,0.2,0.3] }, ...extra };
}
function payloads(message) {
  return [...message.matchAll(/```json\n([^]*?)\n```/g)].map((match) => JSON.parse(match[1]));
}

test("structured message retains exact arbitrary surface barycentrics, revision/cache identity, coordinates and view", () => {
  const item = annotation();
  const message = ui.buildMessage((k) => k, "a special.blend", item.source.path, [item]);
  const [reference] = payloads(message);
  assert.equal(payloads(message).length, 1);
  assert.equal(reference.schema, "dsh.blender.annotation.v1");
  assert.deepEqual(reference.source, item.source);
  assert.deepEqual(reference.surface, item.resolved.evaluated);
  assert.deepEqual(reference.surface.barycentric, [0.123456789123, 0.333333333337, 0.54320987754]);
  assert.deepEqual(reference.pickedPoint.worldMm, [0.37,0.23,0]);
  assert.deepEqual(reference.targetPointWorldMm, [0.37,0.23,0]);
  assert.deepEqual(reference.view, item.view);
  assert.equal(reference.comment, item.comment);
  assert.equal(reference.target, "point");
  assert.match(message, /mtime:1700000000\.123456:size:4097/);
  assert.match(message, /sha256:9f01/);
});

test("structured edge/vertex snap anchors stay separate from original click and use each item's own units", () => {
  const items = [1,25.4].map((unit, index) => {
    const item = annotation({ target: index ? "vertex" : "edge", anchor: [3,4,5] });
    item.source = { ...item.source, mmPerUnit: unit };
    item.resolved.edge = { index: 5, vertices: [2,3], t: 0.234567891, distanceMm: 0.75 };
    item.resolved.vertex = { index: 3, distanceMm: 0.65 };
    return item;
  });
  const message = ui.buildMessage((k) => k, "unit.blend", "/unit.blend", items);
  const refs = payloads(message);
  assert.equal(refs.length, 2);
  refs.forEach((ref, index) => {
    close(ref.targetPointWorldMm, [3,-5,4].map((x) => x*items[index].source.mmPerUnit));
    assert.deepEqual(ref.pickedPoint.worldMm, items[index].resolved.worldMm);
    assert.deepEqual(ref.surface.gltfWorld, items[index].hit.point);
    assert.notDeepEqual(ref.targetPointWorldMm, ref.pickedPoint.worldMm);
  });
  assert.deepEqual(refs[0].sourceElement.edge, items[0].resolved.edge);
  assert.equal(refs[0].sourceElement.vertex, null);
  assert.deepEqual(refs[1].sourceElement.vertex, items[1].resolved.vertex);
  assert.equal(refs[1].sourceElement.edge, null);
  assert.equal((message.match(/original surface click/g) || []).length, 2);
});

test("stale references never request overlay geometry, but retain explicit stale evidence in the message", () => {
  const item = annotation({ target: "object", stale: true });
  let calls = 0;
  const viewer = { trianglesOf: () => { calls++; return new Float32Array(9); } };
  assert.equal(ui.overlayFor(viewer, item), null);
  assert.equal(calls, 0);
  assert.ok(ui.overlayFor(viewer, { ...item, stale: false }).faces);
  assert.equal(calls, 1, "fresh object is a positive control");
  const message = ui.buildMessage((k) => k, "stale.blend", item.source.path, [item]);
  assert.equal(payloads(message)[0].stale, true);
  assert.deepEqual(payloads(message)[0].source, item.source);
  assert.match(message, /do not use its indices on the current geometry without revalidation/);
});

test("snapshot pin drawing omits stale annotations without renumbering fresh references", () => {
  const arcs = [], labels = [];
  const ctx = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, drawImage() {},
    beginPath() {}, arc: (...args) => arcs.push(args), fill() {}, stroke() {},
    fillText: (...args) => labels.push(args) };
  const output = { getContext: () => ctx };
  const helpers = uiHelpers({ createElement: (tag) => { assert.equal(tag, "canvas"); return output; } });
  const viewer = { canvas: { width: 800, height: 600, getBoundingClientRect: () => ({ width: 400 }) },
    project: () => ({ visible: true, x: 100, y: 50 }) };
  const result = helpers.snapshotWithPins(viewer, [annotation({ stale: true }), annotation({ stale: false })]);
  assert.equal(result, output);
  assert.equal(arcs.length, 1);
  assert.equal(labels.length, 1);
  assert.equal(labels[0][0], "2", "pin numbering must match the second message reference");
  assert.equal(output.width, 800);
  assert.equal(output.height, 600);
});
