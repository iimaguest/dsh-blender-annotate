/**
 * Independent QA: dev/resolve.js fed with hits taken from real GLB exports and
 * compared with Blender ground truth (fixtures/oracle.py on the ORIGINAL .blend).
 * Expected values never come from the resolver's own math.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SKIP_NO_BLENDER, oracle, pool, prepareCorpus, removeDir } from "./helpers/blender.mjs";
import { centroid, dist, dot, meshInstances, norm, pointTriangleDistance, readGlb, toYup, toZup, trianglesOf } from "./helpers/glb.mjs";
import { loadResolver } from "./helpers/blocks.mjs";

const SCENES = ["xform", "mm", "mods", "bools", "special"];
const BILINEAR = { xform: ["Parent", "ChildDirect", "Negative", "UVPlane", "Prism"], mm: ["Block", "Plate"] };
const ST = [[0.2, 0.1], [0.7, 0.35], [0.45, 0.8], [0, 0], [1, 0], [1, 1], [0, 1]];
const api = loadResolver();

/** Inverse-transpose of the upper 3x3 of a column-major 4x4. */
function normalMatrix(m) {
  const a = [m[0], m[1], m[2]], b = [m[4], m[5], m[6]], c = [m[8], m[9], m[10]];
  const cx = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const r0 = cx(b, c), r1 = cx(c, a), r2 = cx(a, b);
  const det = dot(a, r0);
  return (n) => norm([(r0[0] * n[0] + r1[0] * n[1] + r2[0] * n[2]) / det, (r0[1] * n[0] + r1[1] * n[1] + r2[1] * n[2]) / det, (r0[2] * n[0] + r1[2] * n[1] + r2[2] * n[2]) / det]);
}

function hitFor(inst, tri, point) {
  const nm = normalMatrix(inst.world);
  const n = tri.normals ? nm(centroid(tri.normals)) : null;
  return {
    nodeName: inst.name,
    nodeWorld: inst.world.slice(),
    point,
    normal: n,
    faceId: tri.faceIds ? tri.faceIds[0] : 0,
    srcId: tri.srcIds ? tri.srcIds[0] : 0,
    uv: null,
  };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const vecClose = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe("resolver vs Blender ground truth", { skip: SKIP_NO_BLENDER }, () => {
  let corpus;
  /** scene -> array of samples {scene, inst, tri, k, kind, hit, r, truth, local, bil} */
  const samples = {};
  const facts = {};

  before(async () => {
    corpus = await prepareCorpus("resolve", SCENES);
    await pool(SCENES, 4, async (scene) => {
      const ex = corpus.exports[scene];
      assert.equal(ex.code, 0, ex.stderr);
      const glb = readGlb(ex.glbPath);
      const resolver = api.createResolver(ex.info.annotate, ex.info.unit.millimeters_per_unit);
      const instances = meshInstances(glb);
      const list = [];
      for (const inst of instances) {
        trianglesOf(glb, inst).forEach((tri, k) => {
          const hit = hitFor(inst, tri, centroid(tri.worldGl));
          list.push({ scene, inst, tri, k, kind: "centroid", hit, local: toZup(centroid(tri.localGl)) });
        });
      }
      const phase1 = await oracle(corpus.blends[scene], { bilinear: BILINEAR[scene] ? { objects: BILINEAR[scene], st: ST } : null }, corpus.dir);
      facts[scene] = phase1;
      for (const b of phase1.bilinear || []) {
        const inst = instances.find((i) => i.name === b.object);
        const p = toYup(b.world);
        const corner = (b.s === 0 || b.s === 1) && (b.t === 0 || b.t === 1);
        let best = null;
        for (const tri of trianglesOf(glb, inst)) {
          if (corner && tri.faceIds[0] !== b.face + 1) continue;
          const d = pointTriangleDistance(p, ...tri.worldGl);
          if (best === null || d < best.d) best = { d, tri };
        }
        const invLocal = api.m4invert(inst.world);
        const localGl = [0, 1, 2].map((r) => invLocal[r] * p[0] + invLocal[4 + r] * p[1] + invLocal[8 + r] * p[2] + invLocal[12 + r]);
        list.push({ scene, inst, tri: best.tri, k: -1, kind: corner ? "corner" : "interior", hit: hitFor(inst, best.tri, p), local: toZup(localGl), bil: b, gap: best.d });
      }
      for (const s of list) s.r = resolver.resolve(s.hit);
      const queries = list.map((s, i) => ({ id: i, object: s.inst.name, local: s.local, face: s.r.face, mesh: s.r.mesh }));
      const phase2 = await oracle(corpus.blends[scene], { points: queries }, corpus.dir);
      phase2.points.forEach((t, i) => { list[i].truth = t; });
      samples[scene] = list;
    });
  });
  after(() => removeDir(corpus?.dir));

  const PLAIN = {
    xform: ["Parent", "ChildDirect", "ChildKeep", "Negative", "Prism", "Tri", "Pent", "UVPlane"],
    mm: ["Block", "Plate"],
    special: ["PreTagged", "MultiMat", "NoMat", "LinkA", "LinkB", "InstCube"],
  };
  const plainSamples = () => Object.entries(PLAIN).flatMap(([scene, names]) => samples[scene].filter((s) => names.includes(s.inst.name)));
  const mmOf = (s) => corpus.exports[s.scene].info.unit.millimeters_per_unit;

  it("unmodified meshes: face = Blender's nearest source polygon, precision exact, zero plane offset", () => {
    const bad = [];
    for (const s of plainSamples()) {
      const { r, truth } = s;
      const tag = `${s.scene}/${s.inst.name}#${s.k}/${s.kind}`;
      if (!(truth.bvh_dist < 1e-4)) { bad.push(`${tag}: sample ${truth.bvh_dist} off the source mesh`); continue; }
      if (s.kind !== "corner" && r.face !== truth.bvh_face) bad.push(`${tag}: face ${r.face}, Blender ${truth.bvh_face}`);
      if (r.precision !== "exact") bad.push(`${tag}: precision ${r.precision}`);
      if (!(Math.abs(r.offsetMm) < 1e-4 * mmOf(s))) bad.push(`${tag}: offset ${r.offsetMm} mm`);
      if (r.faceSides !== truth.face_sides) bad.push(`${tag}: sides ${r.faceSides} vs ${truth.face_sides}`);
    }
    assert.ok(plainSamples().length > 120);
    assert.deepEqual(bad.slice(0, 15), [], `${bad.length} problems`);
  });

  it("localMm and worldMm equal Blender local/world coordinates × unit scale (rotation, non-uniform & negative scale, direct parenting, mm units)", () => {
    const bad = [];
    for (const s of plainSamples()) {
      const mm = mmOf(s);
      const tag = `${s.scene}/${s.inst.name}#${s.k}`;
      if (!vecClose(s.r.localMm, s.local.map((v) => v * mm), 1e-4 * mm)) bad.push(`${tag}: local ${s.r.localMm} vs ${s.local.map((v) => v * mm)}`);
      if (s.inst.name === "ChildKeep" || s.inst.name === "InstCube") continue; // world checked in their own tests
      if (!vecClose(s.r.worldMm, s.truth.world.map((v) => v * mm), 1e-4 * mm)) bad.push(`${tag}: world ${s.r.worldMm} vs ${s.truth.world.map((v) => v * mm)}`);
    }
    assert.deepEqual(bad.slice(0, 10), []);
    // The mm scene really is in millimetres: 1 Blender unit = 1 mm.
    assert.equal(corpus.exports.mm.info.unit.millimeters_per_unit, 1);
  });

  it("worldMm and normal equal Blender's for a child parented with keep-transform under a rotated, non-uniformly scaled parent", () => {
    const list = samples.xform.filter((s) => s.inst.name === "ChildKeep");
    let worst = 0;
    let worstDot = 1;
    for (const s of list) {
      worst = Math.max(worst, dist(s.r.worldMm, s.truth.world.map((v) => v * 1000)));
      if (s.truth.world_normal) worstDot = Math.min(worstDot, dot(s.r.normal, s.truth.world_normal));
    }
    assert.ok(list.length >= 12);
    assert.deepEqual(
      { worldErrorMm: Math.round(worst), normalsAgree: worstDot > 0.9999 },
      { worldErrorMm: 0, normalsAgree: true },
      `worldMm deviates from Blender's matrix_world @ local by up to ${worst.toFixed(1)} mm; worst normal dot ${worstDot.toFixed(4)}`
    );
  });

  it("nearest edge: Blender edge index, its own vertex order, t along edge.vertices[0]→[1], distance", () => {
    const bad = [];
    let checked = 0;
    for (const s of plainSamples()) {
      const { r, truth } = s;
      if (!truth.edges) continue;
      const mm = mmOf(s);
      const min = Math.min(...truth.edges.map((e) => e.dist));
      const e = truth.edges.find((x) => x.index === r.edge.index);
      const tag = `${s.scene}/${s.inst.name}#${s.k}/${s.kind}`;
      checked += 1;
      if (!e) { bad.push(`${tag}: edge ${r.edge.index} is not an edge of face ${r.face}`); continue; }
      if (!(e.dist - min <= 1e-5)) bad.push(`${tag}: edge ${r.edge.index} at ${e.dist}, nearest is ${min}`);
      if (JSON.stringify(r.edge.vertices) !== JSON.stringify(e.vertices)) bad.push(`${tag}: vertices ${r.edge.vertices} vs Blender ${e.vertices}`);
      if (!close(r.edge.t, e.t, 1e-4)) bad.push(`${tag}: t ${r.edge.t} vs Blender ${e.t} (edge ${e.vertices})`);
      if (!close(r.edge.distanceMm, e.dist * mm, 1e-4 * mm)) bad.push(`${tag}: distance ${r.edge.distanceMm} vs ${e.dist * mm}`);
    }
    assert.ok(checked > 120, `checked ${checked}`);
    assert.deepEqual(bad.slice(0, 15), [], `${bad.length} problems`);
  });

  it("nearest vertex: Blender vertex index and distance", () => {
    const bad = [];
    for (const s of plainSamples()) {
      const { r, truth } = s;
      if (!truth.verts) continue;
      const min = Math.min(...truth.verts.map((v) => v.dist));
      const v = truth.verts.find((x) => x.index === r.vertex.index);
      const tag = `${s.scene}/${s.inst.name}#${s.k}`;
      if (!v) bad.push(`${tag}: vertex ${r.vertex.index} not on face`);
      else if (!(v.dist - min <= 1e-5) || !close(r.vertex.distanceMm, v.dist * mmOf(s), 1e-4 * mmOf(s))) bad.push(`${tag}: vertex ${r.vertex.index} ${v.dist} vs min ${min}`);
    }
    assert.deepEqual(bad.slice(0, 15), []);
  });

  it("in-face parameters reproduce the point from Blender's loop-ordered vertices (tri / quad / n-gon)", () => {
    const bad = [];
    for (const s of plainSamples()) {
      const { r, truth } = s;
      if (!truth.face_points) continue;
      const P = truth.face_points;
      const n = P.length;
      const tag = `${s.scene}/${s.inst.name}#${s.k}/${s.kind} (${n} sides)`;
      const expectedKind = n === 3 ? "barycentric" : n === 4 ? "bilinear" : "mean-value";
      if (r.params.kind !== expectedKind) { bad.push(`${tag}: kind ${r.params.kind}`); continue; }
      let q;
      if (n === 4) {
        const { s: u, t: v } = r.params;
        const w = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
        q = [0, 1, 2].map((c) => P.reduce((acc, p, i) => acc + p[c] * w[i], 0));
      } else {
        q = [0, 1, 2].map((c) => P.reduce((acc, p, i) => acc + p[c] * r.params.weights[i], 0));
        const sum = r.params.weights.reduce((a, b) => a + b, 0);
        if (!close(sum, 1, 1e-6)) bad.push(`${tag}: weights sum ${sum}`);
      }
      if (!(dist(q, truth.src_local) <= 1e-4 * truth.face_size)) bad.push(`${tag}: params rebuild ${q} ≠ ${truth.src_local}`);
    }
    assert.deepEqual(bad.slice(0, 15), []);
  });

  it("quad corners resolve to (0,0),(1,0),(1,1),(0,1) in loop order; interior points to their known (s,t)", () => {
    const bad = [];
    let n = 0;
    for (const scene of Object.keys(BILINEAR)) {
      for (const s of samples[scene].filter((x) => x.bil)) {
        n += 1;
        const tag = `${scene}/${s.bil.object} face ${s.bil.face} (s,t)=(${s.bil.s},${s.bil.t})`;
        if (s.gap > 1e-4) { bad.push(`${tag}: Blender point ${s.gap} off the GLB surface`); continue; }
        if (s.r.face !== s.bil.face) { bad.push(`${tag}: resolved face ${s.r.face}`); continue; }
        if (!close(s.r.params.s, s.bil.s, 1e-4) || !close(s.r.params.t, s.bil.t, 1e-4)) bad.push(`${tag}: got (${s.r.params.s.toFixed(5)}, ${s.r.params.t.toFixed(5)})`);
      }
    }
    assert.ok(n > 100, `checked ${n}`);
    assert.deepEqual(bad.slice(0, 15), []);
  });

  it("normal equals Blender's world-space face normal (incl. negative scale)", () => {
    const bad = [];
    for (const s of plainSamples()) {
      if (!s.truth.world_normal || s.inst.name === "ChildKeep" || s.inst.name === "InstCube") continue;
      const d = dot(s.r.normal, s.truth.world_normal);
      if (!(d > 0.9999)) bad.push(`${s.scene}/${s.inst.name}#${s.k}: dot ${d}`);
    }
    assert.deepEqual(bad.slice(0, 10), []);
  });

  it("material is the one Blender renders on the face (multi-material mesh, mesh-linked slot)", () => {
    const bad = [];
    for (const s of samples.special.filter((x) => ["MultiMat", "LinkA"].includes(x.inst.name))) {
      if (s.r.material !== s.truth.material) bad.push(`${s.inst.name} face ${s.r.face}: resolver ${s.r.material}, Blender ${s.truth.material}`);
    }
    assert.deepEqual([...new Set(bad)], []);
  });

  it("material honours an object-linked material slot (linked duplicate with its own material)", () => {
    const bad = [];
    for (const s of samples.special.filter((x) => x.inst.name === "LinkB")) {
      if (s.r.material !== s.truth.material) bad.push(`${s.inst.name} face ${s.r.face}: resolver ${s.r.material}, Blender ${s.truth.material}`);
    }
    assert.deepEqual([...new Set(bad)].slice(0, 2), []);
  });

  it("a mesh without materials reports material null (not undefined)", () => {
    const s = samples.special.find((x) => x.inst.name === "NoMat");
    assert.equal(s.truth.material, null);
    assert.strictEqual(s.r.material, null);
  });

  const boolSamples = (body) => samples.bools.filter((s) => s.inst.name === body);
  function checkBoolean(body) {
    const bad = [];
    const operands = new Set();
    for (const s of boolSamples(body)) {
      const { r, truth } = s;
      operands.add(truth.operand);
      const tag = `${body}#${s.k} (mesh ${r.mesh})`;
      if (r.sourceObject !== truth.operand) bad.push(`${tag}: sourceObject ${r.sourceObject}, Blender operand ${truth.operand}`);
      else if (truth.bvh_dist < 1e-4 && r.face !== truth.bvh_face) bad.push(`${tag}: face ${r.face}, Blender ${truth.bvh_face}`);
      if (truth.face_dist !== undefined && truth.face_dist < 1e-5 * truth.face_size && r.precision !== "exact") bad.push(`${tag}: on the source face but precision ${r.precision}`);
    }
    return { bad: [...new Set(bad)], operands: [...operands] };
  }

  it("Boolean difference/union/intersect (object operand, hidden/visible/disabled cutter): faces attributed to the right object and face", () => {
    for (const [body, cutter] of [["BodyDiff", "CutDiff"], ["BodyUnion", "CutUnion"], ["BodyInt", "CutInt"]]) {
      const { bad, operands } = checkBoolean(body);
      assert.deepEqual(bad.slice(0, 10), [], body);
      assert.deepEqual(operands.sort(), [body, cutter].sort(), `${body} shows faces of both operands`);
    }
    const wall = boolSamples("BodyDiff").find((s) => s.r.sourceObject === "CutDiff");
    assert.match(api.selectorOf(wall.r, "face"), new RegExp(`^BodyDiff › face ${wall.r.face} \\(quad\\) from CutDiff$`));
    assert.match(api.describeResolved(wall.r, "vertex"), new RegExp(`bpy: \`me = bpy\\.data\\.objects\\["CutDiff"\\]\\.data; me\\.polygons\\[${wall.r.face}\\]; me\\.vertices\\[${wall.r.vertex.index}\\]\``));
  });

  it("Boolean with a collection operand: cutter faces are attributed to the cutter, not to an unrelated linked duplicate", () => {
    const { bad } = checkBoolean("BodyColl");
    assert.deepEqual(bad.slice(0, 5), []);
  });

  it("Boolean whose cutter is a linked duplicate of the body's own mesh: cut faces are attributed to the cutter object", () => {
    const { bad, operands } = checkBoolean("BodySelf");
    assert.ok(operands.includes("SelfCutter"), "Blender: some faces come from SelfCutter");
    assert.deepEqual(bad.slice(0, 5), []);
  });

  it("precision is 'exact' only when the point lies on the source face (Mirror / Array copies must not be 'exact')", () => {
    const bad = [];
    for (const s of samples.mods) {
      const { r, truth } = s;
      if (truth.face_dist === undefined) continue;
      const rel = truth.face_dist / truth.face_size;
      if (rel > 0.1 && r.precision === "exact") bad.push(`${s.inst.name}#${s.k}: ${truth.face_dist.toFixed(3)} from source face ${r.face} (×${rel.toFixed(2)} its size) but 'exact'`);
      if (rel < 1e-5 && r.precision !== "exact") bad.push(`${s.inst.name}#${s.k}: on source face but '${r.precision}'`);
    }
    assert.deepEqual(bad.slice(0, 12), [], `${bad.length} misclassified points`);
  });

  it("modifier copies far from their source face are classified 'modifier-copy'", () => {
    const bad = [];
    for (const s of samples.mods.filter((x) => ["MirCube", "MirPlane", "Arr"].includes(x.inst.name))) {
      const { r, truth } = s;
      if (truth.face_dist / truth.face_size > 1 && r.precision !== "modifier-copy") bad.push(`${s.inst.name}#${s.k}: ${r.precision}`);
    }
    assert.deepEqual(bad.slice(0, 12), [], `${bad.length} copies not flagged`);
  });

  it("collection instances: the clicked copy reports which instancer it belongs to", () => {
    const glb = readGlb(corpus.exports.special.glbPath);
    const parents = {};
    glb.json.nodes.forEach((n) => (n.children || []).forEach((c) => { parents[c] = n.name; }));
    const copies = samples.special.filter((s) => s.inst.name === "InstCube" && s.kind === "centroid");
    const byInstancer = {};
    for (const s of copies) (byInstancer[parents[s.inst.nodeIndex]] ||= []).push(s);
    assert.deepEqual(Object.keys(byInstancer).sort(), ["InstA", "InstB"], "two instanced copies in the GLB");
    // Geometry is right: instance world = instancer.matrix_world @ local.
    const mwB = facts.special.objects.InstB.matrix_world;
    const s0 = byInstancer.InstB[0];
    const expected = [0, 1, 2].map((r) => (mwB[r][0] * s0.local[0] + mwB[r][1] * s0.local[1] + mwB[r][2] * s0.local[2] + mwB[r][3]) * 1000);
    assert.ok(vecClose(s0.r.worldMm, expected, 0.1), `world ${s0.r.worldMm} vs ${expected}`);
    // Identity: README promises "Object, instance, ..."; the agent must be able to tell InstA's copy from InstB's.
    const textA = api.describeResolved(byInstancer.InstA[0].r, "point");
    const textB = api.describeResolved(s0.r, "point");
    assert.ok(textB.includes("InstB") && textA.includes("InstA"), `no instancer in the reference:\n${textB}`);
  });

  it("linked duplicates: same source face and local point, each with its own object and world position", () => {
    const a = samples.special.filter((s) => s.inst.name === "LinkA" && s.kind === "centroid");
    const b = samples.special.filter((s) => s.inst.name === "LinkB" && s.kind === "centroid");
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i += 1) {
      assert.equal(a[i].r.object, "LinkA");
      assert.equal(b[i].r.object, "LinkB");
      assert.equal(a[i].r.face, b[i].r.face);
      assert.equal(a[i].r.mesh, b[i].r.mesh);
      assert.ok(vecClose(a[i].r.localMm, b[i].r.localMm, 1e-3));
      assert.ok(vecClose(b[i].r.worldMm, b[i].truth.world.map((v) => v * 1000), 0.1));
    }
  });

  it("curves and text resolve at object level with correct world coordinates", () => {
    for (const name of ["BezierRing", "Label"]) {
      const s = samples.special.find((x) => x.inst.name === name);
      assert.equal(s.r.object, name);
      assert.equal(s.r.precision, "object");
      assert.equal(s.r.face, null);
      assert.ok(vecClose(s.r.worldMm, s.truth.world.map((v) => v * 1000), 0.1));
      assert.equal(api.describeResolved(s.r, "point").split("\n").pop(), `- bpy: \`bpy.data.objects[${JSON.stringify(name)}]\``);
    }
  });

  it("target 'object': the selector and the bpy line reference the object, not the clicked polygon", () => {
    const s = samples.xform.find((x) => x.inst.name === "Parent" && x.kind === "centroid");
    const text = api.describeResolved(s.r, "object");
    assert.deepEqual(
      { selector: api.selectorOf(s.r, "object"), bpy: text.split("\n").find((l) => l.startsWith("- bpy:")) },
      { selector: "Parent", bpy: '- bpy: `bpy.data.objects["Parent"]`' }
    );
  });

  it("target 'edge' / 'vertex': bpy line indexes the same edge/vertex the selector names", () => {
    for (const s of plainSamples().filter((x) => x.kind === "centroid").slice(0, 40)) {
      const edgeText = api.describeResolved(s.r, "edge");
      assert.ok(api.selectorOf(s.r, "edge").includes(`edge ${s.r.edge.index} @ t=`));
      assert.ok(edgeText.includes(`me.edges[${s.r.edge.index}]`));
      assert.ok(api.describeResolved(s.r, "vertex").includes(`me.vertices[${s.r.vertex.index}]`));
      assert.ok(!/(^|[^\d])-0\.0+(?!\d*[1-9])/.test(edgeText), `negative zero printed:\n${edgeText}`);
    }
  });

  it("snap points land on GLB geometry: vertex snap is a mesh vertex, edge ends are its edge's vertices in Blender order", () => {
    const bad = [];
    for (const s of plainSamples().filter((x) => x.kind === "centroid")) {
      const { r, truth } = s;
      const glbVerts = s.tri.worldGl;
      const all = trianglesOf(readGlbCached(s.scene), s.inst).flatMap((t) => t.worldGl);
      const onVertex = all.some((p) => dist(p, r.snap.vertexPoint) < 1e-4);
      if (!onVertex) bad.push(`${s.inst.name}#${s.k}: vertex snap ${r.snap.vertexPoint} is not a GLB vertex`);
      const e = truth.edges.find((x) => x.index === r.edge.index);
      const t = e ? e.t : 0;
      const along = [0, 1, 2].map((c) => r.snap.edgeEnds[0][c] + (r.snap.edgeEnds[1][c] - r.snap.edgeEnds[0][c]) * t);
      if (dist(along, r.snap.edgePoint) > 1e-4) bad.push(`${s.inst.name}#${s.k}: edgePoint is not at t along edgeEnds[0]→[1]`);
      void glbVerts;
    }
    assert.deepEqual(bad.slice(0, 10), []);
  });

  const glbCache = {};
  function readGlbCached(scene) {
    return (glbCache[scene] ||= readGlb(corpus.exports[scene].glbPath));
  }
});
