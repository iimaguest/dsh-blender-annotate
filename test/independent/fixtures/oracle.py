"""
Ground-truth oracle for the dsh-blender-annotate QA suite. Runs INSIDE Blender
on the ORIGINAL .blend (never saves it):

    blender -b --disable-autoexec <file.blend> --python oracle.py -- <queries.json> <answers.json>

All geometry answers come from Blender's own data and math (mathutils BVHTree,
mathutils.geometry, Object.matrix_world, MeshEdge.vertices, UV layers), never
from the plugin's resolver.

Query document keys (all optional):
  evalface: [{id, object, local}]       nearest polygon of the EVALUATED mesh (object-local
                                         Blender coords) and the qa ids Blender propagated
                                         through the modifier stack onto it
  points:   [{id, object, local, face, mesh}]
                                         facts about a point given in the node object's local
                                         space and the (face, mesh) the plugin reported
  bilinear: {objects: [...], st: [[s,t], ...]}
                                         world points/UVs at known bilinear params of quads
"""
import json
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_point_line, closest_point_on_tri

args = sys.argv[sys.argv.index("--") + 1:]
queries = json.load(open(args[0], encoding="utf-8"))
answers = {}
scene = bpy.context.scene
units = scene.unit_settings
answers["mm_per_unit"] = (units.scale_length if units.scale_length > 0 else 1.0) * 1000.0
answers["scene"] = scene.name


def rows(m):
    return [[float(m[r][c]) for c in range(4)] for r in range(4)]


answers["objects"] = {
    ob.name_full: {
        "name": ob.name,
        "type": ob.type,
        "mesh": ob.data.name if ob.type == "MESH" and ob.data is not None else None,
        "matrix_world": rows(ob.matrix_world),
        "parent": ob.parent.name if ob.parent else None,
        "library": ob.library is not None,
        "in_scene": ob.name in scene.objects,
        "visible": ob.visible_get() if ob.name in bpy.context.view_layer.objects else False,
        "material_slots": [s.material.name if s.material else None for s in ob.material_slots],
    }
    for ob in bpy.data.objects
}
answers["meshes"] = {me.name_full: {"faces": len(me.polygons), "vertices": len(me.vertices), "edges": len(me.edges)} for me in bpy.data.meshes}


def get_object(name):
    ob = bpy.data.objects.get(name)
    if ob is None:
        raise KeyError(name)
    return ob


def bvh_of(me):
    return BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons], all_triangles=False)


_bvh_cache = {}


def source_bvh(me):
    key = me.name_full
    if key not in _bvh_cache:
        _bvh_cache[key] = bvh_of(me)
    return _bvh_cache[key]


def polygon_distance(me, poly, p):
    """Distance from p to the polygon's surface region (fan of its loop triangles)."""
    best = float("inf")
    for tri in me.loop_triangles:
        if tri.polygon_index != poly.index:
            continue
        a, b, c = (me.vertices[i].co for i in tri.vertices)
        q = closest_point_on_tri(p, a, b, c)
        best = min(best, (q - p).length)
    return best


# ---------------------------------------------------------------- evalface
if queries.get("evalface"):
    # Tag every local mesh with our own ids, then let Blender evaluate the modifier stacks.
    mesh_names = {}
    for i, me in enumerate(bpy.data.meshes):
        mesh_names[i + 1] = me.name_full
        if me.library is not None:
            continue
        for nm in ("qa_face", "qa_src"):
            if nm in me.attributes:
                me.attributes.remove(me.attributes[nm])
        a = me.attributes.new("qa_face", "INT", "FACE")
        a.data.foreach_set("value", list(range(1, len(me.polygons) + 1)))
        a = me.attributes.new("qa_src", "INT", "FACE")
        a.data.foreach_set("value", [i + 1] * len(me.polygons))
        me.update()
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    cache = {}
    out = []
    for q in queries["evalface"]:
        name = q["object"]
        if name not in cache:
            ob = get_object(name)
            ev = ob.evaluated_get(dg)
            me = ev.to_mesh()
            faces = [0] * len(me.polygons)
            srcs = [0] * len(me.polygons)
            if "qa_face" in me.attributes:
                me.attributes["qa_face"].data.foreach_get("value", faces)
            if "qa_src" in me.attributes:
                me.attributes["qa_src"].data.foreach_get("value", srcs)
            cache[name] = (bvh_of(me), list(faces), list(srcs))
            ev.to_mesh_clear()
        bvh, faces, srcs = cache[name]
        loc, normal, index, distance = bvh.find_nearest(Vector(q["local"]))
        out.append({
            "id": q["id"],
            "qa_face": (faces[index] - 1) if index is not None and faces[index] > 0 else None,
            "qa_mesh": mesh_names.get(srcs[index]) if index is not None else None,
            "dist": distance,
        })
    answers["evalface"] = out

# ---------------------------------------------------------------- points
if queries.get("points"):
    out = []
    for q in queries["points"]:
        ob = get_object(q["object"])
        local = Vector(q["local"])
        world = ob.matrix_world @ local
        ans = {"id": q["id"], "world": list(world)}
        mesh_name = q.get("mesh")
        # Candidate source objects: the object itself and every Boolean operand using that mesh.
        candidates = []
        if ob.type == "MESH" and ob.data is not None and ob.data.name == mesh_name:
            candidates.append(ob)
        for mod in ob.modifiers:
            if mod.type != "BOOLEAN":
                continue
            pool = [mod.object] if mod.operand_type == "OBJECT" else (list(mod.collection.all_objects) if mod.collection else [])
            for o in pool:
                if o is not None and o.type == "MESH" and o.data.name == mesh_name and o not in candidates:
                    candidates.append(o)
        scored = []
        for cand in candidates:
            to_src = cand.matrix_world.inverted() @ ob.matrix_world
            p = to_src @ local
            loc, n, idx, d = source_bvh(cand.data).find_nearest(p)
            scored.append((d if d is not None else float("inf"), cand, p, idx))
        ans["candidates"] = [{"object": c.name, "dist": d} for d, c, _, _ in scored]
        if scored:
            scored.sort(key=lambda item: item[0])
            d, src_ob, p, bvh_face = scored[0]
            me = src_ob.data
            me.calc_loop_triangles()
            ans.update(operand=src_ob.name, src_local=list(p), bvh_face=bvh_face, bvh_dist=d)
            fi = q.get("face")
            if fi is not None and 0 <= fi < len(me.polygons):
                poly = me.polygons[fi]
                ans["face_dist"] = polygon_distance(me, poly, p)
                ans["face_points"] = [list(me.vertices[me.loops[li].vertex_index].co) for li in poly.loop_indices]
                ans["face_sides"] = poly.loop_total
                center = sum((Vector(c) for c in ans["face_points"]), Vector()) / poly.loop_total
                ans["face_size"] = max((Vector(c) - center).length for c in ans["face_points"])
                slots = src_ob.material_slots
                ans["material"] = slots[poly.material_index].material.name if poly.material_index < len(slots) and slots[poly.material_index].material else None
                edges = []
                for li in poly.loop_indices:
                    e = me.edges[me.loops[li].edge_index]
                    v0, v1 = e.vertices[0], e.vertices[1]
                    a, b = me.vertices[v0].co, me.vertices[v1].co
                    closest, t = intersect_point_line(p, a, b)
                    tc = min(max(t, 0.0), 1.0)
                    q2 = a.lerp(b, tc)
                    edges.append({"index": e.index, "vertices": [v0, v1], "t": tc, "dist": (p - q2).length})
                ans["edges"] = edges
                ans["verts"] = [{"index": v, "dist": (p - me.vertices[v].co).length} for v in poly.vertices]
                if src_ob == ob:
                    nmat = ob.matrix_world.to_3x3().inverted().transposed()
                    ans["world_normal"] = list((nmat @ poly.normal).normalized())
        out.append(ans)
    answers["points"] = out

# ---------------------------------------------------------------- bilinear
if queries.get("bilinear"):
    spec = queries["bilinear"]
    out = []
    for name in spec["objects"]:
        ob = get_object(name)
        me = ob.data
        uv = me.uv_layers.active
        for poly in me.polygons:
            if poly.loop_total != 4:
                continue
            loops = list(poly.loop_indices)
            corners = [ob.matrix_world @ me.vertices[me.loops[li].vertex_index].co for li in loops]
            uvs = [uv.data[li].uv.copy() for li in loops] if uv else None
            for s, t in spec["st"]:
                w = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t]
                p = sum((corners[k] * w[k] for k in range(4)), Vector())
                item = {"object": name, "face": poly.index, "s": s, "t": t, "world": list(p)}
                if uvs:
                    u = sum((uvs[k] * w[k] for k in range(4)), uvs[0] * 0)
                    item["uv"] = [u[0], u[1]]
                out.append(item)
    answers["bilinear"] = out

json.dump(answers, open(args[1], "w", encoding="utf-8"))
print("ORACLE_OK")
