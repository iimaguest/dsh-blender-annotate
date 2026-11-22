/**
 * Client bundle source for dsh-blender-annotate.
 *
 * Fork of dsh-preview-blender (MIT, 439436269-ctrl) with the annotation editor
 * of dsh-preview-snip (MIT, 439436269-ctrl). Adds point/face/edge/vertex/object
 * annotation on the 3D preview: every picked point is resolved to Blender
 * identities and parameters (dev/resolve.js) and can be sent to the composer.
 *
 * scripts/build-client.mjs replaces the viewer and resolver markers below with
 * dev/viewer.js and dev/resolve.js and writes lib/client.js. Edit the dev files,
 * then run `node scripts/build-client.mjs`.
 */
window.__ModuleLoader__.load({
  id: "dsh-blender-annotate",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

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
          best = { primitive: p, triangle: t / 3, distance: dist, u: u, v: v, normal: normalize(cross([e1x, e1y, e1z], [e2x, e2y, e2z])) };
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
      if (dot(normal, d) > 0) normal = [-normal[0], -normal[1], -normal[2]];
      return {
        point: [o[0] + d[0] * best.distance, o[1] + d[1] * best.distance, o[2] + d[2] * best.distance],
        normal: normal,
        uv: uv,
        faceId: c.faceIds ? Math.round(c.faceIds[corners[0]]) : 0,
        srcId: c.srcIds ? Math.round(c.srcIds[corners[0]]) : 0,
        vertIds: c.vertIds ? corners.map(function (i) { return Math.round(c.vertIds[i]); }) : null,
        nodeName: prim.node.name,
        nodeIndex: prim.node.index,
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
      return toPoint <= toHit + state.radius * 0.01;
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

    function setModel(arrayBuffer) {
      var parsed = parseGlb(arrayBuffer);
      var uploaded = uploadScene(gl, parsed);
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
    canvas.addEventListener("pointercancel", onPointerUp);
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
        canvas.removeEventListener("pointercancel", onPointerUp);
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

  function uploadScene(gl, parsed) {
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

    function visit(nodeIndex, parentMatrix) {
      var node = parsed.nodes[nodeIndex];
      if (!node) return;
      var local = mat4Identity();
      if (Array.isArray(node.matrix) && node.matrix.length === 16) local.set(node.matrix);
      else if (node.translation || node.rotation || node.scale) local.set(mat4Compose(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]));
      var world = mat4Multiply(new Float32Array(16), parentMatrix, local);
      if (node.mesh !== undefined) {
        var mesh = parsed.meshes[node.mesh];
        if (mesh) {
          for (var p = 0; p < (mesh.primitives || []).length; p += 1) {
            var built = buildPrimitive(gl, parsed, mesh.primitives[p], materials, world, bbox, { index: nodeIndex, name: node.name || "node " + nodeIndex, world: world });
            if (built === null) continue;
            primitives.push(built.primitive);
            triangles += built.triangles;
            vertices += built.vertices;
          }
        }
      }
      for (var c = 0; c < (node.children || []).length; c += 1) visit(node.children[c], world);
    }

    var identity = mat4Identity();
    for (var r = 0; r < roots.length; r += 1) visit(roots[r], identity);
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
      node: nodeInfo || { index: -1, name: "", world: world },
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

  /**
   * Build a resolver for one export.
   * @param annotate - scene.annotate from the export script.
   * @param mmPerUnit - scene.unit.millimeters_per_unit.
   */
  function createResolver(annotate, mmPerUnit) {
    var meshes = (annotate && annotate.meshes) || [];
    var objects = (annotate && annotate.objects) || {};
    var unit = typeof mmPerUnit === "number" && mmPerUnit > 0 ? mmPerUnit : 1000;
    var matrices = {};
    function objectMatrix(name) {
      if (!(name in matrices)) matrices[name] = objects[name] ? rowsToColumnMajor(objects[name].matrix_world) : null;
      return matrices[name];
    }

    /** Object whose geometry supplied faces of mesh `meshIndex` inside node object `name`. */
    function operandFor(name, meshIndex) {
      var info = objects[name];
      if (info && info.mesh === meshIndex) return name;
      var mods = info ? info.modifiers || [] : [];
      for (var i = 0; i < mods.length; i += 1) {
        var other = mods[i].object;
        if (other && objects[other] && objects[other].mesh === meshIndex) return other;
      }
      for (var key in objects) if (objects[key].mesh === meshIndex) return key;
      return null;
    }

    /** Matrix taking source-mesh coordinates into the node object's local space. */
    function sourceToLocal(name, operand) {
      if (operand === null || operand === name) return null;
      var own = objectMatrix(name), other = objectMatrix(operand);
      if (own === null || other === null) return null;
      var inv = m4invert(own);
      return inv === null ? null : m4mul(inv, other);
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
      var materialSlot = g.material_index ? g.material_index[faceIndex] : 0;
      return { verts: verts, edges: edges, points: points, material: g.materials ? g.materials[materialSlot] : null };
    }

    /**
     * Resolve one picked point.
     * @param hit - { nodeName, nodeWorld (glTF column-major), point (glTF world),
     *   normal (glTF world), faceId, srcId, uv } from the viewer.
     */
    function resolve(hit) {
      var name = hit.nodeName || null;
      var info = name !== null ? objects[name] || null : null;
      var nodeInverse = hit.nodeWorld ? m4invert(hit.nodeWorld) : null;
      var localGl = nodeInverse ? m4apply(nodeInverse, hit.point) : hit.point;
      var local = yupToZup(localGl);
      var world = yupToZup(hit.point);
      var result = {
        object: name,
        objectType: info ? info.type : null,
        data: info ? info.data : null,
        collections: info ? info.collections : [],
        parent: info ? info.parent : null,
        modifiers: info ? info.modifiers.map(function (m) { return m.type + (m.object ? "(" + m.object + ")" : ""); }) : [],
        custom: info ? info.custom : {},
        worldMm: v3scale(world, unit),
        localMm: v3scale(local, unit),
        normal: hit.normal ? v3norm(yupToZup(hit.normal)) : null,
        uv: hit.uv || null,
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
      };
      var meshIndex = hit.srcId > 0 ? hit.srcId - 1 : -1;
      var faceIndex = hit.faceId > 0 ? hit.faceId - 1 : -1;
      if (meshIndex < 0 || meshIndex >= meshes.length || faceIndex < 0) return result;
      var mesh = meshes[meshIndex];
      result.mesh = mesh.name;
      result.face = faceIndex;
      var operand = operandFor(name, meshIndex);
      result.sourceObject = operand;
      var face = faceOf(mesh, faceIndex);
      if (face === null) { result.precision = "face"; return result; }
      result.faceSides = face.points.length;
      result.material = face.material;

      // Source-mesh coordinates of the point (Boolean operands live in their own space).
      var toLocal = sourceToLocal(name, operand);
      var fromLocal = toLocal ? m4invert(toLocal) : null;
      var p = fromLocal ? m4apply(fromLocal, local) : local;

      var centroid = [0, 0, 0];
      var normal = [0, 0, 0];
      for (var i = 0; i < face.points.length; i += 1) {
        var a = face.points[i], b = face.points[(i + 1) % face.points.length];
        centroid = v3add(centroid, a);
        normal = [normal[0] + (a[1] - b[1]) * (a[2] + b[2]), normal[1] + (a[2] - b[2]) * (a[0] + b[0]), normal[2] + (a[0] - b[0]) * (a[1] + b[1])];
      }
      centroid = v3scale(centroid, 1 / face.points.length);
      normal = v3norm(normal);
      var offset = v3dot(v3sub(p, centroid), normal);
      var projected = v3sub(p, v3scale(normal, offset));
      var size = 0;
      for (var j = 0; j < face.points.length; j += 1) size = Math.max(size, v3len(v3sub(face.points[j], centroid)));
      result.offsetMm = offset * unit;
      result.params = faceParameters(face.points, projected, normal);
      var ratio = size > 0 ? Math.abs(offset) / size : 0;
      result.precision = ratio < 0.02 ? "exact" : ratio < 1 ? "modified-surface" : "modifier-copy";

      var g = mesh.geometry;
      var bestEdge = null;
      for (var e = 0; e < face.points.length; e += 1) {
        var edgeIndex = face.edges[e];
        var ea = face.points[e], eb = face.points[(e + 1) % face.points.length];
        var hitEdge = segmentClosest(p, ea, eb);
        if (bestEdge === null || hitEdge.distance < bestEdge.distance) {
          var first = g.edge_vertices[edgeIndex * 2];
          var forward = first === face.verts[e];
          bestEdge = {
            index: edgeIndex,
            vertices: [g.edge_vertices[edgeIndex * 2], g.edge_vertices[edgeIndex * 2 + 1]],
            t: forward ? hitEdge.t : 1 - hitEdge.t,
            distance: hitEdge.distance,
            sourcePoint: hitEdge.point,
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
    return text === "-" + (0).toFixed(d) ? (0).toFixed(d) : text;
  }
  function fmtVec(v, digits) { return v ? "(" + v.map(function (x) { return fmt(x, digits); }).join(", ") + ")" : "—"; }

  /** Short human selector, like a CSS selector for a point on the model. */
  function selectorOf(r, target) {
    var parts = [r.object || "(unnamed)"];
    if (r.face !== null) {
      var face = "face " + r.face + (r.faceSides ? " (" + (r.faceSides === 3 ? "tri" : r.faceSides === 4 ? "quad" : r.faceSides + "-gon") + ")" : "");
      if (r.sourceObject && r.sourceObject !== r.object) face += " from " + r.sourceObject;
      parts.push(face);
    }
    if (target === "edge" && r.edge) parts.push("edge " + r.edge.index + " @ t=" + fmt(r.edge.t, 3));
    else if (target === "vertex" && r.vertex) parts.push("vertex " + r.vertex.index);
    else if (target !== "object" && target !== "face" && r.params) {
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
    lines.push("- " + ident);
    if (r.modifiers && r.modifiers.length) lines.push("- modifiers: " + r.modifiers.join(" → "));
    if (r.custom && Object.keys(r.custom).length) lines.push("- custom properties: `" + JSON.stringify(r.custom) + "`");
    if (r.face !== null) {
      var faceLine = "- face " + r.face + " of mesh `" + r.mesh + "`" + (r.faceSides ? " (" + r.faceSides + " sides)" : "");
      if (r.sourceObject && r.sourceObject !== r.object) faceLine += " — surface created by `" + r.sourceObject + "`";
      if (r.material) faceLine += " · material `" + r.material + "`";
      lines.push(faceLine);
    }
    if (r.params) {
      if (r.params.kind === "bilinear") lines.push("- in-face parameters (bilinear): s=" + fmt(r.params.s, 4) + ", t=" + fmt(r.params.t, 4));
      else lines.push("- in-face parameters (" + r.params.kind + "): " + fmtVec(r.params.weights, 4));
      lines.push("- distance from source face plane: " + fmt(r.offsetMm) + " mm");
    }
    if (r.edge) lines.push("- nearest edge " + r.edge.index + " (vertices " + r.edge.vertices.join("–") + ") at t=" + fmt(r.edge.t, 4) + ", " + fmt(r.edge.distanceMm) + " mm away");
    if (r.vertex) lines.push("- nearest vertex " + r.vertex.index + ", " + fmt(r.vertex.distanceMm) + " mm away");
    lines.push("- point: local " + fmtVec(r.localMm) + " mm · world " + fmtVec(r.worldMm) + " mm");
    if (r.normal) lines.push("- normal (world): " + fmtVec(r.normal, 3));
    if (r.uv) lines.push("- uv: " + fmtVec(r.uv, 4));
    if (r.face !== null) {
      var owner = r.sourceObject && r.sourceObject !== r.object ? r.sourceObject : r.object;
      var code = "me = bpy.data.objects[" + JSON.stringify(owner) + "].data; me.polygons[" + r.face + "]";
      if (r.edge && target === "edge") code += "; me.edges[" + r.edge.index + "]";
      if (r.vertex && target === "vertex") code += "; me.vertices[" + r.vertex.index + "]";
      lines.push("- bpy: `" + code + "`");
    } else if (r.object) {
      lines.push("- bpy: `bpy.data.objects[" + JSON.stringify(r.object) + "]`");
    }
    return lines.join("\n");
  }

    /** This package's copy namespace. */
    const NS = "blenderAnnotate";
    /** Renderer identity: the registry definition id and the body slot key. */
    const BODY_ID = "dsh-blender-annotate/scene";
    /** Route that converts and serves the scene; the Host half owns the same default. */
    const DEFAULT_ROUTE_PATH = "/api/blender-annotate";
    /** Suffixes mirrored from the Host defaults. */
    const DEFAULT_EXTENSIONS = ["blend"];

    const zh = {
      blender: "Blender",
      loading: "正在用 Blender 导出预览…",
      loadingHint: "首次打开需要几秒，之后直接读缓存。",
      preparing: "正在读取场景信息…",
      elapsed: "已用 {seconds}s",
      failed: "无法预览这个场景",
      retry: "重试",
      reset: "重置视角",
      wireframe: "线框",
      spin: "自动旋转",
      info: "场景信息",
      hint: "拖动旋转 · 滚轮缩放 · 双击复位",
      size: "外形尺寸",
      objects: "对象",
      triangles: "三角面",
      materials: "材质",
      cameras: "相机",
      lights: "灯光",
      exportMeta: "{blender} · {size} GLB · {time}",
      cached: "缓存命中",
      exportedIn: "导出 {seconds}s",
      unit: "单位",
      scene: "场景",
      collections: "集合",
      noSceneInfo: "没有可显示的场景信息。",
      details: "Blender 日志",
      webglMissing: "这个浏览器/显卡组合不支持 WebGL，无法绘制 3D 预览。",
      readFailed: "无法读取这个文件。",
      unsupported: "这个文件无法被 Blender 打开，或者不是有效的 .blend。",
      annotate: "标注",
      annotations: "标注",
      sketch: "草图",
      send: "发送到对话",
      targetPoint: "点",
      targetFace: "面",
      targetEdge: "边",
      targetVertex: "顶点",
      targetObject: "对象",
      annotateHint: "点击模型放置标注 · 拖动仍可旋转",
      commentPlaceholder: "写下对这个位置的意见…",
      save: "保存",
      cancel: "取消",
      goTo: "定位",
      remove: "删除",
      details: "详细参数",
      noAnnotations: "还没有标注。打开「标注」后点击模型。",
      noHit: "没有点中模型表面",
      sent: "已把标注写入输入框",
      sketchAdded: "已把草图插入输入框",
      sendFailed: "无法写入输入框",
      stale: "文件已变更",
      precisionExact: "精确",
      precisionModified: "修改器改变了表面",
      precisionCopy: "修改器生成的副本",
      precisionObject: "仅对象",
      box: "方框",
      ellipse: "圆形",
      arrow: "箭头",
      text: "文字",
      undo: "撤销",
      clear: "清空",
      insert: "插入输入框",
      textPrompt: "输入要标注的文字",
      editor: "标注后插入",
      messageTitle: "3D 标注",
    };

    const en = {
      blender: "Blender",
      loading: "Exporting the preview with Blender…",
      loadingHint: "The first open takes a few seconds; later opens read the cache.",
      preparing: "Reading scene information…",
      elapsed: "{seconds}s elapsed",
      failed: "This scene could not be previewed",
      retry: "Retry",
      reset: "Reset view",
      wireframe: "Wireframe",
      spin: "Auto-rotate",
      info: "Scene info",
      hint: "Drag to orbit · Wheel to zoom · Double-click to reset",
      size: "Size",
      objects: "Objects",
      triangles: "Triangles",
      materials: "Materials",
      cameras: "Cameras",
      lights: "Lights",
      exportMeta: "{blender} · {size} GLB · {time}",
      cached: "cache hit",
      exportedIn: "exported in {seconds}s",
      unit: "Unit",
      scene: "Scene",
      collections: "Collections",
      noSceneInfo: "No scene information to show.",
      details: "Blender log",
      webglMissing: "This browser/GPU combination does not support WebGL, so the 3D preview cannot be drawn.",
      readFailed: "This file could not be read.",
      unsupported: "Blender could not open this file, or it is not a valid .blend.",
      annotate: "Annotate",
      annotations: "Annotations",
      sketch: "Sketch",
      send: "Send to chat",
      targetPoint: "Point",
      targetFace: "Face",
      targetEdge: "Edge",
      targetVertex: "Vertex",
      targetObject: "Object",
      annotateHint: "Click the model to annotate · drag still orbits",
      commentPlaceholder: "What should change here?",
      save: "Save",
      cancel: "Cancel",
      goTo: "Go to",
      remove: "Delete",
      details: "Parameters",
      noAnnotations: "No annotations yet. Turn on Annotate, then click the model.",
      noHit: "That click did not land on the model",
      sent: "Annotations added to the composer",
      sketchAdded: "Sketch added to the composer",
      sendFailed: "Could not write to the composer",
      stale: "file changed",
      precisionExact: "exact",
      precisionModified: "surface changed by a modifier",
      precisionCopy: "modifier-generated copy",
      precisionObject: "object only",
      box: "Box",
      ellipse: "Circle",
      arrow: "Arrow",
      text: "Text",
      undo: "Undo",
      clear: "Clear",
      insert: "Insert",
      textPrompt: "Text to annotate",
      editor: "Annotate the view, then insert it",
      messageTitle: "3D annotations",
    };

    /** Scoped styles; every selector starts at the root attribute. */
    const STYLE = [
      '[data-blender-annotate]{display:flex;flex-direction:column;flex:auto;height:100%;min-height:0;box-sizing:border-box;color:var(--dsw-alias-label-primary,#1f2329);font-size:12px}',
      '[data-blender-annotate] .dsh-bp-toolbar{display:flex;align-items:center;gap:6px;flex:none;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}',
      '[data-blender-annotate] .dsh-bp-name{font-weight:600;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '[data-blender-annotate] .dsh-bp-actions{display:flex;gap:4px;margin-left:auto;flex:none}',
      '[data-blender-annotate] .dsh-bp-button{appearance:none;border:0;border-radius:7px;padding:5px 8px;font:inherit;font-size:11px;line-height:1.2;cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));white-space:nowrap}',
      '[data-blender-annotate] .dsh-bp-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.12))}',
      '[data-blender-annotate] .dsh-bp-button[data-active="true"]{background:var(--dsw-alias-interactive-bg-selected,rgba(64,128,255,.18));color:var(--dsw-alias-label-accent,#2c6ef2)}',
      '[data-blender-annotate] .dsh-bp-viewport{position:relative;flex:1 1 auto;min-height:240px;min-width:0;overflow:hidden;background:radial-gradient(120% 100% at 50% 0%,#2a3446 0%,#141a24 55%,#0b0f16 100%)}',
      '[data-blender-annotate] .dsh-bp-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none}',
      '[data-blender-annotate] .dsh-bp-canvas:active{cursor:grabbing}',
      '[data-blender-annotate] .dsh-bp-badge{position:absolute;left:10px;top:10px;padding:4px 8px;border-radius:999px;background:rgba(9,13,20,.55);color:#dfe8f6;font-size:11px;letter-spacing:.01em;pointer-events:none;backdrop-filter:blur(6px)}',
      '[data-blender-annotate] .dsh-bp-hint{position:absolute;left:10px;bottom:8px;color:rgba(223,232,246,.55);font-size:10.5px;pointer-events:none;user-select:none}',
      '[data-blender-annotate] .dsh-bp-overlay{position:absolute;inset:0;display:grid;place-items:center;padding:20px;background:rgba(8,11,17,.72);backdrop-filter:blur(3px)}',
      '[data-blender-annotate] .dsh-bp-card{width:min(420px,100%);color:#e8edf5;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center}',
      '[data-blender-annotate] .dsh-bp-card[data-tone="error"]{text-align:left;align-items:stretch}',
      '[data-blender-annotate] .dsh-bp-title{margin:0;font-size:13px;font-weight:600}',
      '[data-blender-annotate] .dsh-bp-text{margin:0;font-size:11.5px;line-height:1.55;color:rgba(232,237,245,.72)}',
      '[data-blender-annotate] .dsh-bp-code{margin:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;color:#ffb4b4}',
      '[data-blender-annotate] .dsh-bp-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:#7fa8ff;animation:dsh-bp-spin .8s linear infinite}',
      '@keyframes dsh-bp-spin{to{transform:rotate(360deg)}}',
      '[data-blender-annotate] .dsh-bp-panel{flex:none;max-height:40%;overflow:auto;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02))}',
      '[data-blender-annotate] .dsh-bp-panel[data-open="false"]{display:none}',
      '[data-blender-annotate] .dsh-bp-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 14px;margin-bottom:8px}',
      '[data-blender-annotate] .dsh-bp-kv{display:flex;justify-content:space-between;gap:8px;min-width:0}',
      '[data-blender-annotate] .dsh-bp-kv span:first-child{opacity:.6}',
      '[data-blender-annotate] .dsh-bp-kv span:last-child{font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}',
      '[data-blender-annotate] .dsh-bp-table{width:100%;border-collapse:collapse;font-size:11.5px}',
      '[data-blender-annotate] .dsh-bp-table th{text-align:left;font-weight:500;opacity:.5;padding:2px 4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}',
      '[data-blender-annotate] .dsh-bp-table td{padding:3px 4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05));vertical-align:top}',
      '[data-blender-annotate] .dsh-bp-table td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '[data-blender-annotate] .dsh-bp-swatch{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:-1px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}',
      '[data-blender-annotate] .dsh-bp-materials{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}',
      '[data-blender-annotate] .dsh-bp-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));font-size:10.5px}',
      '[data-blender-annotate] .dsh-bp-footer{margin-top:8px;font-size:10.5px;opacity:.55;display:flex;flex-wrap:wrap;gap:4px 10px}',
      '[data-blender-annotate] .dsh-bp-details{margin-top:4px;font-size:10.5px;color:rgba(232,237,245,.7)}',
      '[data-blender-annotate] .dsh-bp-details pre{max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);padding:8px;border-radius:8px;margin:6px 0 0;font-size:10.5px}',
      // dsh-blender-annotate
      '[data-blender-annotate] .dsh-bp-toolbar{flex-wrap:wrap}',
      '[data-blender-annotate] .dsh-bp-actions{flex-wrap:wrap;justify-content:flex-end}',
      '[data-blender-annotate] .dsh-ba-targets{display:flex;flex-wrap:wrap;gap:2px;flex:1 0 100%;padding-top:4px}',
      '[data-blender-annotate] .dsh-ba-targets .dsh-bp-button{padding:3px 8px}',
      '[data-blender-annotate] .dsh-bp-canvas[data-annotating="true"]{cursor:crosshair}',
      '[data-blender-annotate] .dsh-ba-pins{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
      '[data-blender-annotate] .dsh-ba-pin{position:absolute;left:0;top:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;color:#1b1300;background:#ffb020;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.45);pointer-events:auto;cursor:pointer;user-select:none;will-change:transform}',
      '[data-blender-annotate] .dsh-ba-pin[data-draft="true"]{background:#4f8cff;color:#fff}',
      '[data-blender-annotate] .dsh-ba-pin[data-occluded="true"]{opacity:.35}',
      '[data-blender-annotate] .dsh-ba-pin[data-offscreen="true"]{display:none}',
      '[data-blender-annotate] .dsh-ba-draft{position:absolute;left:8px;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 8px 28px rgba(0,0,0,.35);max-height:62%;overflow:auto}',
      '[data-blender-annotate] .dsh-ba-selector{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.45;overflow-wrap:anywhere}',
      '[data-blender-annotate] .dsh-ba-meta{font-size:10.5px;opacity:.65}',
      '[data-blender-annotate] .dsh-ba-draft textarea{width:100%;box-sizing:border-box;min-height:52px;resize:vertical;border:1px solid var(--dsw-alias-border-default,rgba(0,0,0,.18));border-radius:7px;padding:6px 8px;font:inherit;font-size:12px;background:transparent;color:inherit}',
      '[data-blender-annotate] .dsh-ba-row{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}',
      '[data-blender-annotate] .dsh-ba-details summary{cursor:pointer;font-size:11px;opacity:.75}',
      '[data-blender-annotate] .dsh-ba-details pre{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;line-height:1.45;opacity:.85}',
      '[data-blender-annotate] .dsh-ba-tabs{display:flex;gap:4px;margin-bottom:8px}',
      '[data-blender-annotate] .dsh-ba-list{display:flex;flex-direction:column;gap:6px}',
      '[data-blender-annotate] .dsh-ba-item{display:grid;grid-template-columns:22px 1fr auto;gap:6px 8px;align-items:start;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}',
      '[data-blender-annotate] .dsh-ba-item .dsh-ba-num{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;color:#1b1300;background:#ffb020}',
      '[data-blender-annotate] .dsh-ba-item p{margin:2px 0 0;font-size:12px;overflow-wrap:anywhere}',
      '[data-blender-annotate] .dsh-ba-notice{position:absolute;left:50%;top:10px;transform:translateX(-50%);padding:4px 10px;border-radius:999px;background:rgba(9,13,20,.75);color:#dfe8f6;font-size:11px;pointer-events:none;white-space:nowrap}',
      '[data-ba-editor]{position:fixed;inset:0;z-index:100001;background:rgba(8,10,14,.72);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
      '[data-ba-editor] .ba-editor-panel{display:flex;flex-direction:column;gap:10px;max-width:94vw;max-height:92vh;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);border-radius:12px;padding:12px;box-shadow:0 18px 60px rgba(0,0,0,.35)}',
      '[data-ba-editor] .ba-editor-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '[data-ba-editor] .ba-editor-toolbar button,[data-ba-editor] .ba-editor-textbar button{appearance:none;border:1px solid rgba(0,0,0,.12);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;cursor:pointer;background:transparent;color:inherit}',
      '[data-ba-editor] .ba-editor-toolbar button[data-active=true]{background:#2c6ef2;color:#fff;border-color:#2c6ef2}',
      '[data-ba-editor] .ba-editor-toolbar button[data-color]{width:22px;height:22px;padding:0;border-radius:999px}',
      '[data-ba-editor] .ba-editor-toolbar button[data-color][data-active=true]{outline:2px solid #111;outline-offset:2px}',
      '[data-ba-editor] .ba-editor-spacer{flex:1 1 auto}',
      '[data-ba-editor] .ba-editor-textbar{display:flex;gap:6px;align-items:center}',
      '[data-ba-editor] .ba-editor-textbar input{flex:1 1 auto;min-width:180px;border:1px solid rgba(0,0,0,.18);border-radius:7px;padding:6px 8px;font:inherit;font-size:12px;background:transparent;color:inherit}',
      '[data-ba-editor] canvas{display:block;max-width:90vw;max-height:72vh;width:auto;height:auto;background:#fff;border-radius:8px;cursor:crosshair;touch-action:none}',
      '[data-ba-editor] .ba-editor-hint{font-size:11px;opacity:.55}',
    ].join("\n");

    /** Install the scoped stylesheet once per document. */
    function installStyle() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-blender-annotate/client.css";
      if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-blender-annotate";
      tag.dataset.pluginCss = tagId;
      tag.textContent = STYLE;
      document.head.appendChild(tag);
    }

    /** Fill `{key}` placeholders. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
      );
    }

    /** A final path segment. */
    function basenameOf(path) {
      if (typeof path !== "string") return "";
      const normalized = path.replaceAll("\\", "/");
      return normalized.slice(normalized.lastIndexOf("/") + 1);
    }

    /** Human byte size, or the empty string when unknown. */
    function formatBytes(bytes) {
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1);
      return rounded + " " + units[unit];
    }

    /** Thousands separators without depending on the UI locale. */
    function formatCount(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "0";
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    /** One dimension triple in millimetres. */
    function formatSize(values) {
      if (!Array.isArray(values) || values.length < 3) return "—";
      return values
        .slice(0, 3)
        .map((value) => (typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "0"))
        .join(" × ") + " mm";
    }

    /** The route the Host half actually registered, as injected at boot. */
    function configuredConfig() {
      const config = globalThis.__DSH_BLENDER_ANNOTATE_CONFIG__;
      const routePath =
        typeof config === "object" && config !== null && typeof config.routePath === "string" && config.routePath !== ""
          ? config.routePath
          : DEFAULT_ROUTE_PATH;
      const extensions =
        typeof config === "object" && config !== null && Array.isArray(config.extensions) && config.extensions.length > 0
          ? config.extensions.filter((entry) => typeof entry === "string" && entry !== "")
          : DEFAULT_EXTENSIONS;
      return { routePath, extensions };
    }

    /** The route URL for one artifact of one file version. */
    function assetUrl(routePath, absolutePath, kind, version) {
      return (
        routePath +
        "?path=" +
        encodeURIComponent(absolutePath) +
        "&kind=" +
        encodeURIComponent(kind) +
        "&v=" +
        encodeURIComponent(version)
      );
    }

    /** The material swatch for one scene object. */
    function swatchFor(object, materials) {
      const names = Array.isArray(object.materials) ? object.materials.filter(Boolean) : [];
      for (const name of names) {
        const material = materials.find((entry) => entry.name === name);
        if (material && typeof material.hex === "string") return material.hex;
      }
      return "#8a94a6";
    }

    // ------------------------------------------------------------ annotations
    const TARGETS = ["point", "face", "edge", "vertex", "object"];
    const TARGET_LABEL = { point: "targetPoint", face: "targetFace", edge: "targetEdge", vertex: "targetVertex", object: "targetObject" };
    const PRECISION_LABEL = { exact: "precisionExact", "modified-surface": "precisionModified", "modifier-copy": "precisionCopy", object: "precisionObject", face: "precisionObject" };
    const SKETCH_COLORS = ["#e11d48", "#f59e0b", "#2563eb", "#16a34a"];
    const STORE_PREFIX = "dsh-blender-annotate:v1:";

    function loadAnnotations(path) {
      try {
        const raw = window.localStorage.getItem(STORE_PREFIX + path);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && Array.isArray(parsed.items) ? parsed : { version: null, items: [] };
      } catch {
        return { version: null, items: [] };
      }
    }
    function storeAnnotations(path, version, items) {
      try {
        if (items.length === 0) window.localStorage.removeItem(STORE_PREFIX + path);
        else window.localStorage.setItem(STORE_PREFIX + path, JSON.stringify({ version, items }));
      } catch {
        // Storage full or blocked: annotations stay in memory for this view.
      }
    }

    /** Overlay geometry (glTF world) emphasising an annotation's target. */
    function overlayFor(viewer, item) {
      if (viewer === null || !item || !item.hit) return null;
      const r = item.resolved;
      const hit = item.hit;
      const outline = (points) => {
        const lines = [];
        for (let i = 0; i < points.length; i += 1) lines.push(...points[i], ...points[(i + 1) % points.length]);
        return lines;
      };
      if (item.target === "object") return { faces: viewer.trianglesOf(hit.nodeIndex, 0, null) };
      const faces = r && r.face !== null ? viewer.trianglesOf(hit.nodeIndex, hit.srcId, hit.faceId) : null;
      if (item.target === "face") return { faces, lines: r && r.snap ? outline(r.snap.faceOutline) : null };
      if (item.target === "edge" && r && r.snap) {
        return { faces, faceColor: [1, 0.72, 0.18, 0.14], lines: [...r.snap.edgeEnds[0], ...r.snap.edgeEnds[1]], lineColor: [1, 0.3, 0.3, 1] };
      }
      if (item.target === "vertex" && r && r.snap) {
        const p = r.snap.vertexPoint;
        const edge = r.snap.faceOutline;
        let size = 0.02;
        if (edge && edge.length > 1) size = Math.hypot(edge[0][0] - edge[1][0], edge[0][1] - edge[1][1], edge[0][2] - edge[1][2]) * 0.12;
        const lines = [];
        for (let a = 0; a < 3; a += 1) {
          const lo = p.slice(), hi = p.slice();
          lo[a] -= size; hi[a] += size;
          lines.push(...lo, ...hi);
        }
        return { faces, faceColor: [1, 0.72, 0.18, 0.14], lines, lineColor: [1, 0.3, 0.3, 1] };
      }
      return { faces, faceColor: [1, 0.72, 0.18, 0.22] };
    }

    /** The current 3D view with numbered pins burnt in, as a 2D canvas. */
    function snapshotWithPins(viewer, items) {
      const source = viewer.canvas;
      const out = document.createElement("canvas");
      out.width = source.width;
      out.height = source.height;
      const context = out.getContext("2d");
      if (context === null) throw new Error("canvas");
      const background = context.createLinearGradient(0, 0, 0, out.height);
      background.addColorStop(0, "#2a3446");
      background.addColorStop(1, "#0b0f16");
      context.fillStyle = background;
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(source, 0, 0);
      const rect = source.getBoundingClientRect();
      const scale = out.width / Math.max(rect.width, 1);
      const radius = 11 * scale;
      items.forEach((item, index) => {
        const at = viewer.project(item.anchor);
        if (!at.visible) return;
        const x = at.x * scale, y = at.y * scale;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = "#ffb020";
        context.fill();
        context.lineWidth = 2 * scale;
        context.strokeStyle = "#ffffff";
        context.stroke();
        context.fillStyle = "#1b1300";
        context.font = `700 ${Math.round(11 * scale)}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), x, y + 0.5);
      });
      return out;
    }

    function canvasToFile(canvas, stem) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) reject(new Error("encode"));
          else resolve(new File([blob], `${stem}-${Date.now()}.png`, { type: "image/png" }));
        }, "image/png");
      });
    }

    /** Markdown the agent receives: one block per annotation, numbered like the pins. */
    function buildMessage(t, fileName, filePath, items) {
      const lines = [`### ${t("messageTitle")} — \`${fileName}\``, `File: \`${filePath}\``, ""];
      items.forEach((item, index) => {
        lines.push(`**${index + 1}. ${item.comment.trim() || "(no comment)"}**`);
        lines.push(item.resolved ? describeResolved(item.resolved, item.target) : `- target: ${item.target}`);
        if (item.stale) lines.push("- note: recorded on an earlier version of this file");
        lines.push("");
      });
      return lines.join("\n");
    }

    function drawSketchShape(context, shape, lineWidth, font) {
      context.save();
      context.strokeStyle = shape.color;
      context.fillStyle = shape.color;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      const x = Math.min(shape.x1, shape.x2);
      const y = Math.min(shape.y1, shape.y2);
      const w = Math.abs(shape.x2 - shape.x1);
      const h = Math.abs(shape.y2 - shape.y1);
      if (shape.type === "rect") {
        context.strokeRect(x, y, w, h);
      } else if (shape.type === "ellipse") {
        context.beginPath();
        context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        context.stroke();
      } else if (shape.type === "arrow") {
        context.beginPath();
        context.moveTo(shape.x1, shape.y1);
        context.lineTo(shape.x2, shape.y2);
        context.stroke();
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
        const head = Math.max(10, lineWidth * 3);
        context.beginPath();
        context.moveTo(shape.x2, shape.y2);
        context.lineTo(shape.x2 - head * Math.cos(angle - 0.5), shape.y2 - head * Math.sin(angle - 0.5));
        context.moveTo(shape.x2, shape.y2);
        context.lineTo(shape.x2 - head * Math.cos(angle + 0.5), shape.y2 - head * Math.sin(angle + 0.5));
        context.stroke();
      } else if (shape.type === "text") {
        context.font = `600 ${font}px sans-serif`;
        context.textBaseline = "top";
        context.fillText(shape.text, shape.x1, shape.y1);
      }
      context.restore();
    }

    /** Free-form markup over the captured view (adapted from dsh-preview-snip's SnipEditor, MIT). */
    function SketchEditor({ src, width, height, t, onCancel, onCommit }) {
      const canvasRef = React.useRef(null);
      const imageRef = React.useRef(null);
      const startRef = React.useRef(null);
      const [tool, setTool] = React.useState("ellipse");
      const [color, setColor] = React.useState(SKETCH_COLORS[0]);
      const [shapes, setShapes] = React.useState([]);
      const [draft, setDraft] = React.useState(null);
      const [textAt, setTextAt] = React.useState(null);
      const [textValue, setTextValue] = React.useState("");
      const [busy, setBusy] = React.useState(false);

      const redraw = React.useCallback(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (canvas === null || image === null) return;
        const context = canvas.getContext("2d");
        if (context === null) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const lineWidth = Math.max(4, canvas.width / 260);
        const font = Math.max(22, canvas.width / 28);
        for (const shape of shapes) drawSketchShape(context, shape, lineWidth, font);
        if (draft !== null) drawSketchShape(context, draft, lineWidth, font);
      }, [shapes, draft]);

      React.useEffect(() => {
        const image = new Image();
        image.onload = () => {
          imageRef.current = image;
          const canvas = canvasRef.current;
          if (canvas !== null) {
            canvas.width = width;
            canvas.height = height;
            redraw();
          }
        };
        image.src = src;
      }, [src, width, height, redraw]);
      React.useEffect(() => { redraw(); }, [redraw]);

      const pointOf = (event) => {
        const canvas = canvasRef.current;
        if (canvas === null) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
      };
      const onPointerDown = (event) => {
        event.preventDefault();
        const point = pointOf(event);
        if (tool === "text") { setTextAt(point); setTextValue(""); return; }
        startRef.current = point;
        setDraft({ type: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color });
        event.currentTarget.setPointerCapture?.(event.pointerId);
      };
      const onPointerMove = (event) => {
        if (startRef.current === null) return;
        const point = pointOf(event);
        setDraft((previous) => (previous === null ? null : { ...previous, x2: point.x, y2: point.y }));
      };
      const onPointerUp = () => {
        if (startRef.current === null) return;
        startRef.current = null;
        setDraft((previous) => {
          if (previous !== null && Math.abs(previous.x2 - previous.x1) > 2 && Math.abs(previous.y2 - previous.y1) > 2) {
            setShapes((now) => [...now, previous]);
          }
          return null;
        });
      };
      const addText = () => {
        if (textAt === null || textValue.trim() === "") return;
        setShapes((previous) => [...previous, { type: "text", x1: textAt.x, y1: textAt.y, x2: textAt.x, y2: textAt.y, text: textValue, color }]);
        setTextAt(null);
        setTextValue("");
      };
      const insert = async () => {
        const canvas = canvasRef.current;
        if (canvas === null) return;
        setBusy(true);
        try { await onCommit(await canvasToFile(canvas, "blender-sketch")); } finally { setBusy(false); }
      };
      const toolButton = (id, label) =>
        React.createElement("button", { type: "button", key: id, "data-active": tool === id, onClick: () => setTool(id) }, t(label));

      return React.createElement(
        "div",
        { "data-ba-editor": true },
        React.createElement(
          "div",
          { className: "ba-editor-panel" },
          React.createElement(
            "div",
            { className: "ba-editor-toolbar" },
            toolButton("rect", "box"),
            toolButton("ellipse", "ellipse"),
            toolButton("arrow", "arrow"),
            toolButton("text", "text"),
            ...SKETCH_COLORS.map((value) =>
              React.createElement("button", { key: value, type: "button", "data-color": true, "data-active": color === value, title: value, style: { background: value }, onClick: () => setColor(value) })
            ),
            React.createElement("span", { className: "ba-editor-spacer" }),
            React.createElement("button", { type: "button", onClick: () => setShapes((previous) => previous.slice(0, -1)) }, t("undo")),
            React.createElement("button", { type: "button", onClick: () => setShapes([]) }, t("clear")),
            React.createElement("button", { type: "button", onClick: onCancel }, t("cancel")),
            React.createElement("button", { type: "button", disabled: busy, onClick: () => void insert() }, busy ? "…" : t("insert"))
          ),
          textAt === null
            ? null
            : React.createElement(
                "div",
                { className: "ba-editor-textbar" },
                React.createElement("input", {
                  autoFocus: true,
                  value: textValue,
                  placeholder: t("textPrompt"),
                  onChange: (event) => setTextValue(event.target.value),
                  onKeyDown: (event) => { if (event.key === "Enter") addText(); if (event.key === "Escape") setTextAt(null); },
                }),
                React.createElement("button", { type: "button", onClick: addText }, t("insert")),
                React.createElement("button", { type: "button", onClick: () => setTextAt(null) }, t("cancel"))
              ),
          React.createElement("canvas", { ref: canvasRef, width, height, onPointerDown, onPointerMove, onPointerUp }),
          React.createElement("p", { className: "ba-editor-hint" }, t("editor"))
        )
      );
    }

    /**
     * The preview body: fetch the scene JSON and the exported GLB, draw the
     * model, and show the scene facts underneath.
     * @param props - document body props plus the injected route and copy.
     * @returns the preview, or its loading/error state.
     */
    function BlendBody(props) {
      const { content, resourceAddress, useResource, t, routePath, inputActions, useInput, sessionId, createDraftsFor } = props;
      const composerDraft = typeof useInput === "function" ? useInput((input) => input.draft) : "";
      const meta = useResource(resourceAddress);
      const absolutePath = meta.value && meta.value.absolutePath ? meta.value.absolutePath : undefined;
      const version = meta.value && meta.value.version ? meta.value.version : "0";
      const revision = content !== undefined && content.kind === "renderer" ? content.revision : 0;
      const tRef = React.useRef(t);
      tRef.current = t;

      const viewerRef = React.useRef(null);
      const viewerErrorRef = React.useRef("");
      const [viewerError, setViewerError] = React.useState("");
      const [state, setState] = React.useState("loading");
      const [payload, setPayload] = React.useState(null);
      const [stats, setStats] = React.useState(null);
      const [failure, setFailure] = React.useState(null);
      const [attempt, setAttempt] = React.useState(0);
      const [elapsed, setElapsed] = React.useState(0);
      const [panelOpen, setPanelOpen] = React.useState(true);
      const [wireframe, setWireframe] = React.useState(false);
      const [autoRotate, setAutoRotate] = React.useState(false);
      const reported = React.useRef(-1);

      // Annotation state.
      const [annotating, setAnnotating] = React.useState(false);
      const [target, setTarget] = React.useState("point");
      const [annotations, setAnnotations] = React.useState([]);
      const [draft, setDraft] = React.useState(null);
      const [selectedId, setSelectedId] = React.useState(null);
      const [panelTab, setPanelTab] = React.useState("info");
      const [notice, setNotice] = React.useState("");
      const [sketch, setSketch] = React.useState(null);
      const resolverRef = React.useRef(null);
      const loadedRef = React.useRef(false);
      const pinElements = React.useRef({});
      const pinItemsRef = React.useRef([]);
      const occlusionAt = React.useRef(0);
      const clickRef = React.useRef(() => {});
      const viewRef = React.useRef(() => {});
      const noticeTimer = React.useRef(0);

      const flash = React.useCallback((message) => {
        setNotice(message);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(""), 2600);
      }, []);
      React.useEffect(() => () => clearTimeout(noticeTimer.current), []);

      const anchorFor = (item, nextTarget) => {
        const r = item.resolved;
        if (nextTarget === "edge" && r && r.snap) return r.snap.edgePoint;
        if (nextTarget === "vertex" && r && r.snap) return r.snap.vertexPoint;
        return item.hit.point;
      };

      // Click on the model (no drag) while annotating: resolve and open a draft.
      clickRef.current = (clientX, clientY) => {
        const viewer = viewerRef.current;
        if (!annotating || viewer === null || state !== "ready") return;
        const hit = viewer.pick(clientX, clientY);
        if (hit === null) {
          flash(t("noHit"));
          return;
        }
        const resolved = resolverRef.current !== null ? resolverRef.current.resolve(hit) : null;
        const item = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          target,
          hit: { nodeIndex: hit.nodeIndex, nodeName: hit.nodeName, srcId: hit.srcId, faceId: hit.faceId, point: hit.point, normal: hit.normal },
          resolved,
          view: viewer.getView(),
          comment: "",
          stale: false,
        };
        item.anchor = anchorFor(item, target);
        setDraft(item);
        setSelectedId(null);
      };

      const changeTarget = (next) => {
        setTarget(next);
        setDraft((current) => (current === null ? current : { ...current, target: next, anchor: anchorFor(current, next) }));
      };

      // Keep the pins glued to the model while orbiting (direct DOM writes, no React render per frame).
      viewRef.current = () => {
        const viewer = viewerRef.current;
        if (viewer === null) return;
        const rect = viewer.canvas.getBoundingClientRect();
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const checkOcclusion = now - occlusionAt.current > 140;
        if (checkOcclusion) occlusionAt.current = now;
        for (const item of pinItemsRef.current) {
          const element = pinElements.current[item.id];
          if (!element) continue;
          const at = viewer.project(item.anchor);
          const offscreen = !at.visible || at.x < -12 || at.y < -12 || at.x > rect.width + 12 || at.y > rect.height + 12;
          element.dataset.offscreen = offscreen ? "true" : "false";
          if (offscreen) continue;
          element.style.transform = `translate(${at.x}px, ${at.y}px)`;
          if (checkOcclusion) element.dataset.occluded = viewer.isUnoccluded(item.anchor) ? "false" : "true";
        }
      };
      pinItemsRef.current = draft === null ? annotations : [...annotations, draft];
      React.useLayoutEffect(() => {
        occlusionAt.current = 0;
        viewRef.current();
      }, [annotations, draft]);

      // Highlight the draft, or the selected saved annotation.
      React.useEffect(() => {
        const viewer = viewerRef.current;
        if (viewer === null || state !== "ready") return;
        const item = draft !== null ? draft : annotations.find((entry) => entry.id === selectedId);
        viewer.setOverlay(item ? overlayFor(viewer, item) : null);
      }, [draft, selectedId, annotations, state]);

      // Persist per file; annotations from an older file version are kept and flagged.
      React.useEffect(() => {
        if (!loadedRef.current || absolutePath === undefined) return;
        storeAnnotations(absolutePath, version, annotations);
      }, [annotations, absolutePath, version]);

      const settle = React.useCallback(
        (ok, fileVersion) => {
          if (reported.current === revision) return;
          reported.current = revision;
          if (content === undefined || content.kind !== "renderer") return;
          if (ok) content.loaded(fileVersion);
          else content.failed();
        },
        [content, revision]
      );
      const settleRef = React.useRef(settle);
      settleRef.current = settle;

      // The canvas only exists once the resource metadata resolves, so the
      // viewer is created from the ref callback rather than a mount effect.
      const attachCanvas = React.useCallback((node) => {
        if (node === null) {
          viewerRef.current?.dispose();
          viewerRef.current = null;
          return;
        }
        if (viewerRef.current !== null) return;
        try {
          viewerRef.current = createViewer(node, {
            onClick: (x, y) => clickRef.current(x, y),
            onView: () => viewRef.current(),
          });
          viewerErrorRef.current = "";
          setViewerError("");
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          viewerErrorRef.current = message;
          setViewerError(message);
          // The failure is shown in the overlay; the console line keeps the
          // shader/context detail reachable when the overlay is not enough.
          console.error("[blender-annotate] viewer init failed:", error);
        }
      }, []);

      React.useEffect(() => {
        viewerRef.current?.setWireframe(wireframe);
      }, [wireframe]);

      React.useEffect(() => {
        viewerRef.current?.setAutoRotate(autoRotate);
      }, [autoRotate]);

      React.useEffect(() => {
        if (absolutePath === undefined) return undefined;
        const controller = new AbortController();
        let tick = 0;
        const timer = setInterval(() => {
          tick += 1;
          setElapsed(tick);
        }, 1000);
        loadedRef.current = false;
        setState("loading");
        setFailure(null);
        setPayload(null);
        setStats(null);
        setElapsed(0);

        (async () => {
          const infoResponse = await fetch(assetUrl(routePath, absolutePath, "info", version), {
            signal: controller.signal,
            credentials: "same-origin",
          });
          const infoBody = await infoResponse.json().catch(() => null);
          if (!infoResponse.ok) {
            throw infoBody && infoBody.error ? infoBody.error : { message: tRef.current("readFailed"), code: "HTTP_" + String(infoResponse.status) };
          }
          if (controller.signal.aborted) return;
          setPayload(infoBody);
          setState("exporting");

          const glbResponse = await fetch(assetUrl(routePath, absolutePath, "glb", version), {
            signal: controller.signal,
            credentials: "same-origin",
          });
          if (!glbResponse.ok) {
            const glbBody = await glbResponse.json().catch(() => null);
            throw glbBody && glbBody.error ? glbBody.error : { message: tRef.current("readFailed"), code: "HTTP_" + String(glbResponse.status) };
          }
          const bytes = await glbResponse.arrayBuffer();
          if (controller.signal.aborted) return;
          const viewer = viewerRef.current;
          if (viewer === null) {
            const detail = viewerErrorRef.current;
            throw {
              message: tRef.current("webglMissing") + (detail === "" ? "" : " " + detail),
              code: "WEBGL_MISSING",
            };
          }
          const modelStats = viewer.setModel(bytes);
          const sceneInfo = infoBody && infoBody.scene ? infoBody.scene : null;
          resolverRef.current = sceneInfo && sceneInfo.annotate
            ? createResolver(sceneInfo.annotate, sceneInfo.unit ? sceneInfo.unit.millimeters_per_unit : 1000)
            : null;
          const stored = loadAnnotations(absolutePath);
          const changed = stored.version !== null && stored.version !== version;
          loadedRef.current = true;
          setAnnotations(stored.items.map((item) => (changed ? { ...item, stale: true } : item)));
          if (stored.items.length > 0) setPanelTab("annotations");
          setDraft(null);
          setStats(modelStats);
          setState("ready");
          settleRef.current(true, version);
        })().catch((error) => {
          if (controller.signal.aborted) return;
          setFailure({
            code: typeof error?.code === "string" ? error.code : "UNKNOWN",
            message: error instanceof Error ? error.message : String(error?.message ?? error),
            hint: error?.hint,
            detail: error?.detail,
          });
          setState("failed");
          settleRef.current(false, version);
        });

        return () => {
          controller.abort();
          clearInterval(timer);
        };
      }, [absolutePath, version, attempt, routePath]);

      if (absolutePath === undefined) {
        const failed = meta.status === "failed";
        return React.createElement(
          "div",
          { "data-blender-annotate": true, "data-blend-state": failed ? "failed" : "loading" },
          React.createElement(
            "div",
            { className: "dsh-bp-viewport" },
            React.createElement(
              "div",
              { className: "dsh-bp-overlay" },
              failed
                ? React.createElement(
                    "div",
                    { className: "dsh-bp-card", "data-tone": "error" },
                    React.createElement("p", { className: "dsh-bp-title" }, t("failed")),
                    React.createElement("p", { className: "dsh-bp-text" }, t("readFailed")),
                    React.createElement(
                      "button",
                      { type: "button", className: "dsh-bp-button", onClick: () => setAttempt((value) => value + 1) },
                      t("retry")
                    )
                  )
                : React.createElement(
                    "div",
                    { className: "dsh-bp-card" },
                    React.createElement("div", { className: "dsh-bp-spinner" }),
                    React.createElement("p", { className: "dsh-bp-text" }, t("preparing"))
                  )
            )
          )
        );
      }

      const scene = payload && payload.scene ? payload.scene : null;
      const counts = scene && scene.counts ? scene.counts : null;
      const materials = scene && Array.isArray(scene.materials) ? scene.materials : [];
      const objects = scene && Array.isArray(scene.objects)
        ? scene.objects.filter((entry) => entry.type === "MESH" && entry.visible !== false)
        : [];
      const name = scene && scene.file_name ? scene.file_name : basenameOf(absolutePath);
      const triangles = stats !== null ? stats.triangles : counts !== null ? counts.triangles : 0;

      const attachFiles = (files) => {
        if (typeof createDraftsFor !== "function" || inputActions === undefined || typeof inputActions.addAttachments !== "function") return false;
        try {
          const ids = createDraftsFor(sessionId)(files);
          return inputActions.addAttachments(ids) !== false;
        } catch (error) {
          console.warn("[blender-annotate] attachment failed:", error);
          return false;
        }
      };

      const saveDraft = () => {
        if (draft === null) return;
        const saved = { ...draft, comment: draft.comment.trim() };
        setAnnotations((items) => [...items, saved]);
        setDraft(null);
        setSelectedId(saved.id);
        setPanelTab("annotations");
        setPanelOpen(true);
      };

      const send = async () => {
        const viewer = viewerRef.current;
        if (annotations.length === 0 || viewer === null) return;
        if (inputActions === undefined || typeof inputActions.setDraft !== "function") {
          flash(t("sendFailed"));
          return;
        }
        const message = buildMessage(t, name, absolutePath, annotations);
        const current = typeof composerDraft === "string" ? composerDraft : "";
        inputActions.setDraft(current.trim() === "" ? message : `${current}\n\n${message}`);
        try {
          const file = await canvasToFile(snapshotWithPins(viewer, annotations), "blender-annotations");
          attachFiles([file]);
        } catch (error) {
          console.warn("[blender-annotate] snapshot not attached:", error);
        }
        flash(t("sent"));
      };

      const openSketch = () => {
        const viewer = viewerRef.current;
        if (viewer === null) return;
        const capture = snapshotWithPins(viewer, draft === null ? annotations : [...annotations, draft]);
        setSketch({ src: capture.toDataURL("image/png"), width: capture.width, height: capture.height });
      };

      const loading = state === "loading" || state === "exporting";
      const toolbar = React.createElement(
        "div",
        { className: "dsh-bp-toolbar" },
        React.createElement("div", { className: "dsh-bp-name", title: absolutePath }, name),
        React.createElement(
          "div",
          { className: "dsh-bp-actions" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("reset") + " (Home)",
              "data-blend-action": "reset",
              onClick: () => viewerRef.current?.resetView(),
            },
            t("reset")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("wireframe"),
              "data-blend-action": "wireframe",
              "data-active": wireframe ? "true" : "false",
              "aria-pressed": wireframe ? "true" : "false",
              onClick: () => setWireframe((value) => !value),
            },
            t("wireframe")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("spin"),
              "data-blend-action": "spin",
              "data-active": autoRotate ? "true" : "false",
              "aria-pressed": autoRotate ? "true" : "false",
              onClick: () => setAutoRotate((value) => !value),
            },
            t("spin")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              title: t("info"),
              "data-blend-action": "info",
              "data-active": panelOpen ? "true" : "false",
              "aria-pressed": panelOpen ? "true" : "false",
              onClick: () => setPanelOpen((value) => !value),
            },
            t("info")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              "data-blend-action": "annotate",
              "data-active": annotating ? "true" : "false",
              "aria-pressed": annotating ? "true" : "false",
              disabled: state !== "ready",
              onClick: () => {
                setAnnotating((value) => !value);
                if (annotating) setDraft(null);
              },
            },
            t("annotate")
          ),
          React.createElement(
            "button",
            { type: "button", className: "dsh-bp-button", "data-blend-action": "sketch", disabled: state !== "ready", onClick: openSketch },
            t("sketch")
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "dsh-bp-button",
              "data-blend-action": "send",
              disabled: state !== "ready" || annotations.length === 0,
              onClick: () => void send(),
            },
            t("send") + (annotations.length > 0 ? ` (${annotations.length})` : "")
          )
        ),
        annotating
          ? React.createElement(
              "div",
              { className: "dsh-ba-targets", role: "radiogroup", "aria-label": t("annotate") },
              TARGETS.map((id) =>
                React.createElement(
                  "button",
                  {
                    key: id,
                    type: "button",
                    role: "radio",
                    className: "dsh-bp-button",
                    "data-blend-target": id,
                    "data-active": target === id ? "true" : "false",
                    "aria-checked": target === id ? "true" : "false",
                    onClick: () => changeTarget(id),
                  },
                  t(TARGET_LABEL[id])
                )
              )
            )
          : null
      );

      const overlay = loading
        ? React.createElement(
            "div",
            { className: "dsh-bp-overlay" },
            React.createElement(
              "div",
              { className: "dsh-bp-card" },
              React.createElement("div", { className: "dsh-bp-spinner" }),
              React.createElement("p", { className: "dsh-bp-title" }, t("loading")),
              React.createElement("p", { className: "dsh-bp-text" }, t("loadingHint")),
              React.createElement("p", { className: "dsh-bp-text", "data-blend-elapsed": true }, fill(t("elapsed"), { seconds: elapsed }))
            )
          )
        : state === "failed"
          ? React.createElement(
              "div",
              { className: "dsh-bp-overlay" },
              React.createElement(
                "div",
                { className: "dsh-bp-card", "data-tone": "error" },
                React.createElement("p", { className: "dsh-bp-title" }, t("failed")),
                React.createElement("p", { className: "dsh-bp-code", "data-blend-error-code": true }, failure?.code ?? ""),
                React.createElement("p", { className: "dsh-bp-text", "data-blend-error-message": true }, failure?.message ?? ""),
                failure?.hint ? React.createElement("p", { className: "dsh-bp-text" }, failure.hint) : null,
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-bp-button",
                    "data-blend-action": "retry",
                    onClick: () => setAttempt((value) => value + 1),
                  },
                  t("retry")
                ),
                failure?.detail
                  ? React.createElement(
                      "details",
                      { className: "dsh-bp-details" },
                      React.createElement("summary", null, t("details")),
                      React.createElement("pre", null, failure.detail)
                    )
                  : null
              )
            )
          : null;

      const viewport = React.createElement(
        "div",
        { className: "dsh-bp-viewport" },
        React.createElement("canvas", {
          ref: attachCanvas,
          className: "dsh-bp-canvas",
          "data-blend-canvas": true,
          "data-annotating": annotating ? "true" : "false",
          tabIndex: 0,
          "aria-label": name,
        }),
        React.createElement(
          "div",
          { className: "dsh-ba-pins", "data-blend-pins": true },
          pinItemsRef.current.map((item) => {
            const isDraft = draft !== null && item.id === draft.id;
            const number = isDraft ? annotations.length + 1 : annotations.indexOf(item) + 1;
            return React.createElement(
              "div",
              {
                key: item.id,
                ref: (element) => {
                  if (element === null) delete pinElements.current[item.id];
                  else pinElements.current[item.id] = element;
                },
                className: "dsh-ba-pin",
                "data-draft": isDraft ? "true" : "false",
                "data-offscreen": "true",
                title: item.resolved ? selectorOf(item.resolved, item.target) : item.hit.nodeName,
                onClick: () => {
                  if (isDraft) return;
                  setSelectedId(item.id);
                  setPanelTab("annotations");
                  setPanelOpen(true);
                },
              },
              String(number)
            );
          })
        ),
        notice !== "" ? React.createElement("div", { className: "dsh-ba-notice", "data-blend-notice": true }, notice) : null,
        draft !== null
          ? React.createElement(
              "div",
              { className: "dsh-ba-draft", "data-blend-draft": true },
              React.createElement(
                "div",
                { className: "dsh-ba-selector" },
                `${annotations.length + 1}. ` + (draft.resolved ? selectorOf(draft.resolved, draft.target) : draft.hit.nodeName)
              ),
              React.createElement(
                "div",
                { className: "dsh-ba-meta" },
                t(TARGET_LABEL[draft.target]) + " · " + t(PRECISION_LABEL[draft.resolved ? draft.resolved.precision : "object"] || "precisionObject")
              ),
              React.createElement("textarea", {
                autoFocus: true,
                value: draft.comment,
                placeholder: t("commentPlaceholder"),
                onChange: (event) => {
                  const value = event.target.value;
                  setDraft((current) => (current === null ? current : { ...current, comment: value }));
                },
                onKeyDown: (event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) saveDraft();
                  if (event.key === "Escape") setDraft(null);
                },
              }),
              draft.resolved
                ? React.createElement(
                    "details",
                    { className: "dsh-ba-details" },
                    React.createElement("summary", null, t("details")),
                    React.createElement("pre", null, describeResolved(draft.resolved, draft.target))
                  )
                : null,
              React.createElement(
                "div",
                { className: "dsh-ba-row" },
                React.createElement("button", { type: "button", className: "dsh-bp-button", onClick: () => setDraft(null) }, t("cancel")),
                React.createElement("button", { type: "button", className: "dsh-bp-button", "data-active": "true", "data-blend-action": "save-annotation", onClick: saveDraft }, t("save"))
              )
            )
          : null,
        state === "ready"
          ? React.createElement(
              "div",
              { className: "dsh-bp-badge", "data-blend-badge": true },
              formatCount(triangles) + " " + t("triangles")
            )
          : null,
        state === "ready" && draft === null ? React.createElement("div", { className: "dsh-bp-hint" }, annotating ? t("annotateHint") : t("hint")) : null,
        overlay,
        viewerError !== "" && state !== "failed"
          ? React.createElement(
              "div",
              { className: "dsh-bp-overlay" },
              React.createElement(
                "div",
                { className: "dsh-bp-card", "data-tone": "error" },
                React.createElement("p", { className: "dsh-bp-title" }, t("failed")),
                React.createElement("p", { className: "dsh-bp-text" }, t("webglMissing")),
                React.createElement("p", { className: "dsh-bp-code" }, viewerError)
              )
            )
          : null
      );

      const summaryRows = [];
      if (scene !== null) {
        summaryRows.push([t("size"), formatSize(scene.bounds ? scene.bounds.size_mm : null)]);
        summaryRows.push([t("objects"), formatCount(counts ? counts.visible_meshes : objects.length)]);
        summaryRows.push([t("triangles"), formatCount(triangles)]);
        summaryRows.push([t("materials"), formatCount(counts ? counts.materials : materials.length)]);
        if (counts && (counts.cameras > 0 || counts.lights > 0)) {
          summaryRows.push([t("cameras"), formatCount(counts.cameras)]);
          summaryRows.push([t("lights"), formatCount(counts.lights)]);
        }
        summaryRows.push([t("scene"), scene.scene ?? "—"]);
        summaryRows.push([t("unit"), scene.unit ? `${scene.unit.length_unit} (${scene.unit.millimeters_per_unit} mm/unit)` : "—"]);
      }

      const objectRows = objects.map((entry) =>
        React.createElement(
          "tr",
          { key: entry.name, "data-blend-object": entry.name },
          React.createElement(
            "td",
            null,
            React.createElement("span", {
              className: "dsh-bp-swatch",
              style: { background: swatchFor(entry, materials) },
            }),
            entry.name
          ),
          React.createElement("td", { className: "num" }, formatCount(entry.triangles)),
          React.createElement("td", { className: "num" }, formatSize(entry.dims_mm))
        )
      );

      const tabs = React.createElement(
        "div",
        { className: "dsh-ba-tabs", role: "tablist" },
        React.createElement(
          "button",
          { type: "button", role: "tab", className: "dsh-bp-button", "data-active": panelTab === "info" ? "true" : "false", "aria-selected": panelTab === "info", onClick: () => setPanelTab("info") },
          t("info")
        ),
        React.createElement(
          "button",
          {
            type: "button",
            role: "tab",
            className: "dsh-bp-button",
            "data-blend-tab": "annotations",
            "data-active": panelTab === "annotations" ? "true" : "false",
            "aria-selected": panelTab === "annotations",
            onClick: () => setPanelTab("annotations"),
          },
          t("annotations") + (annotations.length > 0 ? ` (${annotations.length})` : "")
        )
      );

      const annotationList = annotations.length === 0
        ? React.createElement("p", { className: "dsh-bp-text", style: { color: "inherit", opacity: 0.6 } }, t("noAnnotations"))
        : React.createElement(
            "div",
            { className: "dsh-ba-list", "data-blend-annotations": true },
            annotations.map((item, index) =>
              React.createElement(
                "div",
                { className: "dsh-ba-item", key: item.id, "data-selected": item.id === selectedId ? "true" : "false", style: item.id === selectedId ? { background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04))" } : undefined },
                React.createElement("span", { className: "dsh-ba-num" }, String(index + 1)),
                React.createElement(
                  "div",
                  { style: { minWidth: 0 } },
                  React.createElement("div", { className: "dsh-ba-selector" }, item.resolved ? selectorOf(item.resolved, item.target) : item.hit.nodeName),
                  React.createElement(
                    "div",
                    { className: "dsh-ba-meta" },
                    t(TARGET_LABEL[item.target]) + " · " + t(PRECISION_LABEL[item.resolved ? item.resolved.precision : "object"] || "precisionObject") + (item.stale ? " · " + t("stale") : "")
                  ),
                  item.comment ? React.createElement("p", null, item.comment) : null
                ),
                React.createElement(
                  "div",
                  { className: "dsh-ba-row", style: { flexWrap: "nowrap" } },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "dsh-bp-button",
                      onClick: () => {
                        viewerRef.current?.setView(item.view);
                        setSelectedId(item.id);
                      },
                    },
                    t("goTo")
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "dsh-bp-button",
                      onClick: () => {
                        setAnnotations((items) => items.filter((entry) => entry.id !== item.id));
                        if (selectedId === item.id) setSelectedId(null);
                      },
                    },
                    t("remove")
                  )
                )
              )
            )
          );

      const infoContent = scene === null
          ? React.createElement("p", { className: "dsh-bp-text" }, t("noSceneInfo"))
          : React.createElement(
              React.Fragment,
              null,
              React.createElement(
                "div",
                { className: "dsh-bp-summary" },
                summaryRows.map(([label, value]) =>
                  React.createElement(
                    "div",
                    { className: "dsh-bp-kv", key: label },
                    React.createElement("span", null, label),
                    React.createElement("span", { title: value }, value)
                  )
                )
              ),
              objectRows.length > 0
                ? React.createElement(
                    "table",
                    { className: "dsh-bp-table" },
                    React.createElement(
                      "thead",
                      null,
                      React.createElement(
                        "tr",
                        null,
                        React.createElement("th", null, t("objects")),
                        React.createElement("th", { className: "num" }, t("triangles")),
                        React.createElement("th", { className: "num" }, t("size"))
                      )
                    ),
                    React.createElement("tbody", null, objectRows)
                  )
                : null,
              materials.length > 0
                ? React.createElement(
                    "div",
                    { className: "dsh-bp-materials" },
                    materials.map((material) =>
                      React.createElement(
                        "span",
                        { className: "dsh-bp-chip", key: material.name, title: material.name },
                        React.createElement("span", {
                          className: "dsh-bp-swatch",
                          style: { background: material.hex || "#8a94a6", marginRight: "0" },
                        }),
                        material.name
                      )
                    )
                  )
                : null,
              React.createElement(
                "div",
                { className: "dsh-bp-footer" },
                React.createElement(
                  "span",
                  null,
                  fill(t("exportMeta"), {
                    blender: payload && payload.blender ? payload.blender : scene.blender ?? "Blender",
                    size: formatBytes(payload && payload.cache ? payload.cache.glbBytes : 0),
                    time:
                      payload && payload.cache && payload.cache.cached
                        ? t("cached")
                        : fill(t("exportedIn"), {
                            seconds:
                              payload && payload.cache && typeof payload.cache.elapsedMs === "number"
                                ? (payload.cache.elapsedMs / 1000).toFixed(1)
                                : "?",
                          }),
                  })
                ),
                counts !== null && typeof counts.collections === "number"
                  ? React.createElement("span", null, `${t("collections")}: ${formatCount(counts.collections)}`)
                  : null
              )
            );

      const panel = React.createElement(
        "div",
        { className: "dsh-bp-panel", "data-blend-panel": true, "data-open": panelOpen ? "true" : "false" },
        tabs,
        panelTab === "annotations" ? annotationList : infoContent
      );

      return React.createElement(
        "div",
        {
          "data-blender-annotate": true,
          "data-blend-state": state,
          "data-blend-triangles": String(triangles),
        },
        toolbar,
        viewport,
        panel,
        sketch === null
          ? null
          : React.createElement(SketchEditor, {
              src: sketch.src,
              width: sketch.width,
              height: sketch.height,
              t,
              onCancel: () => setSketch(null),
              onCommit: async (file) => {
                if (attachFiles([file])) flash(t("sketchAdded"));
                else flash(t("sendFailed"));
                setSketch(null);
              },
            })
      );
    }

    const inject = ["slots", "locale", "resources", "documentPreviews", "sessions"];

    /**
     * Register the Blender renderer and its body for the plugin's lifetime.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      installStyle();
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "blender-annotate: dictionaries");
      const config = configuredConfig();
      // Composer attachments go through the session's conversation service, as in dsh-preview-snip.
      const createDraftsFor = (sessionId) => (files) => {
        const scope = ctx.sessions?.scope?.(sessionId);
        const conversation = scope?.get?.("conversation");
        if (conversation === undefined) throw new Error("conversation unavailable");
        return conversation.createDrafts(sessionId, files).map((draft) => draft.id);
      };
      const bodyInject = () => ({ routePath: config.routePath, t, createDraftsFor });
      ctx.effect(
        () =>
          ctx.documentPreviews.register({
            id: BODY_ID,
            extensions: config.extensions,
            binaryExtensions: config.extensions,
            priority: "extension",
            title: () => t("blender"),
            loading: "renderer",
            wrap: false,
          }),
        "blender-annotate: metadata"
      );
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.right.tab.document", () =>
            ctx.slots.register(
              {
                name: "sidebar.right.tab.document",
                key: BODY_ID,
                locale: NS,
                inject: bodyInject,
              },
              BlendBody
            )
          ),
        "blender-annotate: body"
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__createViewer = createViewer;
    return module.exports;
  },
});
