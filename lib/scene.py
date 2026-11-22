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
RECIPE = 3

# Source geometry beyond this many vertices (summed over meshes) is not written
# to the scene JSON; those meshes still carry face/vertex ids in the GLB.
MAX_SOURCE_VERTICES = 400_000

# Attribute names the plugin owns, as the glTF exporter writes them (upper-case).
TAG_NAMES = {"_DSH_FACE", "_DSH_VERT", "_DSH_SRC"}


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


def object_keys():
    """Key per object: its name, or name_full for a linked object whose name a local object also uses."""
    counts = {}
    for ob in bpy.data.objects:
        counts[ob.name] = counts.get(ob.name, 0) + 1
    return lambda ob: ob.name if counts.get(ob.name, 0) == 1 or ob.library is None else ob.name_full


def rename_instance_nodes(glb_path):
    """Name mesh nodes the exporter calls "GN Instance" after their parent (the object owning the node tree)."""
    import struct
    with open(glb_path, "rb") as handle:
        data = handle.read()
    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        return
    document = json.loads(data[20:20 + json_length].decode("utf-8"))
    nodes = document.get("nodes", [])
    parent = {}
    for index, node in enumerate(nodes):
        for child in node.get("children", []):
            parent[child] = index
    changed = False
    for index, node in enumerate(nodes):
        name = node.get("name", "")
        if "mesh" in node and name.startswith("GN Instance") and index in parent:
            owner = nodes[parent[index]].get("name")
            if owner:
                node["name"] = owner
                node.setdefault("extras", {})["dsh_instance"] = name
                changed = True
    if not changed:
        return
    body = json.dumps(document, separators=(",", ":")).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    rest = data[20 + json_length:]
    total = 12 + 8 + len(body) + len(rest)
    with open(glb_path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total))
        handle.write(struct.pack("<II", len(body), 0x4E4F534A))
        handle.write(body)
        handle.write(rest)


def tag_sources():
    """Tag every mesh with source ids and describe the source geometry."""
    key_of = object_keys()
    original_name = {}  # private copy name_full -> the mesh name the .blend actually has
    # A Boolean operand that shares its mesh with another object (a linked
    # duplicate, or the body itself) would make cut faces ambiguous; give each
    # such operand a private in-memory copy so its faces carry its own id.
    for ob in bpy.data.objects:
        for modifier in ob.modifiers:
            if modifier.type != "BOOLEAN":
                continue
            operands = []
            if getattr(modifier, "operand_type", "OBJECT") == "COLLECTION" and modifier.collection is not None:
                operands = list(modifier.collection.all_objects)
            elif modifier.object is not None:
                operands = [modifier.object]
            for operand in operands:
                if operand.type == "MESH" and operand.data is not None and operand.data.users > 1 and operand.library is None:
                    try:
                        shared_name = operand.data.name
                        operand.data = operand.data.copy()
                        original_name[operand.data.name_full] = shared_name
                    except Exception:
                        pass

    mesh_list, mesh_index = [], {}
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.data is not None and ob.data.name_full not in mesh_index:
            mesh_index[ob.data.name_full] = len(mesh_list)
            mesh_list.append(ob.data)

    budget = MAX_SOURCE_VERTICES
    meshes = []
    for i, me in enumerate(mesh_list):
        entry = {
            "name": original_name.get(me.name_full, me.name),
            "faces": len(me.polygons),
            "edges": len(me.edges),
            "vertices": len(me.vertices),
            "tagged": False,
            "geometry": None,
        }
        try:
            if me.library is not None:
                raise RuntimeError("linked library mesh is read-only")
            # The exporter upper-cases attribute names, so any `_dsh_*` in any
            # case (e.g. `_DSH_FACE` from re-importing a GLB) would collide.
            for existing in [a.name for a in me.attributes if a.name.upper() in TAG_NAMES]:
                me.attributes.remove(me.attributes[existing])
            for name, domain, count, fill in (
                ("_dsh_face", "FACE", len(me.polygons), None),
                ("_dsh_vert", "POINT", len(me.vertices), None),
                ("_dsh_src", "FACE", len(me.polygons), i + 1),
            ):
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
    instanced = set()
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
                item["object"] = key_of(operand)
            if modifier.type == "BOOLEAN" and getattr(modifier, "operand_type", "OBJECT") == "COLLECTION" and modifier.collection is not None:
                item["collection"] = modifier.collection.name_full
                item["collection_objects"] = [key_of(o) for o in modifier.collection.all_objects]
            modifiers.append(item)
        entry = {
            "name": ob.name,
            "type": ob.type,
            "data": original_name.get(ob.data.name_full, ob.data.name) if ob.data is not None else None,
            "mesh": mesh_index.get(ob.data.name_full, -1) if ob.type == "MESH" and ob.data is not None else -1,
            "matrix_world": matrix_rows(ob.matrix_world),
            "parent": key_of(ob.parent) if ob.parent is not None else None,
            "collections": [c.name for c in ob.users_collection],
            "modifiers": modifiers,
            "material_slots": [slot.material.name if slot.material else None for slot in ob.material_slots],
            "custom": custom,
            "library": ob.library.filepath if ob.library is not None else None,
        }
        if ob.instance_type == "COLLECTION" and ob.instance_collection is not None:
            entry["instance_collection"] = ob.instance_collection.name_full
            instanced.add(ob.instance_collection)
        objects[key_of(ob)] = entry

    # Collections used by instancers: their members and offset, so the viewer
    # can tell which instancer an instanced copy belongs to.
    collections = {}
    for collection in instanced:
        collections[collection.name_full] = {
            "name": collection.name,
            "offset": [round(float(v), 7) for v in collection.instance_offset],
            "objects": [key_of(o) for o in collection.all_objects],
        }
    bpy.context.view_layer.update()
    return {"version": 2, "meshes": meshes, "objects": objects, "collections": collections}


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

    scene_objects = list(scene.objects)
    for ob in scene_objects:
        try:
            visible = bool(ob.visible_get())
        except Exception:
            visible = not ob.hide_viewport and not ob.hide_get()
        entry = {
            "name": ob.name,
            "type": ob.type,
            "collections": [collection.name for collection in ob.users_collection],
            "visible": visible,
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

    for ob in scene_objects:
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
            "objects": len(scene_objects),
            "meshes": sum(1 for ob in scene_objects if ob.type == "MESH"),
            "visible_meshes": visible_meshes,
            "materials": len(bpy.data.materials),
            "cameras": sum(1 for ob in scene_objects if ob.type == "CAMERA"),
            "lights": sum(1 for ob in scene_objects if ob.type == "LIGHT"),
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
    export_options = dict(
        filepath=glb_tmp,
        export_format="GLB",
        export_apply=apply_modifiers,
        use_visible=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_attributes=True,
        export_gn_mesh=True,  # geometry-nodes instances (Blender 3.6+)
    )
    try:
        bpy.ops.export_scene.gltf(**export_options)
    except TypeError:
        export_options.pop("export_gn_mesh")
        bpy.ops.export_scene.gltf(**export_options)
    if not os.path.exists(glb_tmp) or os.path.getsize(glb_tmp) == 0:
        raise RuntimeError("glTF exporter produced no GLB")
    rename_instance_nodes(glb_tmp)
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
