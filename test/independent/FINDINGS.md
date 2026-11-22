# Independent QA findings (baseline fe668dc)

Run: `npm run test:independent` (= `node --test test/independent/*.test.js`). Blender-dependent
suites skip when Blender is absent (`DSH_BLENDER` overrides the path). Expected values come from
Blender (fixtures/oracle.py on the original .blend), an independent GLB parser, camera and
ray caster, never from the resolver's own math. Every failing test below is a kept, genuine bug.

| # | Test (file) | Root cause |
|---|---|---|
| 1 | Mirror/Array copies coplanar with the source face are `exact` (resolve-groundtruth) | dev/resolve.js:253-254 classifies by plane offset only; never checks the projected point is inside the face |
| 2 | Collection-operand Boolean attributed to an unrelated linked duplicate (resolve-groundtruth) | dev/resolve.js:149-159 `operandFor` falls back to "first object using that mesh"; annotate records no collection operands (lib/scene.py:146-151) |
| 3 | Boolean cutter sharing the body's mesh: cut faces attributed to the body (resolve-groundtruth) | dev/resolve.js:151 returns the node object whenever srcId names its own mesh |
| 4 | Object-linked material slot ignored (resolve-groundtruth) | dev/resolve.js:181-182 reads mesh `materials`, not the object's `material_slots` |
| 5 | Mesh without materials gives `material: undefined` (resolve-groundtruth) | dev/resolve.js:182 indexes an empty array |
| 6 | Collection instance: instancer not reported (resolve-groundtruth) | resolver uses only `hit.nodeName` (instanced copies are named after the source object); README promises "instance" |
| 7 | Keep-transform child of rotated non-uniformly scaled parent: worldMm off by 778 mm, normal wrong (resolve-groundtruth) | glTF exporter decomposes the sheared local matrix into TRS; dev/resolve.js:196 trusts the GLB point instead of `annotate.objects[name].matrix_world` |
| 8 | Object target emits a polygon selector / bpy line (resolve-groundtruth) | dev/resolve.js:312, 354-359 ignore `target === "object"` |
| 9 | Re-imported glTF attributes `_DSH_*` override the tags: srcId 77, faceId 7 (scene-export) | lib/scene.py:98 removes only exact-case names; exporter upper-cases names, so both map to `_DSH_SRC` |
| 10 | Geometry-nodes instances missing from the GLB (scene-export) | lib/scene.py:288-297 omits `export_gn_mesh=True` (verified: with it the instances appear) |
| 11 | info `visible` true for objects in hidden/excluded collections (scene-export) | lib/scene.py:194 uses `hide_viewport`/`hide_get()` instead of `visible_get()` |
| 12 | Multi-scene file: other scene's object counted as visible (scene-export) | lib/scene.py:189 iterates `bpy.data.objects`, not the active scene |
| 13 | Local + linked objects with the same name: one dropped from annotate.objects (scene-export) | lib/scene.py:152 keys by `ob.name` (not `name_full`) |
| 14 | Shape-key result not drawn (viewer-pick) | exporter keeps basis + morph target (weight 1); dev/viewer.js:729-821 ignores `targets`/`weights` |
| 15 | Back-face picks on open surfaces report the inverted normal (viewer-pick) | dev/viewer.js:267 flips the normal toward the camera; resolver reports it as the world normal |
| 16 | Pin 0.59 % of scene radius behind another surface shown unoccluded (viewer-pick) | dev/viewer.js:331 tolerance `radius * 0.01` |
| 17 | `pointercancel` fires onClick (viewer-pick) | dev/viewer.js:591 registers `onPointerUp` for `pointercancel` |
| 18 | Stale flag lost when the file changes while the preview is open (client-ui) | dev/client-body.js:746-749 persist effect runs before the reload effect and rewrites the stored version to the new one; :850 then sees no change |
| 19 | Failure panel "Blender log" disclosure reads "Parameters" (client-ui) | duplicate `details` key in dev/client-body.js:61/80 (zh) and :129/148 (en) |
| 20 | SIGTERM-ignoring Blender hangs the request forever (host) | lib/blender.js:384-390 / 415-418 only `child.kill()` (SIGTERM), no SIGKILL escalation; the shared pending job never settles |
| 21 | Prune deletes another in-flight conversion's directory (host) | lib/blender.js:276-290 skips only `currentDirectory`; in-flight dirs have no model.glb, so mtime 0 sorts them first for deletion |
| 22 | `routePath: "/api/"` normalizes to `/api` (host) | lib/config.js:89-90 checks `/api/` before stripping trailing slashes |

Test-design notes: Array copies are spaced (relative offset 1.25) because adjacent copies produce
coincident internal faces whose face id is geometrically ambiguous; bevel corner polygons are
non-planar, so the id cross-check allows a 1e-2 gap between GLB and BVH triangulations.
