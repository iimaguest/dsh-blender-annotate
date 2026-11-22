# dsh-blender-annotate

Preview **and precisely annotate** Blender `.blend` files in the DeepSeek Harness right-sidebar file preview.

Fork of [dsh-preview-blender](https://github.com/439436269-ctrl/dsh-preview-blender) (headless Blender → cached GLB → WebGL viewer) with the annotation editor of [dsh-preview-snip](https://github.com/439436269-ctrl/dsh-preview-snip), both MIT by 439436269-ctrl.

## What it adds

Turn on **Annotate** and click the model. Every clicked point resolves to:

| Field | Source |
|---|---|
| Object, instance, collection, parent, custom properties | glTF node name + scene JSON |
| Source face index, mesh, material | `_DSH_FACE` / `_DSH_SRC` attributes written by Blender's glTF exporter |
| Faces cut by a Boolean | attributed to the cutter object and its own face |
| In-face parameters | barycentric (tri), bilinear s,t (quad), mean-value weights (n-gon) on the source face |
| Nearest edge (with `t` along it) and nearest vertex | source (pre-modifier) mesh |
| UV, local and world coordinates (mm), normal | GLB + unit scale |
| `bpy` line to reach the element | e.g. `me = bpy.data.objects["Body"].data; me.polygons[5]` |

Targets: **Point · Face · Edge · Vertex · Object**. Edge and vertex snap the pin to the source edge/vertex and highlight it; face and object highlight the surface.

- Pins stay attached to the model while you orbit; hidden pins fade.
- **Sketch** opens the snip editor (box, circle, arrow, text) over the current view with numbered pins burnt in.
- **Send to chat** writes all annotations (selector, parameters, coordinates, `bpy` line, comment) into the composer and attaches a pinned snapshot.
- Annotations are stored per file in the browser and flagged when the file changes.

## How identities survive modifiers

Before exporting (in Blender's background session; the file is never saved) each mesh gets integer attributes `_dsh_face`, `_dsh_vert`, `_dsh_src`. Blender propagates generic attributes through Bevel, Subsurf, Mirror, Array, Solidify and Boolean, and the glTF exporter keeps attributes whose names start with `_` (`export_attributes=True`). Every exported triangle therefore carries exactly one source face id.

Precision is reported per annotation: `exact` (point lies on the source face), `modified-surface` (Bevel/Subsurf moved the surface; parameters are projected onto the source face), `modifier-copy` (a Mirror/Array copy; parameters are approximate), or `object` (no source geometry, e.g. linked library data or very large meshes).

## Requirements

- DeepSeek Harness 0.2.x, Blender 3.6+ (tested with Blender 4.2.23 LTS on macOS).
- Install from a local directory or Git; restart DSH after upgrading.

## Development

```sh
npm run build   # dev/client-body.js + dev/viewer.js + dev/resolve.js -> lib/client.js
npm test        # upstream tests + resolver tests against test/fixtures (real Blender export)
npm run fixture # regenerate the fixture with a `blender` on PATH
```
