# dsh-blender-annotate

Preview **and precisely annotate** Blender `.blend` files in the DeepSeek Harness right-sidebar file preview.

Fork of [dsh-preview-blender](https://github.com/439436269-ctrl/dsh-preview-blender) (headless Blender → cached GLB → WebGL viewer) with the annotation editor of [dsh-preview-snip](https://github.com/439436269-ctrl/dsh-preview-snip), both MIT by 439436269-ctrl.

## What it adds

Turn on **Annotate** and click the model. Every clicked point resolves to:

| Field | Source |
|---|---|
| Exact point on the evaluated surface | export cache key + node/primitive/triangle + barycentric coordinates, retained as a structured JSON reference |
| Object, instance, collection, parent, custom properties | glTF node path + scene JSON; collection instancers are identified |
| Source face index, mesh, material | `_DSH_FACE` / `_DSH_SRC` attributes written by Blender's glTF exporter |
| Faces cut by a Boolean | attributed to the cutter object and its own face |
| In-face parameters | barycentric (tri), bilinear s,t (quad), mean-value weights (n-gon) on the source face |
| Nearest edge (with `t` along it) and nearest vertex | source (pre-modifier) mesh |
| UV, local and world coordinates (mm), normal | GLB + unit scale |
| `bpy` line to reach the element | e.g. `me = bpy.data.objects["Body"].data; me.polygons[5]` |

Targets: **Point · Face · Edge · Vertex · Object**. Edge and vertex snap the pin to the source edge/vertex and highlight it; face and object highlight the surface.

- Pins stay attached to the model while you orbit; hidden pins fade.
- **Sketch** opens the snip editor (box, circle, arrow, text) over the current view with numbered pins burnt in.
- **Send to chat** writes all annotations (selector, parameters, coordinates, `bpy` line, comment) into the composer and attaches a pinned snapshot. Each annotation also includes a machine-readable `dsh.blender.annotation.v1` JSON block with source path/version/cache key, evaluated-surface location and comment. Edge/vertex snap positions are labeled separately from the original clicked surface point.
- Annotations are stored per file in the browser and flagged when the file changes. Stale annotations remain in the list but are not drawn/highlighted against new geometry. They must be revalidated before applying an edit.
- Shape-key default weights, including sparse glTF morph accessors, are displayed. Geometry-nodes instances are exported; each clicked copy has a node index/path in its evaluated-surface reference.

## How identities survive modifiers

Before exporting (in Blender's background session; the file is never saved) writable meshes get integer attributes `_dsh_face`, `_dsh_vert`, `_dsh_src`. Blender propagates generic attributes through the tested Bevel, Subsurf, Mirror, Array, Solidify and Boolean cases, and the glTF exporter keeps `_`-prefixed custom attributes (`export_attributes=True`). These provide source provenance where available—not an unconditional stable topology guarantee for every modifier. Boolean operands sharing a mesh get a private in-memory copy so cutter provenance is unambiguous; the source files remain untouched.

Every successful surface pick retains an evaluated triangle plus barycentric weights, even if source provenance is unavailable. This precisely identifies the point **within that export revision**. Source-face indices and nearest pre-modifier edges/vertices are additional context, not a claim that a modifier-generated point is an original editable vertex.

Source-projection proximity is labeled `exact` (within the resolver's 2% source-face-radius tolerance), `modified-surface` or `modifier-copy`. These labels describe proximity to the source cage; they do not prove an unchanged one-to-one topology mapping. Read-only linked meshes may be object-only; very large source meshes may retain face IDs while omitting source coordinates (`face` precision). The precise evaluated point remains available in both cases.

## Limits

- Face parameters are projected onto the source face; edge/vertex targets snap to the pre-modifier cage, which can differ from the displayed surface.
- Node/triangle references are valid for the recorded export cache key; annotations are not automatically reattached after topology changes.
- Collection-instance placement is identified from recorded transforms. Generated geometry without a recoverable original face uses its evaluated-surface reference instead.
- Textures, skeletal skinning and animation playback are not implemented. Static shape-key mixes are supported.
- Rendering and interaction need a real WebGL-capable DSH page; automated CPU/DOM tests do not establish visual correctness in the live app.

## Install

DeepSeek Harness 0.2.x and Blender 3.6+ are required (tested with Blender 4.2.23 LTS on macOS).

Prebuilt tarball (no build step, no npm publishing):

```sh
dsh plugin --profile <profile> add https://github.com/iimaguest/dsh-blender-annotate/releases/latest/download/dsh-blender-annotate.tgz
```

Or install the repository source (also prebuilt `lib/`): `dsh plugin --profile <profile> add github:iimaguest/dsh-blender-annotate`. A bare checkout `link:` may fail to resolve DSH-provided modules such as `@deepseek-ai/schemastery`; use the tarball for a clean install.

Restart DSH when an update reports `restart-required`. The plugin is listed in the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog used by dsh-market.

## Requirements

- DSH-provided Client/Host packages are peer dependencies; do not bundle or install them.
- The `.blend` conversion runs your local Blender in the background. Nothing is uploaded.

## Development

```sh
npm run build   # dev/client-body.js + dev/viewer.js + dev/resolve.js -> lib/client.js
npm test        # upstream tests + resolver tests against test/fixtures (real Blender export)
npm run test:independent  # adversarial Blender-ground-truth, host, picker and UI tests
npm run fixture # regenerate glb/json fixtures (binary .blend is generated in a temp dir and not committed)
```
