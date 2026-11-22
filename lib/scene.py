"""
Blender-side half of dsh-preview-blender.

Run by the Host as:

    blender --background --disable-autoexec --python-exit-code 1 \
            <scene.blend> --python scene.py -- <model.glb> <scene.json>

It exports the scene as GLB (Y-up, modifiers applied) and writes one JSON
document describing the scene for the preview's information panel. Everything
is written through `*.part` files and renamed, so the Host never serves a
half-written artifact.

The script has no dependencies beyond Blender's own `bpy` and `numpy`.

dsh-blender-annotate additions: before exporting, every mesh datablock gets
three in-memory attributes (the .blend file is never saved):

  _dsh_face  FACE   source polygon index + 1   (0 = made by a modifier)
  _dsh_vert  POINT  source vertex index + 1
  _dsh_src   FACE   index into `annotate.meshes` + 1 (which mesh a face came
                    from; differs from the object's own mesh for Boolean cutters)

Blender propagates generic attributes through modifiers, and the glTF exporter
writes `_`-prefixed attributes as custom vertex attributes (`_DSH_FACE`, ...)
with `export_attributes=True`. The scene JSON gains `annotate`: the source
(pre-modifier) geometry of each mesh and the transforms, modifier stacks and
custom properties of each object, so the viewer can turn any picked point into
object / face / edge / vertex / in-face parameters.
"""

import json
import math
import os
import sys
import time
import traceback

import bpy
import numpy as np
from mathutils import Vector

# Bumped when the JSON contract or the export calls change; the Host folds this
# into its cache key, so an upgrade re-converts rather than serving stale data.
RECIPE = 2

# Source geometry beyond this many vertices (summed over meshes) is not written
# to the scene JSON; those meshes still carry face/vertex ids in the GLB.
MAX_SOURCE_VERTICES = 400_000


def json_value(value):
    """A JSON-safe copy of a custom property value, or None to skip it."""
    if isinstance(value, (bool, int, float, str)):
        return value
    if hasattr(value, "to_list"):
        value = value.to_list()
    elif hasattr(value, "to_dict"):
        value = value.to_dict()
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return None


def matrix_rows(matrix):
    return [[round(float(matrix[r][c]), 7) for c in range(4)] for r in range(4)]


def tag_sources():
    """Tag every mesh with source ids and describe the source geometry."""
    mesh_list, mesh_index = [], {}
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.data is not None and ob.data.name_full not in mesh_index:
            mesh_index[ob.data.name_full] = len(mesh_list)
            mesh_list.append(ob.data)

    budget = MAX_SOURCE_VERTICES
    meshes = []
    for i, me in enumerate(mesh_list):
        entry = {
            "name": me.name,
            "faces": len(me.polygons),
            "edges": len(me.edges),
            "vertices": len(me.vertices),
            "tagged": False,
            "geometry": None,
        }
        try:
            if me.library is not None:
                raise RuntimeError("linked library mesh is read-only")
            for name, domain, count, fill in (
                ("_dsh_face", "FACE", len(me.polygons), None),
                ("_dsh_vert", "POINT", len(me.vertices), None),
                ("_dsh_src", "FACE", len(me.polygons), i + 1),
            ):
                if name in me.attributes:
                    me.attributes.remove(me.attributes[name])
                attribute = me.attributes.new(name, "INT", domain)
                values = np.arange(1, count + 1, dtype=np.int32) if fill is None else np.full(count, fill, dtype=np.int32)
                attribute.data.foreach_set("value", values)
            me.update()
            entry["tagged"] = True
        except Exception as error:  # keep exporting; this mesh is identified at object level only
            entry["tag_error"] = str(error)

        if len(me.vertices) <= budget:
            budget -= len(me.vertices)
            co = np.empty(len(me.vertices) * 3, dtype=np.float32)
            me.vertices.foreach_get("co", co)
            loop_start = np.empty(len(me.polygons), dtype=np.int32)
            loop_total = np.empty(len(me.polygons), dtype=np.int32)
            me.polygons.foreach_get("loop_start", loop_start)
            me.polygons.foreach_get("loop_total", loop_total)
            loop_vertex = np.empty(len(me.loops), dtype=np.int32)
            loop_edge = np.empty(len(me.loops), dtype=np.int32)
            me.loops.foreach_get("vertex_index", loop_vertex)
            me.loops.foreach_get("edge_index", loop_edge)
            edge_vertices = np.empty(len(me.edges) * 2, dtype=np.int32)
            me.edges.foreach_get("vertices", edge_vertices)
            material_index = np.empty(len(me.polygons), dtype=np.int32)
            me.polygons.foreach_get("material_index", material_index)
            entry["geometry"] = {
                "co": np.round(co, 6).tolist(),
                "loop_start": loop_start.tolist(),
                "loop_total": loop_total.tolist(),
                "loop_vertex": loop_vertex.tolist(),
                "loop_edge": loop_edge.tolist(),
                "edge_vertices": edge_vertices.tolist(),
                "material_index": material_index.tolist(),
                "materials": [m.name if m else None for m in me.materials],
            }
        meshes.append(entry)

    objects = {}
    for ob in bpy.data.objects:
        custom = {}
        for key in ob.keys():
            if key.startswith("_") or key in {"cycles", "cycles_visibility"}:
                continue
            value = json_value(ob[key])
            if value is not None:
                custom[key] = value
        modifiers = []
        for modifier in ob.modifiers:
            item = {"name": modifier.name, "type": modifier.type, "show_render": modifier.show_render}
            operand = getattr(modifier, "object", None)
            if operand is not None:
                item["object"] = operand.name
            modifiers.append(item)
        objects[ob.name] = {
            "type": ob.type,
            "data": ob.data.name if ob.data is not None else None,
            "mesh": mesh_index.get(ob.data.name_full, -1) if ob.type == "MESH" and ob.data is not None else -1,
            "matrix_world": matrix_rows(ob.matrix_world),
            "parent": ob.parent.name if ob.parent is not None else None,
            "collections": [c.name for c in ob.users_collection],
            "modifiers": modifiers,
            "material_slots": [slot.material.name if slot.material else None for slot in ob.material_slots],
            "custom": custom,
            "library": ob.library.filepath if ob.library is not None else None,
        }
    bpy.context.view_layer.update()
    return {"version": 1, "meshes": meshes, "objects": objects}


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) < 2:
        raise SystemExit("scene.py: expected <model.glb> <scene.json> [apply-modifiers]")
    glb_path, info_path = args[0], args[1]
    apply_modifiers = len(args) < 3 or args[2] != "0"
    started = time.time()

    scene = bpy.context.scene
    units = scene.unit_settings
    scale = units.scale_length if units.scale_length and units.scale_length > 0 else 1.0
    to_mm = scale * 1000.0

    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects = []
    materials_seen = {}
    bounds_min = [math.inf, math.inf, math.inf]
    bounds_max = [-math.inf, -math.inf, -math.inf]
    totals = {"vertices": 0, "polygons": 0, "triangles": 0}
    visible_meshes = 0

    for ob in bpy.data.objects:
        entry = {
            "name": ob.name,
            "type": ob.type,
            "collections": [collection.name for collection in ob.users_collection],
            "visible": not ob.hide_viewport and not ob.hide_get(),
            "parent": ob.parent.name if ob.parent is not None else None,
        }
        if ob.type == "MESH":
            mesh = ob.data
            try:
                mesh.calc_loop_triangles()
                triangles = len(mesh.loop_triangles)
            except Exception:
                triangles = 0
            entry.update(
                vertices=len(mesh.vertices),
                polygons=len(mesh.polygons),
                triangles=triangles,
                materials=[material.name if material else None for material in mesh.materials],
                modifiers=[modifier.type for modifier in ob.modifiers],
            )
            totals["vertices"] += entry["vertices"]
            totals["polygons"] += entry["polygons"]
            totals["triangles"] += triangles
            for material in mesh.materials:
                if material is not None and material.name not in materials_seen:
                    materials_seen[material.name] = material_entry(material)

            # Evaluated bounds follow modifiers (bevels, boolean cuts) and the
            # object's world transform, which is what the exported GLB shows.
            evaluated = ob.evaluated_get(depsgraph)
            corners = [ob.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
            if corners:
                low = [min(corner[i] for corner in corners) for i in range(3)]
                high = [max(corner[i] for corner in corners) for i in range(3)]
                entry["dims_mm"] = [round((high[i] - low[i]) * to_mm, 3) for i in range(3)]
                entry["center_mm"] = [round(((high[i] + low[i]) / 2.0) * to_mm, 3) for i in range(3)]
                if entry["visible"]:
                    visible_meshes += 1
                    for i in range(3):
                        bounds_min[i] = min(bounds_min[i], low[i])
                        bounds_max[i] = max(bounds_max[i], high[i])
        objects.append(entry)

    for ob in bpy.data.objects:
        if ob.type != "MESH" and ob.type in {"LIGHT", "CAMERA", "EMPTY", "CURVE", "FONT"}:
            entry = next((item for item in objects if item["name"] == ob.name), None)
            if entry is not None and ob.type == "LIGHT":
                entry["light_type"] = ob.data.type if ob.data is not None else None
            if entry is not None and ob.type == "CAMERA":
                entry["lens_mm"] = round(ob.data.lens, 3) if ob.data is not None else None

    if visible_meshes > 0 and bounds_min[0] != math.inf:
        size_mm = [round((bounds_max[i] - bounds_min[i]) * to_mm, 3) for i in range(3)]
        bounds = {
            "min_mm": [round(value * to_mm, 3) for value in bounds_min],
            "max_mm": [round(value * to_mm, 3) for value in bounds_max],
            "size_mm": size_mm,
        }
    else:
        bounds = {"min_mm": [0.0, 0.0, 0.0], "max_mm": [0.0, 0.0, 0.0], "size_mm": [0.0, 0.0, 0.0]}

    info = {
        "recipe": RECIPE,
        "blender": bpy.app.version_string,
        "file": bpy.data.filepath,
        "file_name": os.path.basename(bpy.data.filepath),
        "scene": scene.name,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "unit": {
            "system": units.system,
            "scale_length": scale,
            "length_unit": units.length_unit,
            "millimeters_per_unit": round(to_mm, 6),
        },
        "frame": {"current": scene.frame_current, "start": scene.frame_start, "end": scene.frame_end},
        "counts": {
            "objects": len(bpy.data.objects),
            "meshes": sum(1 for ob in bpy.data.objects if ob.type == "MESH"),
            "visible_meshes": visible_meshes,
            "materials": len(bpy.data.materials),
            "cameras": sum(1 for ob in bpy.data.objects if ob.type == "CAMERA"),
            "lights": sum(1 for ob in bpy.data.objects if ob.type == "LIGHT"),
            "collections": len(bpy.data.collections),
            "images": len(bpy.data.images),
            **totals,
        },
        "bounds": bounds,
        "objects": objects,
        "materials": list(materials_seen.values()),
    }
    info["annotate"] = tag_sources()

    # The exporter rewrites the filepath to end in `.glb`, so the temporary name
    # has to keep that suffix and only gain a `.part` marker.
    glb_tmp = glb_path[: -len(".glb")] + ".part.glb" if glb_path.endswith(".glb") else glb_path + ".part.glb"
    if os.path.exists(glb_tmp):
        os.remove(glb_tmp)
    bpy.ops.export_scene.gltf(
        filepath=glb_tmp,
        export_format="GLB",
        export_apply=apply_modifiers,
        use_visible=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_attributes=True,
    )
    if not os.path.exists(glb_tmp) or os.path.getsize(glb_tmp) == 0:
        raise RuntimeError("glTF exporter produced no GLB")
    os.replace(glb_tmp, glb_path)

    info_tmp = info_path + ".part"
    with open(info_tmp, "w", encoding="utf-8") as handle:
        json.dump(info, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(info_tmp, info_path)
    info["export_seconds"] = round(time.time() - started, 3)
    print("BLEND_PREVIEW_OK " + str(info["export_seconds"]))


def material_entry(material):
    """One material as the viewer needs it: a base colour plus PBR scalars."""
    entry = {"name": material.name, "base_color": [0.8, 0.8, 0.8, 1.0], "metallic": 0.0, "roughness": 0.5}
    try:
        if material.use_nodes and material.node_tree is not None:
            bsdf = material.node_tree.nodes.get("Principled BSDF")
            if bsdf is None:
                for node in material.node_tree.nodes:
                    if node.type == "BSDF_PRINCIPLED":
                        bsdf = node
                        break
            if bsdf is not None:
                color = bsdf.inputs["Base Color"].default_value
                entry["base_color"] = [round(float(channel), 5) for channel in color]
                entry["metallic"] = round(float(bsdf.inputs["Metallic"].default_value), 5)
                entry["roughness"] = round(float(bsdf.inputs["Roughness"].default_value), 5)
    except Exception:
        pass
    entry["hex"] = linear_to_hex(entry["base_color"])
    entry["double_sided"] = not material.use_backface_culling
    return entry


def linear_to_hex(color):
    """Scene-linear RGB to a displayable #rrggbb swatch."""
    channels = []
    for value in color[:3]:
        value = min(max(float(value), 0.0), 1.0)
        srgb = 12.92 * value if value <= 0.0031308 else 1.055 * (value ** (1.0 / 2.4)) - 0.055
        channels.append(round(min(max(srgb, 0.0), 1.0) * 255))
    return "#%02x%02x%02x" % tuple(channels)


try:
    main()
except Exception:
    traceback.print_exc()
    sys.exit(1)
