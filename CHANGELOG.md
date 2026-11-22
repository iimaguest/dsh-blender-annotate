# Changelog

## 0.1.0 — fork

Forked from dsh-preview-blender 0.1.1 and dsh-preview-snip 0.3.1 (both MIT, 439436269-ctrl).

- Export tags every mesh with `_dsh_face`, `_dsh_vert`, `_dsh_src` (in memory; the .blend is never saved). Blender propagates them through modifiers and the glTF exporter writes them as `_DSH_*` vertex attributes (`export_attributes=True`).
- Scene JSON gains `annotate`: source geometry, transforms, modifier stacks and custom properties.
- Viewer keeps node identity and per-primitive ids, adds ray picking, highlight overlay, projection and occlusion checks.
- New resolver (`dev/resolve.js`): object, instance, source face (Boolean faces attributed to the cutter), in-face parameters (barycentric / bilinear / mean-value), nearest edge with t, nearest vertex, UV, local/world mm, normal, `bpy` access line.
- Annotate mode with Point / Face / Edge / Vertex / Object targets, 3D pins, comments, per-file persistence, Sketch (snip's editor) and Send to chat.
- Test: resolver checked against a real Blender export fixture; upstream cache test fixed for macOS (`realpath` of tmpdir).
