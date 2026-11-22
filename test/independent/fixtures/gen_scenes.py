"""
QA scene generator for dsh-blender-annotate (independent test suite).

    blender -b --factory-startup --python gen_scenes.py -- <outdir> <name> [<name> ...]

Each builder starts from an empty factory scene and saves <outdir>/<name>.blend.
Mesh datablocks are named "<Object>_me" so tests can map meshes to objects.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:]
OUTDIR = ARGS[0]
NAMES = ARGS[1:]
rad = math.radians


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def rename(ob, name):
    ob.name = name
    if ob.data is not None and hasattr(ob.data, "name"):
        ob.data.name = name + "_me"
    return ob


def cube(name, size=2.0, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cube_add(size=size, location=location)
    ob = rename(bpy.context.object, name)
    ob.rotation_euler = rotation
    ob.scale = scale
    return ob


def plane(name, size=2.0, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=location)
    ob = rename(bpy.context.object, name)
    ob.rotation_euler = rotation
    ob.scale = scale
    return ob


def cylinder(name, radius=0.5, depth=2.0, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1), vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location, vertices=vertices)
    ob = rename(bpy.context.object, name)
    ob.rotation_euler = rotation
    ob.scale = scale
    return ob


def from_data(name, verts, faces, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1), collection=None):
    me = bpy.data.meshes.new(name + "_me")
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co.x * 0.25 + 0.5, co.y * 0.25 + 0.5)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    ob.location = location
    ob.rotation_euler = rotation
    ob.scale = scale
    return ob


def save(name):
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTDIR, name + ".blend"))


# --------------------------------------------------------------------------- scenes
def build_xform():
    reset()
    parent = cube("Parent", size=1, location=(0, 5, 0), rotation=(0, 0, rad(30)), scale=(2, 0.5, 1))
    # Direct parenting (identity parent-inverse): world matrix has shear, local TRS is exact.
    direct = cube("ChildDirect", size=1, location=(1.5, 0.5, 1.0), rotation=(rad(40), 0, rad(10)))
    direct.parent = parent
    # Ctrl+P "keep transform" parenting: parent-inverse is baked, local matrix has shear.
    keep = cube("ChildKeep", size=1, location=(1, 6, 1.5), rotation=(rad(40), 0, rad(10)))
    bpy.context.view_layer.update()
    keep.parent = parent
    keep.matrix_parent_inverse = parent.matrix_world.inverted()
    cube("Negative", size=1, location=(-4, 0, 1), rotation=(rad(15), rad(25), rad(35)), scale=(-1, 2, 1.5))
    # Hexagonal prism: two 6-gon caps + 6 quads.
    hexv = [(math.cos(k * math.pi / 3), math.sin(k * math.pi / 3), z) for z in (-0.5, 0.5) for k in range(6)]
    faces = [tuple(range(5, -1, -1)), tuple(range(6, 12))] + [(k, (k + 1) % 6, (k + 1) % 6 + 6, k + 6) for k in range(6)]
    from_data("Prism", hexv, faces, location=(4, 0, 0.5), rotation=(rad(10), rad(-20), rad(50)), scale=(1.5, 1.5, 0.8))
    from_data("Tri", [(0, 0, 0), (2, 0, 0), (0.5, 1.5, 0)], [(0, 1, 2)], location=(0, -4, 1), rotation=(rad(60), 0, rad(20)))
    pent = [(math.cos(k * 2 * math.pi / 5 + 0.3) * 1.2, math.sin(k * 2 * math.pi / 5 + 0.3) * 0.9, 0) for k in range(5)]
    from_data("Pent", pent, [tuple(range(5))], location=(-4, -4, 0.5), rotation=(rad(-30), rad(15), 0))
    plane("UVPlane", size=2, location=(0, -8, 0), rotation=(0, 0, rad(25)))
    save("xform")


def build_mm():
    sc = reset()
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 0.001
    sc.unit_settings.length_unit = "MILLIMETERS"
    cube("Block", size=20, location=(100, 50, 10), rotation=(0, 0, rad(20)), scale=(1, 2, 0.5))
    plane("Plate", size=40, location=(0, 0, 0))
    save("mm")


def gn_set_position(ob, offset):
    mod = ob.modifiers.new("GN", "NODES")
    tree = bpy.data.node_groups.new(ob.name + "_tree", "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nin = tree.nodes.new("NodeGroupInput")
    nout = tree.nodes.new("NodeGroupOutput")
    setp = tree.nodes.new("GeometryNodeSetPosition")
    setp.inputs["Offset"].default_value = offset
    tree.links.new(nin.outputs[0], setp.inputs["Geometry"])
    tree.links.new(setp.outputs[0], nout.inputs[0])
    mod.node_group = tree


def build_mods():
    reset()
    bev = cube("Bev", size=2, location=(0, 0, 0))
    m = bev.modifiers.new("Bevel", "BEVEL"); m.width = 0.15; m.segments = 2
    sub = cube("Sub", size=2, location=(5, 0, 0))
    m = sub.modifiers.new("Subsurf", "SUBSURF"); m.levels = 2; m.render_levels = 2
    mir = cube("MirCube", size=1, location=(0, 6, 0.5))
    mir.data.transform(Matrix.Translation((1.5, 0, 0)))
    mir.modifiers.new("Mirror", "MIRROR")
    mirp = plane("MirPlane", size=1, location=(6, 6, 0))
    mirp.data.transform(Matrix.Translation((1.5, 0, 0)))
    mirp.modifiers.new("Mirror", "MIRROR")
    arr = cube("Arr", size=1, location=(0, 12, 0.5))
    m = arr.modifiers.new("Array", "ARRAY"); m.count = 3; m.relative_offset_displace = (1.25, 0, 0)  # gaps: no coincident faces, tops stay coplanar
    sol = plane("Sol", size=2, location=(8, 0, 0))
    m = sol.modifiers.new("Solidify", "SOLIDIFY"); m.thickness = 0.3
    gn = cube("GNSetPos", size=1, location=(8, 12, 0.5))
    gn_set_position(gn, (0.0, 0.0, 0.4))
    save("mods")


def build_bools():
    reset()
    body = cube("BodyDiff", size=2, location=(0, 0, 0), rotation=(0, 0, rad(10)))
    cut = cylinder("CutDiff", radius=0.5, depth=3, location=(0.3, 0.2, 0.5), rotation=(rad(20), rad(10), 0), scale=(1, 1.3, 1))
    m = body.modifiers.new("Diff", "BOOLEAN"); m.operation = "DIFFERENCE"; m.solver = "EXACT"; m.object = cut
    cut.hide_set(True)

    body = cube("BodyUnion", size=2, location=(6, 0, 0))
    cut = cylinder("CutUnion", radius=0.6, depth=1.5, location=(6.9, 0, 0.4), rotation=(rad(90), 0, 0), scale=(1.2, 1, 1))
    m = body.modifiers.new("Union", "BOOLEAN"); m.operation = "UNION"; m.solver = "EXACT"; m.object = cut
    # cutter stays visible: it is exported as its own node too

    body = cube("BodyInt", size=2, location=(12, 0, 0))
    cut = cube("CutInt", size=2, location=(12.5, 0.3, 0.2), rotation=(rad(30), rad(20), rad(40)))
    m = body.modifiers.new("Int", "BOOLEAN"); m.operation = "INTERSECT"; m.solver = "EXACT"; m.object = cut
    cut.hide_viewport = True

    # Collection operand whose cutter mesh is shared with a visible decoy that sorts first.
    coll = bpy.data.collections.new("Cutters")
    bpy.context.scene.collection.children.link(coll)
    body = cube("BodyColl", size=2, location=(0, 8, 0))
    zcut = cylinder("ZCutter", radius=0.5, depth=3, location=(0.4, 8, 0.5), rotation=(rad(15), 0, 0))
    for c in list(zcut.users_collection):
        c.objects.unlink(zcut)
    coll.objects.link(zcut)
    decoy = bpy.data.objects.new("ADecoy", zcut.data)
    bpy.context.scene.collection.objects.link(decoy)
    decoy.location = (8, 8, 5)
    decoy.rotation_euler = (0, rad(70), 0)
    m = body.modifiers.new("CollBool", "BOOLEAN"); m.operation = "DIFFERENCE"; m.solver = "EXACT"
    m.operand_type = "COLLECTION"; m.collection = coll
    zcut.hide_set(True)

    # Cutter is a linked duplicate of the body itself (same mesh datablock).
    body = cube("BodySelf", size=2, location=(6, 8, 0))
    selfcut = bpy.data.objects.new("SelfCutter", body.data)
    bpy.context.scene.collection.objects.link(selfcut)
    selfcut.location = (6.9, 8.7, 0.8)
    selfcut.rotation_euler = (0, 0, rad(20))
    selfcut.scale = (0.5, 0.5, 0.5)
    m = body.modifiers.new("SelfBool", "BOOLEAN"); m.operation = "DIFFERENCE"; m.solver = "EXACT"; m.object = selfcut
    selfcut.hide_set(True)
    save("bools")


def build_special():
    sc = reset()
    # Collection instances.
    src = bpy.data.collections.new("Src")
    sc.collection.children.link(src)
    inst = cube("InstCube", size=1)
    for c in list(inst.users_collection):
        c.objects.unlink(inst)
    src.objects.link(inst)
    bpy.context.view_layer.layer_collection.children["Src"].exclude = True
    for name, loc, rz in (("InstA", (5, 0, 0), 0.0), ("InstB", (5, 3, 0), 35.0)):
        e = bpy.data.objects.new(name, None)
        e.instance_type = "COLLECTION"
        e.instance_collection = src
        e.location = loc
        e.rotation_euler = (0, 0, rad(rz))
        sc.collection.objects.link(e)
    # Geometry-nodes instances (not realized).
    host = plane("GNInst", size=2, location=(0, -5, 0))
    mod = host.modifiers.new("GN", "NODES")
    tree = bpy.data.node_groups.new("GNInstTree", "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nin = tree.nodes.new("NodeGroupInput"); nout = tree.nodes.new("NodeGroupOutput")
    iop = tree.nodes.new("GeometryNodeInstanceOnPoints"); mc = tree.nodes.new("GeometryNodeMeshCube")
    mc.inputs["Size"].default_value = (0.3, 0.3, 0.3)
    tree.links.new(nin.outputs[0], iop.inputs["Points"]); tree.links.new(mc.outputs[0], iop.inputs["Instance"])
    tree.links.new(iop.outputs[0], nout.inputs[0])
    mod.node_group = tree
    # Curve and text.
    bpy.ops.curve.primitive_bezier_circle_add(radius=1, location=(0, -10, 0))
    curve = bpy.context.object; curve.name = "BezierRing"; curve.data.bevel_depth = 0.1
    bpy.ops.object.text_add(location=(4, -10, 0))
    text = bpy.context.object; text.name = "Label"; text.data.extrude = 0.05
    # Shape keys: basis + "Lift" (top face up by 1) at value 1.
    sk = cube("ShapeKeyed", size=2, location=(-5, 0, 0))
    sk.shape_key_add(name="Basis")
    lift = sk.shape_key_add(name="Lift")
    for i, v in enumerate(sk.data.vertices):
        if v.co.z > 0:
            lift.data[i].co.z += 1.0
    lift.value = 1.0
    # Hidden objects (three different mechanisms).
    eye = cube("HiddenEye", size=1, location=(0, 10, 0)); eye.hide_set(True)
    mon = cube("HiddenMonitor", size=1, location=(3, 10, 0)); mon.hide_viewport = True
    ghost = bpy.data.collections.new("Ghost"); sc.collection.children.link(ghost)
    gh = cube("HiddenColl", size=1, location=(6, 10, 0))
    for c in list(gh.users_collection):
        c.objects.unlink(gh)
    ghost.objects.link(gh)
    bpy.context.view_layer.layer_collection.children["Ghost"].hide_viewport = True
    # Existing attributes with the exact plugin names (wrong domain/values).
    pre = cube("PreTagged", size=2, location=(-5, 5, 0))
    a = pre.data.attributes.new("_dsh_face", "FLOAT", "POINT"); a.data.foreach_set("value", [99.0] * len(pre.data.vertices))
    a = pre.data.attributes.new("_dsh_src", "INT", "FACE"); a.data.foreach_set("value", [42] * len(pre.data.polygons))
    # Attributes a glTF re-import of the plugin's own GLB creates (upper-case names, POINT/FLOAT).
    re = cube("Reimported", size=2, location=(-5, 10, 0))
    for nm, val in (("_DSH_FACE", 7.0), ("_DSH_SRC", 77.0), ("_DSH_VERT", 3.0)):
        a = re.data.attributes.new(nm, "FLOAT", "POINT"); a.data.foreach_set("value", [val] * len(re.data.vertices))
    # Materials.
    mm = cube("MultiMat", size=2, location=(10, 0, 0))
    red = bpy.data.materials.new("Red"); blue = bpy.data.materials.new("Blue")
    mm.data.materials.append(red); mm.data.materials.append(blue)
    for p in mm.data.polygons:
        p.material_index = 0 if p.index < 3 else 1
    cube("NoMat", size=2, location=(10, 4, 0))
    # Linked duplicates.
    la = cube("LinkA", size=1, location=(14, 0, 0), rotation=(0, 0, rad(10)))
    lb = bpy.data.objects.new("LinkB", la.data)
    sc.collection.objects.link(lb)
    lb.location = (14, 4, 1); lb.rotation_euler = (rad(30), 0, 0); lb.scale = (1, 2, 1)
    # LinkA renders with the mesh material; LinkB overrides its slot with an object-linked material.
    la.data.materials.append(bpy.data.materials.new("Gray"))
    lb.material_slots[0].link = "OBJECT"
    lb.material_slots[0].material = bpy.data.materials.new("Green")
    save("special")


def build_empty():
    reset()
    save("empty")


def build_multiscene():
    main = reset()
    main.name = "Main"
    cube("MainCube", size=2, location=(0, 0, 0))
    other = bpy.data.scenes.new("Other")
    oc_me = bpy.data.meshes.new("OtherCube_me")
    oc_me.from_pydata([(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)], [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    oc = bpy.data.objects.new("OtherCube", oc_me)
    other.collection.objects.link(oc)
    oc.location = (50, 0, 0)
    save("multiscene")


def build_huge():
    reset()
    n = 400_010
    verts = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.0, 1.0, 0.0)] + [(2.0 + (i % 1000) * 1e-3, (i // 1000) * 1e-3, -1.0) for i in range(n - 4)]
    me = bpy.data.meshes.new("ABig_me")
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    me.update()
    ob = bpy.data.objects.new("ABig", me)
    bpy.context.scene.collection.objects.link(ob)
    cube("BSmall", size=1, location=(5, 0, 0))
    save("huge")


def build_library():
    reset()
    cube("LibCube", size=1, location=(0, 0, 0))
    cube("Shared", size=1, location=(0, 0, 3))
    libpath = os.path.join(OUTDIR, "libsrc.blend")
    bpy.ops.wm.save_as_mainfile(filepath=libpath)
    reset()
    cube("Shared", size=2, location=(5, 0, 0))
    with bpy.data.libraries.load(libpath, link=True, relative=False) as (data_from, data_to):
        data_to.objects = ["LibCube", "Shared"]
    for ob in data_to.objects:
        bpy.context.scene.collection.objects.link(ob)
    save("library")


BUILDERS = {
    "xform": build_xform,
    "mm": build_mm,
    "mods": build_mods,
    "bools": build_bools,
    "special": build_special,
    "empty": build_empty,
    "multiscene": build_multiscene,
    "huge": build_huge,
    "library": build_library,
}

for name in NAMES:
    BUILDERS[name]()
print("GEN_OK", " ".join(NAMES))
