/**
 * Independent GLB reader for the QA suite (does not reuse the viewer's parser).
 * Handles interleaved/strided buffer views, TRS and matrix nodes, node
 * hierarchies and every scene in the file.
 */
import { readFileSync } from "node:fs";

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const GETTERS = {
  5120: (v, o) => v.getInt8(o),
  5121: (v, o) => v.getUint8(o),
  5122: (v, o) => v.getInt16(o, true),
  5123: (v, o) => v.getUint16(o, true),
  5125: (v, o) => v.getUint32(o, true),
  5126: (v, o) => v.getFloat32(o, true),
};

export function readGlb(pathOrBuffer) {
  const buffer = typeof pathOrBuffer === "string" ? readFileSync(pathOrBuffer) : pathOrBuffer;
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  const view = bin ? new DataView(bin.buffer, bin.byteOffset, bin.byteLength) : null;
  function accessor(index) {
    const a = json.accessors[index];
    const n = COMPONENTS[a.type];
    const out = new Float64Array(a.count * n);
    if (a.bufferView === undefined) return out;
    const bv = json.bufferViews[a.bufferView];
    const size = TYPES[a.componentType].BYTES_PER_ELEMENT;
    const stride = bv.byteStride || n * size;
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const get = GETTERS[a.componentType];
    for (let i = 0; i < a.count; i += 1) for (let c = 0; c < n; c += 1) out[i * n + c] = get(view, base + i * stride + c * size);
    return out;
  }
  return { json, accessor, buffer };
}

export function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + w * z) * s[0], 2 * (x * z - w * y) * s[0], 0,
    2 * (x * y - w * z) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + w * x) * s[1], 0,
    2 * (x * z + w * y) * s[2], 2 * (y * z - w * x) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
/** Column-major 4x4 product a*b. */
export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
export const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** glTF Y-up -> Blender Z-up, and back. */
export const toZup = (p) => [p[0], -p[2], p[1]];
export const toYup = (p) => [p[0], p[2], -p[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => scale(a, 1 / (len(a) || 1));
export const dist = (a, b) => len(sub(a, b));

/**
 * Every mesh-bearing node instance of one scene (default: the file's default
 * scene) with its world matrix and triangles in both local and world space.
 */
export function meshInstances(glb, sceneIndex) {
  const { json } = glb;
  const si = sceneIndex ?? json.scene ?? 0;
  const scene = json.scenes ? json.scenes[si] : null;
  const roots = scene ? scene.nodes || [] : json.nodes.map((_, i) => i);
  const out = [];
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const local = node.matrix ? node.matrix.slice() : compose(node.translation, node.rotation, node.scale);
    const world = mul(parent, local);
    if (node.mesh !== undefined) out.push({ nodeIndex: index, name: node.name, world, mesh: node.mesh });
    for (const child of node.children || []) visit(child, world);
  };
  for (const r of roots) visit(r, identity());
  return out;
}

/** Triangles of one node instance with ids read at each corner. */
export function trianglesOf(glb, instance) {
  const { json, accessor } = glb;
  const tris = [];
  const mesh = json.meshes[instance.mesh];
  mesh.primitives.forEach((primitive, pi) => {
    if ((primitive.mode ?? 4) !== 4) return;
    const a = primitive.attributes;
    const pos = accessor(a.POSITION);
    const nrm = a.NORMAL !== undefined ? accessor(a.NORMAL) : null;
    const face = a._DSH_FACE !== undefined ? accessor(a._DSH_FACE) : null;
    const src = a._DSH_SRC !== undefined ? accessor(a._DSH_SRC) : null;
    const vert = a._DSH_VERT !== undefined ? accessor(a._DSH_VERT) : null;
    const uv = a.TEXCOORD_0 !== undefined ? accessor(a.TEXCOORD_0) : null;
    const count = pos.length / 3;
    const idx = primitive.indices !== undefined ? accessor(primitive.indices) : Float64Array.from({ length: count }, (_, i) => i);
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const ids = [idx[t], idx[t + 1], idx[t + 2]];
      const localGl = ids.map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      const worldGl = localGl.map((p) => apply(instance.world, p));
      tris.push({
        primitive: pi,
        material: primitive.material,
        indices: ids,
        localGl,
        worldGl,
        faceIds: face ? ids.map((i) => face[i]) : null,
        srcIds: src ? ids.map((i) => src[i]) : null,
        vertIds: vert ? ids.map((i) => vert[i]) : null,
        uvs: uv ? ids.map((i) => [uv[i * 2], uv[i * 2 + 1]]) : null,
        normals: nrm ? ids.map((i) => [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]) : null,
      });
    }
  });
  return tris;
}

export function centroid(points) {
  return scale(points.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / points.length);
}
/** Geometric (winding) normal of a world triangle. */
export function windingNormal(points) {
  return norm(cross(sub(points[1], points[0]), sub(points[2], points[0])));
}
/** Barycentric coordinates of p in triangle abc (p assumed coplanar). */
export function barycentric(p, a, b, c) {
  const v0 = sub(b, a), v1 = sub(c, a), v2 = sub(p, a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}
/** Distance from p to triangle abc (via closest point). */
export function pointTriangleDistance(p, a, b, c) {
  const n = cross(sub(b, a), sub(c, a));
  const nn = len(n);
  if (nn === 0) return Infinity;
  const nu = scale(n, 1 / nn);
  const d = dot(sub(p, a), nu);
  const q = sub(p, scale(nu, d));
  const [u, v, w] = barycentric(q, a, b, c);
  if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) return Math.abs(d);
  const seg = (x, y) => {
    const xy = sub(y, x);
    const tt = Math.max(0, Math.min(1, dot(sub(p, x), xy) / dot(xy, xy)));
    return dist(p, add(x, scale(xy, tt)));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}
