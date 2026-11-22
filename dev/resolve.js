/**
 * Point resolution for dsh-blender-annotate: turn a picked point on the GLB
 * into Blender identities and parameters, using the source geometry the
 * export script writes to `scene.annotate`.
 *
 * Inserted verbatim into lib/client.js by scripts/build-client.mjs (between the
 * markers), and evaluated directly by test/resolve.test.js.
 *
 * Coordinates: the GLB is Y-up (Blender exporter `export_yup`), Blender is
 * Z-up. Blender (x, y, z) == glTF (x, z, -y). Matrices from Blender arrive as
 * row-major 4x4 lists; glTF node matrices are column-major Float32Array(16).
 */
/* @resolve:start — inserted verbatim into lib/client.js by scripts/build-client.mjs */
  function yupToZup(p) { return [p[0], -p[2], p[1]]; }
  function zupToYup(p) { return [p[0], p[2], -p[1]]; }
  function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
  function v3norm(a) { var l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  /** Column-major 4x4 from Blender's row-major nested list. */
  function rowsToColumnMajor(rows) {
    var out = new Array(16);
    for (var r = 0; r < 4; r += 1) for (var c = 0; c < 4; c += 1) out[c * 4 + r] = rows[r][c];
    return out;
  }
  function m4apply(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  }
  function m4applyDir(m, d) {
    return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
  }
  function m4mul(a, b) {
    var out = new Array(16);
    for (var c = 0; c < 4; c += 1) {
      for (var r = 0; r < 4; r += 1) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }
  function m4invert(m) {
    var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    var a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    var b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    var b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    return [
      (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
      (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
      (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
      (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
      (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
      (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
      (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
      (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ];
  }

  /** Closest point on segment ab to p: parameter t in [0,1] and distance. */
  function segmentClosest(p, a, b) {
    var ab = v3sub(b, a);
    var len2 = v3dot(ab, ab);
    var t = len2 > 0 ? Math.min(Math.max(v3dot(v3sub(p, a), ab) / len2, 0), 1) : 0;
    var q = v3add(a, v3scale(ab, t));
    return { t: t, point: q, distance: v3len(v3sub(p, q)) };
  }

  /** In-face parameters of point p (already projected onto the face plane). */
  function faceParameters(points, p, normal) {
    var n = points.length;
    var axisU = v3norm(v3sub(points[1], points[0]));
    var axisV = v3cross(normal, axisU);
    var flat = points.map(function (q) { var d = v3sub(q, points[0]); return [v3dot(d, axisU), v3dot(d, axisV)]; });
    var d = v3sub(p, points[0]);
    var x = [v3dot(d, axisU), v3dot(d, axisV)];
    if (n === 3) {
      var a = flat[0], b = flat[1], c = flat[2];
      var den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      var w0 = ((b[1] - c[1]) * (x[0] - c[0]) + (c[0] - b[0]) * (x[1] - c[1])) / den;
      var w1 = ((c[1] - a[1]) * (x[0] - c[0]) + (a[0] - c[0]) * (x[1] - c[1])) / den;
      return { kind: "barycentric", weights: [w0, w1, 1 - w0 - w1] };
    }
    if (n === 4) {
      // Inverse bilinear by Newton: P(s,t) = (1-s)(1-t)P0 + s(1-t)P1 + s t P2 + (1-s) t P3.
      var s = 0.5, t = 0.5;
      for (var it = 0; it < 24; it += 1) {
        var px = (1 - s) * (1 - t) * flat[0][0] + s * (1 - t) * flat[1][0] + s * t * flat[2][0] + (1 - s) * t * flat[3][0] - x[0];
        var py = (1 - s) * (1 - t) * flat[0][1] + s * (1 - t) * flat[1][1] + s * t * flat[2][1] + (1 - s) * t * flat[3][1] - x[1];
        var dsx = (1 - t) * (flat[1][0] - flat[0][0]) + t * (flat[2][0] - flat[3][0]);
        var dsy = (1 - t) * (flat[1][1] - flat[0][1]) + t * (flat[2][1] - flat[3][1]);
        var dtx = (1 - s) * (flat[3][0] - flat[0][0]) + s * (flat[2][0] - flat[1][0]);
        var dty = (1 - s) * (flat[3][1] - flat[0][1]) + s * (flat[2][1] - flat[1][1]);
        var det = dsx * dty - dsy * dtx;
        if (Math.abs(det) < 1e-14) break;
        var ds = (px * dty - py * dtx) / det;
        var dt = (py * dsx - px * dsy) / det;
        s -= ds; t -= dt;
        if (Math.abs(ds) + Math.abs(dt) < 1e-10) break;
      }
      return { kind: "bilinear", s: s, t: t };
    }
    // Mean value coordinates for n-gons.
    var weights = new Array(n);
    var total = 0;
    for (var i = 0; i < n; i += 1) {
      var prev = flat[(i + n - 1) % n], cur = flat[i], next = flat[(i + 1) % n];
      var r = Math.hypot(cur[0] - x[0], cur[1] - x[1]);
      if (r < 1e-12) { weights.fill(0); weights[i] = 1; return { kind: "mean-value", weights: weights }; }
      var angle = function (q1, q2) {
        var u1 = [q1[0] - x[0], q1[1] - x[1]], u2 = [q2[0] - x[0], q2[1] - x[1]];
        return Math.atan2(u1[0] * u2[1] - u1[1] * u2[0], u1[0] * u2[0] + u1[1] * u2[1]);
      };
      var w = (Math.tan(angle(prev, cur) / 2) + Math.tan(angle(cur, next) / 2)) / r;
      weights[i] = w;
      total += w;
    }
    for (var k = 0; k < n; k += 1) weights[k] = total !== 0 ? weights[k] / total : 1 / n;
    return { kind: "mean-value", weights: weights };
  }

  /** Even-odd point-in-polygon test in 2D. */
  function insidePolygon2D(poly, x) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      var a = poly[i], b = poly[j];
      if ((a[1] > x[1]) !== (b[1] > x[1]) && x[0] < ((b[0] - a[0]) * (x[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  /** Distance from p (already on the face plane) to the face polygon: 0 inside, else to its boundary. */
  function distanceOutsideFace(points, p, normal) {
    var axisU = v3norm(v3sub(points[1], points[0]));
    var axisV = v3cross(normal, axisU);
    var flat = points.map(function (q) { var d = v3sub(q, points[0]); return [v3dot(d, axisU), v3dot(d, axisV)]; });
    var d0 = v3sub(p, points[0]);
    if (insidePolygon2D(flat, [v3dot(d0, axisU), v3dot(d0, axisV)])) return 0;
    var best = Infinity;
    for (var i = 0; i < points.length; i += 1) best = Math.min(best, segmentClosest(p, points[i], points[(i + 1) % points.length]).distance);
    return best;
  }

  /** Apply the inverse-transpose of a column-major 4x4's upper 3x3 to a normal. */
  function normalThrough(matrix, n) {
    var inv = m4invert(matrix);
    if (inv === null) return v3norm(n);
    return v3norm([
      inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2],
      inv[4] * n[0] + inv[5] * n[1] + inv[6] * n[2],
      inv[8] * n[0] + inv[9] * n[1] + inv[10] * n[2],
    ]);
  }
  /** Transpose of a column-major 4x4's upper 3x3 applied to a vector (world normal -> local normal). */
  function transposeApply(m, n) {
    return [m[0] * n[0] + m[1] * n[1] + m[2] * n[2], m[4] * n[0] + m[5] * n[1] + m[6] * n[2], m[8] * n[0] + m[9] * n[1] + m[10] * n[2]];
  }

  /**
   * Build a resolver for one export.
   * @param annotate - scene.annotate from the export script.
   * @param mmPerUnit - scene.unit.millimeters_per_unit.
   */
  function createResolver(annotate, mmPerUnit) {
    var meshes = (annotate && annotate.meshes) || [];
    var objects = (annotate && annotate.objects) || {};
    var collections = (annotate && annotate.collections) || {};
    var unit = typeof mmPerUnit === "number" && mmPerUnit > 0 ? mmPerUnit : 1000;
    var matrices = {};
    function objectMatrix(key) {
      if (!(key in matrices)) matrices[key] = objects[key] ? rowsToColumnMajor(objects[key].matrix_world) : null;
      return matrices[key];
    }
    // glTF node names are Blender object names; keys can differ for clashing linked objects.
    var byName = {};
    var instancersOf = {};
    Object.keys(objects).forEach(function (key) {
      var name = objects[key].name || key;
      (byName[name] = byName[name] || []).push(key);
      var used = objects[key].instance_collection;
      if (used && collections[used]) {
        collections[used].objects.forEach(function (member) {
          (instancersOf[member] = instancersOf[member] || []).push({ key: key, collection: used });
        });
      }
    });

    /**
     * Which object (and which instancer, for collection instances) produced a
     * node. Candidates are matched by origin: the exporter keeps translations
     * exact even where it must drop shear, so a candidate whose origin equals
     * the node's is the producer, and its Blender matrix is exact. When no
     * candidate's origin agrees (e.g. a geometry-nodes instance named after its
     * object), the identity is kept but placement comes from the export.
     */
    function identify(nodeName, local, world, nodeOrigin) {
      var keys = (byName[nodeName] || []).slice();
      if (objects[nodeName] && keys.indexOf(nodeName) < 0) keys.unshift(nodeName);
      var candidates = [];
      keys.forEach(function (key) {
        var own = objectMatrix(key);
        if (own === null) return;
        candidates.push({ key: key, matrix: own, instancer: null, collection: null });
        (instancersOf[key] || []).forEach(function (via) {
          var instancer = objectMatrix(via.key);
          if (instancer === null) return;
          var offset = collections[via.collection].offset || [0, 0, 0];
          var shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -offset[0], -offset[1], -offset[2], 1];
          candidates.push({ key: key, matrix: m4mul(m4mul(instancer, shift), own), instancer: via.key, collection: via.collection });
        });
      });
      if (candidates.length === 0) return null;
      var best = null;
      candidates.forEach(function (c) {
        c.originDistance = nodeOrigin ? v3len(v3sub([c.matrix[12], c.matrix[13], c.matrix[14]], nodeOrigin)) : 0;
        c.pointDistance = v3len(v3sub(m4apply(c.matrix, local), world));
        var tolerance = 1e-4 * (1 + v3len(nodeOrigin || [0, 0, 0]));
        if (best === null) { best = c; return; }
        var sameOrigin = Math.abs(c.originDistance - best.originDistance) <= tolerance;
        if ((!sameOrigin && c.originDistance < best.originDistance) || (sameOrigin && c.pointDistance < best.pointDistance)) best = c;
      });
      best.exact = !nodeOrigin || best.originDistance <= 1e-4 * (1 + v3len(nodeOrigin));
      return best;
    }

    /** Object whose geometry supplied faces of mesh `meshIndex` inside object `key` (Boolean operands). */
    function operandFor(key, meshIndex) {
      var info = objects[key];
      if (info && info.mesh === meshIndex) return key;
      var mods = info ? info.modifiers || [] : [];
      for (var i = 0; i < mods.length; i += 1) {
        var candidates = (mods[i].object ? [mods[i].object] : []).concat(mods[i].collection_objects || []);
        for (var c = 0; c < candidates.length; c += 1) {
          if (objects[candidates[c]] && objects[candidates[c]].mesh === meshIndex) return candidates[c];
        }
      }
      for (var other in objects) if (objects[other].mesh === meshIndex) return other;
      return null;
    }

    function materialOf(ownerKey, mesh, faceIndex) {
      var g = mesh.geometry;
      var slot = g && g.material_index ? g.material_index[faceIndex] : 0;
      var owner = ownerKey !== null ? objects[ownerKey] : null;
      if (owner && owner.material_slots && slot < owner.material_slots.length) return owner.material_slots[slot] || null;
      if (g && g.materials && slot < g.materials.length) return g.materials[slot] || null;
      return null;
    }

    function faceOf(mesh, faceIndex) {
      var g = mesh && mesh.geometry;
      if (!g || faceIndex < 0 || faceIndex >= g.loop_start.length) return null;
      var start = g.loop_start[faceIndex], total = g.loop_total[faceIndex];
      var verts = [], edges = [], points = [];
      for (var k = 0; k < total; k += 1) {
        var v = g.loop_vertex[start + k];
        verts.push(v);
        edges.push(g.loop_edge[start + k]);
        points.push([g.co[v * 3], g.co[v * 3 + 1], g.co[v * 3 + 2]]);
      }
      return { verts: verts, edges: edges, points: points };
    }

    /**
     * Resolve one picked point.
     * @param hit - { nodeName, nodeWorld (glTF column-major), point (glTF world),
     *   normal (glTF world), faceId, srcId, uv } from the viewer.
     */
    function resolve(hit) {
      var nodeName = hit.nodeName || null;
      var nodeInverse = hit.nodeWorld ? m4invert(hit.nodeWorld) : null;
      var localGl = nodeInverse ? m4apply(nodeInverse, hit.point) : hit.point;
      var local = yupToZup(localGl);
      var glbWorld = yupToZup(hit.point);
      var nodeOrigin = hit.nodeWorld ? yupToZup([hit.nodeWorld[12], hit.nodeWorld[13], hit.nodeWorld[14]]) : null;
      var chosen = nodeName !== null ? identify(nodeName, local, glbWorld, nodeOrigin) : null;
      var key = chosen ? chosen.key : nodeName;
      var info = key !== null && objects[key] ? objects[key] : null;
      // A renamed GN instance can rotate/scale about its owner's origin. Equal
      // origins do not imply equal transforms; keep the evaluated placement.
      var generatedInstance = Array.isArray(hit.nodePath) && hit.nodePath.slice(0, -1).indexOf(nodeName) >= 0;
      var exact = chosen !== null && chosen.exact && !generatedInstance;
      var world = exact ? m4apply(chosen.matrix, local) : glbWorld;
      var normal = null;
      if (hit.normal) {
        var localNormal = hit.nodeWorld ? yupToZup(transposeApply(hit.nodeWorld, hit.normal)) : yupToZup(hit.normal);
        normal = exact ? normalThrough(chosen.matrix, localNormal) : v3norm(yupToZup(hit.normal));
      }
      var result = {
        object: info ? info.name || key : nodeName,
        objectKey: key,
        library: info ? info.library : null,
        instancer: exact ? chosen.instancer : null,
        instanceCollection: exact && chosen.collection ? (collections[chosen.collection].name || chosen.collection) : null,
        objectType: info ? info.type : null,
        data: info ? info.data : null,
        collections: info ? info.collections : [],
        parent: info ? info.parent : null,
        modifiers: info ? (info.modifiers || []).map(function (m) { return m.type + (m.object ? "(" + m.object + ")" : m.collection ? "(" + m.collection + ")" : ""); }) : [],
        custom: info ? info.custom : {},
        worldMm: v3scale(world, unit),
        localMm: v3scale(local, unit),
        normal: normal,
        uv: hit.uv || null,
        evaluated: {
          nodeIndex: Number.isInteger(hit.nodeIndex) ? hit.nodeIndex : null,
          nodePath: Array.isArray(hit.nodePath) ? hit.nodePath.slice() : (nodeName ? [nodeName] : []),
          meshPrimitive: Number.isInteger(hit.meshPrimitive) ? hit.meshPrimitive : null,
          triangle: Number.isInteger(hit.triangle) ? hit.triangle : null,
          barycentric: Array.isArray(hit.barycentric) ? hit.barycentric.slice() : null,
          gltfWorld: hit.point.slice(),
        },
        mesh: null,
        face: null,
        faceSides: null,
        material: null,
        params: null,
        offsetMm: null,
        precision: "object",
        edge: null,
        vertex: null,
        sourceObject: null,
        snap: null,
      };
      // Never trust pre-existing attributes exported from read-only library
      // data: they may refer to a different export's mesh table.
      if (info && info.mesh >= 0 && meshes[info.mesh] && !meshes[info.mesh].tagged) return result;
      var meshIndex = hit.srcId > 0 ? hit.srcId - 1 : -1;
      var faceIndex = hit.faceId > 0 ? hit.faceId - 1 : -1;
      if (meshIndex < 0 || meshIndex >= meshes.length || faceIndex < 0) return result;
      var mesh = meshes[meshIndex];
      if (!mesh.tagged || faceIndex >= mesh.faces) return result;
      result.mesh = mesh.name;
      result.face = faceIndex;
      result.precision = "face";
      var operand = key !== null ? operandFor(key, meshIndex) : null;
      result.sourceObject = operand !== null && objects[operand] ? objects[operand].name || operand : null;
      result.sourceObjectKey = operand;
      result.sourceLibrary = operand !== null && objects[operand] ? objects[operand].library : null;
      result.material = materialOf(operand, mesh, faceIndex);
      var face = faceOf(mesh, faceIndex);
      if (face === null) return result;
      result.faceSides = face.points.length;

      // Source-mesh coordinates of the point (a Boolean operand lives in its own space).
      var toLocal = null;
      if (operand !== null && operand !== key) {
        var own = objectMatrix(key), other = objectMatrix(operand);
        var ownInverse = own ? m4invert(own) : null;
        if (ownInverse !== null && other !== null) toLocal = m4mul(ownInverse, other);
      }
      var fromLocal = toLocal ? m4invert(toLocal) : null;
      var p = fromLocal ? m4apply(fromLocal, local) : local;

      var centroid = [0, 0, 0];
      var faceNormal = [0, 0, 0];
      for (var i = 0; i < face.points.length; i += 1) {
        var a = face.points[i], b = face.points[(i + 1) % face.points.length];
        centroid = v3add(centroid, a);
        faceNormal = [faceNormal[0] + (a[1] - b[1]) * (a[2] + b[2]), faceNormal[1] + (a[2] - b[2]) * (a[0] + b[0]), faceNormal[2] + (a[0] - b[0]) * (a[1] + b[1])];
      }
      centroid = v3scale(centroid, 1 / face.points.length);
      faceNormal = v3norm(faceNormal);
      var offset = v3dot(v3sub(p, centroid), faceNormal);
      var projected = v3sub(p, v3scale(faceNormal, offset));
      var size = 0;
      for (var j = 0; j < face.points.length; j += 1) size = Math.max(size, v3len(v3sub(face.points[j], centroid)));
      result.offsetMm = offset * unit;
      result.params = faceParameters(face.points, projected, faceNormal);
      // Distance from the source face itself (not just its plane): Mirror/Array copies are coplanar but elsewhere.
      var away = Math.hypot(offset, distanceOutsideFace(face.points, projected, faceNormal));
      var ratio = size > 0 ? away / size : 0;
      result.precision = ratio < 0.02 ? "exact" : ratio <= 1 ? "modified-surface" : "modifier-copy";

      var g = mesh.geometry;
      var bestEdge = null;
      for (var e = 0; e < face.points.length; e += 1) {
        var edgeIndex = face.edges[e];
        var ea = face.points[e], eb = face.points[(e + 1) % face.points.length];
        var near = segmentClosest(p, ea, eb);
        if (bestEdge === null || near.distance < bestEdge.distance) {
          var forward = g.edge_vertices[edgeIndex * 2] === face.verts[e];
          bestEdge = {
            index: edgeIndex,
            vertices: [g.edge_vertices[edgeIndex * 2], g.edge_vertices[edgeIndex * 2 + 1]],
            t: forward ? near.t : 1 - near.t,
            distance: near.distance,
            sourcePoint: near.point,
            sourceEnds: forward ? [ea, eb] : [eb, ea],
          };
        }
      }
      var bestVertex = null;
      for (var v = 0; v < face.points.length; v += 1) {
        var dv = v3len(v3sub(p, face.points[v]));
        if (bestVertex === null || dv < bestVertex.distance) bestVertex = { index: face.verts[v], distance: dv, sourcePoint: face.points[v] };
      }
      result.edge = { index: bestEdge.index, vertices: bestEdge.vertices, t: bestEdge.t, distanceMm: bestEdge.distance * unit };
      result.vertex = { index: bestVertex.index, distanceMm: bestVertex.distance * unit };

      // glTF-world positions for snapping pins and drawing highlights.
      var toWorld = function (q) {
        var inLocal = toLocal ? m4apply(toLocal, q) : q;
        var gl = zupToYup(inLocal);
        return hit.nodeWorld ? m4apply(hit.nodeWorld, gl) : gl;
      };
      result.snap = {
        edgePoint: toWorld(bestEdge.sourcePoint),
        edgeEnds: [toWorld(bestEdge.sourceEnds[0]), toWorld(bestEdge.sourceEnds[1])],
        vertexPoint: toWorld(bestVertex.sourcePoint),
        faceOutline: face.points.map(toWorld),
      };
      return result;
    }

    return { resolve: resolve };
  }

  function fmt(value, digits) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    var d = digits === undefined ? 2 : digits;
    var text = value.toFixed(d);
    return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
  }
  function fmtVec(v, digits) { return v ? "(" + v.map(function (x) { return fmt(x, digits); }).join(", ") + ")" : "—"; }

  /** Python expression reaching an object (tuple key for linked-library objects). */
  function bpyObject(name, library) {
    return library ? "bpy.data.objects[(" + JSON.stringify(name) + ", " + JSON.stringify(library) + ")]" : "bpy.data.objects[" + JSON.stringify(name) + "]";
  }

  /** Short human selector, like a CSS selector for a point on the model. */
  function selectorOf(r, target) {
    var parts = [];
    if (r.instancer) parts.push(r.instancer);
    parts.push(r.object || "(unnamed)");
    if (target === "object") return parts.join(" › ");
    if (r.face !== null) {
      var face = "face " + r.face + (r.faceSides ? " (" + (r.faceSides === 3 ? "tri" : r.faceSides === 4 ? "quad" : r.faceSides + "-gon") + ")" : "");
      if (r.sourceObject && r.sourceObject !== r.object) face += " from " + r.sourceObject;
      parts.push(face);
    }
    if (target === "edge" && r.edge) parts.push("edge " + r.edge.index + " @ t=" + fmt(r.edge.t, 3));
    else if (target === "vertex" && r.vertex) parts.push("vertex " + r.vertex.index);
    else if (target !== "face" && r.params) {
      if (r.params.kind === "bilinear") parts.push("s=" + fmt(r.params.s, 3) + " t=" + fmt(r.params.t, 3));
      else parts.push("w=" + fmtVec(r.params.weights, 3));
    }
    return parts.join(" › ");
  }

  /** Full reference block for the agent: identity, parameters, coordinates, bpy access. */
  function describeResolved(r, target) {
    var lines = [];
    lines.push("- selector: `" + selectorOf(r, target) + "`");
    lines.push("- target: " + target + " · precision: " + r.precision);
    var ident = "object `" + r.object + "`";
    if (r.data) ident += " · data `" + r.data + "`";
    if (r.collections && r.collections.length) ident += " · collection `" + r.collections.join("`, `") + "`";
    if (r.parent) ident += " · parent `" + r.parent + "`";
    if (r.library) ident += " · linked from `" + r.library + "`";
    lines.push("- " + ident);
    if (r.instancer) lines.push("- instance: copy of collection `" + r.instanceCollection + "` placed by instancer `" + r.instancer + "`");
    if (r.evaluated && r.evaluated.triangle !== null) {
      lines.push("- evaluated surface: node " + r.evaluated.nodeIndex + " (`" + r.evaluated.nodePath.join(" › ") + "`), primitive " + r.evaluated.meshPrimitive + ", triangle " + r.evaluated.triangle + ", barycentric " + fmtVec(r.evaluated.barycentric, 8));
    }
    if (r.modifiers && r.modifiers.length) lines.push("- modifiers: " + r.modifiers.join(" → "));
    if (r.custom && Object.keys(r.custom).length) lines.push("- custom properties: `" + JSON.stringify(r.custom) + "`");
    if (r.face !== null) {
      var faceLine = "- " + (target === "object" ? "clicked " : "") + "face " + r.face + " of mesh `" + r.mesh + "`" + (r.faceSides ? " (" + r.faceSides + " sides)" : "");
      if (r.sourceObject && r.sourceObject !== r.object) faceLine += " — surface created by `" + r.sourceObject + "`";
      if (r.material) faceLine += " · material `" + r.material + "`";
      lines.push(faceLine);
    }
    if (r.params && target !== "object") {
      if (r.params.kind === "bilinear") lines.push("- in-face parameters (bilinear): s=" + fmt(r.params.s, 4) + ", t=" + fmt(r.params.t, 4));
      else lines.push("- in-face parameters (" + r.params.kind + "): " + fmtVec(r.params.weights, 4));
      lines.push("- distance from source face plane: " + fmt(r.offsetMm) + " mm");
    }
    if (r.edge && target !== "object") lines.push("- nearest edge " + r.edge.index + " (vertices " + r.edge.vertices.join("–") + ") at t=" + fmt(r.edge.t, 4) + ", " + fmt(r.edge.distanceMm) + " mm away");
    if (r.vertex && target !== "object") lines.push("- nearest vertex " + r.vertex.index + ", " + fmt(r.vertex.distanceMm) + " mm away");
    lines.push("- point: local " + fmtVec(r.localMm) + " mm · world " + fmtVec(r.worldMm) + " mm");
    if (r.normal) lines.push("- normal (world): " + fmtVec(r.normal, 3));
    if (r.uv) lines.push("- uv: " + fmtVec(r.uv, 4));
    if (r.face !== null && target !== "object") {
      var fromOperand = r.sourceObject && r.sourceObject !== r.object;
      var code = "me = " + bpyObject(fromOperand ? r.sourceObject : r.object, fromOperand ? r.sourceLibrary : r.library) + ".data; me.polygons[" + r.face + "]";
      if (r.edge && target === "edge") code += "; me.edges[" + r.edge.index + "]";
      if (r.vertex && target === "vertex") code += "; me.vertices[" + r.vertex.index + "]";
      lines.push("- bpy: `" + code + "`");
    } else if (r.object) {
      lines.push("- bpy: `" + bpyObject(r.object, r.library) + "`");
    }
    return lines.join("\n");
  }
/* @resolve:end */
