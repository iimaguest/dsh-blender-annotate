# Changelog

## 0.1.2 — final interaction checks

- Protect nonempty unsaved comments from a second model click, and require Save/Cancel before sending a pending draft.
- Report when annotation text is added but a snapshot cannot be attached; preserve existing composer text without submitting chat.
- Fifteen new independent regressions cover exact point references, sparse shape-key accessors, same-origin GN instance transforms, read-only stale tags, revision-bound messages, stale visuals and feedback guards.

## 0.1.1 — independent QA fixes

- Fix the original independent test suite's 23 failing cases without modifying its tests: Boolean collection/shared-mesh attribution, object-linked materials, collection-instance identification, shear-aware transforms, object-target selectors, stale persistence, case-insensitive attribute collisions, active-scene visibility, linked-name collisions, GN instance exports, shape-key weights, geometric normals, occlusion, pointer cancellation, timeout escalation, pruning and route normalization.
- Retain evaluated node/path/primitive/triangle and barycentric coordinates for every surface pick; send an export-revision-bound JSON annotation with the comment. Label snapped edge/vertex coordinates separately from the original surface click.
- Decode sparse morph accessors, hide stale pins/highlights and bump export/cache recipe to 3 so older exports cannot bypass the fixes.
- Keep the original MIT licenses. Test dependencies stay in the development checkout, not the installed runtime package.

## 0.1.0 — fork

Forked from dsh-preview-blender 0.1.1 and dsh-preview-snip 0.3.1 (both MIT, 439436269-ctrl).

- Export tags every mesh with `_dsh_face`, `_dsh_vert`, `_dsh_src` (in memory; the .blend is never saved). Blender propagates them through modifiers and the glTF exporter writes them as `_DSH_*` vertex attributes (`export_attributes=True`).
- Scene JSON gains `annotate`: source geometry, transforms, modifier stacks and custom properties.
- Viewer keeps node identity and per-primitive ids, adds ray picking, highlight overlay, projection and occlusion checks.
- New resolver (`dev/resolve.js`): object, instance, source face (Boolean faces attributed to the cutter), in-face parameters (barycentric / bilinear / mean-value), nearest edge with t, nearest vertex, UV, local/world mm, normal, `bpy` access line.
- Annotate mode with Point / Face / Edge / Vertex / Object targets, 3D pins, comments, per-file persistence, Sketch (snip's editor) and Send to chat.
- Test: resolver checked against a real Blender export fixture; upstream cache test fixed for macOS (`realpath` of tmpdir).
