"""Build the annotate test fixture: modifiers, a Boolean cutter, linked duplicates, custom props."""
import bpy, sys
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
def add(name, op, **kw):
    op(**kw); o = bpy.context.object; o.name = name; return o
body = add("Body", bpy.ops.mesh.primitive_cube_add, location=(0, 0, 1))
bev = body.modifiers.new("Bevel", "BEVEL"); bev.width = 0.12; bev.segments = 3
cutter = add("Cutter", bpy.ops.mesh.primitive_cylinder_add, location=(0, 0, 1.8), radius=0.4, depth=1.0)
cutter.hide_render = True; cutter.display_type = "WIRE"; cutter.hide_set(True)
boo = body.modifiers.new("Hole", "BOOLEAN"); boo.object = cutter; boo.solver = "EXACT"
bolt = add("Bolt.A", bpy.ops.mesh.primitive_cylinder_add, location=(2.2, 0, 0.3), radius=0.15, depth=0.6)
bolt["part_no"] = "B-100"; bolt["torque_nm"] = 12.5
bolt_b = bolt.copy(); bolt_b.name = "Bolt.B"; bolt_b.location = (-2.2, 0, 0.3); bpy.context.collection.objects.link(bolt_b)
shell = add("Shell", bpy.ops.mesh.primitive_uv_sphere_add, location=(0, 3, 1), radius=0.8)
shell.modifiers.new("Smooth", "SUBSURF").levels = 1
bpy.ops.wm.save_as_mainfile(filepath=out)
