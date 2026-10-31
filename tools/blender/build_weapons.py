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
    return {"steel": pbr_from("mat_gun_steel_01", "gunsteel"), "wood": pbr_from("mat_gun_wood_01", "gunwood"),
            # scrap-built guns (author: the base weapons are made from scrap) reuse
            # the Sanctuary's rusted old-paint steel, painted planks and cloth
            "scrap": kit.pbr("mat_gun_scrap_metal_01", "steel", tint=(0.72, 0.68, 0.64)),
            "plank": kit.pbr("mat_gun_scrap_wood_01", "plank"),
            "cloth": kit.pbr("mat_gun_cloth_01", "canvas", tint=(0.62, 0.6, 0.5))}


# ---------- parts ----------

def tag(o, grain=False):
    o["tile"] = 1.8 if o.data and getattr(o.data, "materials", None) and o.data.materials and o.data.materials[0].name.startswith("mat_gun_scrap_metal") else GUN_TILE
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

def weld(name, M, coll, p0, p1, r=0.0022):
    """A weld bead: one continuous, lumpy run along a seam, darker and
    rougher than the plates it joins."""
    rr = np.random.default_rng(abs(hash(name)) % 2 ** 32)
    tube(f"{name}_run", M["steel"], coll, p0, p1, r, seg=8, bev=0)
    n = max(2, int(math.dist(p0, p1) / 0.012))
    for k in range(n):
        t = (k + rr.uniform(0.2, 0.8)) / n
        p = [p0[i] + (p1[i] - p0[i]) * t for i in range(3)]
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r * rr.uniform(1.1, 1.5))
        d = Vector(kit.g2b(*p1)) - Vector(kit.g2b(*p0))
        o = kit.mesh_obj(f"{name}_{k}", bm, M["steel"], coll, kit.g2b(*p), d.to_track_quat("Z", "Y").to_euler())
        o.scale = (0.8, 0.8, 2.2)  # stretched along the seam: a ripple of the bead
        o["uv"] = "box"
        tag(o)


def hex_bolt(name, M, coll, p, axis="x", r=0.0045, h=0.004):
    """A hex bolt head (six-sided) sticking out along `axis`."""
    x, y, z = p
    d = {"x": (h, 0, 0), "y": (0, h, 0), "z": (0, 0, h)}[axis]
    return tag(kit.cylinder(name, M["steel"], coll, (x, y, z), (x + d[0], y + d[1], z + d[2]), r, segments=6, bev=0.0006))


def hose_clamp(name, M, coll, z, y, r):
    """A hose clamp round barrel and bar: a steel band and its screw housing."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=r, radius2=r, depth=0.01)
    o = kit.mesh_obj(name, bm, M["steel"], coll, kit.g2b(0, y, z), (R90, 0, 0))
    o["uv"] = "box"
    tag(o)
    part(f"{name}_screw", M["steel"], coll, (r * 0.75, y + r * 0.6, z), (0.009, 0.007, 0.012), bev=0.001)


def rope(name, M, coll, pts, r=0.0035):
    """A rope or cord through the given points (a smooth swept tube)."""
    cu = bpy.data.curves.new(f"{name}_curve", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p_, v in zip(sp.points, pts):
        p_.co = (*kit.g2b(*v), 1.0)
    sp.use_endpoint_u = True
    sp.order_u = 3
    tmp = bpy.data.objects.new(f"{name}_tmp", cu)
    coll.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
    coll.objects.unlink(tmp)
    bpy.data.objects.remove(tmp)
    me.materials.clear()
    me.materials.append(M["cloth"])
    for poly in me.polygons:
        poly.use_smooth = True
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    o["uv"] = "box"
    return tag(o, True)


def tape(name, M, coll, centre, size, rot=(0, 0, 0)):
    """A wrap of cloth tape: a thin sleeve just proud of what it binds."""
    return part(name, M["cloth"], coll, centre, size, rot=rot, bev=0.002)


def build_mule(M, coll):
    """The Mule, scrap-built (author: base weapons are made from scrap): a
    semi-auto carbine the Divers put together from pipe, plate, fence boards
    and tape. 18 rounds, two magazines taped end to end. ~0.95 m."""
    S, Wd = M["scrap"], M["plank"]  # rusted old plate for the welded receiver
    D = M["steel"]  # darker worn steel: pipe, clamps, bolts, magazines, small parts
    rr = np.random.default_rng(31)

    # the stock: two old painted fence boards screwed side by side, cut straight with a saw
    for k, (x, sh) in enumerate(((-0.0105, 0.0), (0.0105, 0.004))):
        o = profile(f"mule_board{k}", Wd, coll, [(-0.36, 0.016 + sh), (-0.085, 0.002), (-0.085, -0.044), (-0.36, -0.124 + sh * 2)], 0.02, x=x, bev=0.003)
        o["tile"] = 1.2
    for k, (z, y) in enumerate(((-0.3, -0.02), (-0.3, -0.09), (-0.16, -0.035), (-0.16, -0.065))):
        tag(kit.cylinder(f"mule_screw{k}", D, coll, (0.0205, y, z), (0.023, y, z), 0.0035, segments=10, bev=0))
    # a chunk of old tyre for a butt pad
    part("mule_buttpad", M["cloth"], coll, (0, -0.052, -0.371), (0.046, 0.15, 0.022), rot=(0.12, 0, 0), bev=0.006)
    # the grip: a wooden block, wrapped in tape
    gp = (0, -0.085, -0.058)
    part("mule_grip", Wd, coll, gp, (0.03, 0.11, 0.038), rot=(0.32, 0, 0), bev=0.004)
    for k, dy in enumerate((-0.03, 0.0, 0.03)):
        tape(f"mule_grip_tape{k}", M, coll, (0, gp[1] + dy * 0.949, gp[2] + dy * 0.315), (0.034, 0.016, 0.042), rot=(0.32, 0, 0))

    # the receiver: scrap plate welded into a box, a side plate bolted on
    part("mule_receiver", S, coll, (0, 0.004, 0.03), (0.034, 0.058, 0.24), bev=0.002)
    part("mule_receiver_lid", S, coll, (0.001, 0.036, 0.02), (0.03, 0.008, 0.2), rot=(0, 0.01, 0), bev=0.0015)
    part("mule_sideplate", S, coll, (0.019, 0.0, 0.0), (0.004, 0.045, 0.12), bev=0.001)
    for k, (z, y) in enumerate(((-0.05, 0.016), (-0.05, -0.016), (0.05, 0.016), (0.05, -0.016))):
        hex_bolt(f"mule_bolt{k}", M, coll, (0.021, y, z))
    weld("mule_weld_top", M, coll, (0.0165, 0.033, -0.085), (0.0165, 0.033, 0.145))
    weld("mule_weld_top2", M, coll, (-0.0165, 0.033, -0.085), (-0.0165, 0.033, 0.145))
    weld("mule_weld_front", M, coll, (-0.017, 0.024, 0.152), (0.017, 0.024, 0.152), r=0.003)
    part("mule_port", S, coll, (0.0175, 0.02, 0.085), (0.002, 0.014, 0.045), bev=0)  # the hand-cut ejection slot
    # the bolt handle: a bent rod with a nut for a knob
    ring("mule_bolt_handle", D, coll, (0.017, 0.02, 0.105), 0.02, 0.0035, plane="xy", a0=0, a1=math.pi / 2.2, n=10)
    tag(kit.cylinder("mule_bolt_nut", D, coll, (0.034, 0.038, 0.1), (0.034, 0.038, 0.11), 0.007, segments=6, bev=0.001))

    # the barrel: a length of steel pipe, a pipe coupling at the muzzle
    tube("mule_barrel", D, coll, (0, 0.012, 0.15), (0, 0.012, 0.575), 0.0115, seg=16)
    tube("mule_coupling", D, coll, (0, 0.012, 0.565), (0, 0.012, 0.61), 0.017, seg=16)
    for k in range(4):  # holes drilled through the coupling, by hand, unevenly
        a = k * math.pi / 2 + 0.3
        part(f"mule_port_hole{k}", D, coll, (0.017 * math.cos(a), 0.012 + 0.017 * math.sin(a), 0.588 + rr.uniform(-0.004, 0.004)), (0.006, 0.006, 0.006), bev=0)
    # a flat bar under the barrel, held on by hose clamps; the forend plank screwed under it
    part("mule_bar", D, coll, (0, -0.008, 0.31), (0.018, 0.008, 0.32), bev=0.001)
    for k, z in enumerate((0.2, 0.33, 0.46)):
        hose_clamp(f"mule_clamp{k}", M, coll, z, 0.003, 0.021)
    o = profile("mule_forend", Wd, coll, [(0.16, -0.013), (0.43, -0.013), (0.43, -0.05), (0.18, -0.052)], 0.036, bev=0.003)
    o["tile"] = 1.2
    for k, z in enumerate((0.26, 0.4)):
        tape(f"mule_forend_tape{k}", M, coll, (0, -0.031, z), (0.04, 0.044, 0.02))

    # sights: a bent-plate notch at the rear, a bolt welded on at the front
    part("mule_rear_plate", S, coll, (0, 0.05, -0.05), (0.022, 0.02, 0.003), rot=(-0.15, 0, 0), bev=0.0005)
    part("mule_rear_foot", S, coll, (0, 0.041, -0.044), (0.022, 0.003, 0.014), bev=0.0005)
    hex_bolt("mule_front_sight", M, coll, (0, 0.028, 0.555), axis="y", r=0.004, h=0.016)
    weld("mule_front_weld", M, coll, (-0.006, 0.025, 0.555), (0.006, 0.025, 0.555), r=0.0025)

    # two magazines taped end to end (one upside down) for a fast swap
    part("mule_mag", D, coll, (0, -0.1, 0.055), (0.024, 0.14, 0.05), rot=(0.05, 0, 0), bev=0.006)
    part("mule_mag2", D, coll, (0.026, -0.1, 0.06), (0.024, 0.14, 0.05), rot=(0.05, 0, 0), bev=0.006)
    for k, x in enumerate((0.0, 0.026)):  # a pressed rib down each magazine
        part(f"mule_mag_rib{k}", D, coll, (x + 0.0125, -0.1, 0.057), (0.002, 0.1, 0.012), rot=(0.05, 0, 0), bev=0.0008)
    for k, dy in enumerate((-0.06, 0.0)):
        tape(f"mule_mag_tape{k}", M, coll, (0.013, -0.1 + dy, 0.057), (0.054, 0.022, 0.054), rot=(0.05, 0, 0))
    # trigger guard: a bent rod; the trigger a cut tab
    ring("mule_guard", D, coll, (0, -0.032, -0.018), 0.03, 0.0032, plane="zy", a0=math.pi, a1=2 * math.pi, n=16)
    part("mule_trigger", D, coll, (0, -0.046, -0.014), (0.005, 0.024, 0.006), rot=(-0.3, 0, 0), bev=0.001)
    # a rope sling from the front clamp to the butt
    rope("mule_sling", M, coll, [(0.0, -0.02, 0.46), (0.026, -0.07, 0.3), (0.03, -0.1, 0.08), (0.028, -0.1, -0.15), (0.012, -0.08, -0.33)])

    marker("muzzle", coll, (0, 0.012, 0.61))
    marker("grip", coll, (0, -0.1, -0.065))
    marker("fore", coll, (0, -0.04, 0.3))
    return {"length": 0.97, "views": [((1.55, 0.08, 0.12), (0, -0.03, 0.12)), ((0.75, 0.35, -0.6), (0, -0.03, 0.1)), ((0.22, 0.09, -0.12), (0, -0.01, 0.02))]}


def build_sparrow(M, coll):
    """The Sparrow, scrap-built: a compact SMG ("shreds small Husks up
    close") made from square steel tube, a short pipe barrel in a punched
    heat shield, a welded box magazine ahead of the grip, a pipe-stub front
    grip and a folding wire stock. 32 rounds. ~0.78 m with the stock out."""
    S, D, Wd = M["scrap"], M["steel"], M["plank"]
    rr = np.random.default_rng(41)

    # the body: a length of square steel tube, a welded end cap, a flat-bar rail
    part("sparrow_body", S, coll, (0, 0.0, 0.04), (0.044, 0.05, 0.32), bev=0.003)
    part("sparrow_endcap", S, coll, (0, 0.0, -0.123), (0.05, 0.056, 0.008), bev=0.002)
    weld("sparrow_cap_weld", M, coll, (-0.022, 0.025, -0.118), (0.022, 0.025, -0.118))
    part("sparrow_rail", D, coll, (0, 0.029, 0.03), (0.016, 0.006, 0.26), bev=0.001)
    weld("sparrow_rail_weld_l", M, coll, (-0.008, 0.026, -0.09), (-0.008, 0.026, 0.15), r=0.0016)
    weld("sparrow_rail_weld_r", M, coll, (0.008, 0.026, -0.09), (0.008, 0.026, 0.15), r=0.0016)
    part("sparrow_port", D, coll, (0.0215, 0.008, 0.07), (0.002, 0.016, 0.06), bev=0)  # the hand-cut ejection slot
    # the cocking handle: a hex bolt riding in a slot on the left
    part("sparrow_cock_slot", D, coll, (-0.0225, 0.008, -0.02), (0.002, 0.008, 0.08), bev=0)
    tube("sparrow_cock_rod", D, coll, (-0.022, 0.008, 0.0), (-0.042, 0.008, 0.0), 0.0035, seg=8)
    hex_bolt("sparrow_cock_head", M, coll, (-0.042, 0.008, 0.0), axis="x", r=0.007, h=-0.008)

    # the barrel: a short pipe inside a heat shield punched full of holes; a nut for a muzzle
    tube("sparrow_barrel", D, coll, (0, 0.006, 0.2), (0, 0.006, 0.42), 0.009, seg=14)
    tube("sparrow_shield", S, coll, (0, 0.006, 0.2), (0, 0.006, 0.36), 0.021, seg=20)
    for row in range(3):
        for k in range(5):
            a = R90 + (row - 1) * 0.7
            z = 0.225 + k * 0.028 + (row % 2) * 0.012
            c, sn = math.cos(a), math.sin(a)
            tag(kit.cylinder(f"sparrow_hole{row}_{k}", D, coll, (0.0205 * c, 0.006 + 0.0205 * sn, z), (0.0216 * c, 0.006 + 0.0216 * sn, z), 0.0042, segments=10, bev=0))
    weld("sparrow_shield_weld", M, coll, (-0.015, 0.02, 0.2), (0.015, 0.02, 0.2), r=0.002)
    hex_bolt("sparrow_muzzle_nut", M, coll, (0, 0.006, 0.405), axis="z", r=0.014, h=0.018)

    # the magazine: a welded sheet-steel box ahead of the grip, taped, in a welded collar
    part("sparrow_magwell", S, coll, (0, -0.035, 0.1), (0.028, 0.025, 0.062), bev=0.002)
    part("sparrow_mag", D, coll, (0, -0.13, 0.1), (0.022, 0.19, 0.052), rot=(0.03, 0, 0), bev=0.005)
    part("sparrow_mag_rib", D, coll, (0.0115, -0.13, 0.1), (0.002, 0.14, 0.01), rot=(0.03, 0, 0), bev=0.0008)
    tape("sparrow_mag_tape", M, coll, (0, -0.16, 0.1), (0.026, 0.025, 0.056), rot=(0.03, 0, 0))
    weld("sparrow_magwell_weld", M, coll, (-0.014, -0.024, 0.07), (-0.014, -0.024, 0.13), r=0.0018)

    # the grip: a wooden block, taped; trigger guard and trigger
    gp = (0, -0.075, -0.04)
    part("sparrow_grip", M["wood"], coll, gp, (0.03, 0.105, 0.036), rot=(0.28, 0, 0), bev=0.004)["tile"] = 1.2
    for k, dy in enumerate((-0.028, 0.002, 0.03)):
        tape(f"sparrow_grip_tape{k}", M, coll, (0, gp[1] + dy * 0.961, gp[2] + dy * 0.276), (0.034, 0.015, 0.04), rot=(0.28, 0, 0))
    ring("sparrow_guard", D, coll, (0, -0.026, -0.005), 0.028, 0.003, plane="zy", a0=math.pi, a1=2 * math.pi, n=16)
    part("sparrow_trigger", D, coll, (0, -0.04, -0.002), (0.005, 0.022, 0.006), rot=(-0.3, 0, 0), bev=0.001)

    # the front grip: a pipe stub, taped, with a pipe cap
    tube("sparrow_fore_stub", D, coll, (0, -0.012, 0.29), (0, -0.1, 0.29), 0.012, seg=14)
    tape("sparrow_fore_tape", M, coll, (0, -0.06, 0.29), (0.028, 0.06, 0.028))
    tube("sparrow_fore_cap", D, coll, (0, -0.098, 0.29), (0, -0.112, 0.29), 0.0145, seg=14)
    weld("sparrow_fore_weld", M, coll, (-0.012, -0.014, 0.29), (0.012, -0.014, 0.29), r=0.002)

    # the folding wire stock: two bent rods on a hinge, a flat-bar butt with a cloth pad
    tube("sparrow_hinge", D, coll, (-0.026, -0.018, -0.12), (0.026, -0.018, -0.12), 0.006, seg=12)
    for k, (yf, yb) in enumerate(((0.012, 0.03), (-0.018, -0.06))):
        for s in (-1, 1):
            tube(f"sparrow_rod{k}_{s}", D, coll, (s * 0.018, yf, -0.125), (s * 0.016, yb, -0.4), 0.004, seg=8)
    part("sparrow_butt", S, coll, (0, -0.015, -0.402), (0.045, 0.11, 0.008), bev=0.002)
    part("sparrow_butt_pad", M["cloth"], coll, (0, -0.015, -0.41), (0.048, 0.1, 0.012), bev=0.004)

    # sights: a nut welded upright for a rear peep, a nail for the front post
    hex_bolt("sparrow_rear_peep", M, coll, (0, 0.032, -0.08), axis="z", r=0.008, h=0.006)
    tag(kit.cylinder("sparrow_front_nail", D, coll, (0, 0.027, 0.345), (0, 0.045, 0.345), 0.0018, segments=6, bev=0))
    # a cord sling from the front grip to the stock
    rope("sparrow_sling", M, coll, [(0.0, -0.1, 0.29), (0.02, -0.14, 0.12), (0.025, -0.14, -0.1), (0.018, -0.06, -0.36)], r=0.003)

    marker("muzzle", coll, (0, 0.006, 0.423))
    marker("grip", coll, (0, -0.09, -0.045))
    marker("fore", coll, (0, -0.07, 0.29))
    return {"length": 0.83, "views": [((1.25, 0.05, 0.0), (0, -0.04, 0.0)), ((0.6, 0.28, -0.45), (0, -0.04, 0.0)), ((0.2, 0.06, 0.25), (0, -0.01, 0.05))]}


def build_badger(M, coll):
    """The Badger, scrap-built: a full-auto rifle on medium rounds ("a good
    all-rounder") welded from angle iron and pipe, with a salvaged red-dot
    sight on a flat-bar rail, a curved magazine built up from welded
    sections, a handguard of two bolted angle irons, a slotted pipe muzzle
    brake and a stock sawn from a painted plank. 26 rounds. ~0.9 m."""
    S, D, Wd = M["scrap"], M["steel"], M["plank"]

    # the receiver: a welded box of rusted plate, a lid of angle iron, a bolted side plate
    part("badger_receiver", S, coll, (0, 0.0, 0.02), (0.038, 0.06, 0.26), bev=0.002)
    part("badger_lid", S, coll, (0, 0.034, 0.02), (0.042, 0.008, 0.26), bev=0.0015)
    part("badger_lid_flange", S, coll, (-0.0185, 0.026, 0.02), (0.005, 0.02, 0.26), bev=0.001)
    weld("badger_lid_weld", M, coll, (0.019, 0.03, -0.1), (0.019, 0.03, 0.14))
    part("badger_sideplate", S, coll, (0.0205, -0.004, -0.02), (0.004, 0.04, 0.11), bev=0.001)
    for k, (z, y) in enumerate(((-0.065, 0.012), (-0.065, -0.02), (0.025, 0.012), (0.025, -0.02))):
        hex_bolt(f"badger_bolt{k}", M, coll, (0.0225, y, z))
    part("badger_port", D, coll, (0.0195, 0.014, 0.08), (0.002, 0.016, 0.05), bev=0)  # the hand-cut ejection slot
    # the charging handle: a rod bent up through a slot in the lid, a nut for a knob
    part("badger_charge_slot", D, coll, (0.0, 0.0385, -0.03), (0.008, 0.002, 0.09), bev=0)
    tube("badger_charge_rod", D, coll, (0, 0.034, -0.06), (0, 0.05, -0.06), 0.0035, seg=8)
    tube("badger_charge_bar", D, coll, (-0.02, 0.05, -0.06), (0.02, 0.05, -0.06), 0.0035, seg=8)
    hex_bolt("badger_charge_nut", M, coll, (0.02, 0.05, -0.06), axis="x", r=0.006, h=0.008)

    # the rail: a flat bar welded along the lid; the red dot on it
    part("badger_rail", D, coll, (0, 0.042, 0.0), (0.02, 0.008, 0.2), bev=0.001)
    for k in range(9):  # short lengths of bar welded across: the rail's teeth
        part(f"badger_rail_tooth{k}", D, coll, (0, 0.0475, -0.088 + k * 0.022), (0.02, 0.003, 0.009), bev=0.0006)
    weld("badger_rail_weld", M, coll, (0.0105, 0.039, -0.09), (0.0105, 0.039, 0.09), r=0.0016)
    # the red dot: a salvaged sight tube on a clamp block, a tape wrap, a knob for the battery cap
    part("badger_dot_mount", D, coll, (0, 0.056, -0.02), (0.026, 0.014, 0.034), bev=0.0015)
    hex_bolt("badger_dot_clamp", M, coll, (0.013, 0.054, -0.02), axis="x", r=0.005, h=0.006)
    tube("badger_dot_body", S, coll, (0, 0.078, -0.055), (0, 0.078, 0.015), 0.017, seg=20)
    for nm, z0, z1, r in (("hood", 0.012, 0.032, 0.0195), ("eye", -0.067, -0.052, 0.0185)):
        bm = bmesh.new()  # an open sleeve: you can see into the sight
        bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=r, radius2=r, depth=z1 - z0)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.0025)
        o = kit.mesh_obj(f"badger_dot_{nm}", bm, D, coll, kit.g2b(0, 0.078, (z0 + z1) / 2), (R90, 0, 0))
        o["uv"] = "box"
        tag(o)
    for k, z in enumerate((-0.054, 0.013)):  # the lenses, dark and set back inside the tube
        tube(f"badger_dot_lens{k}", D, coll, (0, 0.078, z), (0, 0.078, z + 0.002), 0.0165, seg=20, bev=0)
    tube("badger_dot_knob", D, coll, (0.017, 0.078, -0.02), (0.027, 0.078, -0.02), 0.008, seg=10)
    tape("badger_dot_tape", M, coll, (0, 0.078, -0.035), (0.037, 0.037, 0.018))

    # the barrel: steel pipe with a gas tube clamped above it, a slotted muzzle brake
    tube("badger_barrel", D, coll, (0, 0.008, 0.15), (0, 0.008, 0.53), 0.011, seg=16)
    tube("badger_gas", D, coll, (0, 0.03, 0.15), (0, 0.03, 0.38), 0.005, seg=10)
    tube("badger_gas_block", D, coll, (0, 0.016, 0.375), (0, 0.016, 0.395), 0.02, seg=14)
    tube("badger_brake", D, coll, (0, 0.008, 0.51), (0, 0.008, 0.575), 0.017, seg=16)
    for k in range(3):  # slots cut across the top of the brake with a grinder
        part(f"badger_brake_slot{k}", S, coll, (0, 0.0235, 0.525 + k * 0.016), (0.024, 0.004, 0.006), bev=0)
    weld("badger_brake_weld", M, coll, (-0.012, 0.022, 0.51), (0.012, 0.022, 0.51), r=0.002)

    # the handguard: two lengths of angle iron either side of the barrel, bolted through
    for s in (-1, 1):
        part(f"badger_guard_side{s}", S, coll, (s * 0.024, 0.002, 0.27), (0.004, 0.05, 0.22), bev=0.001)
        part(f"badger_guard_lip{s}", S, coll, (s * 0.017, -0.021, 0.27), (0.014, 0.004, 0.22), bev=0.001)
        for k in range(5):  # holes drilled for cooling
            tag(kit.cylinder(f"badger_guard_hole{s}_{k}", D, coll, (s * 0.0258, 0.008, 0.2 + k * 0.035), (s * 0.0262, 0.008, 0.2 + k * 0.035), 0.0055, segments=10, bev=0))
    for k, z in enumerate((0.175, 0.365)):
        tube(f"badger_guard_bolt{k}", D, coll, (-0.03, -0.012, z), (0.03, -0.012, z), 0.003, seg=8)
        for s in (-1, 1):
            hex_bolt(f"badger_guard_nut{k}_{s}", M, coll, (s * 0.026, -0.012, z), axis="x", r=0.005, h=s * 0.005)
    tape("badger_guard_tape", M, coll, (0, 0.002, 0.25), (0.056, 0.058, 0.05))

    # the curved magazine: short welded sections, each tipped a little further forward
    part("badger_magwell", S, coll, (0, -0.04, 0.08), (0.03, 0.03, 0.062), bev=0.002)
    weld("badger_magwell_weld", M, coll, (0.0155, -0.03, 0.05), (0.0155, -0.03, 0.11), r=0.0018)
    y, z, ang = -0.035, 0.08, 0.0
    for k in range(6):
        ang = 0.06 + k * 0.075
        y -= 0.03 * math.cos(ang)
        z += 0.03 * math.sin(ang)
        part(f"badger_mag{k}", D, coll, (0, y, z), (0.024, 0.032, 0.054), rot=(-ang, 0, 0), bev=0.004)
        if k in (1, 4):
            tape(f"badger_mag_tape{k}", M, coll, (0, y, z), (0.028, 0.02, 0.058), rot=(-ang, 0, 0))
    part("badger_mag_base", D, coll, (0, y - 0.018 * math.cos(ang), z + 0.018 * math.sin(ang)), (0.028, 0.008, 0.06), rot=(-ang, 0, 0), bev=0.002)

    # the grip: a wooden block, taped; trigger guard and trigger
    gp = (0, -0.078, -0.06)
    part("badger_grip", Wd, coll, gp, (0.03, 0.105, 0.038), rot=(0.3, 0, 0), bev=0.004)["tile"] = 1.2
    for k, dy in enumerate((-0.028, 0.002, 0.03)):
        tape(f"badger_grip_tape{k}", M, coll, (0, gp[1] + dy * 0.955, gp[2] + dy * 0.296), (0.034, 0.015, 0.042), rot=(0.3, 0, 0))
    ring("badger_trigger_guard", D, coll, (0, -0.03, -0.02), 0.03, 0.0032, plane="zy", a0=math.pi, a1=2 * math.pi, n=16)
    part("badger_trigger", D, coll, (0, -0.044, -0.018), (0.005, 0.024, 0.006), rot=(-0.3, 0, 0), bev=0.001)

    # the stock: a painted plank sawn to shape, bolted to a flat-bar tang, a tyre-chunk butt pad
    part("badger_tang", D, coll, (0, 0.006, -0.135), (0.02, 0.03, 0.06), bev=0.001)
    o = profile("badger_stock", Wd, coll, [(-0.39, 0.03), (-0.13, 0.02), (-0.13, -0.022), (-0.24, -0.04), (-0.39, -0.11)], 0.03, bev=0.004)
    o["tile"] = 1.2
    for k, (zz, yy) in enumerate(((-0.15, 0.01), (-0.15, -0.012))):
        hex_bolt(f"badger_stock_bolt{k}", M, coll, (0.015, yy, zz))
    part("badger_buttpad", M["cloth"], coll, (0, -0.04, -0.4), (0.036, 0.15, 0.022), rot=(0.06, 0, 0), bev=0.006)
    # a cord sling from the gas block to the stock
    rope("badger_sling", M, coll, [(0.0, -0.005, 0.385), (0.028, -0.06, 0.25), (0.032, -0.11, 0.05), (0.03, -0.11, -0.17), (0.016, -0.06, -0.36)], r=0.0035)

    marker("muzzle", coll, (0, 0.008, 0.575))
    marker("grip", coll, (0, -0.095, -0.065))
    marker("fore", coll, (0, -0.01, 0.28))
    return {"length": 0.97, "views": [((1.55, 0.06, 0.08), (0, -0.03, 0.08)), ((0.75, 0.35, -0.6), (0, -0.03, 0.08)), ((0.25, 0.14, 0.12), (0, 0.05, -0.02))]}


def fluted_cylinder(name, mat, coll, cy, z0, z1, r, flute=0.0035, n=6, seg=72):
    """A revolver cylinder: a round drum with `n` shallow flutes cut between
    the chambers, extruded along the barrel axis."""
    bm = bmesh.new()
    verts = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        f = math.cos(n * (a + math.pi / n) / 2) ** 16  # a flute centred between each pair of chambers
        rr = r - flute * f
        verts.append(bm.verts.new(kit.g2b(rr * math.cos(a), cy + rr * math.sin(a), z0)))
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=kit.g2b(0, 0, z1 - z0), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = kit.mesh_obj(name, bm, mat, coll, (0, 0, 0), (0, 0, 0))
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width = 0.0012
    m.segments = 2
    m.limit_method = "ANGLE"
    o["uv"] = "box"
    return tag(o)


def build_hammerhead(M, coll):
    """The Hammerhead: a heavy six-shot revolver ("heavy hand cannon, punches
    through Husk plating"), pre-fall and looked after: worn blued steel with
    the bluing rubbed through on the edges, a full-length underlug and
    vent rib, walnut grip panels. ~0.4 m."""
    D, W = M["steel"], M["wood"]
    cy = 0.008  # the cylinder's axis; the top chamber lines up with the bore
    by = 0.026  # the bore

    # the frame: recoil shield, top strap, front of the window, the bottom rail
    part("hh_shield", D, coll, (0, 0.012, -0.008), (0.036, 0.066, 0.044), bev=0.009)
    part("hh_strap", D, coll, (0, 0.043, 0.055), (0.022, 0.011, 0.09), bev=0.004)
    part("hh_frame_front", D, coll, (0, 0.01, 0.092), (0.03, 0.06, 0.016), bev=0.005)
    part("hh_frame_bottom", D, coll, (0, -0.019, 0.05), (0.028, 0.01, 0.07), bev=0.002)
    # the cylinder: six chambers, fluted, on its pin
    fluted_cylinder("hh_cylinder", D, coll, cy, 0.017, 0.083, 0.0255)
    for k in range(6):
        a = R90 + k * math.pi / 3
        tube(f"hh_chamber{k}", D, coll, (0.017 * math.cos(a), cy + 0.017 * math.sin(a), 0.082), (0.017 * math.cos(a), cy + 0.017 * math.sin(a), 0.0845), 0.0058, seg=12, bev=0)
    tube("hh_pin", D, coll, (0, cy, 0.08), (0, cy, 0.086), 0.004, seg=10)
    # the barrel: a heavy shroud with a full-length underlug, a vent rib on top
    tube("hh_barrel", D, coll, (0, by, 0.098), (0, by, 0.33), 0.0135, seg=28, bev=0.002)
    profile("hh_underlug", D, coll, [(0.098, 0.02), (0.33, 0.02), (0.33, -0.002), (0.31, -0.009), (0.15, -0.011), (0.098, -0.006)], 0.019, bev=0.004, grain=False)
    part("hh_rib", D, coll, (0, 0.042, 0.215), (0.009, 0.008, 0.232), bev=0.0015)
    tube("hh_crown", D, coll, (0, by, 0.329), (0, by, 0.332), 0.0105, seg=16, bev=0.0008)
    tube("hh_bore", D, coll, (0, by, 0.331), (0, by, 0.3325), 0.0058, seg=12, bev=0)
    for s in (-1, 1):
        part(f"hh_rib_edge{s}", D, coll, (s * 0.0055, 0.0495, 0.215), (0.003, 0.005, 0.228), bev=0.0006)
    for k in range(7):  # the vent rib's cross posts
        part(f"hh_rib_post{k}", D, coll, (0, 0.049, 0.115 + k * 0.034), (0.008, 0.004, 0.006), bev=0.0005)
    # the ejector rod, tucked under the barrel in the lug
    tube("hh_ejector", D, coll, (0, cy - 0.004, 0.084), (0, cy - 0.004, 0.1), 0.0045, seg=10)
    # sights: a ramped front blade, a notched rear on the strap
    profile("hh_front_sight", D, coll, [(0.29, 0.049), (0.322, 0.049), (0.322, 0.064), (0.314, 0.064)], 0.004, bev=0.0005, grain=False)
    for s in (-1, 1):
        part(f"hh_rear_sight{s}", D, coll, (s * 0.0045, 0.0525, 0.0), (0.004, 0.007, 0.012), bev=0.0006)
    # the hammer, cocked back over the grip, and the cylinder latch on the left
    profile("hh_hammer", D, coll, [(-0.028, 0.03), (-0.019, 0.043), (-0.028, 0.051), (-0.047, 0.052), (-0.05, 0.046), (-0.036, 0.04), (-0.033, 0.026)], 0.007, bev=0.0015, grain=False)
    part("hh_latch", D, coll, (-0.0195, 0.022, -0.004), (0.004, 0.009, 0.018), bev=0.001)
    for k, (z, y) in enumerate(((-0.01, 0.0), (0.06, -0.008), (0.02, 0.034))):  # frame screws
        tag(kit.cylinder(f"hh_screw{k}", D, coll, (0.0175 if k != 2 else 0.011, y, z), (0.0195 if k != 2 else 0.013, y, z), 0.0028, segments=10, bev=0))

    # the grip: a steel frame, walnut panels either side, a lanyard ring
    grip = [(-0.03, -0.012), (0.012, -0.014), (0.009, -0.03), (0.003, -0.055), (-0.007, -0.085), (-0.017, -0.112), (-0.026, -0.13),
            (-0.04, -0.136), (-0.058, -0.134), (-0.068, -0.124), (-0.066, -0.1), (-0.058, -0.07), (-0.05, -0.042), (-0.045, -0.018), (-0.036, -0.004), (-0.028, 0.002)]
    profile("hh_grip_frame", D, coll, grip, 0.02, bev=0.005, grain=False)
    panel = [(-0.03, -0.02), (0.003, -0.021), (-0.001, -0.05), (-0.01, -0.08), (-0.02, -0.108), (-0.03, -0.124), (-0.042, -0.128),
             (-0.056, -0.126), (-0.061, -0.112), (-0.056, -0.082), (-0.049, -0.055), (-0.043, -0.032)]
    for s in (-1, 1):
        o = profile(f"hh_panel{s}", W, coll, panel, 0.007, x=s * 0.0125, bev=0.003)
        o["tile"] = 0.5
        tag(kit.cylinder(f"hh_panel_screw{s}", D, coll, (s * 0.0155, -0.07, -0.03), (s * 0.0168, -0.07, -0.03), 0.004, segments=12, bev=0))
    ring("hh_lanyard", D, coll, (0, -0.143, -0.048), 0.007, 0.0016, plane="zy", n=16)
    # trigger guard and trigger
    ring("hh_guard", D, coll, (0, -0.02, 0.03), 0.026, 0.0034, plane="zy", a0=math.pi, a1=2 * math.pi, n=18)
    part("hh_trigger", D, coll, (0, -0.033, 0.024), (0.006, 0.026, 0.007), rot=(-0.35, 0, 0), bev=0.0015)

    marker("muzzle", coll, (0, by, 0.333))
    marker("grip", coll, (0, -0.07, -0.035))
    marker("fore", coll, (0, -0.1, -0.03))  # a revolver: the off hand cups the grip
    return {"length": 0.42, "views": [((0.75, 0.02, 0.12), (0, -0.03, 0.12)), ((0.4, 0.18, -0.3), (0, -0.02, 0.12)), ((0.17, 0.08, 0.16), (0, 0.01, 0.04))]}


def build_boar(M, coll):
    """The Boar: a pump shotgun ("devastating up close, useless far away"),
    pre-fall and kept running: worn blued steel, a ribbed walnut pump on a
    tube magazine, a walnut stock with a steel butt plate. 5 shells. ~1.17 m."""
    D, W = M["steel"], M["wood"]
    by, my = 0.022, -0.011  # bore and magazine-tube axes

    # the receiver: one machined block with a sloped back, an ejection port, two pins
    profile("boar_receiver", D, coll, [(-0.095, 0.022), (-0.07, 0.038), (0.12, 0.038), (0.12, -0.024), (0.03, -0.032), (-0.095, -0.032)], 0.038, bev=0.005, grain=False)
    part("boar_port", D, coll, (0.0195, 0.018, 0.045), (0.002, 0.022, 0.07), bev=0.0006)
    part("boar_bolt_face", D, coll, (0.0205, 0.018, 0.03), (0.002, 0.016, 0.03), bev=0.0006)
    for k, z in enumerate((-0.03, 0.08)):
        tag(kit.cylinder(f"boar_pin{k}", D, coll, (0.019, -0.016, z), (0.0205, -0.016, z), 0.003, segments=10, bev=0))
    part("boar_safety", D, coll, (0, 0.04, -0.075), (0.008, 0.006, 0.012), bev=0.001)

    # the barrel and the magazine tube under it, joined by a clamp band near the muzzle
    tube("boar_barrel", D, coll, (0, by, 0.12), (0, by, 0.7), 0.0115, seg=24)
    tube("boar_muzzle", D, coll, (0, by, 0.69), (0, by, 0.705), 0.0125, seg=24, bev=0.001)
    tube("boar_bore", D, coll, (0, by, 0.704), (0, by, 0.7055), 0.0095, seg=16, bev=0)
    tag(kit.cylinder("boar_bead", D, coll, (0, by + 0.011, 0.695), (0, by + 0.0145, 0.695), 0.0022, segments=8, bev=0.001))
    tube("boar_magtube", D, coll, (0, my, 0.12), (0, my, 0.6), 0.0115, seg=20)
    tube("boar_magcap", D, coll, (0, my, 0.598), (0, my, 0.63), 0.0135, seg=12, bev=0.001)  # faceted: a knurled cap
    part("boar_band", D, coll, (0, (by + my) / 2, 0.585), (0.02, 0.05, 0.016), bev=0.004)
    ring("boar_front_swivel", D, coll, (0, my - 0.02, 0.615), 0.007, 0.0015, plane="zy", n=14)

    # the pump: a ribbed walnut forend on two action bars
    o = profile("boar_pump", W, coll, [(0.24, 0.012), (0.42, 0.012), (0.425, -0.006), (0.42, -0.036), (0.24, -0.036), (0.235, -0.006)], 0.046, bev=0.009)
    o["tile"] = 0.5
    for k in range(7):  # turned grooves round the pump
        part(f"boar_pump_rib{k}", W, coll, (0, -0.012, 0.268 + k * 0.022), (0.049, 0.05, 0.008), bev=0.003)["tile"] = 0.5
    for s_ in (-1, 1):
        part(f"boar_action_bar{s_}", D, coll, (s_ * 0.0125, -0.002, 0.18), (0.003, 0.006, 0.12), bev=0.0006)

    # trigger guard and trigger
    profile("boar_guard_plate", D, coll, [(-0.07, -0.03), (0.04, -0.03), (0.04, -0.038), (-0.07, -0.038)], 0.02, bev=0.002, grain=False)
    ring("boar_guard", D, coll, (0, -0.036, -0.02), 0.03, 0.0035, plane="zy", a0=math.pi, a1=2 * math.pi, n=18)
    part("boar_trigger", D, coll, (0, -0.05, -0.016), (0.006, 0.026, 0.007), rot=(-0.3, 0, 0), bev=0.0015)

    # the stock: walnut with a pistol grip and a dropped comb, narrow at the wrist,
    # a steel butt plate held by two screws
    def wrist(z, y):
        t = min(max((z + 0.36) / 0.24, 0.0), 1.0)
        return 0.72 + 0.28 * abs(2 * t - 1)
    o = profile("boar_stock", W, coll, [(-0.093, 0.03), (-0.14, 0.022), (-0.3, 0.012), (-0.462, 0.006), (-0.47, -0.14), (-0.36, -0.106),
                                       (-0.26, -0.08), (-0.21, -0.076), (-0.185, -0.1), (-0.172, -0.135), (-0.162, -0.152), (-0.132, -0.156), (-0.118, -0.138),
                                       (-0.104, -0.085), (-0.09, -0.036)], 0.044, bev=0.012, taper=wrist)
    o["tile"] = 0.5
    wn = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")  # flat sides stay flat: no shading crease across the n-gon
    wn.keep_sharp = True
    part("boar_buttplate", D, coll, (0, -0.066, -0.47), (0.042, 0.142, 0.007), rot=(0.03, 0, 0), bev=0.003)
    for k, y in enumerate((-0.02, -0.11)):
        tag(kit.cylinder(f"boar_butt_screw{k}", D, coll, (0, y, -0.4735), (0, y, -0.4755), 0.0035, segments=10, bev=0))
    ring("boar_rear_swivel", D, coll, (0, -0.13, -0.39), 0.007, 0.0015, plane="zy", n=14)

    marker("muzzle", coll, (0, by, 0.706))
    marker("grip", coll, (0, -0.11, -0.145))
    marker("fore", coll, (0, -0.03, 0.33))
    return {"length": 1.18, "views": [((1.85, 0.06, 0.12), (0, -0.03, 0.12)), ((0.9, 0.4, -0.7), (0, -0.03, 0.1)), ((0.32, 0.1, 0.22), (0, -0.005, 0.12))]}


GUNS = {"mule": build_mule, "sparrow": build_sparrow, "badger": build_badger, "hammerhead": build_hammerhead, "boar": build_boar}


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
