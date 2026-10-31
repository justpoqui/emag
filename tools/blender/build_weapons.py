"""Builds Scrapfall's weapons in Blender, one gun at a time.

Follows design/art/art-bible.md (Section 8: weapons up to 12k triangles,
2 materials, ~1024 px/m; realistic, bevelled, never blocky; everything
worn). Guns are modelled at real-world size in the game's gun frame: +Z is
the muzzle direction, +Y up, the trigger near the origin. Each gun exports
marker nodes the game uses to hold and fire it: `muzzle`, `grip` (the
firing hand) and `fore` (the support hand).

Run with the Blender Python module (bpy):
    python tools/blender/build_weapons.py <work dir> [--guns mule] [--render] [--export]
--export writes godot/models/weapons/wpn_<gun>.gltf (+ .bin), textures in
godot/textures/weapons/.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402  (first: it makes bmesh and mathutils importable)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import build_quarters as kit  # noqa: E402
import make_textures as mt  # noqa: E402

ROOT = kit.ROOT
GTEX = os.path.join(ROOT, "godot", "textures", "weapons")
GMODELS = os.path.join(ROOT, "godot", "models", "weapons")
GUN_TILE = 0.6  # metres per texture repeat on guns (~1700 px/m at 1024)
R90 = math.pi / 2


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


# ---------- materials: worn blued steel, oiled walnut ----------

def make_gun_textures():
    """Seamless gun materials in godot/textures/weapons/ (art bible 6.2 wear
    layers, Section 4 saturation)."""
    mt.OUT = GTEX
    S = mt.SIZE
    fbm, smooth, mix, hexcol, blur, ridged = mt.fbm, mt.smooth, mt.mix, mt.hexcol, mt.blur, mt.ridged

    # blued steel: dark blue-grey bluing, fine scratches, bluing rubbed through
    # to bare steel in patches, a few rust freckles
    mottle = fbm(201, 2.6)
    wear = smooth(0.5, 0.64, 0.6 * fbm(202, 2.2) + 0.4 * fbm(203, 1.0))  # bluing rubbed through, generously
    rng = np.random.default_rng(204)
    scratches = np.zeros((S, S))
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    for _ in range(140):  # straight scratches, mostly along the gun's length
        x0, y0 = rng.uniform(0, S, 2)
        ang = rng.normal(0, 0.35) + (math.pi / 2 if rng.random() < 0.8 else 0)
        ln = rng.uniform(10, 70)
        dxv, dyv = math.cos(ang), math.sin(ang)
        rx, ry = (xx - x0 + S / 2) % S - S / 2, (yy - y0 + S / 2) % S - S / 2
        t = np.clip(rx * dxv + ry * dyv, 0, ln)
        d = np.hypot(rx - t * dxv, ry - t * dyv)
        scratches = np.maximum(scratches, np.clip(0.9 - d, 0, 1) * rng.uniform(0.2, 0.55))
    rust = smooth(0.86, 0.92, fbm(205, 1.2)) * (1 - wear)
    col = mix(hexcol("#1c1f23"), hexcol("#2c3136"), mottle)
    col = mix(col, hexcol("#5f646a"), np.clip(wear * 0.7 + scratches * 0.5, 0, 1))
    col = mix(col, hexcol("#4e3424"), rust)
    h = 0.15 * mottle - 0.3 * scratches - 0.2 * rust
    rough = 0.42 + 0.12 * mottle - 0.12 * wear + 0.35 * rust
    metal = np.clip(0.9 - 0.8 * rust, 0, 1)
    mt.save("gunsteel", col, h, rough, metal, 3.0, 1.2)

    # oiled walnut: tight grain, darker where hands hold it, dents and dings
    grain = fbm(211, 2.0, stretch=(1.0, 0.07))
    fine = fbm(212, 1.0, stretch=(1.0, 0.04))
    figure = fbm(213, 2.8)
    dents = smooth(0.84, 0.92, fbm(214, 1.0))
    worn = smooth(0.55, 0.7, 0.6 * fbm(216, 2.6) + 0.4 * fbm(217, 1.2))  # finish worn off to pale, dry wood
    col = mix(hexcol("#2a1f18"), hexcol("#4d3a2d"), smooth(0.15, 0.9, 0.5 * grain + 0.2 * fine + 0.3 * figure))
    col = mix(col, hexcol("#1e150f"), smooth(0.55, 0.9, fbm(215, 3.0)) * 0.45)  # hand oil and grime
    col = mix(col, hexcol("#5c4b3d"), worn * 0.55)
    col = mix(col, hexcol("#1a120c"), dents * 0.7)
    h = 0.5 * grain + 0.2 * fine - 0.4 * dents - 0.1 * worn
    rough = 0.5 + 0.15 * fine + 0.2 * dents + 0.25 * worn
    mt.save("gunwood", col, h, rough, np.zeros_like(h), 3.0, 1.0)


def gun_materials():
    def pbr_from(name, key):
        m = kit.pbr(name, None)
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        alb = nt.nodes.new("ShaderNodeTexImage")
        alb.image = bpy.data.images.load(os.path.join(GTEX, f"{key}_albedo.png"))
        nt.links.new(alb.outputs["Color"], bsdf.inputs["Base Color"])
        orm = nt.nodes.new("ShaderNodeTexImage")
        orm.image = bpy.data.images.load(os.path.join(GTEX, f"{key}_orm.png"))
        orm.image.colorspace_settings.name = "Non-Color"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        nrm = nt.nodes.new("ShaderNodeTexImage")
        nrm.image = bpy.data.images.load(os.path.join(GTEX, f"{key}_normal.png"))
        nrm.image.colorspace_settings.name = "Non-Color"
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        return m
    return {"steel": pbr_from("mat_gun_steel_01", "gunsteel"), "wood": pbr_from("mat_gun_wood_01", "gunwood")}


# ---------- parts ----------

def tag(o, grain=False):
    o["tile"] = GUN_TILE
    if grain:
        o["grain"] = "long"
    return o


def part(name, mat, coll, pos, size, rot=(0, 0, 0), bev=0.003, grain=False):
    return tag(kit.box(name, mat, coll, pos, size, rot=rot, bev=bev), grain)


def tube(name, mat, coll, p0, p1, r, seg=16, bev=0.0015):
    return tag(kit.cylinder(name, mat, coll, p0, p1, r, segments=seg, bev=bev), True)


def profile(name, mat, coll, pts, thick, x=0.0, bev=0.008, grain=True, taper=None):
    """A solid cut from a side profile: pts are (z, y) in the gun frame,
    extruded `thick` across x and rounded off at the edges, like a wooden
    stock shaped from a blank."""
    bm = bmesh.new()
    verts = [bm.verts.new(kit.g2b(x - thick / 2, y, z)) for z, y in pts]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=kit.g2b(thick, 0, 0), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if taper:  # thickness as a fraction of `thick`, by position along the gun (game z = -Blender y)
        for v in bm.verts:
            f = taper(-v.co.y, v.co.z)
            v.co.x = x + (v.co.x - x) * f
    o = kit.mesh_obj(name, bm, mat, coll, (0, 0, 0), (0, 0, 0))
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width = bev
    m.segments = 4
    m.limit_method = "ANGLE"
    o["uv"] = "box"
    return tag(o, grain)


def ring(name, mat, coll, centre, radius, r_wire, plane="zy", a0=0.0, a1=2 * math.pi, n=24):
    """A bent wire (trigger guard, swivel loop): one smooth swept tube."""
    cx, cy, cz = centre
    pts = []
    for a in np.linspace(a0, a1, n):
        if plane == "zy":
            pts.append(kit.g2b(cx, cy + radius * math.sin(a), cz + radius * math.cos(a)))
        else:
            pts.append(kit.g2b(cx + radius * math.cos(a), cy + radius * math.sin(a), cz))
    cu = bpy.data.curves.new(f"{name}_curve", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r_wire
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p_, v in zip(sp.points, pts):
        p_.co = (*v, 1.0)
    sp.use_cyclic_u = abs(a1 - a0 - 2 * math.pi) < 1e-6
    tmp = bpy.data.objects.new(f"{name}_tmp", cu)
    coll.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
    coll.objects.unlink(tmp)
    bpy.data.objects.remove(tmp)
    me.materials.clear()
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    o["uv"] = "box"
    return tag(o, True)


def marker(name, coll, pos):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.02
    e.location = kit.g2b(*pos)
    coll.objects.link(e)
    return e


# ---------- the guns ----------

def build_mule(M, coll):
    """The Mule: an old wood-stocked semi-auto carbine with iron sights,
    the gun every Diver starts with. 18-round box magazine. ~0.95 m."""
    S, W = M["steel"], M["wood"]
    # the one-piece stock: butt, semi-pistol wrist, forend running under the barrel
    stock = [(-0.36, 0.018), (-0.25, 0.012), (-0.12, 0.002), (-0.075, -0.012), (0.14, -0.018), (0.4, -0.018),
             (0.425, -0.03), (0.425, -0.055), (0.4, -0.066), (0.12, -0.07), (0.09, -0.076), (0.0, -0.078),
             (-0.04, -0.08), (-0.085, -0.122), (-0.115, -0.124), (-0.14, -0.092), (-0.25, -0.11), (-0.36, -0.132)]
    def stock_taper(z, y):
        if z > 0.12:
            return 0.78  # slim forend
        if -0.14 < z < -0.04:
            return 0.86 if y < -0.06 else 0.92  # the wrist, slimmer where the hand wraps it
        return 1.0 if z < -0.2 else 0.95
    profile("mule_stock", W, coll, stock, 0.048, bev=0.014, taper=stock_taper)
    # the upper handguard over the barrel, held by the band
    profile("mule_handguard", W, coll, [(0.15, 0.0), (0.37, 0.004), (0.375, 0.018), (0.36, 0.03), (0.16, 0.028), (0.15, 0.016)], 0.034, bev=0.008)
    # steel butt plate with two screws
    profile("mule_buttplate", S, coll, [(-0.366, 0.02), (-0.356, 0.02), (-0.356, -0.134), (-0.366, -0.134)], 0.05, bev=0.003, grain=False)
    for k, y in enumerate((-0.01, -0.1)):
        tube(f"mule_buttscrew{k}", S, coll, (0, y, -0.368), (0, y, -0.362), 0.004, seg=8, bev=0)
    # the receiver: ejection port, bolt handle, safety, rear peep sight with ears
    # a shaped receiver: rounded top, sloping down to the barrel, a step at the rear
    profile("mule_receiver", S, coll, [(-0.08, -0.018), (-0.08, 0.02), (-0.06, 0.036), (0.02, 0.04), (0.09, 0.036),
                                      (0.13, 0.026), (0.142, 0.016), (0.142, -0.016)], 0.03, bev=0.006, grain=False,
            taper=lambda z, y: 0.82 if y > 0.03 else 1.0)
    part("mule_port", M["steel"], coll, (0.0152, 0.016, 0.06), (0.002, 0.016, 0.05), bev=0)
    tube("mule_bolt_handle", S, coll, (0.015, 0.018, 0.075), (0.042, 0.018, 0.075), 0.004, seg=10)
    tag(kit.cylinder("mule_bolt_knob", S, coll, (0.042, 0.018, 0.068), (0.042, 0.018, 0.082), 0.0075, segments=12, bev=0.002))
    part("mule_safety", S, coll, (-0.016, -0.03, -0.005), (0.006, 0.01, 0.012), bev=0.002)
    part("mule_rear_sight_base", S, coll, (0, 0.046, -0.055), (0.018, 0.012, 0.03), bev=0.003)
    tag(kit.cylinder("mule_peep", S, coll, (0, 0.06, -0.056), (0, 0.06, -0.05), 0.007, segments=14, bev=0.001))
    for s in (-1, 1):
        part(f"mule_rear_ear{s}", S, coll, (s * 0.011, 0.058, -0.053), (0.004, 0.02, 0.022), bev=0.0015)
    # the barrel, crowned at the muzzle; the front sight post between its ears
    tube("mule_barrel", S, coll, (0, 0.012, 0.14), (0, 0.012, 0.59), 0.0095, seg=18)
    tube("mule_muzzle", S, coll, (0, 0.012, 0.582), (0, 0.012, 0.592), 0.0108, seg=18)
    part("mule_front_base", S, coll, (0, 0.025, 0.567), (0.016, 0.012, 0.03), bev=0.003)
    part("mule_front_post", S, coll, (0, 0.04, 0.567), (0.003, 0.02, 0.004), bev=0.0008)
    for s in (-1, 1):
        part(f"mule_front_ear{s}", S, coll, (s * 0.0075, 0.038, 0.567), (0.003, 0.018, 0.014), bev=0.001)
    # the barrel band round stock and handguard, with its sling swivel
    part("mule_band", S, coll, (0, -0.017, 0.34), (0.05, 0.1, 0.022), bev=0.009)
    ring("mule_band_swivel", S, coll, (0, -0.078, 0.34), 0.012, 0.0022, plane="zy", n=14)
    ring("mule_butt_swivel", S, coll, (0, -0.135, -0.27), 0.011, 0.0022, plane="zy", n=14)
    # the 18-round box magazine, ribbed, with a base plate
    part("mule_mag", S, coll, (0, -0.105, 0.05), (0.024, 0.15, 0.052), rot=(0.06, 0, 0), bev=0.003)
    part("mule_mag_base", S, coll, (0, -0.182, 0.054), (0.028, 0.008, 0.058), rot=(0.06, 0, 0), bev=0.002)
    for s in (-1, 1):
        part(f"mule_mag_rib{s}", S, coll, (s * 0.0125, -0.105, 0.05), (0.002, 0.11, 0.008), rot=(0.06, 0, 0), bev=0.0005)
    part("mule_mag_catch", S, coll, (0.014, -0.045, 0.012), (0.004, 0.01, 0.014), bev=0.001)
    # trigger guard and trigger
    ring("mule_guard", S, coll, (0, -0.078, -0.012), 0.032, 0.0035, plane="zy", a0=math.pi, a1=2 * math.pi, n=16)
    part("mule_trigger", S, coll, (0, -0.09, -0.008), (0.006, 0.026, 0.006), rot=(-0.3, 0, 0), bev=0.0015)
    # where the game holds it and where shots leave it
    marker("muzzle", coll, (0, 0.012, 0.592))
    marker("grip", coll, (0, -0.1, -0.1))
    marker("fore", coll, (0, -0.05, 0.27))
    return {"length": 0.95, "views": [((1.55, 0.08, 0.12), (0, -0.03, 0.12)), ((0.75, 0.35, -0.6), (0, -0.03, 0.1)), ((0.22, 0.09, -0.12), (0, -0.01, 0.02))]}


GUNS = {"mule": build_mule}


# ---------- render & export ----------

def studio(cam, look, out, fov=30):
    scn = bpy.context.scene
    for o in [o for o in scn.objects if o.name.startswith("studio_")]:
        bpy.data.objects.remove(o)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=3.0)
    floor = kit.mesh_obj("studio_floor", bm, kit.pbr("mat_studio", None, tint=(0.08, 0.07, 0.06), rough=0.8), scn.collection, kit.g2b(0, -0.2, 0))
    kit.add_light("studio_key", "AREA", (0.6, 0.8, 0.5), (1.0, 0.8, 0.62), 60, coll=scn.collection, size=0.8)
    kit.add_light("studio_fill", "AREA", (-0.7, 0.4, 0.2), (0.85, 0.82, 0.78), 18, coll=scn.collection, size=1.2)
    kit.add_light("studio_rim", "AREA", (0.0, 0.5, -0.9), (1.0, 0.85, 0.7), 30, coll=scn.collection, size=0.6)
    for o in scn.objects:
        if o.name.startswith("studio_") and o.type == "LIGHT":
            d = Vector((0, 0, 0)) - o.location
            o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    kit.setup_render(out, cam, look, fov=fov, res=(1200, 675), samples=64)
    scn.world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.025, 0.02, 1)


def main():
    guns = (arg("--guns") or ",".join(GUNS)).split(",")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(kit.WORK, exist_ok=True)
    make_gun_textures()
    M = gun_materials()
    for gun in guns:
        coll = bpy.data.collections.new(f"wpn_{gun}")
        bpy.context.scene.collection.children.link(coll)
        info = GUNS[gun](M, coll)
        for o in list(coll.objects):
            kit.finalize(o)
        tris = sum(len(p.vertices) - 2 for o in coll.objects if o.type == "MESH" for p in o.data.polygons)
        print(f"{gun}: parts {len([o for o in coll.objects if o.type == 'MESH'])}  triangles {tris}")
        if "--render" in sys.argv:
            for k, (cam, look) in enumerate(info["views"]):
                for other in bpy.data.collections:
                    if other.name.startswith("wpn_"):
                        other.hide_render = other is not coll
                studio(cam, look, os.path.join(kit.WORK, f"preview_wpn_{gun}_{k}.png"), fov=30 if k < 2 else 26)
        if "--export" in sys.argv:
            os.makedirs(GMODELS, exist_ok=True)
            kit.merge_by_material(coll, prefix=f"wpn_{gun}_")
            bpy.ops.object.select_all(action="DESELECT")
            for o in coll.objects:
                o.select_set(True)
            bpy.ops.export_scene.gltf(
                filepath=os.path.join(GMODELS, f"wpn_{gun}.gltf"), export_format="GLTF_SEPARATE",
                export_texture_dir="../../textures/weapons", use_selection=True, export_apply=True, export_yup=True,
                export_tangents=True, export_lights=False, export_cameras=False, export_materials="EXPORT",
                export_image_format="AUTO",
            )


if __name__ == "__main__":
    main()
