"""Builds Scrapfall's loot items in Blender, one item at a time.

Follows design/art/art-bible.md (Section 8.4: an item is a small prop, at
most 3k triangles and 1 material; worn, real-world size, never blocky).
Items are modelled in the game's frame (+Y up), centred on the origin and
resting on y = 0 (art bible 8.8: props bottom centre). They share the
Sanctuary's tiling textures (godot/textures/sanctuary/) so they add no
texture files of their own.

Run with the Blender Python module (bpy):
    python tools/blender/build_items.py <work dir> [--items bandage] [--render] [--export]
--export writes godot/models/items/prop_<item>_01.gltf (+ .bin).
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
import build_weapons as bw  # noqa: E402
import make_textures as mt  # noqa: E402

ROOT = kit.ROOT
IMODELS = os.path.join(ROOT, "godot", "models", "items")
ITEX = os.path.join(ROOT, "godot", "textures", "items")
# The item atlas: one texture for every item, cut into 4 x 4 squares, one
# surface each. An item maps each of its parts onto a square, so it keeps to
# 1 material (art bible 8.4) however many surfaces it has.
ATLAS = ("canvas_olive", "canvas_bone", "twine", "herb",
         "glass_amber", "cork", "steel_rust", "steel_bare",
         "brass", "leather", "paper", "rubber",
         "copper", "plastic", "husk", "shield_ice")
ITEM_TILE = 0.15  # metres per texture repeat on small items: a fine weave at hand size
R90 = math.pi / 2


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


def make_item_atlas():
    """Writes godot/textures/items/item_atlas_{albedo,normal,orm}.png: 16
    surfaces in a 4 x 4 grid of 256 px squares, each worn the Scrapfall way."""
    S = mt.SIZE
    c = S // 4
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    big, mid, fine_ = mt.fbm(401, 2.6), mt.fbm(402, 2.0), mt.fbm(403, 1.2)
    weave = 0.5 + 0.12 * np.sin(xx * 2 * math.pi / 2.5) + 0.12 * np.sin(yy * 2 * math.pi / 2.5) + 0.26 * (mid - 0.5)
    strands = 0.5 + 0.5 * np.sin((xx + yy * 0.35) * 2 * math.pi / 6)
    col, h, rough, metal = np.zeros((S, S, 3)), np.zeros((S, S)), np.zeros((S, S)), np.zeros((S, S))
    grime = mt.smooth(0.5, 0.85, big)
    looks = {  # base, worn-to colour, height source, roughness, metal
        "canvas_olive": ("#3f4230", "#5a5a42", weave, 0.9, 0.0),
        "canvas_bone": ("#ddd6c2", "#b9ad8e", weave, 0.88, 0.0),
        "twine": ("#9a7f55", "#6e5a3a", strands, 0.85, 0.0),
        "herb": ("#56603a", "#7d6b40", fine_, 0.8, 0.0),
        "glass_amber": ("#24110a", "#3a1e0e", mid * 0.2, 0.18, 0.0),
        "cork": ("#a98458", "#7a5c38", fine_, 0.9, 0.0),
        "steel_rust": ("#3f342c", "#2c241e", fine_ * 0.3 + mid * 0.1, 0.8, 0.4),  # rust kept under 35% saturation (art bible 6.2)
        "steel_bare": ("#7d7b76", "#4c4a46", mid * 0.12, 0.45, 0.9),
        "brass": ("#9c7c3c", "#5c4a28", mid * 0.3, 0.4, 1.0),
        "leather": ("#3b2c22", "#52402f", mid * 0.6, 0.65, 0.0),  # worn brown, under 35% saturation
        "paper": ("#d6cdb4", "#a89a76", fine_ * 0.4, 0.92, 0.0),
        "rubber": ("#262422", "#3a3632", fine_ * 0.5, 0.85, 0.0),
        "copper": ("#a5603a", "#4a6a58", mid * 0.3, 0.4, 1.0),
        "plastic": ("#8a8a7a", "#5e5c50", fine_ * 0.3, 0.55, 0.0),
        "husk": ("#3c434c", "#4d4640", mid * 0.15, 0.38, 0.75),  # Husk Slate (art bible 4), heat-tinted, never rust
        "shield_ice": ("#9fd8f0", "#7fa8b8", mid * 0.35, 0.3, 0.2),  # Shield Ice (art bible 4): pale, low saturation, never glowing
    }
    for i, name in enumerate(ATLAS):
        r0, c0 = (i // 4) * c, (i % 4) * c
        sl = (slice(r0, r0 + c), slice(c0, c0 + c))
        base, worn, hsrc, ro, me = looks[name]
        t = np.clip(0.55 * grime[sl] + 0.25 * mid[sl], 0, 1)
        col[sl] = mt.mix(mt.hexcol(base), mt.hexcol(worn), t) * (0.92 + 0.12 * fine_[sl])[..., None]
        h[sl] = hsrc[sl]
        rough[sl] = np.clip(ro + 0.12 * (grime[sl] - 0.5), 0, 1)
        metal[sl] = me * (1 - 0.6 * grime[sl]) if name not in ("steel_rust", "copper") else me * (0.6 + 0.4 * fine_[sl])
    mt.OUT = ITEX
    mt.save("item_atlas", col, h, rough, metal, 2.0, 0.8)


def atlas_material():
    """The one item material: the atlas as albedo, ORM and normal."""
    m = kit.pbr("mat_item_atlas_01", None)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    def img(kind, data):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(os.path.join(ITEX, f"item_atlas_{kind}.png"))
        if data:
            n.image.colorspace_settings.name = "Non-Color"
        n.interpolation = "Closest" if False else "Linear"
        return n
    alb = img("albedo", False)
    nt.links.new(alb.outputs["Color"], bsdf.inputs["Base Color"])
    orm = img("orm", True)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nrm = img("normal", True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def to_cell(o, cell):
    """After kit.finalize: squeeze the object's box-projected UVs into its
    atlas square (a little inset so filtering never bleeds next door)."""
    i = ATLAS.index(cell)
    me = o.data
    uv = me.uv_layers.active.data
    us = np.array([d.uv[0] for d in uv])
    vs = np.array([d.uv[1] for d in uv])
    span = max(us.max() - us.min(), vs.max() - vs.min(), 1e-6)
    pad = 0.012
    u0, v0 = (i % 4) / 4 + pad, 1 - (i // 4 + 1) / 4 + pad  # image row 0 is the top: v counts up from the bottom
    size = 0.25 - 2 * pad
    for d, u, v in zip(uv, us, vs):
        d.uv = (u0 + (u - us.min()) / span * size, v0 + (v - vs.min()) / span * size)


def item_materials():
    """One material per item (art bible 8.4), tinted from the shared set."""
    return {
        "cloth_bone": kit.pbr("mat_item_cloth_bone_01", "canvas", tint=(0.92, 0.88, 0.78)),  # old sheets, washed thin (the Bandage)
        "atlas": atlas_material(),
    }


def fine(o):
    """Items are small: a finer texture repeat than the guns."""
    o["tile"] = ITEM_TILE
    return o


def strip(name, mat, coll, pts, width, thick=0.0018, side=(1.0, 0.0, 0.0), ragged=0.0, seed=0):
    """A cloth strip laid along game-space points pts (each (x, y, z)),
    `width` across the `side` direction: a thin ribbon, softly bent. ragged
    jitters the two edges, as cloth torn rather than cut."""
    r = np.random.default_rng(seed)
    bm = bmesh.new()
    rows = []
    for p in pts:
        e = [width / 2 + r.uniform(-ragged, ragged) for _ in (0, 1)]
        rows.append([bm.verts.new(kit.g2b(*(p[i] + sgn * e[j] * side[i] for i in range(3)))) for j, sgn in enumerate((-1, 1))])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = kit.mesh_obj(name, bm, mat, coll, (0, 0, 0), (0, 0, 0))
    m = o.modifiers.new("Solidify", "SOLIDIFY")
    m.thickness = thick
    o["uv"] = "box"
    return fine(o)


def wire(name, mat, coll, pts, r):
    """A fine line laid through game-space points: a low-resolution swept tube."""
    cu = bpy.data.curves.new(f"{name}_curve", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 0
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p_, v in zip(sp.points, pts):
        p_.co = (*kit.g2b(*v), 1.0)
    tmp = bpy.data.objects.new(f"{name}_tmp", cu)
    coll.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
    coll.objects.unlink(tmp)
    bpy.data.objects.remove(tmp)
    me.materials.clear()
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    o["uv"] = "box"
    return fine(o)


# ---------- the items ----------

def build_bandage(M, coll):
    """The Bandage: old sheets torn into strips by Nia, folded back and forth
    into a flat bundle and tied round the middle with one more strip
    ("restores 25 health"). Torn, not cut: the edges are ragged and a few
    threads hang loose. ~12 x 6 x 4 cm."""
    C = M["cloth_bone"]
    rr_ = np.random.default_rng(11)
    L, sp = 0.12, 0.0034  # folded length, layer spacing
    tie_w = 0.014
    layer = 0
    for k, (w, dx, folds) in enumerate(((0.058, 0.0, 4), (0.052, 0.004, 3), (0.055, -0.003, 4))):
        pts = []
        z_end = L / 2 - k * 0.004
        for f in range(folds):
            y = 0.002 + layer * sp
            zs = np.linspace(-z_end, z_end, 9) if f % 2 == 0 else np.linspace(z_end, -z_end, 9)
            for z in zs:
                pinch = 0.55 + 0.45 * min(1.0, abs(z) / (L * 0.32))  # pulled in where the tie goes round
                pts.append((dx, 0.002 + layer * sp * pinch, z))
            if f < folds - 1:  # the fold: round the end and back, one layer up
                zc = zs[-1]
                for a in np.linspace(0, math.pi, 6)[1:-1]:
                    pts.append((dx, y + sp / 2 - (sp / 2) * math.cos(a), zc + math.copysign(sp / 2 * math.sin(a), zc)))
            layer += 1
        strip(f"bandage_strip{k}", C, coll, pts, w, thick=0.0013, ragged=0.0012, seed=20 + k)
        # the last layer's end lies loose a little past the fold, torn ragged with a couple of threads
        ex, ey, ez = pts[-1]
        for j in range(2):
            tx = dx + rr_.uniform(-w / 2.5, w / 2.5)
            sgn = math.copysign(1, ez)
            wire(f"bandage_strip{k}_thread{j}", C, coll, [(tx, ey, ez), (tx + rr_.uniform(-0.002, 0.002), ey + 0.0006, ez + sgn * rr_.uniform(0.004, 0.009))], 0.00035)
    top = 0.002 + layer * sp * 0.55 + 0.0016  # the bundle's top under the tie
    hw = 0.032  # half the bundle's width under the tie
    # the tie: one more strip, pulled tight round the middle, knotted on top
    ring_pts = []
    for a in np.linspace(0, 2 * math.pi, 29):
        cx, cyy = hw * math.cos(a), (top / 2) + (top / 2 + 0.0015) * math.sin(a)
        ring_pts.append((max(-hw, min(hw, cx * 1.25)), max(0.0, min(top + 0.0012, cyy)), 0.0))
    strip("bandage_tie", C, coll, ring_pts, tie_w, thick=0.0013, side=(0.0, 0.0, 1.0), ragged=0.0008, seed=31)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.0075)
    knot = kit.mesh_obj("bandage_knot", bm, C, coll, kit.g2b(0.004, top + 0.004, 0), (0.3, 0.5, 0.2))
    knot.scale = (1.3, 0.75, 1.0)
    knot["uv"] = "box"
    fine(knot)
    for j, (sx, sz) in enumerate(((-1, -1), (1, 1))):  # the two ends of the knot, lying out across the top
        strip(f"bandage_tie_end{j}", C, coll, [(0.004 + sx * 0.004, top + 0.004, sz * 0.003), (0.004 + sx * 0.012, top + 0.0025, sz * 0.012), (0.004 + sx * 0.02, top + 0.0012, sz * 0.026)],
              0.011, thick=0.0012, side=(-sz * 0.6, 0.0, sx * 0.8), ragged=0.0007, seed=40 + j)
    return {"views": [((0.15, 0.1, 0.14), (0, 0.015, 0.0)), ((-0.14, 0.06, -0.1), (0, 0.015, 0.0)), ((0.03, 0.2, 0.05), (0, 0.01, 0.0))]}


def cell(o, name):
    o["cell"] = name
    return o


def build_med_kit(M, coll):
    """The Herbal Med Kit: Nia's stitched canvas pouch ("restores 60
    health"), rolled closed with its flap over and tied with twine; her
    bone-white stitched patch on the flap (no red cross, art bible 5.2),
    dried herbs poking out of one end, a small corked bottle tucked under
    the twine. ~18 x 8 x 7 cm."""
    A = M["atlas"]
    rr_ = np.random.default_rng(5)
    L, W, Hh = 0.17, 0.075, 0.062  # along x, across z, height
    cy = Hh / 2
    body = kit.box("medkit_body", A, coll, (0, cy, 0), (L, Hh, W), bev=0)
    kit.bevel(body, 0.024, 5)  # a stuffed pouch, well rounded
    for poly in body.data.polygons:
        poly.use_smooth = True
    cell(body, "canvas_olive")
    # the flap: draped from the back, over the top and down the front, softly bent
    flap = [(0.004, Hh * 0.55, -W / 2 - 0.002), (0.004, Hh * 0.85, -W / 2 + 0.002), (0.004, Hh + 0.0025, -W / 4),
            (0.004, Hh + 0.003, W / 6), (0.004, Hh - 0.004, W / 2 - 0.004), (0.004, Hh - 0.02, W / 2 + 0.002), (0.004, Hh - 0.034, W / 2 + 0.003)]
    pts = []
    for a_, b_ in zip(flap, flap[1:]):
        for t in np.linspace(0, 1, 3)[:-1]:
            pts.append(tuple(a_[i] + (b_[i] - a_[i]) * t for i in range(3)))
    pts.append(flap[-1])
    cell(strip("medkit_flap", A, coll, pts, L - 0.014, thick=0.0025, ragged=0.0006, seed=51), "canvas_olive")
    # Nia's patch on the flap, stitched on by hand
    px, pz = -0.028, W / 2 + 0.0045
    cell(kit.box("medkit_patch", A, coll, (px, Hh - 0.017, pz), (0.042, 0.026, 0.002), rot=(-0.06, 0, 0), bev=0.0006), "canvas_bone")
    for k in range(14):  # running stitches round the patch edge
        t = k / 14
        per = 2 * (0.042 + 0.026)
        d = t * per
        if d < 0.042:
            x, y = px - 0.021 + d, Hh - 0.017 + 0.013
        elif d < 0.068:
            x, y = px + 0.021, Hh - 0.017 + 0.013 - (d - 0.042)
        elif d < 0.11:
            x, y = px + 0.021 - (d - 0.068), Hh - 0.017 - 0.013
        else:
            x, y = px - 0.021, Hh - 0.017 - 0.013 + (d - 0.11)
        cell(kit.box(f"medkit_stitch{k}", A, coll, (x, y, pz + 0.0013 + (Hh - 0.017 - y) * 0.06), (0.0026, 0.0026, 0.0012), bev=0), "twine")
    # two turns of twine round the roll, knotted at the front
    for k, x in enumerate((-0.05, 0.05)):
        ring = []
        for a in np.linspace(0, 2 * math.pi, 25):
            ring.append((x, cy + (Hh / 2 + 0.0068) * math.sin(a), (W / 2 + 0.0078) * math.cos(a)))  # over the flap, pulled snug
        cell(wire(f"medkit_twine{k}", A, coll, ring, 0.0016), "twine")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.0035)
        cell(fine(kit.mesh_obj(f"medkit_twine{k}_knot", bm, A, coll, kit.g2b(x, cy + 0.006, W / 2 + 0.0105))), "twine")
        for j in range(2):
            cell(wire(f"medkit_twine{k}_end{j}", A, coll, [(x, cy + 0.006, W / 2 + 0.0115), (x + (j - 0.5) * 0.008, cy - 0.006, W / 2 + 0.0135), (x + (j - 0.5) * 0.012, cy - 0.016, W / 2 + 0.0125)], 0.0012), "twine")
    # dried herbs poking out of the open end: stalks with little bunched leaves
    for k in range(7):
        y0, z0 = cy + rr_.uniform(-0.012, 0.016), rr_.uniform(-0.022, 0.022)
        ln = rr_.uniform(0.025, 0.05)
        tip = (L / 2 + ln, y0 + rr_.uniform(-0.004, 0.012), z0 + rr_.uniform(-0.01, 0.01))
        cell(wire(f"medkit_stalk{k}", A, coll, [(L / 2 - 0.02, y0, z0), (L / 2 + ln * 0.5, (y0 + tip[1]) / 2 + 0.002, (z0 + tip[2]) / 2), tip], 0.0011), "herb")
        for j in range(3):
            t = 0.45 + j * 0.25
            lp = (L / 2 + ln * t, y0 + (tip[1] - y0) * t + 0.002, z0 + (tip[2] - z0) * t)
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.005)
            leaf = kit.mesh_obj(f"medkit_leaf{k}_{j}", bm, A, coll, kit.g2b(*lp), tuple(rr_.uniform(-1.2, 1.2, 3)))
            leaf.scale = (1.0, 0.25, 0.45)  # a dried, curled leaf
            cell(fine(leaf), "herb")
    # a small brown bottle tucked under the twine at the back, its cork stopper
    bx, bz = 0.0, -W / 2 - 0.012
    bz = -W / 2 - 0.006
    cell(kit.cylinder("medkit_bottle", A, coll, (bx - 0.064, cy - 0.01, bz), (bx - 0.03, cy - 0.01, bz), 0.0075, segments=12, bev=0.002), "glass_amber")
    cell(kit.cylinder("medkit_bottle_neck", A, coll, (bx - 0.03, cy - 0.01, bz), (bx - 0.023, cy - 0.01, bz), 0.0038, segments=8, bev=0.0008), "glass_amber")
    cell(kit.cylinder("medkit_cork", A, coll, (bx - 0.023, cy - 0.01, bz), (bx - 0.016, cy - 0.01, bz), 0.0042, segments=8, bev=0.001), "cork")
    for o in coll.objects:
        fine(o)
    return {"views": [((0.24, 0.15, 0.22), (0, 0.03, 0.0)), ((-0.22, 0.1, -0.18), (0.01, 0.03, 0.0)), ((0.3, 0.13, 0.1), (0.07, 0.035, 0.0))]}


def hex_prism(name, mat, coll, x0, x1, cy, r, rot=0.0, bev=0.002):
    """A hexagonal prism lying along x (a flat side down), from x0 to x1."""
    o = kit.cylinder(name, mat, coll, (x0, cy, 0), (x1, cy, 0), r, segments=6, bev=bev)
    o.rotation_euler.rotate_axis("Z", rot)  # about its own long axis
    return fine(o)


def build_shield_cell(M, coll):
    """The Shield Cell: a hexagonal canister that recharges a shield ("restores
    45 shield charge"). The Shield Ice core shows between the bars of a
    scuffed steel frame; hex end caps with brass contacts; a rubber grip
    band and a peeling paper label. Hexagons are for shields only (art
    bible 3). Doesn't glow. ~13 cm long."""
    A = M["atlas"]
    L, r = 0.11, 0.032  # body length, hex radius (corner)
    cy = r * math.cos(math.pi / 6)  # resting on a flat side
    turn = math.pi / 6  # turned so a flat side is down
    # the core: Shield Ice, a hex prism just inside the frame
    cell(hex_prism("cell_core", A, coll, -L / 2, L / 2, cy, r * 0.9, turn, bev=0.003), "shield_ice")
    # the frame: a steel bar down each corner of the hexagon
    for k in range(6):
        a = k * math.pi / 3  # the corners: one each side, flat sides top and bottom
        y, z = cy + r * 0.97 * math.sin(a), r * 0.97 * math.cos(a)
        cell(fine(kit.box(f"cell_bar{k}", A, coll, (0, y, z), (L, 0.0065, 0.0065), rot=(-a, 0, 0), bev=0.0012)), "steel_bare" if k % 3 else "steel_rust")
    # the end caps: thick hex plates, bevelled, with a brass contact and four screws
    for s_ in (-1, 1):
        x = s_ * (L / 2 + 0.006)
        cell(hex_prism(f"cell_cap{s_}", A, coll, x - 0.008, x + 0.008, cy, r * 1.06, turn, bev=0.003), "steel_bare")
        cell(fine(kit.cylinder(f"cell_contact{s_}", A, coll, (x + s_ * 0.008, cy, 0), (x + s_ * 0.012, cy, 0), 0.009, segments=16, bev=0.0012)), "brass")
        for j in range(4):
            a = j * math.pi / 2 + math.pi / 4
            cell(fine(kit.cylinder(f"cell_screw{s_}_{j}", A, coll, (x + s_ * 0.008, cy + 0.019 * math.sin(a), 0.019 * math.cos(a)),
                                    (x + s_ * 0.0092, cy + 0.019 * math.sin(a), 0.019 * math.cos(a)), 0.0022, segments=6, bev=0)), "steel_rust")
    # a rubber grip band round the middle, and the label, half peeled
    cell(hex_prism("cell_grip", A, coll, -0.012, 0.012, cy, r * 1.03, turn, bev=0.002), "rubber")
    label = strip("cell_label", A, coll, [(0.03, cy + r * 0.88, -0.014), (0.03, cy + r * 0.882, 0.004), (0.03, cy + r * 0.885 + 0.0015, 0.011), (0.03, cy + r * 0.885 + 0.004, 0.015)],
                  0.03, thick=0.0005, ragged=0.0006, seed=61)
    cell(label, "paper")
    return {"views": [((0.2, 0.13, 0.18), (0, 0.028, 0.0)), ((-0.18, 0.08, -0.15), (0, 0.028, 0.0)), ((0.23, 0.05, 0.0), (0, 0.028, 0.0))]}


def build_shield(M, coll, tier):
    """A shield pack: the bevelled steel case a Diver clips to the back of
    their pack (art bible 5: scratched and stickered, doesn't glow), stood
    upright. Its tier reads from the size and build of the case and from the
    row of hexagonal charge windows on the front (3, 5 or 7 Shield Ice cells:
    hexagons are for shields only). Webbing straps and buckles on the back."""
    A = M["atlas"]
    W, H, D, cells, case = {
        "light": (0.2, 0.26, 0.05, 3, "steel_bare"),
        "medium": (0.22, 0.29, 0.07, 5, "steel_bare"),
        "heavy": (0.25, 0.31, 0.095, 7, "steel_rust"),
    }[tier]
    p = f"shield_{tier}"
    body = kit.box(f"{p}_case", A, coll, (0, H / 2, 0), (W, H, D), bev=0)
    kit.bevel(body, min(D * 0.3, 0.02), 4)
    cell(fine(body), case)
    # a raised face plate, a little smaller, its own bevel; a seam all round
    face = kit.box(f"{p}_face", A, coll, (0, H / 2 + 0.005, D / 2 + 0.003), (W - 0.03, H - 0.04, 0.008), bev=0)
    kit.bevel(face, 0.004, 2)
    cell(fine(face), "steel_bare")
    # the charge windows: a row of hex cells of Shield Ice across the face, in a dark bezel
    rh = 0.012
    span = (cells - 1) * rh * 1.9
    cell(fine(kit.box(f"{p}_bezel", A, coll, (0, H * 0.72, D / 2 + 0.0075), (span + 0.034, 0.034, 0.003), bev=0.0015)), "rubber")
    for k in range(cells):
        x = -span / 2 + k * rh * 1.9
        o = kit.cylinder(f"{p}_cell{k}", A, coll, (x, H * 0.72, D / 2 + 0.008), (x, H * 0.72, D / 2 + 0.011), rh, segments=6, bev=0.0008)
        cell(fine(o), "shield_ice")
    # screws at the face plate's corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W / 2 - 0.028), H / 2 + 0.005 + sy * (H / 2 - 0.034)
            cell(fine(kit.cylinder(f"{p}_screw{sx}{sy}", A, coll, (x, y, D / 2 + 0.007), (x, y, D / 2 + 0.0095), 0.004, segments=6, bev=0)), "steel_rust")
    # stickers: a worn paper one slapped on, a second half torn away
    cell(fine(kit.box(f"{p}_sticker0", A, coll, (-W * 0.18, H * 0.35, D / 2 + 0.0078), (0.05, 0.035, 0.0006), rot=(0, 0, 0.12), bev=0)), "paper")
    cell(fine(kit.box(f"{p}_sticker1", A, coll, (W * 0.22, H * 0.3, D / 2 + 0.0078), (0.03, 0.022, 0.0006), rot=(0, 0, -0.3), bev=0)), "paper")
    # the back: two webbing straps with steel buckles, to clip it on the pack
    for sx in (-1, 1):
        x = sx * W * 0.28
        loop = [(x, H - 0.02, -D / 2 + 0.002), (x, H - 0.008, -D / 2 - 0.012), (x, H * 0.55, -D / 2 - 0.016), (x, 0.03, -D / 2 - 0.012), (x, 0.012, -D / 2 + 0.002)]
        cell(strip(f"{p}_strap{sx}", A, coll, loop, 0.03, thick=0.002, ragged=0.0004, seed=70 + sx), "canvas_olive")
        cell(fine(kit.box(f"{p}_buckle{sx}", A, coll, (x, H * 0.5, -D / 2 - 0.019), (0.036, 0.024, 0.004), bev=0.0015)), "steel_bare")
    if tier != "light":  # vents down the sides
        for sx in (-1, 1):
            for k in range(4 if tier == "medium" else 5):
                y = H * 0.25 + k * 0.03
                cell(fine(kit.box(f"{p}_vent{sx}_{k}", A, coll, (sx * (W / 2 + 0.0008), y, 0), (0.002, 0.008, D * 0.55), bev=0)), "rubber")
    if tier == "heavy":  # armour plates bolted on the shoulders, and a carry handle on top
        for sx in (-1, 1):
            plate = kit.box(f"{p}_armour{sx}", A, coll, (sx * W * 0.33, H * 0.9, D / 2 + 0.006), (W * 0.3, 0.05, 0.01), rot=(0.0, 0, sx * 0.08), bev=0)
            kit.bevel(plate, 0.004, 1)
            cell(fine(plate), "steel_rust")
            for j in (-1, 1):
                x = sx * W * 0.33 + j * W * 0.1
                cell(fine(kit.cylinder(f"{p}_armour{sx}_bolt{j}", A, coll, (x, H * 0.9, D / 2 + 0.011), (x, H * 0.9, D / 2 + 0.0145), 0.0045, segments=6, bev=0)), "steel_bare")
    # the handle (author: it hangs from the side of the Diver's backpack by this and swings
    # with movement): a steel bail pivoting in two lugs on top, a rubber grip sleeve on it
    hw, hh, hr = {"light": (0.04, 0.034, 0.0035), "medium": (0.05, 0.04, 0.0045), "heavy": (0.06, 0.045, 0.0055)}[tier]
    for sx in (-1, 1):
        lug = kit.box(f"{p}_lug{sx}", A, coll, (sx * hw, H + 0.006, 0), (0.008, 0.016, 0.014), bev=0)
        kit.bevel(lug, 0.003, 1)
        cell(fine(lug), "steel_rust")
        cell(fine(kit.cylinder(f"{p}_pin{sx}", A, coll, (sx * hw - 0.007, H + 0.009, 0), (sx * hw + 0.007, H + 0.009, 0), 0.0028, segments=8, bev=0.0006)), "steel_bare")
    bail = [(-hw - 0.005, H + 0.009, 0)]
    for a in np.linspace(math.pi, 0, 11):
        bail.append((hw * 1.02 * math.cos(a), H + 0.009 + hh * math.sin(a) ** 0.6, 0))
    bail.append((hw + 0.005, H + 0.009, 0))
    cell(wire(f"{p}_handle", A, coll, bail, hr), "steel_bare")
    top = H + 0.009 + hh
    cell(fine(kit.cylinder(f"{p}_grip", A, coll, (-hw * 0.45, top, 0), (hw * 0.45, top, 0), hr + 0.004, segments=10, bev=0.0015)), "rubber")
    bw.marker("hang", coll, (0, top, 0))  # where the game hangs it from the pack
    return {"views": [((0.5, 0.4, 0.6), (0, H * 0.62, 0)), ((-0.52, 0.32, -0.42), (0, H * 0.62, 0)), ((0.16, H + 0.12, 0.22), (0, H, 0))]}


def build_frag(M, coll):
    """The Frag Grenade, homemade (author: not a real grenade, a homemade
    one): a food tin wrapped in cloth tape with rusty nuts and washers
    packed round it under the tape; on top a scrap-metal striker with a
    lever cut from a strip of tin, held down by the tape, and a brass pull
    ring on a bent nail. Stood on its base. ~11 cm tall."""
    A = M["atlas"]
    rr_ = np.random.default_rng(13)
    r, h = 0.032, 0.088  # tin radius, height
    tin = kit.cylinder("frag_tin", A, coll, (0, 0, 0), (0, h, 0), r, segments=24, bev=0.002)
    for poly in tin.data.polygons:
        poly.use_smooth = True
    cell(fine(tin), "steel_bare")
    for k, y in enumerate((0.012, h - 0.012)):  # the tin's rolled rims
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r + 0.0012, radius2=r + 0.0012, depth=0.003)
        o = kit.mesh_obj(f"frag_rim{k}", bm, A, coll, kit.g2b(0, y, 0), (0, 0, 0))
        o["uv"] = "box"
        cell(fine(o), "steel_bare")
    # rusty nuts and washers packed round the middle, held on by the tape
    for k in range(18):
        a = k / 18 * 2 * math.pi + rr_.uniform(-0.08, 0.08)
        y = 0.03 + (k % 3) * 0.014 + rr_.uniform(-0.002, 0.002)
        cx, cz = (r + 0.002) * math.cos(a), (r + 0.002) * math.sin(a)
        ox, oz = math.cos(a) * 0.004, math.sin(a) * 0.004
        if k % 4 == 3:  # a washer
            cell(fine(kit.cylinder(f"frag_washer{k}", A, coll, (cx, y, cz), (cx + ox * 0.4, y, cz + oz * 0.4), 0.0055, segments=10, bev=0)), "steel_rust")
        else:  # a hex nut
            cell(fine(kit.cylinder(f"frag_nut{k}", A, coll, (cx, y, cz), (cx + ox, y, cz + oz), 0.0048, segments=6, bev=0.0005)), "steel_rust")
    # cloth tape wound round over them, three bands, the ends left loose
    for k, (y, w) in enumerate(((0.024, 0.014), (0.045, 0.02), (0.068, 0.014))):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r + 0.006, radius2=r + 0.006, depth=w)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.0015)
        o = kit.mesh_obj(f"frag_tape{k}", bm, A, coll, kit.g2b(0, y, 0), (rr_.uniform(-0.04, 0.04), rr_.uniform(-0.04, 0.04), 0))
        o["uv"] = "box"
        cell(fine(o), "canvas_bone")
    cell(strip("frag_tape_end", A, coll, [(r + 0.006, 0.045, 0.0), (r + 0.01, 0.042, 0.012), (r + 0.012, 0.036, 0.02)], 0.018, thick=0.0012,
               side=(0.0, 1.0, 0.0), ragged=0.0008, seed=81), "canvas_bone")
    # on the lid: a striker housing knocked up from a pipe end, its lever a bent strip of tin taped down the side
    cell(fine(kit.cylinder("frag_striker", A, coll, (0.004, h, 0), (0.004, h + 0.02, 0), 0.0085, segments=12, bev=0.0015)), "steel_rust")
    cell(fine(kit.cylinder("frag_striker_cap", A, coll, (0.004, h + 0.02, 0), (0.004, h + 0.024, 0), 0.0065, segments=10, bev=0.001)), "steel_bare")
    lever = [(0.004, h + 0.026, -0.006), (0.004, h + 0.026, 0.006), (0.004, h + 0.02, 0.016), (0.004, h + 0.004, r + 0.004), (0.004, h - 0.018, r + 0.007), (0.004, 0.05, r + 0.0075)]
    pts = []
    for a_, b_ in zip(lever, lever[1:]):
        for t in np.linspace(0, 1, 3)[:-1]:
            pts.append(tuple(a_[i] + (b_[i] - a_[i]) * t for i in range(3)))
    pts.append(lever[-1])
    cell(strip("frag_lever", A, coll, pts, 0.01, thick=0.0012, ragged=0.0004, seed=82), "steel_bare")
    # the pin: a bent nail through the striker, a brass ring on it
    cell(fine(kit.cylinder("frag_nail", A, coll, (-0.012, h + 0.013, 0), (0.02, h + 0.013, 0), 0.0011, segments=6, bev=0)), "steel_bare")
    cell(fine(kit.cylinder("frag_nail_head", A, coll, (-0.013, h + 0.013, 0), (-0.012, h + 0.013, 0), 0.0024, segments=8, bev=0)), "steel_bare")
    ring = [(0.02 + 0.01 * (1 - math.cos(a)), h + 0.013 - 0.01 * math.sin(a) * 0.5, 0.01 * math.sin(a) * 0.85) for a in np.linspace(0, 2 * math.pi, 19)]
    cell(wire("frag_ring", A, coll, ring, 0.0013), "brass")
    return {"views": [((0.26, 0.17, 0.26), (0, 0.055, 0)), ((-0.24, 0.11, -0.19), (0, 0.055, 0)), ((0.16, 0.22, 0.12), (0, 0.075, 0))]}


def cartridge(name, A, coll, base, d, case_len, r, bullet_len, tip="copper", case="brass", seg=10):
    """A round from its base along unit direction d: a case (with a rim), then
    the bullet narrowing to a rounded point. Shotgun shells pass bullet_len 0
    and case="plastic" for a hull on a brass head."""
    from mathutils import Vector
    def at(t):
        return tuple(base[i] + d[i] * t for i in range(3))
    cell(fine(kit.cylinder(f"{name}_rim", A, coll, at(0), at(0.0012), r * 1.08, segments=seg, bev=0)), "brass")
    if bullet_len == 0:  # a shotgun shell: a brass head, then the hull
        cell(fine(kit.cylinder(f"{name}_head", A, coll, at(0.0012), at(case_len * 0.22), r, segments=seg, bev=0)), "brass")
        cell(fine(kit.cylinder(f"{name}_hull", A, coll, at(case_len * 0.22), at(case_len), r * 0.97, segments=seg, bev=0.0008)), case)
        cell(fine(kit.cylinder(f"{name}_crimp", A, coll, at(case_len - 0.0008), at(case_len + 0.0004), r * 0.72, segments=6, bev=0)), "rubber")  # the folded crimp
        return
    cell(fine(kit.cylinder(f"{name}_case", A, coll, at(0.0012), at(case_len), r, segments=seg, bev=0.0004)), case)
    bm = bmesh.new()  # the bullet: a lathed ogive, round-nosed
    rings = []
    for k in range(7):
        t = k / 6
        rad = r * 0.88 * max(0.12, (1 - t ** 1.7) ** 0.55)
        rings.append([bm.verts.new((rad * math.cos(a), rad * math.sin(a), -bullet_len / 2 + t * bullet_len)) for a in np.linspace(0, 2 * math.pi, seg, endpoint=False)])
    for a_, b_ in zip(rings, rings[1:]):
        for j in range(seg):
            bm.faces.new((a_[j], a_[(j + 1) % seg], b_[(j + 1) % seg], b_[j]))
    bm.faces.new(rings[-1])
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    rot = Vector(kit.g2b(*d)).to_track_quat("Z", "Y").to_euler()
    o = kit.mesh_obj(f"{name}_bullet", bm, A, coll, kit.g2b(*at(case_len + bullet_len / 2)), rot)
    o["uv"] = "box"
    cell(fine(o), tip)


def build_ammo_light(M, coll):
    """Light Ammo (Mule, Sparrow): a battered paper box, its flap torn open
    and bent back, short rounds standing in rows. ~7 x 5 cm."""
    A = M["atlas"]
    W, D, Hh, t = 0.072, 0.05, 0.03, 0.0015
    cell(fine(kit.box("ammol_floor", A, coll, (0, t / 2, 0), (W, t, D), bev=0)), "cork")  # brown cardboard
    for sx in (-1, 1):
        cell(fine(kit.box(f"ammol_side{sx}", A, coll, (sx * (W / 2 - t / 2), Hh / 2, 0), (t, Hh, D), rot=(0, 0, 0), bev=0.0004)), "cork")
        cell(fine(kit.box(f"ammol_end{sx}", A, coll, (0, Hh / 2, sx * (D / 2 - t / 2)), (W, Hh, t), rot=(0, 0, 0), bev=0.0004)), "cork")
    flap = [(0, Hh, -D / 2), (0, Hh + 0.012, -D / 2 - 0.006), (0, Hh + 0.02, -D / 2 - 0.018), (0, Hh + 0.022, -D / 2 - 0.035)]
    cell(strip("ammol_flap", A, coll, flap, W - 0.002, thick=0.0012, ragged=0.0005, seed=91), "cork")
    cell(fine(kit.box("ammol_label", A, coll, (0, Hh * 0.55, D / 2 + 0.0002), (0.04, 0.014, 0.0005), bev=0)), "paper")  # a scrap of the old label
    for i in range(5):
        for j in range(3):
            if (i, j) in ((4, 2), (3, 2), (4, 1), (4, 0)):
                continue  # a couple already used
            x, z = -W / 2 + 0.011 + i * 0.0125, -D / 2 + 0.012 + j * 0.013
            cartridge(f"ammol_round{i}{j}", A, coll, (x, t, z), (0, 1, 0), 0.019, 0.0045, 0.013, seg=7)
    cartridge("ammol_loose", A, coll, (0.05, 0.0045, 0.02), (0.6, 0, 0.8), 0.019, 0.0045, 0.013, seg=8)
    return {"views": [((0.16, 0.13, 0.17), (0, 0.02, 0.0)), ((-0.14, 0.1, -0.1), (0, 0.02, 0.0)), ((0.04, 0.16, 0.06), (0, 0.02, 0.0))]}


def build_ammo_medium(M, coll):
    """Medium Ammo (Badger): rifle rounds lying side by side in an old tin,
    its lid peeled back and curled. ~11 x 6 cm."""
    A = M["atlas"]
    W, D, Hh = 0.11, 0.062, 0.022
    t = 0.0012
    cell(fine(kit.box("ammom_floor", A, coll, (0, t / 2, 0), (W, t, D), bev=0)), "steel_bare")
    for sx in (-1, 1):  # an open tin: thin walls, rolled rims
        cell(fine(kit.box(f"ammom_side{sx}", A, coll, (sx * (W / 2 - t / 2), Hh / 2, 0), (t, Hh, D), bev=0.0005)), "steel_rust")
        cell(fine(kit.box(f"ammom_end{sx}", A, coll, (0, Hh / 2, sx * (D / 2 - t / 2)), (W, Hh, t), bev=0.0005)), "steel_rust")
        cell(fine(kit.cylinder(f"ammom_rim{sx}", A, coll, (-W / 2, Hh, sx * (D / 2 - t / 2)), (W / 2, Hh, sx * (D / 2 - t / 2)), 0.0015, segments=6, bev=0)), "steel_rust")
    lid = []
    for k, a in enumerate(np.linspace(0, 1.6 * math.pi, 14)):  # the lid rolled back on itself at one end
        rr = 0.008 - 0.0025 * k / 13
        lid.append((W / 2 + 0.002 + rr * math.sin(a), Hh + rr * (1 - math.cos(a)), 0))
    lid = [(W / 2 - 0.004, Hh + 0.0008, 0)] + lid  # peeled back from the far end and rolled
    cell(strip("ammom_lid", A, coll, lid, D - 0.004, thick=0.0008, side=(0, 0, 1)), "steel_bare")
    for k in range(7):
        z = -D / 2 + 0.008 + k * 0.0078
        cartridge(f"ammom_round{k}", A, coll, (-W / 2 + 0.006 + (k % 2) * 0.004, 0.0055, z), (1, 0, 0), 0.044, 0.0042, 0.02)  # lying in the tin
    return {"views": [((0.18, 0.15, 0.2), (0, 0.02, 0.0)), ((-0.16, 0.1, -0.14), (0, 0.02, 0.0)), ((0.02, 0.17, 0.08), (0, 0.02, 0.0))]}


def build_ammo_heavy(M, coll):
    """Heavy Ammo (Hammerhead, Heron): five big rounds held upright in a
    strip of leather loops stitched to a backing, the strip curved a little
    so it stands. ~12 cm long."""
    A = M["atlas"]
    n, step, r = 5, 0.022, 0.0068
    pts = [(-n * step / 2 + k * step * 0.5, 0.004, 0.004 * math.sin(k * 0.6)) for k in range(2 * n + 1)]
    cell(strip("ammoh_backing", A, coll, [(p[0], 0.016, p[2] - 0.008) for p in pts], 0.03, thick=0.003, side=(0, 1, 0), ragged=0.0004, seed=93), "leather")
    for k in range(n):
        x = -n * step / 2 + step * (k + 0.5)
        loop = [(x - r - 0.002, 0.016, -0.008), (x - r - 0.002, 0.016, -0.0005), (x, 0.016, r + 0.002), (x + r + 0.002, 0.016, -0.0005), (x + r + 0.002, 0.016, -0.008)]
        cell(strip(f"ammoh_loop{k}", A, coll, loop, 0.016, thick=0.0025, side=(0, 1, 0), seed=94 + k), "leather")
        cartridge(f"ammoh_round{k}", A, coll, (x, 0.0, -0.001), (0, 1, 0), 0.042, r, 0.026, seg=12)
    return {"views": [((0.17, 0.12, 0.2), (0, 0.035, 0.0)), ((-0.15, 0.09, -0.15), (0, 0.035, 0.0)), ((0.05, 0.1, 0.09), (0, 0.05, 0.0))]}


def build_ammo_shotgun(M, coll):
    """Shotgun Shells (Boar): five shells, faded hulls on brass heads,
    stacked three and two and bundled with a perished rubber band pulled
    tight round them; a sixth lies loose beside. ~7 cm long."""
    A = M["atlas"]
    r, L = 0.0105, 0.066
    lift = 0.0036  # the bundle rests on the band where it runs underneath
    centres = [(lift + r, -2 * r), (lift + r, 0.0), (lift + r, 2 * r), (lift + r + r * math.sqrt(3), -r), (lift + r + r * math.sqrt(3), r)]  # (y, z): three below, two in the grooves
    for k, (y, z) in enumerate(centres):
        cartridge(f"ammos_shell{k}", A, coll, (-L / 2 + (0.003 if k % 2 else 0), y, z), (1, 0, 0), L, r, 0, case="canvas_olive", seg=12)  # waxed paper hulls, faded
    cartridge("ammos_loose", A, coll, (-0.02, r, 0.05), (0.94, 0, -0.34), L, r, 0, case="canvas_olive", seg=12)
    # the band: traced round the outline of the bundle, hugging each shell and running straight between them
    band = []
    for a in np.linspace(0, 2 * math.pi, 49):
        u = (math.cos(a), math.sin(a))  # (y, z) direction
        cy_, cz_ = max(centres, key=lambda c: c[0] * u[0] + c[1] * u[1])
        band.append((0.006, cy_ + (r + 0.0016) * u[0], cz_ + (r + 0.0016) * u[1]))
    cell(wire("ammos_band", A, coll, band, 0.0018), "rubber")
    return {"views": [((0.15, 0.12, 0.17), (0, 0.018, 0.012)), ((-0.14, 0.08, -0.12), (0, 0.018, 0.0)), ((0.07, 0.07, -0.13), (0, 0.02, 0.0))]}


def bent_plate(name, A, coll, base, length, width, bends, sq, seed):
    """A scrap of sheet metal bent along its length: bends is a list of
    (where 0..1, angle) folds; the plate starts flat on the ground."""
    r = np.random.default_rng(seed)
    pts, (x, y, z) = [], base
    ang = 0.0
    n = 12
    for k in range(n + 1):
        t = k / n
        for w_, a_ in bends:
            if abs(t - w_) < 0.5 / n:
                ang += a_
        pts.append((x, y, z))
        x += math.cos(ang) * length / n * math.cos(sq)
        z += math.cos(ang) * length / n * math.sin(sq)
        y = max(0.0008, y + math.sin(ang) * length / n)
    return strip(name, A, coll, pts, width, thick=0.0016, side=(-math.sin(sq), 0, math.cos(sq)), ragged=0.0015, seed=seed)


def ring_obj(name, A, coll, centre, radius, r_tube, axis="y", n=24):
    """A ring (seal, coil turn) round the given axis, as a fine swept tube."""
    cx, cy_, cz = centre
    pts = []
    for a in np.linspace(0, 2 * math.pi, n + 1):
        c, s_ = radius * math.cos(a), radius * math.sin(a)
        pts.append((cx + c, cy_, cz + s_) if axis == "y" else (cx, cy_ + s_, cz + c) if axis == "x" else (cx + c, cy_ + s_, cz))
    return wire(name, A, coll, pts, r_tube)


def build_scrap(M, coll):
    """Scrap Metal ("bent metal, used in almost everything"): a small heap of
    torn and bent plate, a twisted bracket and a rusty bolt. ~13 cm across."""
    A = M["atlas"]
    cell(bent_plate("scrap_plate0", A, coll, (-0.05, 0.001, -0.02), 0.11, 0.045, [(0.45, 0.5), (0.75, -0.3)], 0.2, 101), "steel_rust")
    cell(bent_plate("scrap_plate1", A, coll, (-0.03, 0.004, 0.03), 0.08, 0.03, [(0.3, 0.9), (0.6, -0.9)], -0.6, 102), "steel_bare")
    cell(bent_plate("scrap_plate2", A, coll, (0.0, 0.012, -0.035), 0.07, 0.05, [(0.5, -0.4)], 1.2, 103), "steel_rust")
    br = kit.box("scrap_bracket", A, coll, (0.035, 0.012, 0.0), (0.05, 0.004, 0.018), rot=(0.25, 0.4, 0.6), bev=0.0008)  # a twisted bracket
    cell(fine(br), "steel_bare")
    cell(bent_plate("scrap_plate3", A, coll, (-0.06, 0.002, 0.045), 0.06, 0.025, [(0.5, 1.4)], -0.2, 104), "steel_bare")
    cell(bent_plate("scrap_plate4", A, coll, (0.03, 0.002, 0.04), 0.05, 0.035, [(0.35, -0.6), (0.7, 0.8)], 2.4, 105), "steel_rust")
    cell(fine(kit.cylinder("scrap_bolt", A, coll, (0.012, 0.0045, 0.06), (0.05, 0.0045, 0.072), 0.0038, segments=10, bev=0)), "steel_bare")
    cell(fine(kit.cylinder("scrap_bolt_head", A, coll, (0.005, 0.0045, 0.058), (0.012, 0.0045, 0.06), 0.0075, segments=6, bev=0.0006)), "steel_bare")
    cell(fine(kit.cylinder("scrap_nut", A, coll, (0.036, 0.0045, 0.0677), (0.042, 0.0045, 0.0696), 0.0072, segments=6, bev=0.0006)), "steel_rust")
    return {"views": [((0.15, 0.11, 0.15), (0, 0.008, 0.01)), ((-0.14, 0.09, -0.11), (0, 0.008, 0.01)), ((0.02, 0.17, 0.05), (0, 0.0, 0.01))]}


def build_rubber(M, coll):
    """Rubber Parts ("hoses, tyres and seals"): a coil of cracked hose, two
    seal rings and a chunk of tyre tread. ~13 cm across."""
    A = M["atlas"]
    hose = []
    for k in range(60):
        t = k / 59
        a = t * 2 * math.pi * 1.6
        rr = 0.045 - 0.01 * t
        hose.append((rr * math.cos(a), 0.008 + 0.012 * t + 0.003 * math.sin(a * 2), rr * math.sin(a)))
    cell(wire("rubber_hose", A, coll, hose, 0.0075), "rubber")
    cell(fine(ring_obj("rubber_seal0", A, coll, (0.055, 0.003, 0.04), 0.014, 0.0028)), "rubber")
    cell(fine(ring_obj("rubber_seal1", A, coll, (0.065, 0.0075, 0.052), 0.01, 0.0024)), "rubber")
    tread = kit.box("rubber_tread", A, coll, (-0.01, 0.009, 0.06), (0.06, 0.018, 0.035), rot=(0, 0, 0.3), bev=0)
    kit.bevel(tread, 0.004, 2)
    cell(fine(tread), "rubber")
    for k in range(5):  # the tread blocks on top
        cell(fine(kit.box(f"rubber_tread_block{k}", A, coll, (-0.034 + k * 0.012, 0.0195, 0.06), (0.008, 0.004, 0.03), rot=(0, 0, 0.3), bev=0.0008)), "rubber")
    return {"views": [((0.2, 0.15, 0.22), (0.01, 0.01, 0.01)), ((-0.18, 0.12, -0.15), (0.01, 0.01, 0.0)), ((0.04, 0.22, 0.08), (0.01, 0.0, 0.02))]}


def build_plastic(M, coll):
    """Plastic Parts ("brittle but useful"): shards of a cracked casing, a
    snapped clip and a bottle cap. ~11 cm across."""
    A = M["atlas"]
    cell(bent_plate("plastic_shard0", A, coll, (-0.05, 0.001, -0.015), 0.08, 0.05, [(0.55, 1.2)], 0.15, 111), "plastic")
    cell(bent_plate("plastic_shard1", A, coll, (-0.01, 0.002, 0.025), 0.06, 0.035, [(0.4, 1.4)], -0.9, 112), "plastic")
    cell(bent_plate("plastic_shard2", A, coll, (0.01, 0.004, -0.04), 0.045, 0.03, [(0.5, -0.5)], 1.0, 113), "plastic")
    cell(fine(kit.cylinder("plastic_cap", A, coll, (0.045, 0.0, 0.03), (0.045, 0.012, 0.03), 0.013, segments=16, bev=0.0012)), "plastic")
    for k in range(12):  # the cap's ridges
        a = k / 12 * 2 * math.pi
        cell(fine(kit.box(f"plastic_cap_ridge{k}", A, coll, (0.045 + 0.0133 * math.cos(a), 0.006, 0.03 + 0.0133 * math.sin(a)), (0.0012, 0.01, 0.0012), bev=0)), "plastic")
    clip = kit.box("plastic_clip", A, coll, (0.02, 0.003, -0.005), (0.03, 0.006, 0.01), rot=(0, 0, 0.9), bev=0.0012)
    cell(fine(clip), "plastic")
    return {"views": [((0.18, 0.14, 0.2), (0, 0.01, 0.0)), ((-0.17, 0.11, -0.14), (0, 0.01, 0.0)), ((0.02, 0.2, 0.06), (0, 0.0, 0.0))]}


def build_fabric(M, coll):
    """Fabric ("for bandages and padding"): squares of cloth folded in a
    stack, a torn rag thrown over the top. ~15 x 12 cm."""
    A = M["atlas"]
    y = 0.0
    for k, (w, d, c, rot) in enumerate(((0.15, 0.12, "canvas_olive", 0.05), (0.14, 0.11, "canvas_bone", -0.08), (0.145, 0.115, "canvas_olive", 0.12))):
        o = kit.box(f"fabric_fold{k}", A, coll, (0.002 * k, y + 0.0045, -0.002 * k), (w, 0.009, d), rot=(0, 0, rot), bev=0)
        kit.bevel(o, 0.0038, 3)
        for poly in o.data.polygons:
            poly.use_smooth = True
        cell(fine(o), c)
        y += 0.0088
    rag = [(-0.07, y + 0.001, -0.02), (-0.03, y + 0.004, -0.01), (0.01, y + 0.002, 0.005), (0.05, y - 0.004, 0.02), (0.075, y - 0.02, 0.03), (0.08, y - 0.035, 0.032)]
    pts = []
    for a_, b_ in zip(rag, rag[1:]):
        for t in np.linspace(0, 1, 3)[:-1]:
            pts.append(tuple(a_[i] + (b_[i] - a_[i]) * t for i in range(3)))
    pts.append(rag[-1])
    cell(strip("fabric_rag", A, coll, pts, 0.06, thick=0.0015, side=(0.3, 0, -0.95), ragged=0.004, seed=121), "canvas_bone")
    return {"views": [((0.22, 0.18, 0.24), (0, 0.02, 0.0)), ((-0.2, 0.13, -0.17), (0, 0.02, 0.0)), ((0.03, 0.25, 0.07), (0, 0.02, 0.0))]}


def build_chemicals(M, coll):
    """Chemicals ("solvents and powders, handle with care"): a dented
    plastic bottle with a screw cap, a hand-marked paper label tied on.
    ~14 cm tall."""
    A = M["atlas"]
    r, h = 0.03, 0.11
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=r, radius2=r, depth=h)
    for v in bm.verts:  # a dent in one side, a shoulder narrowing to the neck
        z = v.co.z
        if v.co.xy.length > 1e-6:
            if z > h / 2 - 0.001:
                v.co.xy *= 0.95
            dx, dy = v.co.x, v.co.y
            if dx > r * 0.6 and abs(z) < h * 0.25:
                v.co.x -= 0.006 * (1 - abs(z) / (h * 0.25))
    bottle = kit.mesh_obj("chem_bottle", bm, A, coll, kit.g2b(0, h / 2, 0), (0, 0, 0))
    kit.bevel(bottle, 0.006, 3)
    for poly in bottle.data.polygons:
        poly.use_smooth = True
    bottle["uv"] = "box"
    cell(fine(bottle), "plastic")
    cell(fine(kit.cylinder("chem_shoulder", A, coll, (0, h, 0), (0, h + 0.012, 0), 0.02, segments=16, bev=0.004)), "plastic")
    cell(fine(kit.cylinder("chem_cap", A, coll, (0, h + 0.012, 0), (0, h + 0.026, 0), 0.0125, segments=16, bev=0.0015)), "rubber")
    cell(fine(kit.box("chem_label", A, coll, (0, h * 0.5, r + 0.0006), (0.035, 0.04, 0.0006), rot=(0, 0, 0.05), bev=0)), "paper")
    cell(fine(ring_obj("chem_label_string", A, coll, (0, h * 0.5 + 0.022, 0), r + 0.0012, 0.0008)), "twine")
    return {"views": [((0.2, 0.16, 0.24), (0, 0.06, 0.0)), ((-0.2, 0.12, -0.16), (0, 0.06, 0.0)), ((0.08, 0.1, 0.14), (0, 0.06, 0.02))]}


def build_wires(M, coll):
    """Wires ("copper, mostly"): a coil of bare copper wire twisted shut with
    its own tail, a short bundle of cut insulated wire beside it. ~12 cm."""
    A = M["atlas"]
    coil = []
    for k in range(240):
        t = k / 239
        a = t * 2 * math.pi * 9
        rr = 0.035 + 0.003 * math.sin(a * 0.5) + 0.002 * math.sin(t * 40)
        coil.append((rr * math.cos(a) - 0.015, 0.003 + 0.004 * math.sin(t * 7) + 0.0012 * (k % 3), rr * math.sin(a)))
    cell(wire("wires_coil", A, coll, coil, 0.0012), "copper")
    for k in range(3):  # the twist holding it shut
        a = 0.3 + k * 0.03
        cell(fine(ring_obj(f"wires_twist{k}", A, coll, (0.022 + k * 0.003, 0.004, 0.003), 0.004, 0.0009, axis="x", n=10)), "copper")
    for k in range(4):  # cut lengths of insulated wire, the copper showing at the ends
        z = 0.05 + k * 0.006
        a, b_ = (-0.05, 0.003, z + 0.004 * k), (0.04, 0.003, z - 0.003 * k)
        cell(wire(f"wires_cable{k}", A, coll, [a, ((a[0] + b_[0]) / 2, 0.006, (a[2] + b_[2]) / 2 + 0.006), b_], 0.0026), "rubber" if k % 2 else "plastic")
        cell(fine(kit.cylinder(f"wires_cable{k}_end", A, coll, b_, (b_[0] + 0.008, b_[1], b_[2]), 0.0012, segments=6, bev=0)), "copper")
    return {"views": [((0.17, 0.14, 0.2), (0, 0.005, 0.02)), ((-0.16, 0.11, -0.12), (0, 0.005, 0.02)), ((0.02, 0.2, 0.06), (0, 0.0, 0.02))]}


def build_battery(M, coll):
    """Battery ("still holds some charge"): a salvaged battery block, its
    casing cracked and taped, brass and copper terminals on top with a
    scrap of wire still clamped on, the old label half gone. ~12 x 9 cm."""
    A = M["atlas"]
    W, H, D = 0.12, 0.085, 0.07
    case = kit.box("battery_case", A, coll, (0, H / 2, 0), (W, H, D), bev=0)
    kit.bevel(case, 0.006, 2)
    cell(fine(case), "husk")
    lid = kit.box("battery_lid", A, coll, (0, H + 0.004, 0), (W - 0.004, 0.008, D - 0.004), bev=0)
    kit.bevel(lid, 0.003, 2)
    cell(fine(lid), "plastic")
    for k, (x, c) in enumerate(((-0.035, "brass"), (0.035, "copper"))):
        cell(fine(kit.cylinder(f"battery_post{k}", A, coll, (x, H + 0.008, 0), (x, H + 0.022, 0), 0.0065, segments=12, bev=0.0012)), c)
        cell(fine(kit.box(f"battery_clamp{k}", A, coll, (x, H + 0.016, 0), (0.02, 0.008, 0.014), bev=0.0012)), "steel_rust")
    lead = [(0.035, H + 0.019, 0.004), (0.045, H + 0.03, 0.02), (0.07, H + 0.02, 0.038), (0.085, H * 0.6, 0.05), (0.095, 0.02, 0.055), (0.11, 0.004, 0.06), (0.13, 0.004, 0.05)]
    cell(wire("battery_lead", A, coll, lead, 0.0028), "rubber")  # a scrap of lead still clamped on, trailing to the ground
    cell(fine(kit.box("battery_label", A, coll, (-0.022, H * 0.6, D / 2 + 0.0005), (0.04, 0.026, 0.0006), rot=(0, 0, -0.06), bev=0)), "paper")
    tape = kit.box("battery_tape", A, coll, (0.03, H * 0.45, D / 2 + 0.0008), (0.018, 0.05, 0.001), rot=(0, 0, 0.5), bev=0)  # cloth tape over a crack
    cell(fine(tape), "canvas_olive")
    return {"views": [((0.24, 0.2, 0.26), (0, 0.05, 0.0)), ((-0.22, 0.15, -0.18), (0, 0.05, 0.0)), ((0.06, 0.2, 0.12), (0, 0.08, 0.0))]}


def curved_panel(name, A, coll, w, l, bend, thick, y0, seed, ragged=0.0):
    """A machined plate curved across its width (an arc of `bend` radians),
    lying convex side up, `l` long along z."""
    pts = []
    R = w / max(bend, 1e-3)
    for a in np.linspace(-bend / 2, bend / 2, 9):
        pts.append((R * math.sin(a), y0 + R * (math.cos(a) - math.cos(bend / 2)), 0.0))
    # strip runs along the arc (x), with width l along z
    return strip(name, A, coll, pts, l, thick=thick, side=(0, 0, 1), ragged=ragged, seed=seed)


def build_husk_plating(M, coll):
    """Husk Plating ("plating stripped from Husks"): a curved slate armour
    plate prised off a Husk, a second layer seated on it with a precise
    seam, a machined chevron ridge, pale bare-metal edges, two mounting
    bolts sheared off flush, scorched at one end (art bible 5.4: machined,
    never rust). ~16 x 11 cm."""
    A = M["atlas"]
    R = 0.16 / 0.9  # both layers share one curvature, so the top one seats on the base
    def arc(x):  # the base plate's top surface height at x
        return 0.006 + R * (math.cos(math.asin(max(-1, min(1, x / R)))) - math.cos(0.45))
    cell(curved_panel("hplate_base", A, coll, 0.16, 0.11, 0.9, 0.006, 0.006, 131), "husk")
    lw = 2 * R * math.sin(0.11 / R / 2)
    cell(curved_panel("hplate_layer", A, coll, 0.11, 0.075, 0.11 / R, 0.004, arc(lw / 2) + 0.0045, 132), "husk")
    for sz in (-1, 1):  # pale bare-metal edges along the two long sides
        pts = [(x, arc(x) - 0.003, sz * 0.0545) for x in np.linspace(-0.077, 0.077, 13)]
        cell(wire(f"hplate_edge{sz}", A, coll, pts, 0.0022), "steel_bare")  # worn to bare metal
    for k, sx in enumerate((-1, 1)):  # the chevron ridge: two machined arms meeting at a point
        pts = [(sx * 0.03 * t, arc(sx * 0.03 * t) + 0.0045, 0.012 - 0.03 * t) for t in np.linspace(0, 1, 5)]
        cell(wire(f"hplate_chevron{k}", A, coll, pts, 0.0016), "steel_bare")
    for k, (x, z) in enumerate(((-0.06, -0.04), (0.06, 0.035))):  # sheared mounting bolts
        y = arc(x) - 0.002
        cell(fine(kit.cylinder(f"hplate_bolt{k}", A, coll, (x, y, z), (x, y + 0.0035, z), 0.0055, segments=12, bev=0.0006)), "steel_bare")
    return {"views": [((0.2, 0.17, 0.22), (0, 0.015, 0.0)), ((-0.2, 0.1, -0.17), (0, 0.015, 0.0)), ((0.03, 0.22, 0.07), (0, 0.01, 0.0))]}


def build_husk_circuit(M, coll):
    """Husk Circuitry ("strange, warm circuit boards"): a board in a
    machined slate frame, its copper traces laid in chevrons and diamonds,
    the Husk way (art bible 3), three studs where it plugged in. ~10 x 7 cm."""
    A = M["atlas"]
    W, D = 0.1, 0.07
    frame = kit.box("hcirc_frame", A, coll, (0, 0.003, 0), (W, 0.006, D), bev=0)
    kit.bevel(frame, 0.004, 3)
    cell(fine(frame), "steel_bare")
    cell(fine(kit.box("hcirc_board", A, coll, (0, 0.0062, 0), (W - 0.012, 0.0012, D - 0.012), bev=0)), "husk")
    y = 0.0069
    for k in range(4):  # chevrons, nested
        o = 0.008 * k
        pts = [(-0.035 + o * 0.5, y, -0.022 + o), (-0.012, y, -0.004 + o), (-0.035 + o * 0.5, y, 0.014 + o)]
        cell(wire(f"hcirc_chev{k}", A, coll, pts, 0.0006), "copper")
    for k, (cx, cz, rr) in enumerate(((0.02, -0.01, 0.012), (0.02, -0.01, 0.007), (0.034, 0.018, 0.006))):  # diamonds
        pts = [(cx, y, cz - rr), (cx + rr, y, cz), (cx, y, cz + rr), (cx - rr, y, cz), (cx, y, cz - rr)]
        cell(wire(f"hcirc_diamond{k}", A, coll, pts, 0.0006), "copper")
    for k in range(3):  # the studs on the edge where it plugged into the Husk
        x = -0.02 + k * 0.02
        cell(fine(kit.cylinder(f"hcirc_stud{k}", A, coll, (x, 0.003, D / 2), (x, 0.003, D / 2 + 0.007), 0.0025, segments=8, bev=0.0004)), "brass")
    chip = kit.box("hcirc_chip", A, coll, (-0.028, 0.0085, 0.022), (0.016, 0.003, 0.016), rot=(0, 0, math.pi / 4), bev=0.0008)
    cell(fine(chip), "husk")
    return {"views": [((0.15, 0.13, 0.17), (0, 0.004, 0.0)), ((-0.14, 0.09, -0.12), (0, 0.004, 0.0)), ((0.01, 0.17, 0.05), (0, 0.004, 0.0))]}


def build_husk_heart(M, coll):
    """Husk Heart ("the heart of a big Husk, worth a fortune"): the core
    pulled from a Pouncer or Warden (art bible 5.4: the glowing critical
    spot), dark now: a glass lens sphere in a machined cage of layered
    slate bands, pale at the edges, two torn-off couplings. Sits on its
    lower ring. ~11 cm across."""
    A = M["atlas"]
    cy, R = 0.052, 0.04
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=R * 0.8)  # cut like a stone
    lens = kit.mesh_obj("hheart_lens", bm, A, coll, kit.g2b(0, cy, 0))
    lens["uv"] = "box"
    cell(fine(lens), "glass_amber")
    for k, (tilt, c) in enumerate(((0.0, "husk"), (1.05, "husk"), (-1.05, "husk"))):  # three machined bands caging it
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=R, radius2=R, depth=0.012)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.005)
        o = kit.mesh_obj(f"hheart_band{k}", bm, A, coll, kit.g2b(0, cy, 0), (math.pi / 2 if k else 0, tilt, 0))
        o["uv"] = "box"
        kit.bevel(o, 0.0012, 1)
        cell(fine(o), c)
    for k, sx in enumerate((-1, 1)):  # couplings torn off where it was wired in, pale bare metal
        cell(fine(kit.cylinder(f"hheart_coupling{k}", A, coll, (sx * R * 0.95, cy, 0), (sx * (R + 0.016), cy, 0), 0.009, segments=12, bev=0.0012)), "steel_bare")
        cell(fine(kit.cylinder(f"hheart_coupling{k}_lip", A, coll, (sx * (R + 0.014), cy, 0), (sx * (R + 0.019), cy, 0), 0.012, segments=12, bev=0.001)), "husk")
    cell(fine(kit.cylinder("hheart_foot", A, coll, (0, 0.0, 0), (0, 0.012, 0), 0.022, segments=24, bev=0.002)), "husk")
    return {"views": [((0.2, 0.16, 0.22), (0, 0.05, 0.0)), ((-0.2, 0.12, -0.16), (0, 0.05, 0.0)), ((0.09, 0.08, 0.13), (0, 0.05, 0.0))]}


def extruded(name, A, coll, outline, y0, thick, bev=0.0008):
    """A flat solid from a closed outline [(x, z)] lying on the ground at
    height y0, `thick` tall."""
    bm = bmesh.new()
    verts = [bm.verts.new(kit.g2b(x, y0, z)) for x, z in outline]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=kit.g2b(0, thick, 0), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = kit.mesh_obj(name, bm, A, coll, (0, 0, 0), (0, 0, 0))
    if bev:
        kit.bevel(o, bev, 1)
    o["uv"] = "box"
    return fine(o)


def build_rusted_gear(M, coll):
    """Rusted Gear ("sells for a little"): a heavy spur gear from some old
    machine, rusted through, a few teeth chipped, lying flat. ~10 cm."""
    A = M["atlas"]
    rr_ = np.random.default_rng(141)
    n, r_root, r_tip = 18, 0.042, 0.05
    pts = []
    for k in range(n):
        chipped = k in (3, 11)
        tip = r_root + (r_tip - r_root) * (0.4 if chipped else 1.0)
        for f, rad in ((0.0, r_root), (0.18, tip), (0.42, tip), (0.6, r_root)):
            a = (k + f) / n * 2 * math.pi
            pts.append((rad * math.cos(a), rad * math.sin(a)))
    cell(extruded("gear_rim", A, coll, pts, 0.0, 0.012), "steel_rust")
    cell(fine(kit.cylinder("gear_hub", A, coll, (0, 0.0, 0), (0, 0.018, 0), 0.013, segments=20, bev=0.0015)), "steel_rust")
    cell(fine(kit.cylinder("gear_bore", A, coll, (0, 0.018, 0), (0, 0.0185, 0), 0.006, segments=12, bev=0)), "rubber")
    cell(fine(kit.box("gear_key", A, coll, (0.0065, 0.0182, 0), (0.003, 0.0004, 0.003), bev=0)), "rubber")
    return {"views": [((0.16, 0.14, 0.17), (0, 0.006, 0)), ((-0.15, 0.09, -0.12), (0, 0.006, 0)), ((0.02, 0.18, 0.05), (0, 0.0, 0))]}


def build_old_radio(M, coll):
    """Old Radio ("from before the Husks came"): a portable set in a worn
    leather case, a steel speaker grille, the tuning dial behind its glass,
    two knobs, a carry strap and the aerial folded down. ~20 x 13 cm."""
    A = M["atlas"]
    W, H, D = 0.2, 0.13, 0.07
    case = kit.box("radio_case", A, coll, (0, H / 2, 0), (W, H, D), bev=0)
    kit.bevel(case, 0.012, 3)
    cell(fine(case), "leather")
    grille = kit.box("radio_grille", A, coll, (-0.035, H * 0.48, D / 2 + 0.001), (0.1, 0.085, 0.002), bev=0.002)
    cell(fine(grille), "steel_bare")
    for k in range(7):
        cell(fine(kit.box(f"radio_slot{k}", A, coll, (-0.035, H * 0.48 - 0.033 + k * 0.011, D / 2 + 0.0022), (0.088, 0.0035, 0.0008), bev=0)), "rubber")
    cell(fine(kit.box("radio_dial", A, coll, (0.058, H * 0.62, D / 2 + 0.001), (0.055, 0.03, 0.002), bev=0.002)), "paper")
    cell(fine(kit.box("radio_dial_glass", A, coll, (0.058, H * 0.62, D / 2 + 0.0025), (0.05, 0.025, 0.001), bev=0.001)), "glass_amber")
    cell(fine(kit.box("radio_dial_needle", A, coll, (0.05, H * 0.62, D / 2 + 0.0034), (0.0012, 0.022, 0.0005), bev=0)), "rubber")
    for k, x in enumerate((0.042, 0.074)):
        cell(fine(kit.cylinder(f"radio_knob{k}", A, coll, (x, H * 0.32, D / 2), (x, H * 0.32, D / 2 + 0.012), 0.009, segments=14, bev=0.0015)), "rubber")
        cell(fine(kit.cylinder(f"radio_knob{k}_cap", A, coll, (x, H * 0.32, D / 2 + 0.012), (x, H * 0.32, D / 2 + 0.013), 0.006, segments=12, bev=0)), "brass")
    strap = [(-W / 2 + 0.02, H - 0.002, 0), (-W / 2 + 0.03, H + 0.03, 0), (0, H + 0.04, 0), (W / 2 - 0.03, H + 0.03, 0), (W / 2 - 0.02, H - 0.002, 0)]
    cell(strip("radio_strap", A, coll, strap, 0.018, thick=0.003, side=(0, 0, 1), seed=142), "leather")
    for sx in (-1, 1):
        cell(fine(kit.box(f"radio_strap_lug{sx}", A, coll, (sx * (W / 2 - 0.02), H, 0), (0.012, 0.01, 0.022), bev=0.0015)), "brass")
    cell(fine(kit.cylinder("radio_aerial", A, coll, (W / 2 - 0.012, H + 0.002, -D / 2 + 0.01), (-W / 2 + 0.03, H + 0.004, -D / 2 + 0.01), 0.0025, segments=8, bev=0)), "steel_bare")
    cell(fine(kit.cylinder("radio_aerial_tip", A, coll, (-W / 2 + 0.03, H + 0.004, -D / 2 + 0.01), (-W / 2 + 0.024, H + 0.004, -D / 2 + 0.01), 0.0045, segments=10, bev=0.001)), "steel_bare")
    return {"views": [((0.3, 0.22, 0.34), (0, 0.07, 0)), ((-0.3, 0.17, -0.25), (0, 0.07, 0)), ((0.12, 0.1, 0.2), (0.03, 0.08, 0.03))]}


def build_pocket_watch(M, coll):
    """Pocket Watch ("still ticks, traders love it"): a brass case lying
    open-faced, the winding crown and bow, a paper-white face with hour
    marks and two hands, its chain coiled beside it. ~5 cm."""
    A = M["atlas"]
    r = 0.024
    cell(fine(kit.cylinder("watch_case", A, coll, (0, 0, 0), (0, 0.011, 0), r, segments=32, bev=0.003)), "brass")
    cell(fine(kit.cylinder("watch_bezel", A, coll, (0, 0.011, 0), (0, 0.0128, 0), r * 0.94, segments=32, bev=0.0008)), "brass")
    cell(fine(kit.cylinder("watch_face", A, coll, (0, 0.0128, 0), (0, 0.0131, 0), r * 0.86, segments=32, bev=0)), "canvas_bone")
    for k in range(12):
        a = k / 12 * 2 * math.pi
        cell(fine(kit.box(f"watch_mark{k}", A, coll, (0.0175 * math.cos(a), 0.01325, 0.0175 * math.sin(a)), (0.0035, 0.0003, 0.0009), rot=(0, 0, -a), bev=0)), "rubber")
    cell(fine(kit.box("watch_hand_h", A, coll, (0.004, 0.0134, -0.003), (0.0012, 0.0003, 0.011), rot=(0, 0, 0.9), bev=0)), "rubber")
    cell(fine(kit.box("watch_hand_m", A, coll, (-0.002, 0.0135, -0.007), (0.0009, 0.0003, 0.016), rot=(0, 0, -0.35), bev=0)), "rubber")
    cell(fine(kit.cylinder("watch_crown", A, coll, (0, 0.0055, -r), (0, 0.0055, -r - 0.006), 0.0035, segments=12, bev=0.0006)), "brass")
    cell(fine(ring_obj("watch_bow", A, coll, (0, 0.0055, -r - 0.011), 0.006, 0.0011, axis="z", n=16)), "brass")
    chain = []
    for k in range(80):
        t = k / 79
        a = t * 2 * math.pi * 1.4
        rr = 0.016 + 0.006 * t
        chain.append((0.004 + rr * math.sin(a) - 0.01 * t, 0.0012, -r - 0.017 - 0.012 + rr * math.cos(a) * 0.8))
    cell(wire("watch_chain", A, coll, chain, 0.0011), "brass")
    return {"views": [((0.09, 0.08, 0.1), (0, 0.005, -0.01)), ((-0.08, 0.06, -0.09), (0, 0.005, -0.015)), ((0.01, 0.11, 0.03), (0, 0.006, -0.008))]}


def build_film_camera(M, coll):
    """Film Camera ("somebody remembered something with this"): a
    rangefinder body wrapped in leather, a steel top plate with the wind
    lever, shutter button and viewfinder windows, the lens barrel with its
    rings, a frayed strap. ~13 x 8 cm."""
    A = M["atlas"]
    W, H, D = 0.13, 0.075, 0.035
    body = kit.box("cam_body", A, coll, (0, H / 2, 0), (W, H * 0.78, D), bev=0)
    kit.bevel(body, 0.007, 3)
    cell(fine(body), "leather")
    top = kit.box("cam_top", A, coll, (0, H * 0.84, 0), (W - 0.002, H * 0.2, D + 0.001), bev=0)
    kit.bevel(top, 0.005, 2)
    cell(fine(top), "steel_bare")
    for k, x in enumerate((-0.045, -0.02)):
        cell(fine(kit.box(f"cam_window{k}", A, coll, (x, H * 0.85, D / 2 + 0.0008), (0.014, 0.009, 0.001), bev=0.0006)), "glass_amber")
    lens = [(0, H * 0.45, D / 2), (0, H * 0.45, D / 2 + 0.03)]
    cell(fine(kit.cylinder("cam_lens_mount", A, coll, lens[0], (0, H * 0.45, D / 2 + 0.006), 0.021, segments=24, bev=0.001)), "steel_bare")
    cell(fine(kit.cylinder("cam_lens_ring", A, coll, (0, H * 0.45, D / 2 + 0.006), (0, H * 0.45, D / 2 + 0.018), 0.018, segments=24, bev=0.0012)), "rubber")
    cell(fine(kit.cylinder("cam_lens_barrel", A, coll, (0, H * 0.45, D / 2 + 0.018), (0, H * 0.45, D / 2 + 0.03), 0.016, segments=24, bev=0.0012)), "steel_bare")
    cell(fine(kit.cylinder("cam_lens_glass", A, coll, (0, H * 0.45, D / 2 + 0.0295), (0, H * 0.45, D / 2 + 0.0302), 0.012, segments=20, bev=0)), "glass_amber")
    cell(fine(kit.cylinder("cam_shutter", A, coll, (0.045, H * 0.94, 0.004), (0.045, H * 0.94 + 0.005, 0.004), 0.004, segments=10, bev=0.0008)), "steel_bare")
    cell(fine(kit.box("cam_lever", A, coll, (0.03, H * 0.95, -0.006), (0.024, 0.002, 0.006), rot=(0, 0, 0.5), bev=0.0006)), "steel_bare")
    cell(fine(kit.cylinder("cam_rewind", A, coll, (-0.05, H * 0.94, 0), (-0.05, H * 0.94 + 0.006, 0), 0.007, segments=12, bev=0.001)), "steel_bare")
    strap = [(-W / 2, H * 0.8, 0), (-W / 2 - 0.012, H * 0.6, 0.004), (-W / 2 - 0.02, 0.02, 0.02), (-W / 2 - 0.01, 0.002, 0.05), (-0.02, 0.002, 0.06), (W / 2 + 0.005, 0.002, 0.045)]
    cell(strip("cam_strap", A, coll, strap, 0.012, thick=0.002, side=(0, 1, 0), ragged=0.0005, seed=143), "leather")
    return {"views": [((0.2, 0.15, 0.24), (0, 0.04, 0.01)), ((-0.2, 0.12, -0.18), (0, 0.04, 0)), ((0.06, 0.06, 0.15), (0, 0.035, 0.02))]}


def build_music_box(M, coll):
    """Music Box ("plays a song nobody knows anymore"): a small box with
    brass corners, its lid standing open on its hinge; inside, the steel
    comb and the brass cylinder studded with pins; a winding key in the
    side. ~11 x 8 cm."""
    A = M["atlas"]
    W, H, D, t = 0.11, 0.05, 0.08, 0.005
    cell(fine(kit.box("mbox_floor", A, coll, (0, t / 2, 0), (W, t, D), bev=0.001)), "leather")
    for sx in (-1, 1):
        cell(fine(kit.box(f"mbox_side{sx}", A, coll, (sx * (W / 2 - t / 2), H / 2, 0), (t, H, D), bev=0.0012)), "leather")
        cell(fine(kit.box(f"mbox_end{sx}", A, coll, (0, H / 2, sx * (D / 2 - t / 2)), (W, H, t), bev=0.0012)), "leather")
        for sz in (-1, 1):
            cell(fine(kit.box(f"mbox_corner{sx}{sz}", A, coll, (sx * (W / 2 - 0.004), H / 2, sz * (D / 2 - 0.004)), (0.011, H + 0.002, 0.011), bev=0.0012)), "brass")
    lid = kit.box("mbox_lid", A, coll, (0, H + 0.035, -D / 2 - 0.004), (W, 0.07, t), rot=(-0.25, 0, 0), bev=0.0012)
    cell(fine(lid), "leather")
    cell(fine(kit.box("mbox_lid_inner", A, coll, (0, H + 0.035, -D / 2 + 0.0002), (W - 0.012, 0.06, 0.001), rot=(-0.25, 0, 0), bev=0)), "paper")
    cell(fine(kit.cylinder("mbox_hinge", A, coll, (-W / 2 + 0.01, H, -D / 2), (W / 2 - 0.01, H, -D / 2), 0.0025, segments=8, bev=0)), "brass")
    cell(fine(kit.box("mbox_bed", A, coll, (0, 0.012, 0), (W - 0.016, 0.004, D - 0.016), bev=0.0008)), "steel_bare")
    cy_ = 0.026
    cell(fine(kit.cylinder("mbox_cylinder", A, coll, (-0.035, cy_, -0.008), (0.035, cy_, -0.008), 0.009, segments=20, bev=0.001)), "brass")
    rr_ = np.random.default_rng(144)
    for k in range(26):  # the pins that play the tune
        x = rr_.uniform(-0.033, 0.033)
        a = rr_.uniform(0, 2 * math.pi)
        p0 = (x, cy_ + 0.009 * math.sin(a), -0.008 + 0.009 * math.cos(a))
        p1 = (x, cy_ + 0.0105 * math.sin(a), -0.008 + 0.0105 * math.cos(a))
        cell(fine(kit.cylinder(f"mbox_pin{k}", A, coll, p0, p1, 0.0006, segments=4, bev=0)), "steel_bare")
    for k in range(14):  # the comb's teeth, longest at the bass end
        x = -0.033 + k * 0.005
        ln = 0.024 - k * 0.0008
        cell(fine(kit.box(f"mbox_tooth{k}", A, coll, (x, cy_ + 0.0005, 0.004 + ln / 2), (0.004, 0.0012, ln), bev=0)), "steel_bare")
    cell(fine(kit.box("mbox_comb_base", A, coll, (0, cy_ - 0.002, 0.024), (0.075, 0.008, 0.012), bev=0.0008)), "steel_bare")
    cell(fine(kit.cylinder("mbox_key_stem", A, coll, (W / 2, 0.022, 0.01), (W / 2 + 0.012, 0.022, 0.01), 0.002, segments=8, bev=0)), "brass")
    cell(fine(kit.box("mbox_key_wing", A, coll, (W / 2 + 0.014, 0.022, 0.01), (0.003, 0.016, 0.009), bev=0.001)), "brass")
    return {"views": [((0.17, 0.17, 0.2), (0, 0.035, 0.0)), ((-0.17, 0.12, 0.15), (0, 0.035, 0.0)), ((0.03, 0.12, 0.09), (0, 0.025, 0.0))]}


def build_gilded_relay(M, coll):
    """Gilded Relay ("a Husk component plated in gold. Why?"): a machined
    Husk relay, symmetrical and precise (art bible 5.4), its housing, coils
    and terminals all plated in gold; the slate shows only in the gaps
    between them. ~10 x 7 cm."""
    A = M["atlas"]
    W, H, D = 0.1, 0.03, 0.07
    base = kit.box("relay_base", A, coll, (0, H / 2, 0), (W, H, D), bev=0)
    kit.bevel(base, 0.006, 3)
    cell(fine(base), "brass")
    cell(fine(kit.box("relay_seam", A, coll, (0, H * 0.5, 0), (W + 0.001, 0.003, D + 0.001), bev=0)), "husk")  # the slate between the plated halves
    for k, x in enumerate((-0.025, 0.025)):  # two coils on machined cradles
        cell(fine(kit.box(f"relay_cradle{k}", A, coll, (x, H + 0.004, 0), (0.026, 0.008, 0.05), bev=0.0015)), "brass")
        coil = kit.cylinder(f"relay_coil{k}", A, coll, (x, H + 0.018, -0.022), (x, H + 0.018, 0.022), 0.012, segments=20, bev=0.0015)
        cell(fine(coil), "brass")
        for j in range(5):  # the windings
            z = -0.016 + j * 0.008
            cell(fine(ring_obj(f"relay_winding{k}_{j}", A, coll, (x, H + 0.018, z), 0.0125, 0.0012, axis="z", n=20)), "brass")
    for sx in (-1, 1):  # the Husk chevron raised on the housing's front edge, gilded too
        cell(wire(f"relay_chevron{sx}", A, coll, [(sx * 0.014, H + 0.0012, D / 2 - 0.004), (0, H + 0.0012, D / 2 - 0.016)], 0.0016), "brass")
    for k in range(4):  # terminals along the front, slate showing round each
        x = -0.03 + k * 0.02
        cell(fine(kit.cylinder(f"relay_term{k}_ring", A, coll, (x, H * 0.5, D / 2), (x, H * 0.5, D / 2 + 0.002), 0.005, segments=12, bev=0)), "husk")
        cell(fine(kit.cylinder(f"relay_term{k}", A, coll, (x, H * 0.5, D / 2), (x, H * 0.5, D / 2 + 0.008), 0.0028, segments=10, bev=0.0005)), "brass")
    return {"views": [((0.16, 0.13, 0.17), (0, 0.03, 0.0)), ((-0.15, 0.1, -0.13), (0, 0.03, 0.0)), ((0.05, 0.09, 0.11), (0, 0.03, 0.02))]}


ITEMS = {"rusted_gear": build_rusted_gear, "old_radio": build_old_radio, "pocket_watch": build_pocket_watch, "film_camera": build_film_camera,
         "music_box": build_music_box, "golden_relay": build_gilded_relay,
         "husk_plating": build_husk_plating, "husk_circuit": build_husk_circuit, "husk_heart": build_husk_heart,
         "scrap": build_scrap, "rubber": build_rubber, "plastic": build_plastic, "fabric": build_fabric, "chemicals": build_chemicals,
         "wires": build_wires, "battery": build_battery,
         "ammo_light": build_ammo_light, "ammo_medium": build_ammo_medium, "ammo_heavy": build_ammo_heavy, "ammo_shotgun": build_ammo_shotgun,
         "frag": build_frag, "bandage": build_bandage, "med_kit": build_med_kit, "shield_cell": build_shield_cell,
         "shield_light": lambda M, c: build_shield(M, c, "light"), "shield_medium": lambda M, c: build_shield(M, c, "medium"),
         "shield_heavy": lambda M, c: build_shield(M, c, "heavy")}


def studio(cam, look, out, fov=30):
    """The weapons studio with the floor at y = 0, so items sit on it."""
    scn = bpy.context.scene
    for o in [o for o in scn.objects if o.name.startswith("studio_")]:
        bpy.data.objects.remove(o)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=2.0)
    kit.mesh_obj("studio_floor", bm, kit.pbr("mat_studio", None, tint=(0.08, 0.07, 0.06), rough=0.8), scn.collection, kit.g2b(0, 0, 0))
    kit.add_light("studio_key", "AREA", (0.35, 0.45, 0.3), (1.0, 0.8, 0.62), 14, coll=scn.collection, size=0.4)
    kit.add_light("studio_fill", "AREA", (-0.4, 0.25, 0.1), (0.85, 0.82, 0.78), 5, coll=scn.collection, size=0.6)
    kit.add_light("studio_rim", "AREA", (0.0, 0.3, -0.5), (1.0, 0.85, 0.7), 8, coll=scn.collection, size=0.3)
    for o in scn.objects:
        if o.name.startswith("studio_") and o.type == "LIGHT":
            d = Vector(kit.g2b(0, 0.03, 0)) - o.location
            o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    kit.setup_render(out, cam, look, fov=fov, res=(1200, 675), samples=64)
    scn.world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.025, 0.02, 1)


def main():
    items = (arg("--items") or ",".join(ITEMS)).split(",")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(kit.WORK, exist_ok=True)
    if not os.path.exists(os.path.join(ITEX, "item_atlas_albedo.png")) or "--textures" in sys.argv:
        make_item_atlas()
    M = item_materials()
    for item in items:
        coll = bpy.data.collections.new(f"prop_{item}_01")
        bpy.context.scene.collection.children.link(coll)
        info = ITEMS[item](M, coll)
        for o in list(coll.objects):
            kit.finalize(o)
            if o.get("cell"):
                to_cell(o, o["cell"])
        tris = sum(len(p.vertices) - 2 for o in coll.objects if o.type == "MESH" for p in o.data.polygons)
        mats = {s.material.name for o in coll.objects if o.type == "MESH" for s in o.material_slots if s.material}
        print(f"{item}: parts {len([o for o in coll.objects if o.type == 'MESH'])}  triangles {tris}  materials {len(mats)}")
        if "--render" in sys.argv:
            for k, (cam, look) in enumerate(info["views"]):
                for other in bpy.data.collections:
                    if other.name.startswith("prop_"):
                        other.hide_render = other is not coll
                studio(cam, look, os.path.join(kit.WORK, f"preview_item_{item}_{k}.png"), fov=30)
        if "--export" in sys.argv:
            os.makedirs(IMODELS, exist_ok=True)
            kit.merge_by_material(coll, prefix=f"prop_{item}_01_")
            for o in coll.objects:
                if o.type == "MESH":  # triangles only, so the exporter can work out tangents for the normal map
                    bm = bmesh.new()
                    bm.from_mesh(o.data)
                    bmesh.ops.triangulate(bm, faces=bm.faces[:])
                    bm.to_mesh(o.data)
                    bm.free()
                elif o.name.split(".")[0] in ("hang",):  # markers keep their plain names in every export
                    o.name = o.name.split(".")[0]
            bpy.ops.object.select_all(action="DESELECT")
            for o in coll.objects:
                o.select_set(True)
            bpy.ops.export_scene.gltf(
                filepath=os.path.join(IMODELS, f"prop_{item}_01.gltf"), export_format="GLTF_SEPARATE",
                export_texture_dir="../../textures/items" if item != "bandage" else "../../textures/sanctuary", use_selection=True, export_apply=True, export_yup=True,
                export_tangents=True, export_lights=False, export_cameras=False, export_materials="EXPORT",
                export_image_format="AUTO",
            )
            for o in coll.objects:  # out of the way of the next item's markers
                if o.type == "EMPTY":
                    o.name = f"{o.name}_{item}_done"


if __name__ == "__main__":
    main()
