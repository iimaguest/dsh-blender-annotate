/**
 * Minimal dependency-free glTF 2.0 (GLB) viewer used by dsh-blender-annotate.
 *
 * This file is the standalone development copy of the renderer that also lives
 * inside lib/client.js (the DSH client bundle is a single CJS factory, so it
 * cannot import a sibling module). Keep the two in sync; dev/viewer.html loads
 * this one against a real GLB for visual iteration.
 *
 * Scope: the subset Blender's glTF exporter produces for still scenes 鈥? * POSITION + NORMAL attributes, indexed triangles, PBR metallic-roughness
 * factors, node TRS/matrix transforms. No textures, skinning, or animation.
 */
/* @viewer:start 鈥?inserted verbatim into lib/client.js by scripts/build-client.mjs */
  var DEFAULTS = {
    backgroundTop: [0.16, 0.2, 0.27],
    backgroundBottom: [0.04, 0.055, 0.08],
    fieldOfView: (38 * Math.PI) / 180,
    minDistanceFactor: 0.12,
    maxDistanceFactor: 24,
  };

  function createViewer(canvas, options) {
    var settings = Object.assign({}, DEFAULTS, options || {});
    var gl =
      canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true }) ||
      canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (gl === null) throw new Error("WebGL is not available in this browser.");

    var modelProgram = buildProgram(gl, MODEL_VERTEX, MODEL_FRAGMENT);
    var lineProgram = buildProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
    var shadowProgram = buildProgram(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
    var shadowUniforms = uniformsOf(gl, shadowProgram, ["uViewProj", "uCenter", "uExtent", "uOpacity"]);
    var shadowQuad = createShadowQuad();
    var modelUniforms = uniformsOf(gl, modelProgram, [
      "uViewProj",
      "uView",
      "uViewRot",
      "uCamera",
      "uBaseColor",
      "uRoughness",
      "uMetallic",
      "uWireframe",
      "uExposure",
    ]);
    var lineUniforms = uniformsOf(gl, lineProgram, ["uViewProj", "uOpacity"]);

    var primitives = [];
    var bbox = null;
    // dsh-blender-annotate: highlight overlay (glTF world positions) and view callbacks.
    var overlay = { faces: null, lines: null, faceColor: [1, 0.72, 0.18, 0.38], lineColor: [1, 0.85, 0.3, 1] };
    var onView = typeof settings.onView === "function" ? settings.onView : null;
    var onClick = typeof settings.onClick === "function" ? settings.onClick : null;
    var grid = null;
    var axes = createAxes();
    var modelLocations = {
      position: gl.getAttribLocation(modelProgram, "aPosition"),
      normal: gl.getAttribLocation(modelProgram, "aNormal"),
    };
    var lineLocations = {
      position: gl.getAttribLocation(lineProgram, "aPosition"),
      color: gl.getAttribLocation(lineProgram, "aColor"),
    };

    var state = {
      yaw: 0.72,
      pitch: 0.62,
      distance: 1,
      target: [0, 0, 0],
      radius: 1,
      wireframe: false,
      autoRotate: false,
      exposure: 1,
    };
    var camera = { eye: [0, 0, 1], up: [0, 1, 0] };
    var view = new Float32Array(16);
    var projection = new Float32Array(16);
    var viewProjection = new Float32Array(16);
    var viewRotation = new Float32Array(9);

    var dirty = true;
    var frame = 0;
    var lastTime = 0;
    var disposed = false;

    function render(time) {
      if (disposed) return;
      if (dirty || state.autoRotate) draw(time);
      dirty = false;
      frame = requestAnimationFrame(render);
    }

    function draw(time) {
      var now = typeof time === "number" ? time : performance.now();
      var dt = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      if (state.autoRotate) {
        state.yaw += dt * 0.55;
        dirty = true;
      }

      var width = canvas.width;
      var height = canvas.height;
      if (width === 0 || height === 0) return;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);

      var cosPitch = Math.cos(state.pitch);
      camera.eye = [
        state.target[0] + state.distance * cosPitch * Math.sin(state.yaw),
        state.target[1] + state.distance * Math.sin(state.pitch),
        state.target[2] + state.distance * cosPitch * Math.cos(state.yaw),
      ];
      var near = Math.max(state.distance - state.radius * 4, state.radius * 0.001);
      var far = state.distance + state.radius * 8;
      mat4Perspective(projection, settings.fieldOfView, width / height, near, far);
      mat4LookAt(view, camera.eye, state.target, camera.up);
      mat4Multiply(viewProjection, projection, view);
      rotationOf(view, viewRotation);

      drawShadow();

      gl.disable(gl.BLEND);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);

      gl.useProgram(modelProgram);
      gl.uniformMatrix4fv(modelUniforms.uViewProj, false, viewProjection);
      gl.uniformMatrix4fv(modelUniforms.uView, false, view);
      gl.uniformMatrix3fv(modelUniforms.uViewRot, false, viewRotation);
      gl.uniform3fv(modelUniforms.uCamera, camera.eye);
      gl.uniform1f(modelUniforms.uExposure, state.exposure);

      for (var index = 0; index < primitives.length; index += 1) {
        var primitive = primitives[index];
        if (!state.wireframe) {
          bindPrimitive(primitive);
          gl.uniform1f(modelUniforms.uWireframe, 0);
          gl.uniform4fv(modelUniforms.uBaseColor, primitive.color);
          gl.uniform1f(modelUniforms.uRoughness, primitive.roughness);
          gl.uniform1f(modelUniforms.uMetallic, primitive.metallic);
          gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0);
        } else {
          // Edges only: a solid pass plus ~68k edge overlays turns into mush at
          // preview size, so wireframe replaces the surface instead.
          gl.disable(gl.POLYGON_OFFSET_FILL);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          bindLineIndices(primitive);
          gl.uniform1f(modelUniforms.uWireframe, 1);
          gl.uniform4fv(modelUniforms.uBaseColor, primitive.color);
          gl.drawElements(gl.LINES, primitive.lineCount, primitive.indexType, 0);
          gl.disable(gl.BLEND);
          gl.enable(gl.POLYGON_OFFSET_FILL);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);

      drawOverlay();
      if (grid !== null) drawGrid();
      drawAxes();
      if (onView !== null) onView();
    }

    function drawOverlay() {
      if (overlay.faces === null && overlay.lines === null) return;
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(lineUniforms.uViewProj, false, viewProjection);
      gl.uniform1f(lineUniforms.uOpacity, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      if (overlay.faces !== null) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-2, -2);
        bindLines(overlay.faces);
        gl.drawArrays(gl.TRIANGLES, 0, overlay.faces.count);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      if (overlay.lines !== null) {
        gl.disable(gl.DEPTH_TEST);
        bindLines(overlay.lines);
        gl.drawArrays(gl.LINES, 0, overlay.lines.count);
        gl.enable(gl.DEPTH_TEST);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    function uploadColored(positions, color) {
      var count = positions.length / 3;
      var colors = new Float32Array(count * 4);
      for (var i = 0; i < count; i += 1) colors.set(color, i * 4);
      return { positions: uploadArray(gl, positions instanceof Float32Array ? positions : new Float32Array(positions)), colors: uploadArray(gl, colors), count: count };
    }

    /** Replace the highlight: face triangles and line segments, both glTF-world xyz lists. */
    function setOverlay(next) {
      if (overlay.faces !== null) destroyBufferSet(overlay.faces);
      if (overlay.lines !== null) destroyBufferSet(overlay.lines);
      overlay.faces = next && next.faces && next.faces.length ? uploadColored(next.faces, next.faceColor || overlay.faceColor) : null;
      overlay.lines = next && next.lines && next.lines.length ? uploadColored(next.lines, next.lineColor || overlay.lineColor) : null;
      dirty = true;
    }

    /** Camera ray through a client-space point, in glTF world space. */
    function rayAt(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      var y = 1 - ((clientY - rect.top) / Math.max(rect.height, 1)) * 2;
      var inverse = m4invert(viewProjection);
      if (inverse === null) return null;
      var unproject = function (z) {
        var p = [x, y, z, 1];
        var o = [0, 0, 0, 0];
        for (var r = 0; r < 4; r += 1) o[r] = inverse[r] * p[0] + inverse[4 + r] * p[1] + inverse[8 + r] * p[2] + inverse[12 + r] * p[3];
        return [o[0] / o[3], o[1] / o[3], o[2] / o[3]];
      };
      var near = unproject(-1);
      var far = unproject(1);
      return { origin: near, direction: normalize(sub(far, near)) };
    }

    /** Nearest surface hit under a client-space point, with every id the GLB carries. */
    function pick(clientX, clientY) {
      var ray = rayAt(clientX, clientY);
      if (ray === null) return null;
      var o = ray.origin, d = ray.direction;
      var best = null;
      for (var p = 0; p < primitives.length; p += 1) {
        var cpu = primitives[p].cpu;
        if (!cpu || !rayHitsBox(o, d, cpu.min, cpu.max)) continue;
        var pos = cpu.positions, idx = cpu.indices;
        for (var t = 0; t + 2 < idx.length; t += 3) {
          var ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
          var e1x = pos[ib] - pos[ia], e1y = pos[ib + 1] - pos[ia + 1], e1z = pos[ib + 2] - pos[ia + 2];
          var e2x = pos[ic] - pos[ia], e2y = pos[ic + 1] - pos[ia + 1], e2z = pos[ic + 2] - pos[ia + 2];
          var px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
          var det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          var inv = 1 / det;
          var sx = o[0] - pos[ia], sy = o[1] - pos[ia + 1], sz = o[2] - pos[ia + 2];
          var u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          var qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          var v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          var dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (dist <= 1e-9 || (best !== null && dist >= best.distance)) continue;
          var geometric = normalize(cross([e1x, e1y, e1z], [e2x, e2y, e2z]));
          if (primitives[p].mirrored) geometric = [-geometric[0], -geometric[1], -geometric[2]];
          best = { primitive: p, triangle: t / 3, distance: dist, u: u, v: v, normal: geometric };
        }
      }
      if (best === null) return null;
      var prim = primitives[best.primitive];
      var c = prim.cpu;
      var corners = [c.indices[best.triangle * 3], c.indices[best.triangle * 3 + 1], c.indices[best.triangle * 3 + 2]];
      var w = [1 - best.u - best.v, best.u, best.v];
      var uv = null;
      if (c.uvs) {
        uv = [0, 0];
        for (var k = 0; k < 3; k += 1) { uv[0] += c.uvs[corners[k] * 2] * w[k]; uv[1] += c.uvs[corners[k] * 2 + 1] * w[k]; }
        uv[1] = 1 - uv[1]; // glTF flips V relative to Blender
      }
      var normal = best.normal;
      return {
        point: [o[0] + d[0] * best.distance, o[1] + d[1] * best.distance, o[2] + d[2] * best.distance],
        normal: normal,
        uv: uv,
        faceId: c.faceIds ? Math.round(c.faceIds[corners[0]]) : 0,
        srcId: c.srcIds ? Math.round(c.srcIds[corners[0]]) : 0,
        vertIds: c.vertIds ? corners.map(function (i) { return Math.round(c.vertIds[i]); }) : null,
        nodeName: prim.node.name,
        nodePath: prim.node.path ? prim.node.path.slice() : [prim.node.name],
        nodeIndex: prim.node.index,
        meshPrimitive: prim.meshPrimitive,
        triangle: best.triangle,
        barycentric: w.slice(),
        nodeWorld: Array.prototype.slice.call(prim.node.world),
      };
    }

    function rayHitsBox(o, d, min, max) {
      var tmin = -Infinity, tmax = Infinity;
      for (var a = 0; a < 3; a += 1) {
        if (Math.abs(d[a]) < 1e-12) { if (o[a] < min[a] || o[a] > max[a]) return false; continue; }
        var t1 = (min[a] - o[a]) / d[a], t2 = (max[a] - o[a]) / d[a];
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
      }
      return tmax >= Math.max(tmin, 0);
    }

    /** glTF-world triangles of one source face (or a whole node when faceId is null). */
    function trianglesOf(nodeIndex, srcId, faceId) {
      var out = [];
      for (var p = 0; p < primitives.length; p += 1) {
        var prim = primitives[p];
        if (prim.node.index !== nodeIndex || !prim.cpu) continue;
        var c = prim.cpu;
        for (var t = 0; t + 2 < c.indices.length; t += 3) {
          var first = c.indices[t];
          if (faceId !== null && (!c.faceIds || Math.round(c.faceIds[first]) !== faceId || Math.round(c.srcIds ? c.srcIds[first] : 0) !== srcId)) continue;
          for (var k = 0; k < 3; k += 1) {
            var i = c.indices[t + k] * 3;
            out.push(c.positions[i], c.positions[i + 1], c.positions[i + 2]);
          }
        }
      }
      return new Float32Array(out);
    }

    /** Client-space position of a glTF-world point, and whether it is in front of the camera. */
    function project(point) {
      var m = viewProjection;
      var x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
      var y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
      var w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
      var rect = canvas.getBoundingClientRect();
      if (w <= 1e-9) return { x: 0, y: 0, visible: false };
      return { x: ((x / w + 1) / 2) * rect.width, y: ((1 - y / w) / 2) * rect.height, visible: true };
    }

    /** Is the point the first surface hit along its camera ray (not hidden behind other geometry)? */
    function isUnoccluded(point) {
      var screen = project(point);
      if (!screen.visible) return false;
      var rect = canvas.getBoundingClientRect();
      var hit = pick(rect.left + screen.x, rect.top + screen.y);
      if (hit === null) return true;
      var toPoint = Math.hypot(point[0] - camera.eye[0], point[1] - camera.eye[1], point[2] - camera.eye[2]);
      var toHit = Math.hypot(hit.point[0] - camera.eye[0], hit.point[1] - camera.eye[1], hit.point[2] - camera.eye[2]);
      return toPoint <= toHit + state.radius * 1e-4 + toHit * 1e-6;
    }

    function drawGrid() {
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(lineUniforms.uViewProj, false, viewProjection);
      gl.uniform1f(lineUniforms.uOpacity, 0.2);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      bindLines(grid);
      gl.drawArrays(gl.LINES, 0, grid.count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    function drawAxes() {
      var size = Math.max(56, Math.min(84, Math.round(canvas.height * 0.12)));
      var margin = 10;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(margin, margin, size, size);
      gl.viewport(margin, margin, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      var ortho = new Float32Array(16);
      mat4Orthographic(ortho, -1.35, 1.35, -1.35, 1.35, -4, 4);
      var combined = new Float32Array(16);
      var rotationOnly = new Float32Array(16);
      for (var i = 0; i < 12; i += 1) rotationOnly[i] = view[i];
      rotationOnly[15] = 1;
      mat4Multiply(combined, ortho, rotationOnly);
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(lineUniforms.uViewProj, false, combined);
      gl.uniform1f(lineUniforms.uOpacity, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      bindLines(axes);
      gl.drawArrays(gl.LINES, 0, axes.count);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST);
    }

    function bindPrimitive(primitive) {
      gl.bindBuffer(gl.ARRAY_BUFFER, primitive.positions);
      gl.enableVertexAttribArray(modelLocations.position);
      gl.vertexAttribPointer(modelLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, primitive.normals);
      gl.enableVertexAttribArray(modelLocations.normal);
      gl.vertexAttribPointer(modelLocations.normal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.indices);
    }

    function bindLineIndices(primitive) {
      gl.bindBuffer(gl.ARRAY_BUFFER, primitive.positions);
      gl.enableVertexAttribArray(modelLocations.position);
      gl.vertexAttribPointer(modelLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, primitive.normals);
      gl.enableVertexAttribArray(modelLocations.normal);
      gl.vertexAttribPointer(modelLocations.normal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.lineIndices);
    }

    function bindLines(buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.positions);
      gl.enableVertexAttribArray(lineLocations.position);
      gl.vertexAttribPointer(lineLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.colors);
      gl.enableVertexAttribArray(lineLocations.color);
      gl.vertexAttribPointer(lineLocations.color, 4, gl.FLOAT, false, 0, 0);
    }

    function uploadLines(positions, colors) {
      return {
        positions: uploadArray(gl, new Float32Array(positions)),
        colors: uploadArray(gl, new Float32Array(colors)),
        count: positions.length / 3,
      };
    }

    function createAxes() {
      var positions = [];
      var colors = [];
      pushLine(positions, colors, 0, 0, 0, 1, 0, 0, [0.95, 0.35, 0.35, 1]);
      pushLine(positions, colors, 0, 0, 0, 0, 1, 0, [0.45, 0.85, 0.45, 1]);
      pushLine(positions, colors, 0, 0, 0, 0, 0, 1, [0.45, 0.62, 0.98, 1]);
      return uploadLines(positions, colors);
    }

    function createShadowQuad() {
      var buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      return { buffer: buffer, count: 6 };
    }

    function drawShadow() {
      if (bbox === null) return;
      gl.useProgram(shadowProgram);
      gl.uniformMatrix4fv(shadowUniforms.uViewProj, false, viewProjection);
      gl.uniform3f(
        shadowUniforms.uCenter,
        (bbox.min[0] + bbox.max[0]) / 2,
        bbox.min[1] + state.radius * 0.002,
        (bbox.min[2] + bbox.max[2]) / 2
      );
      gl.uniform2f(
        shadowUniforms.uExtent,
        Math.max((bbox.max[0] - bbox.min[0]) * 0.62, state.radius * 0.2),
        Math.max((bbox.max[2] - bbox.min[2]) * 0.62, state.radius * 0.2)
      );
      gl.uniform1f(shadowUniforms.uOpacity, 0.55);
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowQuad.buffer);
      var location = gl.getAttribLocation(shadowProgram, "aUv");
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, shadowQuad.count);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        dirty = true;
      }
    }

    function fit() {
      if (bbox === null) return;
      var size = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];
      state.target = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
      state.radius = Math.max(Math.hypot(size[0], size[1], size[2]) / 2, 1e-6);
      // Fit the bounding sphere against the narrower of the vertical and
      // horizontal fields of view, so a wide part fits a tall pane too.
      var aspect = Math.max(canvas.width / Math.max(canvas.height, 1), 0.2);
      var horizontal = 2 * Math.atan(Math.tan(settings.fieldOfView / 2) * aspect);
      var narrowest = Math.min(settings.fieldOfView, horizontal);
      state.distance = (state.radius / Math.sin(narrowest / 2)) * 1.08;
      state.yaw = 0.72;
      state.pitch = 0.58;
      buildGrid();
      dirty = true;
    }

    function buildGrid() {
      if (bbox === null) return;
      var span = Math.max(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2]);
      var step = niceStep(span / 8);
      var extent = Math.ceil((span * 0.9) / step) * step;
      if (extent <= 0) return;
      var center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
      var level = bbox.min[1] - state.radius * 0.004;
      var positions = [];
      var colors = [];
      var count = Math.round(extent / step);
      for (var i = -count; i <= count; i += 1) {
        var offset = i * step;
        var major = Math.abs(offset) < step * 0.01;
        var alpha = major ? 0.42 : 0.16;
        pushLine(positions, colors, center[0] + offset, level, center[1] - extent, center[0] + offset, level, center[1] + extent, [0.62, 0.72, 0.86, alpha]);
        pushLine(positions, colors, center[0] - extent, level, center[1] + offset, center[0] + extent, level, center[1] + offset, [0.62, 0.72, 0.86, alpha]);
      }
      if (grid !== null) destroyBufferSet(grid);
      grid = uploadLines(positions, colors);
    }

    function setModel(arrayBuffer, modelOptions) {
      var parsed = parseGlb(arrayBuffer);
      var uploaded = uploadScene(gl, parsed, modelOptions || {});
      for (var i = 0; i < primitives.length; i += 1) destroyPrimitive(primitives[i]);
      primitives = uploaded.primitives;
      bbox = uploaded.bbox;
      fit();
      return { triangles: uploaded.triangles, vertices: uploaded.vertices, bounds: bbox, materials: parsed.materials.length, nodes: parsed.nodes.length };
    }

    function destroyPrimitive(primitive) {
      gl.deleteBuffer(primitive.positions);
      gl.deleteBuffer(primitive.normals);
      gl.deleteBuffer(primitive.indices);
    }

    function destroyBufferSet(buffer) {
      gl.deleteBuffer(buffer.positions);
      gl.deleteBuffer(buffer.colors);
    }

    // ---------------------------------------------------------------- events
    var pointer = null;
    function onPointerDown(event) {
      if (event.button !== 0 && event.button !== 2 && event.button !== 1) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button, moved: false };
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
    function onPointerMove(event) {
      if (pointer === null || pointer.id !== event.pointerId) return;
      var dx = event.clientX - pointer.x;
      var dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.travel = (pointer.travel || 0) + Math.abs(dx) + Math.abs(dy);
      pointer.moved = pointer.moved || pointer.travel > 4;
      if (!pointer.moved) return;
      if (pointer.button === 0) {
        state.yaw -= dx * 0.0075;
        state.pitch = clamp(state.pitch + dy * 0.0065, -1.45, 1.45);
      } else {
        pan(dx, dy);
      }
      dirty = true;
    }
    function onPointerUp(event) {
      if (pointer !== null && pointer.id === event.pointerId && pointer.button === 0 && !pointer.moved && onClick !== null) {
        onClick(event.clientX, event.clientY, event);
      }
      if (pointer !== null && pointer.id === event.pointerId) {
        canvas.releasePointerCapture?.(event.pointerId);
        pointer = null;
      }
    }
    function onPointerCancel(event) {
      if (pointer !== null && pointer.id === event.pointerId) {
        canvas.releasePointerCapture?.(event.pointerId);
        pointer = null;
      }
    }
    function onWheel(event) {
      var scale = Math.exp(clamp(event.deltaY, -240, 240) * 0.0014);
      state.distance = clamp(state.distance * scale, state.radius * settings.minDistanceFactor, state.radius * settings.maxDistanceFactor);
      dirty = true;
      event.preventDefault();
    }
    function onDoubleClick() {
      fit();
    }
    function onKeyDown(event) {
      if (event.key === "Home" || event.key === "0") {
        fit();
        event.preventDefault();
      }
    }
    function pan(dx, dy) {
      var worldPerPixel = (2 * state.distance * Math.tan(settings.fieldOfView / 2)) / Math.max(canvas.height, 1);
      var forward = normalize(sub(camera.eye, state.target));
      var right = normalize(cross(forward, camera.up));
      var up = cross(right, forward);
      for (var i = 0; i < 3; i += 1) {
        state.target[i] += (-right[i] * dx + up[i] * dy) * worldPerPixel;
      }
      dirty = true;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("keydown", onKeyDown);
    var observer = typeof ResizeObserver === "function" ? new ResizeObserver(function () { resize(); }) : null;
    if (observer !== null) observer.observe(canvas);
    var onWindowResize = function () { resize(); };
    window.addEventListener("resize", onWindowResize);

    resize();
    frame = requestAnimationFrame(render);

    return {
      setModel: setModel,
      resetView: fit,
      pick: pick,
      project: project,
      isUnoccluded: isUnoccluded,
      trianglesOf: trianglesOf,
      setOverlay: setOverlay,
      getView: function () { return { yaw: state.yaw, pitch: state.pitch, distance: state.distance, target: state.target.slice() }; },
      setView: function (v) { if (!v) return; state.yaw = v.yaw; state.pitch = v.pitch; state.distance = v.distance; state.target = v.target.slice(); dirty = true; },
      redraw: function () { dirty = true; },
      canvas: canvas,
      setWireframe: function (value) { state.wireframe = value === true; dirty = true; },
      setAutoRotate: function (value) { state.autoRotate = value === true; lastTime = 0; dirty = true; },
      isWireframe: function () { return state.wireframe; },
      isAutoRotate: function () { return state.autoRotate; },
      dispose: function () {
        disposed = true;
        cancelAnimationFrame(frame);
        observer?.disconnect();
        window.removeEventListener("resize", onWindowResize);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("dblclick", onDoubleClick);
        canvas.removeEventListener("keydown", onKeyDown);
        for (var i = 0; i < primitives.length; i += 1) destroyPrimitive(primitives[i]);
        setOverlay(null);
        if (grid !== null) destroyBufferSet(grid);
        destroyBufferSet(axes);
        gl.deleteBuffer(shadowQuad.buffer);
        gl.deleteProgram(shadowProgram);
        gl.deleteProgram(modelProgram);
        gl.deleteProgram(lineProgram);
      },
    };
  }

  // ------------------------------------------------------------------ glTF
  function parseGlb(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    if (view.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file.");
    var version = view.getUint32(4, true);
    if (version !== 2) throw new Error("Only glTF 2.0 GLB files are supported.");
    var total = Math.min(view.getUint32(8, true), view.byteLength);
    var json = null;
    var bin = null;
    var offset = 12;
    while (offset + 8 <= total) {
      var length = view.getUint32(offset, true);
      var type = view.getUint32(offset + 4, true);
      var start = offset + 8;
      if (start + length > view.byteLength) break;
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, length)));
      else if (type === 0x004e4942) bin = new Uint8Array(arrayBuffer, start, length);
      offset = start + length + ((4 - (length % 4)) % 4);
    }
    if (json === null) throw new Error("GLB has no JSON chunk.");
    if (!json.asset || json.asset.version !== "2.0") throw new Error("Unsupported glTF asset version.");
    return {
      json: json,
      bin: bin,
      accessors: json.accessors || [],
      bufferViews: json.bufferViews || [],
      materials: json.materials || [],
      meshes: json.meshes || [],
      nodes: json.nodes || [],
      scenes: json.scenes || [],
    };
  }

  function uploadScene(gl, parsed, modelOptions) {
    var worldFor = modelOptions && typeof modelOptions.worldFor === "function" ? modelOptions.worldFor : null;
    var json = parsed.json;
    var materials = parsed.materials.map(function (material) {
      var pbr = material.pbrMetallicRoughness || {};
      var factor = pbr.baseColorFactor || [0.8, 0.8, 0.8, 1];
      return {
        // glTF baseColorFactor is already scene-linear; the shader does the
        // tone map and the display gamma, so no conversion belongs here.
        color: [factor[0], factor[1], factor[2], factor[3]],
        roughness: pbr.roughnessFactor === undefined ? 0.5 : pbr.roughnessFactor,
        metallic: pbr.metallicFactor === undefined ? 0 : pbr.metallicFactor,
        doubleSided: material.doubleSided === true,
        alphaMode: material.alphaMode || "OPAQUE",
      };
    });
    if (materials.length === 0) materials.push({ color: [0.78, 0.8, 0.84, 1], roughness: 0.6, metallic: 0, doubleSided: true, alphaMode: "OPAQUE" });

    var sceneIndex = json.scene === undefined ? 0 : json.scene;
    var scene = parsed.scenes[sceneIndex];
    var roots = scene && Array.isArray(scene.nodes) ? scene.nodes.slice() : parsed.nodes.map(function (_, index) { return index; });
    var bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    var primitives = [];
    var triangles = 0;
    var vertices = 0;

    function visit(nodeIndex, parentMatrix, ancestors) {
      var node = parsed.nodes[nodeIndex];
      if (!node) return;
      var local = mat4Identity();
      if (Array.isArray(node.matrix) && node.matrix.length === 16) local.set(node.matrix);
      else if (node.translation || node.rotation || node.scale) local.set(mat4Compose(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]));
      var world = mat4Multiply(new Float32Array(16), parentMatrix, local);
      // The exporter decomposes transforms into TRS and loses shear; a caller
      // that knows Blender's exact matrix (non-skinned, non-instanced) supplies it.
      if (worldFor !== null && node.skin === undefined) {
        var exact = worldFor(node.name, ancestors || [], world);
        if (exact) world = new Float32Array(exact);
      }
      var path = (ancestors || []).concat([node.name || ""]);
      if (node.mesh !== undefined) {
        var mesh = parsed.meshes[node.mesh];
        if (mesh) {
          for (var p = 0; p < (mesh.primitives || []).length; p += 1) {
            var built = buildPrimitive(gl, parsed, mesh.primitives[p], materials, world, bbox, {
              index: nodeIndex,
              name: node.name || "node " + nodeIndex,
              path: path,
              world: world,
              weights: node.weights || mesh.weights || null,
            });
            if (built === null) continue;
            built.primitive.meshPrimitive = p;
            primitives.push(built.primitive);
            triangles += built.triangles;
            vertices += built.vertices;
          }
        }
      }
      for (var c = 0; c < (node.children || []).length; c += 1) visit(node.children[c], world, path);
    }

    var identity = mat4Identity();
    for (var r = 0; r < roots.length; r += 1) visit(roots[r], identity, []);
    if (!isFinite(bbox.min[0])) bbox = { min: [-1, -1, -1], max: [1, 1, 1] };
    return { primitives: primitives, bbox: bbox, triangles: triangles, vertices: vertices };
  }

  function buildPrimitive(gl, parsed, primitive, materials, world, bbox, nodeInfo) {
    if ((primitive.mode === undefined ? 4 : primitive.mode) !== 4) return null;
    var positionAccessor = parsed.accessors[primitive.attributes.POSITION];
    if (!positionAccessor) return null;
    var positions = readAccessor(parsed, positionAccessor);
    if (positions === null) return null;
    var normals = primitive.attributes.NORMAL === undefined ? null : readAccessor(parsed, parsed.accessors[primitive.attributes.NORMAL]);
    var weights = nodeInfo && nodeInfo.weights ? nodeInfo.weights : null;
    if (Array.isArray(primitive.targets) && weights !== null) {
      positions = new Float32Array(positions);
      if (normals !== null) normals = new Float32Array(normals);
      for (var mt = 0; mt < primitive.targets.length; mt += 1) {
        var w = weights[mt] || 0;
        if (w === 0) continue;
        var target = primitive.targets[mt];
        var dp = target.POSITION === undefined ? null : readAccessor(parsed, parsed.accessors[target.POSITION]);
        if (dp !== null) for (var q = 0; q < positions.length; q += 1) positions[q] += w * dp[q];
        var dn = normals !== null && target.NORMAL !== undefined ? readAccessor(parsed, parsed.accessors[target.NORMAL]) : null;
        if (dn !== null) for (var qn = 0; qn < normals.length; qn += 1) normals[qn] += w * dn[qn];
      }
    }
    if (normals === null) normals = flatNormals(positions, primitive, parsed);
    var indices = primitive.indices === undefined ? null : readAccessor(parsed, parsed.accessors[primitive.indices]);

    var count = positions.length / 3;
    var attributeOf = function (name) {
      return primitive.attributes[name] === undefined ? null : readAccessor(parsed, parsed.accessors[primitive.attributes[name]]);
    };
    var primMin = [Infinity, Infinity, Infinity];
    var primMax = [-Infinity, -Infinity, -Infinity];
    var bakedPositions = new Float32Array(positions.length);
    var bakedNormals = new Float32Array(positions.length);
    var normalMatrix = normalMatrixOf(world);
    for (var i = 0; i < count; i += 1) {
      var x = positions[i * 3];
      var y = positions[i * 3 + 1];
      var z = positions[i * 3 + 2];
      bakedPositions[i * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
      bakedPositions[i * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
      bakedPositions[i * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
      var nx = normals[i * 3];
      var ny = normals[i * 3 + 1];
      var nz = normals[i * 3 + 2];
      var tx = normalMatrix[0] * nx + normalMatrix[3] * ny + normalMatrix[6] * nz;
      var ty = normalMatrix[1] * nx + normalMatrix[4] * ny + normalMatrix[7] * nz;
      var tz = normalMatrix[2] * nx + normalMatrix[5] * ny + normalMatrix[8] * nz;
      var length = Math.hypot(tx, ty, tz) || 1;
      bakedNormals[i * 3] = tx / length;
      bakedNormals[i * 3 + 1] = ty / length;
      bakedNormals[i * 3 + 2] = tz / length;
      var px = bakedPositions[i * 3];
      var py = bakedPositions[i * 3 + 1];
      var pz = bakedPositions[i * 3 + 2];
      if (px < bbox.min[0]) bbox.min[0] = px;
      if (py < bbox.min[1]) bbox.min[1] = py;
      if (pz < bbox.min[2]) bbox.min[2] = pz;
      if (px > bbox.max[0]) bbox.max[0] = px;
      if (py > bbox.max[1]) bbox.max[1] = py;
      if (pz > bbox.max[2]) bbox.max[2] = pz;
      if (px < primMin[0]) primMin[0] = px;
      if (py < primMin[1]) primMin[1] = py;
      if (pz < primMin[2]) primMin[2] = pz;
      if (px > primMax[0]) primMax[0] = px;
      if (py > primMax[1]) primMax[1] = py;
      if (pz > primMax[2]) primMax[2] = pz;
    }

    var indexArray;
    var indexType;
    if (indices === null) {
      indexType = count > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      indexArray = indexType === gl.UNSIGNED_INT ? new Uint32Array(count) : new Uint16Array(count);
      for (var s = 0; s < count; s += 1) indexArray[s] = s;
    } else {
      indexArray = indices;
      indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
    }
    var triangleCount = Math.floor(indexArray.length / 3);
    var lineIndices = buildLineIndices(indexArray, triangleCount);

    var material = materials[primitive.material === undefined ? 0 : primitive.material] || materials[0];
    var primitiveRecord = {
      positions: uploadArray(gl, bakedPositions),
      normals: uploadArray(gl, bakedNormals),
      indices: uploadElement(gl, indexArray),
      lineIndices: uploadElement(gl, lineIndices),
      count: indexArray.length,
      lineCount: lineIndices.length,
      indexType: indexType,
      color: material.color,
      roughness: material.roughness,
      metallic: material.metallic,
      doubleSided: material.doubleSided,
      node: nodeInfo || { index: -1, name: "", path: [], world: world },
      // A mirrored node (negative determinant) reverses triangle winding in world space.
      mirrored: (world[0] * (world[5] * world[10] - world[9] * world[6]) - world[4] * (world[1] * world[10] - world[9] * world[2]) + world[8] * (world[1] * world[6] - world[5] * world[2])) < 0,
      cpu: {
        positions: bakedPositions,
        indices: indexArray,
        faceIds: attributeOf("_DSH_FACE"),
        srcIds: attributeOf("_DSH_SRC"),
        vertIds: attributeOf("_DSH_VERT"),
        uvs: attributeOf("TEXCOORD_0"),
        min: primMin,
        max: primMax,
      },
    };
    return { primitive: primitiveRecord, triangles: triangleCount, vertices: count };
  }

  function buildLineIndices(indices, triangles) {
    var ArrayType = indices instanceof Uint32Array ? Uint32Array : indices instanceof Uint8Array ? Uint8Array : Uint16Array;
    var lineIndices = new ArrayType(triangles * 6);
    for (var t = 0; t < triangles; t += 1) {
      var a = indices[t * 3];
      var b = indices[t * 3 + 1];
      var c = indices[t * 3 + 2];
      lineIndices[t * 6] = a;
      lineIndices[t * 6 + 1] = b;
      lineIndices[t * 6 + 2] = b;
      lineIndices[t * 6 + 3] = c;
      lineIndices[t * 6 + 4] = c;
      lineIndices[t * 6 + 5] = a;
    }
    return lineIndices;
  }

  function flatNormals(positions, primitive, parsed) {
    // Missing NORMAL is legal glTF; compute per-face normals for indexed data.
    var indices = primitive.indices === undefined ? null : readAccessor(parsed, parsed.accessors[primitive.indices]);
    var normals = new Float32Array(positions.length);
    var count = indices === null ? positions.length / 3 : indices.length / 3;
    for (var t = 0; t < count; t += 1) {
      var ia = indices === null ? t * 3 : indices[t * 3] * 3;
      var ib = indices === null ? t * 3 + 3 : indices[t * 3 + 1] * 3;
      var ic = indices === null ? t * 3 + 6 : indices[t * 3 + 2] * 3;
      var ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
      var bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
      var cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
      var nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      var ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      var nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      for (var v = 0; v < 3; v += 1) {
        var at = (indices === null ? t * 3 + v : indices[t * 3 + v]) * 3;
        normals[at] = nx;
        normals[at + 1] = ny;
        normals[at + 2] = nz;
      }
    }
    for (var i = 0; i < normals.length; i += 3) {
      var length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }
    return normals;
  }

  function readAccessor(parsed, accessor) {
    if (!accessor) return null;
    var bufferView = parsed.bufferViews[accessor.bufferView];
    if (accessor.sparse) {
      // glTF shape-key deltas commonly omit a base bufferView and store only
      // changed vertices. Decode the dense base (or zeroes), then apply patches.
      var SparseType = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[accessor.componentType];
      var width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type] || 1;
      if (SparseType === undefined) return null;
      var baseAccessor = Object.assign({}, accessor);
      delete baseAccessor.sparse;
      var baseValues = bufferView ? readAccessor(parsed, baseAccessor) : null;
      var dense = baseValues ? new SparseType(baseValues) : new SparseType(accessor.count * width);
      var patchIndices = readAccessor(parsed, {
        bufferView: accessor.sparse.indices.bufferView,
        byteOffset: accessor.sparse.indices.byteOffset || 0,
        componentType: accessor.sparse.indices.componentType,
        count: accessor.sparse.count,
        type: "SCALAR",
      });
      var patchValues = readAccessor(parsed, {
        bufferView: accessor.sparse.values.bufferView,
        byteOffset: accessor.sparse.values.byteOffset || 0,
        componentType: accessor.componentType,
        count: accessor.sparse.count,
        type: accessor.type,
      });
      if (patchIndices === null || patchValues === null) throw new Error("Invalid sparse glTF accessor");
      for (var si = 0; si < accessor.sparse.count; si += 1) {
        var at = patchIndices[si];
        if (at >= accessor.count) throw new Error("Sparse glTF index is outside its accessor");
        for (var sc = 0; sc < width; sc += 1) dense[at * width + sc] = patchValues[si * width + sc];
      }
      return dense;
    }
    if (!bufferView) return null;
    var components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type] || 1;
    var ArrayType = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[accessor.componentType];
    if (ArrayType === undefined) return null;
    var count = accessor.count * components;
    var start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    var stride = bufferView.byteStride;
    if (stride === undefined || stride === components * ArrayType.BYTES_PER_ELEMENT) {
      return new ArrayType(parsed.bin.buffer, parsed.bin.byteOffset + start, count);
    }
    var target = new ArrayType(count);
    var source = new DataView(parsed.bin.buffer, parsed.bin.byteOffset + start);
    var bytes = ArrayType.BYTES_PER_ELEMENT;
    var read =
      accessor.componentType === 5126
        ? function (view, at) { return view.getFloat32(at, true); }
        : accessor.componentType === 5123
          ? function (view, at) { return view.getUint16(at, true); }
          : accessor.componentType === 5125
            ? function (view, at) { return view.getUint32(at, true); }
            : accessor.componentType === 5122
              ? function (view, at) { return view.getInt16(at, true); }
              : accessor.componentType === 5120
                ? function (view, at) { return view.getInt8(at); }
                : function (view, at) { return view.getUint8(at); };
    for (var i = 0; i < accessor.count; i += 1) {
      for (var c = 0; c < components; c += 1) {
        target[i * components + c] = read(source, i * stride + c * bytes);
      }
    }
    return target;
  }

  // ------------------------------------------------------------------ math
  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function mat4Multiply(out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
  }
  function mat4Compose(translation, rotation, scale) {
    var x = rotation[0], y = rotation[1], z = rotation[2], w = rotation[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([
      (1 - (yy + zz)) * scale[0], (xy + wz) * scale[0], (xz - wy) * scale[0], 0,
      (xy - wz) * scale[1], (1 - (xx + zz)) * scale[1], (yz + wx) * scale[1], 0,
      (xz + wy) * scale[2], (yz - wx) * scale[2], (1 - (xx + yy)) * scale[2], 0,
      translation[0], translation[1], translation[2], 1,
    ]);
  }
  function mat4Perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }
  function mat4Orthographic(out, left, right, bottom, top, near, far) {
    out.fill(0);
    out[0] = 2 / (right - left);
    out[5] = 2 / (top - bottom);
    out[10] = -2 / (far - near);
    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = -(far + near) / (far - near);
    out[15] = 1;
    return out;
  }
  function mat4LookAt(out, eye, center, up) {
    var z = normalize(sub(eye, center));
    var x = normalize(cross(up, z));
    var y = cross(z, x);
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
    out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye); out[15] = 1;
    return out;
  }
  function rotationOf(matrix, out) {
    out[0] = matrix[0]; out[1] = matrix[1]; out[2] = matrix[2];
    out[3] = matrix[4]; out[4] = matrix[5]; out[5] = matrix[6];
    out[6] = matrix[8]; out[7] = matrix[9]; out[8] = matrix[10];
    return out;
  }
  function normalMatrixOf(m) {
    var c00 = m[5] * m[10] - m[9] * m[6];
    var c01 = m[9] * m[2] - m[1] * m[10];
    var c02 = m[1] * m[6] - m[5] * m[2];
    var c10 = m[6] * m[8] - m[10] * m[4];
    var c11 = m[10] * m[0] - m[2] * m[8];
    var c12 = m[2] * m[4] - m[6] * m[0];
    var c20 = m[4] * m[9] - m[8] * m[5];
    var c21 = m[8] * m[1] - m[0] * m[9];
    var c22 = m[0] * m[5] - m[4] * m[1];
    return [c00, c01, c02, c10, c11, c12, c20, c21, c22];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function normalize(v) {
    var length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }
  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
  function niceStep(value) {
    if (!isFinite(value) || value <= 0) return 1;
    var power = Math.pow(10, Math.floor(Math.log10(value)));
    var normalized = value / power;
    var step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return step * power;
  }

  // ------------------------------------------------------------- gl helpers
  function buildProgram(gl, vertexSource, fragmentSource) {
    function compile(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error("Shader compile failed: " + log);
      }
      return shader;
    }
    var program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error("Shader link failed: " + log);
    }
    return program;
  }
  function uniformsOf(gl, program, names) {
    var table = {};
    for (var i = 0; i < names.length; i += 1) table[names[i]] = gl.getUniformLocation(program, names[i]);
    return table;
  }
  function uploadArray(gl, data) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }
  function uploadElement(gl, data) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }
  function pushLine(positions, colors, x1, y1, z1, x2, y2, z2, color) {
    positions.push(x1, y1, z1, x2, y2, z2);
    colors.push(color[0], color[1], color[2], color[3], color[0], color[1], color[2], color[3]);
  }

  var SHADOW_VERTEX = [
    "attribute vec2 aUv;",
    "uniform mat4 uViewProj;",
    "uniform vec3 uCenter;",
    "uniform vec2 uExtent;",
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = aUv;",
    "  vec3 world = uCenter + vec3(aUv.x * uExtent.x, 0.0, aUv.y * uExtent.y);",
    "  gl_Position = uViewProj * vec4(world, 1.0);",
    "}",
  ].join("\n");

  var SHADOW_FRAGMENT = [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform float uOpacity;",
    "void main() {",
    "  float falloff = 1.0 - smoothstep(0.0, 1.0, length(vUv));",
    "  gl_FragColor = vec4(0.015, 0.02, 0.035, falloff * falloff * uOpacity);",
    "}",
  ].join("\n");

  var MODEL_VERTEX = [
    "attribute vec3 aPosition;",
    "attribute vec3 aNormal;",
    "uniform mat4 uView;",
    "uniform mat4 uViewProj;",
    "uniform mat3 uViewRot;",
    "varying vec3 vNormal;",
    "varying vec3 vViewPos;",
    "void main() {",
    "  vec4 viewPos = uView * vec4(aPosition, 1.0);",
    "  vViewPos = viewPos.xyz;",
    "  vNormal = uViewRot * aNormal;",
    "  gl_Position = uViewProj * vec4(aPosition, 1.0);",
    "}",
  ].join("\n");

  var MODEL_FRAGMENT = [
    "precision highp float;",
    "varying vec3 vNormal;",
    "varying vec3 vViewPos;",
    "uniform vec4 uBaseColor;",
    "uniform float uRoughness;",
    "uniform float uMetallic;",
    "uniform float uWireframe;",
    "uniform vec3 uCamera;",
    "uniform float uExposure;",
    "void main() {",
    "  if (uWireframe > 0.5) {",
    "    gl_FragColor = vec4(0.55, 0.72, 1.0, 0.55);",
    "    return;",
    "  }",
    "  vec3 N = normalize(vNormal);",
    "  if (!gl_FrontFacing) N = -N;",
    "  vec3 V = normalize(-vViewPos);",
    "  vec3 key = normalize(vec3(0.42, 0.7, 0.58));",
    "  vec3 fill = normalize(vec3(-0.62, 0.12, 0.38));",
    "  float keyDiff = max(dot(N, key), 0.0);",
    "  float fillDiff = max(dot(N, fill), 0.0);",
    "  float hemi = 0.5 + 0.5 * N.y;",
    "  vec3 ambient = mix(vec3(0.07, 0.075, 0.09), vec3(0.19, 0.21, 0.25), hemi);",
    "  float shininess = mix(6.0, 220.0, 1.0 - uRoughness);",
    "  vec3 H = normalize(key + V);",
    "  float spec = pow(max(dot(N, H), 0.0), shininess);",
    "  float specStrength = (0.1 + 0.6 * (1.0 - uRoughness)) * (1.0 - uMetallic * 0.6);",
    "  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
    "  vec3 diffuse = uBaseColor.rgb * (ambient + keyDiff * vec3(0.98, 0.95, 0.9) * 0.9 + fillDiff * vec3(0.36, 0.44, 0.58) * 0.55);",
    "  vec3 metalTint = mix(vec3(1.0), uBaseColor.rgb * 2.2, uMetallic);",
    "  diffuse += spec * specStrength * metalTint;",
    "  diffuse += fresnel * vec3(0.2, 0.27, 0.36) * 0.55;",
    "  diffuse *= uExposure;",
    "  diffuse = diffuse / (diffuse + vec3(0.72));",
    "  gl_FragColor = vec4(pow(diffuse, vec3(1.0 / 2.2)), 1.0);",
    "}",
  ].join("\n");

  var LINE_VERTEX = [
    "attribute vec3 aPosition;",
    "attribute vec4 aColor;",
    "uniform mat4 uViewProj;",
    "uniform float uOpacity;",
    "varying vec4 vColor;",
    "void main() {",
    "  vColor = vec4(aColor.rgb, aColor.a * uOpacity);",
    "  gl_Position = uViewProj * vec4(aPosition, 1.0);",
    "}",
  ].join("\n");

  var LINE_FRAGMENT = [
    "precision highp float;",
    "varying vec4 vColor;",
    "void main() { gl_FragColor = vColor; }",
  ].join("\n");

  /* @viewer:end */

