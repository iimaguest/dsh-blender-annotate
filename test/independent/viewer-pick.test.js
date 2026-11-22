/**
 * Independent QA: the shipped viewer (lib/client.js -> __createViewer) without a
 * GPU. WebGL and the canvas are stubbed; the expected screen positions and ray
 * hits come from an independent pinhole camera and an independent float64
 * ray caster over the GLB parsed by helpers/glb.mjs; UVs come from Blender.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SKIP_NO_BLENDER, oracle, prepareCorpus, removeDir } from "./helpers/blender.mjs";
import { add, centroid, cross, dist, dot, len, meshInstances, norm, readGlb, scale, sub, toYup, toZup, trianglesOf, windingNormal } from "./helpers/glb.mjs";
import { arrayBufferOf, canvasStub, loadResolver, loadShippedViewer } from "./helpers/blocks.mjs";

const FOV = (38 * Math.PI) / 180;

/** Independent camera from the viewer's public view state. */
function cameraOf(view, canvas, rect) {
  const cp = Math.cos(view.pitch);
  const eye = [view.target[0] + view.distance * cp * Math.sin(view.yaw), view.target[1] + view.distance * Math.sin(view.pitch), view.target[2] + view.distance * cp * Math.cos(view.yaw)];
  const f = norm(sub(view.target, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const aspect = canvas.width / canvas.height;
  const tanHalf = Math.tan(FOV / 2);
  return {
    eye,
    project(p) {
      const d = sub(p, eye);
      const z = dot(d, f);
      return { x: ((dot(d, r) / z / (tanHalf * aspect) + 1) / 2) * rect.width, y: ((1 - dot(d, u) / z / tanHalf) / 2) * rect.height, z };
    },
  };
}

/** Float64 Möller–Trumbore over every triangle; returns the first hit with margins. */
function castRay(triangles, origin, direction) {
  let best = null;
  for (const tri of triangles) {
    const [a, b, c] = tri.worldGl;
    const e1 = sub(b, a), e2 = sub(c, a);
    const p = cross(direction, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-14) continue;
    const s = sub(origin, a);
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(direction, q) / det;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) / det;
    if (t <= 1e-9) continue;
    if (best === null || t < best.t) best = { t, tri, u, v, margin: Math.min(u, v, 1 - u - v) };
  }
  return best;
}

describe("shipped viewer: project / pick / isUnoccluded / trianglesOf / click", { skip: SKIP_NO_BLENDER }, () => {
  let corpus;
  let glb;
  let all;
  let shipped;
  let viewer;
  let canvas;
  const rect = { left: 37, top: 53, width: 640, height: 480 };
  let bil;
  let info;

  before(async () => {
    corpus = await prepareCorpus("viewer", ["xform", "special"]);
    info = corpus.exports.xform.info;
    glb = readGlb(corpus.exports.xform.glbPath);
    all = meshInstances(glb).flatMap((inst) => trianglesOf(glb, inst).map((tri) => ({ ...tri, inst })));
    const answer = await oracle(corpus.blends.xform, { bilinear: { objects: ["UVPlane", "Parent", "Negative"], st: [[0.25, 0.25], [0.7, 0.3], [0.4, 0.85]] } }, corpus.dir);
    bil = answer.bilinear;
    shipped = loadShippedViewer({ dpr: 2 });
    canvas = canvasStub({ ...rect });
    viewer = shipped.createViewer(canvas, {});
    viewer.setModel(arrayBufferOf(readFileSync(corpus.exports.xform.glbPath)));
    shipped.flush();
  });
  after(() => {
    viewer?.dispose();
    removeDir(corpus?.dir);
  });

  const VIEWS = [null, { yaw: 2.4, pitch: -0.4 }, { yaw: -1.1, pitch: 1.2 }, { yaw: 3.9, pitch: 0.15 }];
  function withView(v, fn) {
    const base = viewer.getView();
    if (v) viewer.setView({ ...base, yaw: v.yaw, pitch: v.pitch });
    shipped.flush();
    try {
      fn(cameraOf(viewer.getView(), canvas, rect));
    } finally {
      viewer.setView(base);
      shipped.flush();
    }
  }

  it("canvas backing store follows devicePixelRatio (CSS 640x480 -> 1280x960)", () => {
    assert.equal(canvas.width, 1280);
    assert.equal(canvas.height, 960);
  });

  it("project() agrees with an independent pinhole camera built from getView()", () => {
    for (const v of VIEWS) withView(v, (cam) => {
      for (const tri of all.slice(0, 60)) {
        const p = centroid(tri.worldGl);
        const mine = cam.project(p);
        const got = viewer.project(p);
        assert.equal(got.visible, mine.z > 0);
        assert.ok(Math.abs(got.x - mine.x) < 0.02 && Math.abs(got.y - mine.y) < 0.02, `${JSON.stringify(got)} vs ${JSON.stringify(mine)}`);
      }
    });
  });

  it("pick() at the projected centroid of triangles returns the first surface hit: point, node, faceId, srcId, vertIds, unit normal of the hit triangle", () => {
    let checked = 0;
    const bad = [];
    for (const v of VIEWS) withView(v, (cam) => {
      for (const tri of all) {
        const c = centroid(tri.worldGl);
        const sp = cam.project(c);
        if (sp.z <= 0 || sp.x < 1 || sp.y < 1 || sp.x > rect.width - 1 || sp.y > rect.height - 1) continue;
        const direction = norm(sub(c, cam.eye));
        const truth = castRay(all, cam.eye, direction);
        if (!truth || truth.margin < 1e-3) continue; // avoid grazing edges
        const hit = viewer.pick(rect.left + sp.x, rect.top + sp.y);
        checked += 1;
        const tag = `view ${JSON.stringify(v)} tri of ${tri.inst.name}`;
        if (hit === null) { bad.push(`${tag}: pick returned null`); continue; }
        const expectedPoint = add(cam.eye, scale(direction, truth.t));
        if (dist(hit.point, expectedPoint) > 1e-4 * truth.t) bad.push(`${tag}: point off by ${dist(hit.point, expectedPoint)}`);
        if (hit.nodeName !== truth.tri.inst.name || hit.nodeIndex !== truth.tri.inst.nodeIndex) bad.push(`${tag}: node ${hit.nodeName} vs ${truth.tri.inst.name}`);
        if (hit.faceId !== truth.tri.faceIds[0] || hit.srcId !== truth.tri.srcIds[0]) bad.push(`${tag}: ids ${hit.faceId}/${hit.srcId} vs ${truth.tri.faceIds[0]}/${truth.tri.srcIds[0]}`);
        if (JSON.stringify(hit.vertIds) !== JSON.stringify(truth.tri.vertIds)) bad.push(`${tag}: vertIds ${hit.vertIds} vs ${truth.tri.vertIds}`);
        const wn = windingNormal(truth.tri.worldGl);
        if (!(Math.abs(dot(hit.normal, wn)) > 0.9999)) bad.push(`${tag}: normal not perpendicular to the hit triangle`);
        if (Math.abs(len(hit.normal) - 1) > 1e-9) bad.push(`${tag}: normal not unit`);
        assert.equal(hit.nodeWorld.length, 16);
      }
    });
    assert.ok(checked > 80, `checked ${checked}`);
    assert.deepEqual(bad.slice(0, 12), [], `${bad.length} problems`);
  });

  it("pick() over empty background returns null", () => {
    withView(null, (cam) => {
      let found = 0;
      for (let x = 2; x < rect.width && found < 5; x += 37) {
        for (let y = 2; y < rect.height && found < 5; y += 41) {
          // Independent check that nothing is under this pixel.
          const ndcX = (x / rect.width) * 2 - 1, ndcY = 1 - (y / rect.height) * 2;
          const view = viewer.getView();
          const f = norm(sub(view.target, cam.eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
          const t = Math.tan(FOV / 2);
          const d = norm(add(f, add(scale(r, ndcX * t * (canvas.width / canvas.height)), scale(u, ndcY * t))));
          if (castRay(all, cam.eye, d) !== null) continue;
          found += 1;
          assert.equal(viewer.pick(rect.left + x, rect.top + y), null, `background pixel ${x},${y}`);
        }
      }
      assert.ok(found >= 3);
    });
  });

  it("picked UV equals Blender's UV at that point (glTF V flip undone)", () => {
    const bad = [];
    let checked = 0;
    for (const v of VIEWS) withView(v, (cam) => {
      for (const b of bil) {
        const p = toYup(b.world);
        const sp = cam.project(p);
        const truth = castRay(all, cam.eye, norm(sub(p, cam.eye)));
        if (!truth || truth.tri.inst.name !== b.object || truth.tri.faceIds[0] !== b.face + 1 || dist(add(cam.eye, scale(norm(sub(p, cam.eye)), truth.t)), p) > 1e-4) continue;
        const hit = viewer.pick(rect.left + sp.x, rect.top + sp.y);
        checked += 1;
        if (!hit || !hit.uv || Math.abs(hit.uv[0] - b.uv[0]) > 1e-4 || Math.abs(hit.uv[1] - b.uv[1]) > 1e-4) bad.push(`${b.object} face ${b.face} (${b.s},${b.t}): uv ${hit && hit.uv} vs Blender ${b.uv}`);
      }
    });
    assert.ok(checked >= 6, `checked ${checked}`);
    assert.deepEqual(bad, []);
  });

  it("end to end: resolve(pick()) at Blender points of known bilinear (s,t) recovers face and (s,t)", () => {
    const resolver = loadResolver().createResolver(info.annotate, info.unit.millimeters_per_unit);
    const bad = [];
    let checked = 0;
    for (const v of VIEWS) withView(v, (cam) => {
      for (const b of bil) {
        const p = toYup(b.world);
        const sp = cam.project(p);
        const truth = castRay(all, cam.eye, norm(sub(p, cam.eye)));
        if (!truth || truth.tri.inst.name !== b.object || dist(add(cam.eye, scale(norm(sub(p, cam.eye)), truth.t)), p) > 1e-4) continue;
        const r = resolver.resolve(viewer.pick(rect.left + sp.x, rect.top + sp.y));
        checked += 1;
        if (r.object !== b.object || r.face !== b.face || Math.abs(r.params.s - b.s) > 1e-3 || Math.abs(r.params.t - b.t) > 1e-3) {
          bad.push(`${b.object} face ${b.face} (${b.s},${b.t}) -> ${r.object} face ${r.face} (${r.params && r.params.s},${r.params && r.params.t})`);
        }
        const mm = info.unit.millimeters_per_unit;
        if (dist(r.worldMm, b.world.map((x) => x * mm)) > 0.5) bad.push(`${b.object}: worldMm ${r.worldMm} vs ${b.world.map((x) => x * mm)}`);
      }
    });
    assert.ok(checked >= 6, `checked ${checked}`);
    assert.deepEqual(bad, []);
  });

  it("isUnoccluded(): true for the first surface along the ray, false for any point hidden behind another surface", () => {
    // Independent expectation: a pin is hidden as soon as a surface lies in front of it by more than
    // numerical noise. Gaps below 0.2% of the scene radius are skipped as too close to call.
    const pts = all.flatMap((t) => t.worldGl);
    const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
    const radius = dist(lo, hi) / 2;
    const wrong = [];
    let front = 0, hidden = 0;
    for (const v of VIEWS) withView(v, (cam) => {
      for (const tri of all) {
        const c = centroid(tri.worldGl);
        const truth = castRay(all, cam.eye, norm(sub(c, cam.eye)));
        if (!truth || truth.margin < 1e-3 || cam.project(c).z <= 0) continue;
        const gap = dist(c, cam.eye) - truth.t;
        if (truth.tri === tri || Math.abs(gap) < 1e-6) {
          front += 1;
          if (viewer.isUnoccluded(c) !== true) wrong.push(`front centroid of ${tri.inst.name} reported hidden`);
        } else if (gap > radius * 0.002) {
          hidden += 1;
          if (viewer.isUnoccluded(c) !== false) wrong.push(`${tri.inst.name} centroid ${gap.toFixed(3)} behind ${truth.tri.inst.name} (${(100 * gap / radius).toFixed(2)}% of radius) reported visible`);
        }
      }
    });
    assert.ok(front > 30 && hidden > 30, `front ${front} hidden ${hidden}`);
    assert.deepEqual(wrong.slice(0, 8), [], `${wrong.length} wrong of ${front + hidden}`);
  });

  it("end to end: resolve(pick()).normal is Blender's world-space face normal for every pick", async () => {
    const resolver = loadResolver().createResolver(info.annotate, info.unit.millimeters_per_unit);
    const picks = [];
    for (const v of VIEWS) withView(v, (cam) => {
      for (const tri of all) {
        const c = centroid(tri.worldGl);
        const sp = cam.project(c);
        if (sp.z <= 0 || sp.x < 1 || sp.y < 1 || sp.x > rect.width - 1 || sp.y > rect.height - 1) continue;
        const truth = castRay(all, cam.eye, norm(sub(c, cam.eye)));
        if (!truth || truth.margin < 1e-3 || truth.tri !== tri) continue;
        const hit = viewer.pick(rect.left + sp.x, rect.top + sp.y);
        if (!hit) continue;
        const r = resolver.resolve(hit);
        picks.push({ view: v, name: tri.inst.name, r, local: r.localMm.map((x) => x / info.unit.millimeters_per_unit) });
      }
    });
    const answer = await oracle(corpus.blends.xform, { points: picks.map((p, i) => ({ id: i, object: p.name, local: p.local, face: p.r.face, mesh: p.r.mesh })) }, corpus.dir);
    const wrong = [];
    picks.forEach((p, i) => {
      const n = answer.points[i].world_normal;
      if (!n || p.name === "ChildKeep") return; // ChildKeep's transform is covered by resolve-groundtruth
      const d = dot(p.r.normal, n);
      if (!(d > 0.9999)) wrong.push(`${p.name} face ${p.r.face} view ${JSON.stringify(p.view)}: reported ${p.r.normal.map((x) => x.toFixed(3))}, Blender ${n.map((x) => x.toFixed(3))}`);
    });
    assert.ok(picks.length > 60, `picks ${picks.length}`);
    assert.deepEqual([...new Set(wrong)].slice(0, 8), [], `${wrong.length} of ${picks.length} picks report a normal opposite to Blender's face normal`);
  });

  it("trianglesOf(node, srcId, faceId) returns exactly the triangles carrying those ids; faceId null returns the whole node", () => {
    for (const inst of meshInstances(glb)) {
      const tris = trianglesOf(glb, inst);
      const faces = [...new Set(tris.map((t) => t.faceIds[0]))];
      for (const face of faces) {
        const mine = tris.filter((t) => t.faceIds[0] === face);
        const got = viewer.trianglesOf(inst.nodeIndex, mine[0].srcIds[0], face);
        assert.equal(got.length, mine.length * 9, `${inst.name} face ${face}`);
        const pts = mine.flatMap((t) => t.worldGl);
        for (let i = 0; i < got.length; i += 3) assert.ok(pts.some((p) => dist(p, [got[i], got[i + 1], got[i + 2]]) < 1e-4));
      }
      assert.equal(viewer.trianglesOf(inst.nodeIndex, 0, null).length, tris.length * 9);
      assert.equal(viewer.trianglesOf(inst.nodeIndex, tris[0].srcIds[0] + 1, tris[0].faceIds[0]).length, 0, "srcId must match too");
    }
  });

  describe("click vs drag", () => {
    function harness() {
      const clicks = [];
      const c = canvasStub({ ...rect });
      const v = shipped.createViewer(c, { onClick: (x, y) => clicks.push([x, y]) });
      return { c, v, clicks };
    }

    it("press + release without movement fires onClick once with the release position", () => {
      const { c, v, clicks } = harness();
      c.dispatch("pointerdown", { clientX: 100, clientY: 120 });
      c.dispatch("pointerup", { clientX: 100, clientY: 120 });
      assert.deepEqual(clicks, [[100, 120]]);
      v.dispose();
    });

    it("jitter of up to 4px still counts as a click; a drag beyond 4px orbits instead and fires nothing", () => {
      const { c, v, clicks } = harness();
      c.dispatch("pointerdown", { clientX: 100, clientY: 100 });
      c.dispatch("pointermove", { clientX: 102, clientY: 101 });
      c.dispatch("pointermove", { clientX: 101, clientY: 101 });
      c.dispatch("pointerup", { clientX: 101, clientY: 101 });
      assert.equal(clicks.length, 1);
      const yaw = v.getView().yaw;
      c.dispatch("pointerdown", { clientX: 100, clientY: 100 });
      c.dispatch("pointermove", { clientX: 110, clientY: 100 });
      c.dispatch("pointerup", { clientX: 110, clientY: 100 });
      assert.equal(clicks.length, 1, "drag must not click");
      assert.notEqual(v.getView().yaw, yaw, "drag orbits");
      v.dispose();
    });

    it("right/middle button releases never fire onClick", () => {
      const { c, v, clicks } = harness();
      for (const button of [1, 2]) {
        c.dispatch("pointerdown", { clientX: 50, clientY: 50, button });
        c.dispatch("pointerup", { clientX: 50, clientY: 50, button });
      }
      assert.deepEqual(clicks, []);
      v.dispose();
    });

    it("a pointer release from a different pointer id does not fire the click", () => {
      const { c, v, clicks } = harness();
      c.dispatch("pointerdown", { clientX: 50, clientY: 50, pointerId: 7 });
      c.dispatch("pointerup", { clientX: 50, clientY: 50, pointerId: 8 });
      assert.deepEqual(clicks, []);
      v.dispose();
    });

    it("pointercancel (browser took over the gesture) does not fire onClick", () => {
      const { c, v, clicks } = harness();
      c.dispatch("pointerdown", { clientX: 60, clientY: 70 });
      c.dispatch("pointercancel", { clientX: 60, clientY: 70 });
      assert.deepEqual(clicks, [], "a cancelled pointer is not a click");
      v.dispose();
    });
  });

  it("drawn geometry reflects the active shape-key mix (glTF morph targets with default weights)", () => {
    const sg = readGlb(corpus.exports.special.glbPath);
    const inst = meshInstances(sg).find((i) => i.name === "ShapeKeyed");
    const mesh = sg.json.meshes[inst.mesh];
    assert.ok(mesh.primitives[0].targets && mesh.weights && mesh.weights[0] === 1, "exporter wrote the shape key as a morph target with weight 1");
    const top = trianglesOf(sg, inst).find((t) => t.localGl.every((p) => Math.abs(toZup(p)[2] - 1) < 1e-6));
    const c2 = canvasStub({ ...rect });
    const v2 = shipped.createViewer(c2, {});
    v2.setModel(arrayBufferOf(readFileSync(corpus.exports.special.glbPath)));
    const drawn = v2.trianglesOf(inst.nodeIndex, top.srcIds[0], top.faceIds[0]);
    v2.dispose();
    // Blender (shape key "Lift" at 1.0) shows the top face at z = 2; glTF Y-up => y = 2.
    const ys = [];
    for (let i = 1; i < drawn.length; i += 3) ys.push(Math.round(drawn[i] * 1000) / 1000);
    assert.deepEqual([...new Set(ys)], [2], "top face is drawn where Blender shows it");
  });
});
