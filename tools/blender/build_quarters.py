"""Builds the Sanctuary quarters (the Diver's room) in Blender.

Follows design/art/art-bible.md: the old mine underneath (hewn rock, timber
sets slightly out of true), the survivor build-out on top (plank partition,
salvaged steel), warm lamps with brown shadows, and small "someone lives
here" details. The footprint and the spots players use (locker, mirror,
weapon rack, bed) match src/sanctuary.js, so gameplay positions don't move.

Positions below are game coordinates (Y up, as in src/sanctuary.js) and are
converted to Blender's Z-up on creation. Shared textures come from
make_textures.py (godot/textures/sanctuary/).

Run with the Blender Python module (bpy):
    python tools/blender/build_quarters.py <work dir> [--render] [--export]
Writes <work dir>/env_sanctuary_quarters.blend (kept outside the repo, per
the art bible), previews to <work dir>/preview_*.png with --render, and
godot/models/sanctuary/env_sanctuary_quarters.glb with --export.
"""

import math
import os
import sys

import bpy  # first: it makes bmesh and mathutils importable
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX = os.path.join(ROOT, "godot", "textures", "sanctuary")
MODELS = os.path.join(ROOT, "godot", "models", "sanctuary")
WORK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "build", "blender")
DO_RENDER = "--render" in sys.argv
DO_EXPORT = "--export" in sys.argv
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

H = 3.4  # ceiling height, as in src/sanctuary.js
TILE = 2.0  # metres covered by one tiling texture (1024 px -> 512 px/m)

rng = np.random.default_rng(7)


# ---------- coordinates ----------

def g2b(x, y, z):
    """Game (Y up, as in src/sanctuary.js) to Blender (Z up)."""
    return Vector((x, -z, y))


def gsize(sx, sy, sz):
    return Vector((sx, sz, sy))


# ---------- materials ----------

_images = {}


def image(path, data=False):
    if path not in _images:
        img = bpy.data.images.load(path)
        if data:
            img.colorspace_settings.name = "Non-Color"
        _images[path] = img
    return _images[path]


def pbr(name, tex, tint=(1, 1, 1), emission=None, emission_strength=0.0, rough=None, metal=None):
    """A Principled BSDF material the glTF exporter maps 1:1 to Godot:
    albedo (times tint), ORM (G roughness, B metallic, R occlusion) and normal."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    if tex:
        alb = nt.nodes.new("ShaderNodeTexImage")
        alb.image = image(os.path.join(TEX, f"{tex}_albedo.png"))
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(alb.outputs["Color"], mul.inputs[6])
        mul.inputs[7].default_value = (*tint, 1.0)
        nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
        orm = nt.nodes.new("ShaderNodeTexImage")
        orm.image = image(os.path.join(TEX, f"{tex}_orm.png"), data=True)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        nrm_img = nt.nodes.new("ShaderNodeTexImage")
        nrm_img.image = image(os.path.join(TEX, f"{tex}_normal.png"), data=True)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nrm_img.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        # glTF occlusion comes from the "glTF Material Output" group
        grp = bpy.data.node_groups.get("glTF Material Output")
        if grp is None:
            grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
            grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        gnode = nt.nodes.new("ShaderNodeGroup")
        gnode.node_tree = grp
        nt.links.new(sep.outputs["Red"], gnode.inputs["Occlusion"])
    else:
        bsdf.inputs["Base Color"].default_value = (*tint, 1.0)
    if rough is not None:
        bsdf.inputs["Roughness"].default_value = rough
    if metal is not None:
        bsdf.inputs["Metallic"].default_value = metal
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return m


def picture_material(name, png, emission_strength=0.0, rough=0.8, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = image(png)
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    if emission_strength:
        nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha:
        nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
    return m


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


# ---------- generated pictures (signs, screen, posters, decals) ----------

def make_pictures():
    os.makedirs(TEX, exist_ok=True)
    out = {}

    def font(size):
        return ImageFont.truetype(FONT, size)

    def grime(img, amount=0.35, seed=0):
        a = np.asarray(img).astype(float) / 255.0
        r = np.random.default_rng(seed)
        n = Image.fromarray((r.random(a.shape[:2]) * 255).astype(np.uint8)).resize((a.shape[1] // 16, a.shape[0] // 16)).resize((a.shape[1], a.shape[0]), Image.BICUBIC)
        n = np.asarray(n.filter(ImageFilter.GaussianBlur(6))).astype(float) / 255.0
        a[..., :3] *= (1.0 - amount * np.clip(n - 0.35, 0, 1))[..., None]
        return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), img.mode)

    # Painted signboard over the room: plank colour, hand-painted lettering
    sb = Image.open(os.path.join(TEX, "plank_albedo.png")).convert("RGB").crop((0, 0, 1024, 256)).resize((1024, 256))
    d = ImageDraw.Draw(sb)
    d.text((512, 100), "PATRON'S SANCTUARY", font=font(78), fill=(222, 208, 182), anchor="mm")
    d.text((512, 196), "REST  ·  REARM  ·  RETURN", font=font(44), fill=(198, 160, 108), anchor="mm")
    p = os.path.join(TEX, "sign_sanctuary_albedo.png")
    grime(sb, 0.5, 1).save(p)
    out["sign"] = p

    # Stencil plate on the locker
    st = Image.new("RGB", (256, 96), (58, 64, 52))
    d = ImageDraw.Draw(st)
    d.text((128, 50), "STASH", font=font(64), fill=(214, 204, 182), anchor="mm")
    p = os.path.join(TEX, "sign_stash_albedo.png")
    grime(st, 0.6, 2).save(p)
    out["stash"] = p

    # Topside camera feed: bleached, harsh daylight over the ruined skyline
    sc = Image.new("RGB", (512, 512))
    a = np.zeros((512, 512, 3))
    yy = np.linspace(0, 1, 512)[:, None]
    sky = np.array([0.93, 0.9, 0.82]) * (1 - yy) + np.array([0.82, 0.74, 0.6]) * yy
    a[:] = sky[:, None, :] if sky.ndim == 2 else sky
    xs = np.arange(512)
    skyline = 300 + 18 * np.sin(xs * 0.03) - np.where((xs // 40) % 3 == 0, 60, 0) - np.where((xs // 23) % 5 == 0, 30, 0)
    for x in xs:
        a[int(skyline[x]):, x] = (0.27, 0.23, 0.2)
    a[::4] *= 0.86  # scanlines
    sc = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(sc)
    d.ellipse((60, 70, 82, 92), fill=(255, 74, 42))
    d.text((96, 81), "CAM 03 · TOPSIDE", font=font(30), fill=(232, 226, 212), anchor="lm")
    p = os.path.join(TEX, "screen_topside_albedo.png")
    sc.save(p)
    out["screen"] = p

    # Two old posters, sun-faded and torn at the corners
    for key, title, bg in (("poster_dustline", "THE DUSTLINE", (92, 108, 102)), ("poster_plating", "KEEP YOUR PLATING", (128, 98, 74))):
        im = Image.new("RGBA", (360, 512), (*bg, 255))
        d = ImageDraw.Draw(im)
        d.ellipse((100, 90, 260, 250), outline=(30, 28, 26), width=14)
        d.ellipse((160, 150, 200, 190), fill=(30, 28, 26))
        d.text((180, 380), title, font=font(30), fill=(28, 26, 24), anchor="mm")
        d.polygon([(0, 0), (40, 0), (0, 34)], fill=(0, 0, 0, 0))
        d.polygon([(360, 512), (300, 512), (360, 470)], fill=(0, 0, 0, 0))
        im = grime(im, 0.55, hash(key) % 100)
        p = os.path.join(TEX, f"{key}_albedo.png")
        im.save(p)
        out[key] = p

    # Tally marks scratched into the plank wall (alpha decal)
    tm = Image.new("RGBA", (512, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(tm)
    x = 20
    for group in range(7):
        for k in range(5):
            if k < 4:
                d.line((x + k * 14, 40 + (k % 2) * 4, x + k * 14 + 3, 200), fill=(212, 196, 168, 230), width=5)
            else:
                d.line((x - 8, 170, x + 56, 70), fill=(212, 196, 168, 230), width=5)
        x += 72
    p = os.path.join(TEX, "decal_tally_albedo.png")
    tm.save(p)
    out["tally"] = p

    # A faded photo pinned by the bed
    ph = Image.new("RGB", (256, 192), (184, 170, 146))
    d = ImageDraw.Draw(ph)
    d.rectangle((14, 14, 242, 178), fill=(150, 136, 112))
    d.ellipse((70, 50, 120, 100), fill=(96, 84, 70))
    d.ellipse((140, 56, 186, 102), fill=(104, 90, 74))
    d.rectangle((60, 100, 130, 178), fill=(96, 84, 70))
    d.rectangle((132, 104, 196, 178), fill=(104, 90, 74))
    p = os.path.join(TEX, "photo_family_albedo.png")
    grime(ph.filter(ImageFilter.GaussianBlur(1.5)), 0.4, 9).save(p)
    out["photo"] = p
    return out


# ---------- mesh helpers ----------

def link(obj, coll):
    coll.objects.link(obj)
    return obj


def mesh_obj(name, bm, mat, coll, loc=(0, 0, 0), rot=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    o.location = loc
    o.rotation_euler = rot
    return link(o, coll)


def bevel(o, width=0.012, segments=2, weighted=True):
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.harden_normals = False
    if weighted:
        w = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        w.keep_sharp = True
    return o


def box(name, mat, coll, pos, size, rot=(0, 0, 0), bev=0.012, uv="box", grain=None, soft=False, puff=0.45):
    """A bevelled box. pos/size in game coordinates; rot is Blender Euler."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    s = gsize(*size)
    for v in bm.verts:
        v.co = Vector((v.co.x * s.x, v.co.y * s.y, v.co.z * s.z))
    o = mesh_obj(name, bm, mat, coll, g2b(*pos), rot, smooth=False)
    if soft:
        # cloth: a fat bevel rounded off by subdivision, with a little sag
        bevel(o, min(size) * (0.3 if min(size) < 0.08 else puff), 3, weighted=False)
        sub = o.modifiers.new("Subsurf", "SUBSURF")
        sub.levels = sub.render_levels = 2
        t = bpy.data.textures.new(f"{name}_lumps", "CLOUDS")
        t.noise_scale = 0.12
        d = o.modifiers.new("Lumps", "DISPLACE")
        d.texture = t
        d.strength = min(size) * 0.12
        d.texture_coords = "GLOBAL"
    elif bev:
        bevel(o, min(bev, min(size) * 0.3))
    o["uv"] = uv
    if grain:
        o["grain"] = grain
    return o


def cylinder(name, mat, coll, p0, p1, radius, segments=12, bev=0.004):
    """A tube between two game-space points."""
    a, b = g2b(*p0), g2b(*p1)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=d.length)
    o = mesh_obj(name, bm, mat, coll, (a + b) / 2, d.to_track_quat("Z", "Y").to_euler())
    if bev:
        bevel(o, bev, 1)
    o["uv"] = "box"
    o["grain"] = "long"
    return o


def plane(name, mat, coll, pos, w, h, rot):
    """A picture plane (keeps its 0..1 UVs). rot is Blender Euler."""
    bm = bmesh.new()
    bm.loops.layers.uv.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5, calc_uvs=True)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= h
    o = mesh_obj(name, bm, mat, coll, g2b(*pos), rot, smooth=False)
    o["uv"] = "keep"
    return o


def displaced_panel(name, mat, coll, pos, w, h, rot, step=0.05, depth=0.32, seed=1):
    """A hewn rock surface: a grid pushed back (away from its normal) by noise."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=max(2, int(w / step)), y_segments=max(2, int(h / step)), size=0.5)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= h
    o = mesh_obj(name, bm, mat, coll, g2b(*pos), rot)
    for i, (scale, strength) in enumerate(((0.7, depth), (0.25, depth * 0.4), (0.08, depth * 0.12))):
        t = bpy.data.textures.new(f"{name}_n{i}", "CLOUDS")
        t.noise_scale = scale
        t.noise_depth = 3
        t.noise_basis = "VORONOI_F2" if i < 2 else "BLENDER_ORIGINAL"
        m = o.modifiers.new(f"Displace{i}", "DISPLACE")
        m.texture = t
        m.texture_coords = "GLOBAL"
        m.strength = strength
        m.mid_level = 1.0  # only push back, never into the room
    o["uv"] = "box"
    return o


def catenary(p0, p1, sag, n):
    a, b = np.array(p0), np.array(p1)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a * (1 - t) + b * t
        p[1] -= sag * 4 * t * (1 - t)
        pts.append(tuple(p))
    return pts


# ---------- UVs ----------

def finalize(o):
    """Apply modifiers and give the mesh world-scale box-projected UVs, so the
    shared tiling textures keep one texel density (art bible 8.5). Timber
    grain follows the object's long axis."""
    if o.type != "MESH":
        return
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    o.modifiers.clear()
    old = o.data
    o.data = me
    bpy.data.meshes.remove(old)
    if o.get("uv") == "keep":
        return
    mw = o.matrix_world
    dims = [o.dimensions.x, o.dimensions.y, o.dimensions.z]
    long_axis = int(np.argmax(dims)) if o.get("grain") else None
    rot = mw.to_3x3()
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = rot @ f.normal
        ax = int(np.argmax([abs(n.x), abs(n.y), abs(n.z)]))
        others = [i for i in range(3) if i != ax]
        if long_axis is not None and long_axis in others:
            vax = long_axis
            uax = [i for i in others if i != vax][0]
        else:
            uax, vax = others
        for loop in f.loops:
            w = mw @ loop.vert.co
            loop[uvl].uv = (w[uax] / TILE, w[vax] / TILE)
    bm.to_mesh(me)
    bm.free()


# ---------- the room ----------

def build(pics):
    coll = bpy.data.collections.new("env_sanctuary_quarters")
    bpy.context.scene.collection.children.link(coll)

    M = {
        "rock": pbr("mat_rock_mine_01", "rock"),
        "rock_ceiling": pbr("mat_rock_mine_02", "rock", tint=(0.8, 0.78, 0.74)),
        "earth": pbr("mat_earth_packed_01", "earth"),
        "timber": pbr("mat_timber_mine_01", "timber"),
        "plank": pbr("mat_plank_survivor_01", "plank"),
        "steel": pbr("mat_steel_painted_01", "steel"),
        "steel_locker": pbr("mat_steel_painted_02", "steel", tint=srgb("#8a9688")),
        "canvas": pbr("mat_canvas_01", "canvas"),
        "blanket": pbr("mat_canvas_blanket_01", "canvas", tint=srgb("#b07a5c")),
        "mattress": pbr("mat_canvas_ticking_01", "canvas", tint=srgb("#d8cdb4")),
        "rug": pbr("mat_canvas_rug_01", "canvas", tint=srgb("#a0684e")),
        "bare": pbr("mat_metal_bare_01", None, tint=srgb("#7c858f"), rough=0.35, metal=1.0),
        "dark": pbr("mat_metal_dark_01", None, tint=srgb("#2a2c2e"), rough=0.5, metal=0.8),
        "glass": pbr("mat_glass_mirror_01", None, tint=srgb("#c8c4bc"), rough=0.04, metal=1.0),
        "bulb": pbr("mat_bulb_warm_01", None, tint=(1, 0.9, 0.75), emission=(1.0, 0.62, 0.32), emission_strength=25.0),
        "leaf": pbr("mat_leaf_01", None, tint=srgb("#5a6a3c"), rough=0.6),
        "sign": picture_material("mat_sign_sanctuary_01", pics["sign"], rough=0.75),
        "stash": picture_material("mat_sign_stash_01", pics["stash"], rough=0.6),
        "screen": picture_material("mat_screen_topside_01", pics["screen"], emission_strength=1.6, rough=0.2),
        "poster_dustline": picture_material("mat_poster_dustline_01", pics["poster_dustline"], alpha=True),
        "poster_plating": picture_material("mat_poster_plating_01", pics["poster_plating"], alpha=True),
        "tally": picture_material("mat_decal_tally_01", pics["tally"], alpha=True),
        "photo": picture_material("mat_photo_family_01", pics["photo"], rough=0.5),
    }

    R90 = math.pi / 2

    # --- the old mine: hewn rock walls and ceiling, packed earth floor ---
    displaced_panel("rock_wall_west", M["rock"], coll, (-4.0, H / 2, 0), 7.3, H + 0.2, (R90, 0, R90), seed=1)
    displaced_panel("rock_wall_east", M["rock"], coll, (4.0, H / 2, 0), 7.3, H + 0.2, (R90, 0, -R90), seed=2)
    displaced_panel("rock_ceiling", M["rock_ceiling"], coll, (0, H, 0), 8.3, 7.3, (math.pi, 0, 0), step=0.07, depth=0.22, seed=3)
    floor = displaced_panel("earth_floor", M["earth"], coll, (0, 0.0, 0), 8.2, 7.2, (0, 0, 0), step=0.1, depth=0.03, seed=4)
    for m in floor.modifiers:
        m.mid_level = 1.0  # only dips: nothing pokes up through the rug

    # --- timber mine sets: post, cap, post; slightly out of true ---
    for i, z in enumerate((-1.4, 1.4)):
        lean = (-1) ** i * 0.025
        box(f"timber_post_w{i}", M["timber"], coll, (-3.82, H / 2 - 0.05, z), (0.22, H - 0.1, 0.22), rot=(0, lean, 0.02), bev=0.03, grain="long")
        box(f"timber_post_e{i}", M["timber"], coll, (3.82, H / 2 - 0.05, z), (0.22, H - 0.1, 0.22), rot=(0, -lean, -0.015), bev=0.03, grain="long")
        box(f"timber_cap_{i}", M["timber"], coll, (0, H - 0.17, z), (8.0, 0.24, 0.26), rot=(0.01 * (-1) ** i, 0, 0), bev=0.03, grain="long")
        for s in (-1, 1):  # wedges driven in between cap and rock
            box(f"timber_wedge_{i}_{s}", M["timber"], coll, (s * 2.6, H - 0.02, z), (0.5, 0.06, 0.2), rot=(0, 0.06 * s, 0), bev=0.01, grain="long")
    # lagging boards between the caps, holding back the ceiling rock
    for k, x in enumerate(np.arange(-3.4, 3.6, 0.85)):
        box(f"timber_lagging_{k}", M["timber"], coll, (x + rng.uniform(-0.05, 0.05), H - 0.04, 0), (0.18, 0.04, 2.8 + rng.uniform(-0.1, 0.1)), rot=(0, 0, rng.uniform(-0.03, 0.03)), bev=0.008, grain="long")

    # --- survivor build-out: plank partition with the doorway (back wall) ---
    door_x, door_w = -2.0, 1.2
    left = (-4.0, door_x - door_w / 2)
    right = (door_x + door_w / 2, 4.0)
    for name, (x0, x1) in (("plank_wall_back_l", left), ("plank_wall_back_r", right)):
        box(name, M["plank"], coll, ((x0 + x1) / 2, H / 2, -3.5), (x1 - x0, H, 0.08), bev=0.006)
    box("plank_wall_back_lintel", M["plank"], coll, (door_x, H - 0.35, -3.5), (door_w, 0.7, 0.08), bev=0.006)
    for k, y in enumerate((0.35, 1.25, 2.25)):  # battens nailed across the boards
        box(f"timber_batten_{k}", M["timber"], coll, (0.9, y, -3.44), (6.0, 0.09, 0.04), rot=(0, 0.004 * (k - 1), 0), bev=0.006, grain="long")
    for s in (-1, 1):  # door frame
        box(f"timber_doorpost_{s}", M["timber"], coll, (door_x + s * (door_w / 2 + 0.06), (H - 0.7) / 2, -3.5), (0.12, H - 0.7, 0.16), rot=(0, 0, 0.01 * s), bev=0.015, grain="long")
    box("timber_doorhead", M["timber"], coll, (door_x, H - 0.68, -3.5), (door_w + 0.3, 0.14, 0.18), bev=0.015, grain="long")
    # front wall (hidden while the menus look in; shown while exploring)
    box("front_wall", M["plank"], coll, (0, H / 2, 3.55), (8.2, H, 0.08), bev=0.006)

    # --- bed: salvaged steel cot, mattress, faded blanket ---
    bx, bz = -2.9, -1.4
    for sx in (-0.48, 0.48):
        cylinder(f"cot_rail_{sx}", M["steel"], coll, (bx + sx, 0.32, bz - 1.02), (bx + sx, 0.32, bz + 1.02), 0.022)
        for sz in (-1.0, 1.0):
            cylinder(f"cot_leg_{sx}_{sz}", M["steel"], coll, (bx + sx, 0.0, bz + sz), (bx + sx, 0.32, bz + sz), 0.02)
    for sz in (-1.02, 1.02):
        cylinder(f"cot_end_{sz}", M["steel"], coll, (bx - 0.5, 0.32, bz + sz), (bx + 0.5, 0.32, bz + sz), 0.022)
    cylinder("cot_headbar", M["steel"], coll, (bx - 0.5, 0.62, bz - 1.02), (bx + 0.5, 0.62, bz - 1.02), 0.02)
    for sx in (-0.48, 0.48):
        cylinder(f"cot_headpost_{sx}", M["steel"], coll, (bx + sx, 0.32, bz - 1.02), (bx + sx, 0.62, bz - 1.02), 0.02)
    mat_ = box("mattress", M["mattress"], coll, (bx, 0.42, bz), (0.92, 0.17, 1.98), bev=0.06, soft=True)
    box("blanket", M["blanket"], coll, (bx + 0.03, 0.52, bz + 0.25), (1.0, 0.05, 1.35), rot=(0.01, 0.03, 0.02), bev=0.025, soft=True)
    box("pillow", M["mattress"], coll, (bx, 0.56, bz - 0.78), (0.58, 0.12, 0.32), rot=(0.08, 0, 0.05), bev=0.05, soft=True)
    # boots by the bed
    for k, dx in enumerate((0, 0.16)):
        box(f"boot_{k}", M["canvas"], coll, (bx + 0.62 + dx, 0.08, bz + 0.7), (0.12, 0.16, 0.3), rot=(0, 0, 0.3 * (k - 0.5)), soft=True, puff=0.25)

    # --- nightstand: an ammo crate, a lamp and a mug ---
    nx, nz = -3.4, 0.2
    box("crate_nightstand", M["plank"], coll, (nx, 0.3, nz), (0.5, 0.6, 0.5), rot=(0, 0, 0.12), bev=0.02)
    cylinder("lamp_bed_stem", M["dark"], coll, (nx, 0.6, nz), (nx, 0.82, nz), 0.012)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=0.15, radius2=0.08, depth=0.16)
    mesh_obj("lamp_bed_shade", bm, M["canvas"], coll, g2b(nx, 0.88, nz))["uv"] = "box"
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.035)
    mesh_obj("lamp_bed_bulb", bm, M["bulb"], coll, g2b(nx, 0.86, nz))["uv"] = "box"
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.042, radius2=0.042, depth=0.1)
    mesh_obj("mug", bm, M["steel"], coll, g2b(nx + 0.14, 0.65, nz - 0.1))["uv"] = "box"

    # --- the stash locker (interactive): dented steel, two doors, vents ---
    lx, lz = 3.4, -2.6
    box("locker", M["steel_locker"], coll, (lx, 1.0, lz), (0.6, 2.0, 0.8), rot=(0, 0, 0.0), bev=0.02)
    box("locker_seam", M["dark"], coll, (lx - 0.302, 1.0, lz), (0.006, 1.86, 0.012), bev=0)
    for s in (-1, 1):
        for k in range(6):
            box(f"locker_vent_{s}_{k}", M["dark"], coll, (lx - 0.302, 1.7 + k * 0.035, lz + s * 0.2), (0.006, 0.012, 0.22), bev=0)
        box(f"locker_handle_{s}", M["bare"], coll, (lx - 0.32, 1.05, lz + s * 0.06), (0.03, 0.16, 0.025), bev=0.006)
    plane("locker_stash_plate", M["stash"], coll, (lx - 0.305, 1.42, lz), 0.4, 0.15, (R90, 0, -R90))
    box("locker_tag_amber", M["bulb"], coll, (lx - 0.31, 1.3, lz + 0.3), (0.01, 0.03, 0.03), bev=0)

    # --- footlocker: timber trunk with steel corners ---
    fx, fz = 2.6, 0.6
    box("footlocker", M["plank"], coll, (fx, 0.22, fz), (1.1, 0.44, 0.6), bev=0.02)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(f"footlocker_corner_{sx}_{sz}", M["steel"], coll, (fx + sx * 0.53, 0.22, fz + sz * 0.28), (0.07, 0.46, 0.07), bev=0.01)
    box("footlocker_hasp", M["bare"], coll, (fx, 0.36, fz + 0.305), (0.08, 0.1, 0.02), bev=0.005)
    # gear repair in progress on the lid: a pack, a tape roll, a spool
    pr = (0, 0, 0.4)
    box("pack_repair", M["canvas"], coll, (fx - 0.15, 0.62, fz), (0.36, 0.36, 0.22), rot=pr, soft=True, puff=0.2)
    box("pack_repair_flap", M["canvas"], coll, (fx - 0.15, 0.79, fz + 0.02), (0.37, 0.05, 0.24), rot=pr, soft=True, puff=0.2)
    for k, dx in enumerate((-0.09, 0.09)):
        box(f"pack_repair_strap_{k}", M["dark"], coll, (fx - 0.15 + dx * math.cos(0.4), 0.66, fz + 0.115 + dx * math.sin(0.4)), (0.035, 0.3, 0.01), rot=pr, bev=0.003)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.05, radius2=0.05, depth=0.05)
    mesh_obj("tape_roll", bm, M["mattress"], coll, g2b(fx + 0.3, 0.465, fz + 0.1))["uv"] = "box"

    # --- the mirror (interactive) on the east wall, braced by a timber post ---
    mx, mz = 3.86, 2.45
    plane("mirror_glass", M["glass"], coll, (mx - 0.01, 1.02, mz), 0.78, 1.75, (R90, 0, -R90))
    for k, (dy, dz, sy, sz) in enumerate(((0, -0.43, 1.87, 0.08), (0, 0.43, 1.87, 0.08), (0.91, 0, 0.08, 0.94), (-0.91, 0, 0.08, 0.94))):
        box(f"mirror_frame_{k}", M["timber"], coll, (mx + 0.01, 1.02 + dy, mz + dz), (0.06, sy, sz), bev=0.01, grain="long")
    plane("mirror_tape", M["mattress"], coll, (mx - 0.015, 1.6, mz + 0.2), 0.22, 0.035, (R90 + 0.6, 0, -R90))
    box("mirror_rail", M["timber"], coll, (mx - 0.02, 1.75, mz - 0.95), (0.05, 0.06, 0.6), bev=0.01, grain="long")
    box("mirror_vanity_lamp", M["steel"], coll, (mx - 0.08, 2.05, mz), (0.14, 0.05, 0.32), bev=0.01)
    box("mirror_vanity_strip", M["bulb"], coll, (mx - 0.12, 2.025, mz), (0.06, 0.01, 0.26), bev=0)

    # --- weapon rack on the plank wall (the game hangs your second weapon here) ---
    for k, y in enumerate((1.45, 1.95)):
        box(f"rack_board_{k}", M["timber"], coll, (-0.4, y, -3.42), (1.4, 0.08, 0.1), bev=0.012, grain="long")
        for px in (-0.55, 0.55):
            cylinder(f"rack_peg_{k}_{px}", M["bare"], coll, (-0.4 + px, y + 0.02, -3.38), (-0.4 + px, y + 0.02, -3.26), 0.012)

    # --- the topside monitor: a porthole screen on the plank wall ---
    wx, wy, wz = 2.6, 2.15, -3.43
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=40, radius=0.72)
    o = mesh_obj("monitor_screen", bm, M["screen"], coll, g2b(wx, wy, wz + 0.02), (R90, 0, 0), smooth=False)
    me = o.data
    me.uv_layers.new()
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            me.uv_layers[0].data[li].uv = (co.x / 1.44 + 0.5, co.y / 1.44 + 0.5)
    o["uv"] = "keep"
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=40, radius1=0.8, radius2=0.8, depth=0.1)
    mesh_obj("monitor_frame", bm, M["steel"], coll, g2b(wx, wy, wz), (R90, 0, 0))["uv"] = "box"
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=0.8, radius2=0.8, depth=0.02)
    o = mesh_obj("monitor_back", bm, M["dark"], coll, g2b(wx, wy, wz - 0.05), (R90, 0, 0))
    o["uv"] = "box"

    # --- signboard, posters, tally marks, photo ---
    plane("sign_sanctuary", M["sign"], coll, (0.2, 2.85, -3.45), 2.2, 0.55, (R90, 0, 0))
    plane("poster_dustline", M["poster_dustline"], coll, (-3.86, 1.75, 2.2), 0.7, 1.0, (R90, 0, R90 - 0.02))
    plane("poster_plating", M["poster_plating"], coll, (3.86, 1.75, 0.3), 0.7, 1.0, (R90, 0.03, -R90))
    plane("decal_tally", M["tally"], coll, (-3.0, 1.0, -3.455), 0.8, 0.4, (R90, 0, 0))
    plane("photo_family", M["photo"], coll, (-3.6, 1.15, -3.455), 0.18, 0.135, (R90, 0.05, 0))

    # --- rug ---
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=48, radius=1.35)
    o = mesh_obj("rug", bm, M["rug"], coll, g2b(0.1, 0.015, 0.3), (0, 0, 0.3), smooth=False)
    o["uv"] = "box"

    # --- plant in a rusted can ---
    px, pz = -3.35, 2.75
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.17, radius2=0.19, depth=0.36)
    mesh_obj("plant_can", bm, M["steel"], coll, g2b(px, 0.18, pz))["uv"] = "box"
    for k in range(9):
        ang = k / 9 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        tilt = rng.uniform(0.4, 0.9)
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=4, size=0.5)
        for v in bm.verts:
            t = v.co.y + 0.5
            v.co.x *= 0.09 * math.sin(math.pi * min(1.0, t * 1.1)) + 0.01
            v.co.y = t * 0.55
            v.co.z = -0.12 * t * t
        o = mesh_obj(f"plant_leaf_{k}", bm, M["leaf"], coll, g2b(px, 0.36, pz), (tilt, 0, ang))
        o["uv"] = "box"

    # --- the caged work lamp over the room, and the string lights ---
    lampx, lampy, lampz = 0.0, H - 0.6, 0.4
    cylinder("lamp_main_cord", M["dark"], coll, (lampx, lampy + 0.1, lampz), (lampx, H, lampz), 0.008)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=0.2, radius2=0.06, depth=0.14)
    mesh_obj("lamp_main_shade", bm, M["steel"], coll, g2b(lampx, lampy + 0.07, lampz))["uv"] = "box"
    for k, dy in enumerate((-0.04, -0.12)):  # the wire cage: rings of short wire segments
        ring = [(lampx + 0.1 * math.cos(a), lampy + dy, lampz + 0.1 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 13)]
        for j in range(12):
            cylinder(f"lamp_main_cage_{k}_{j}", M["dark"], coll, ring[j], ring[j + 1], 0.005, segments=5, bev=0)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.06)
    mesh_obj("lamp_main_bulb", bm, M["bulb"], coll, g2b(lampx, lampy - 0.02, lampz))["uv"] = "box"

    bulbs = []
    for s, (a, b) in enumerate((((-3.7, H - 0.3, -1.4), (3.7, H - 0.3, -1.4)), ((-3.7, H - 0.3, 1.4), (3.2, H - 0.32, 1.4)))):
        pts = catenary(a, b, 0.35, 22)
        for k in range(len(pts) - 1):
            cylinder(f"string_wire_{s}_{k}", M["dark"], coll, pts[k], pts[k + 1], 0.004, segments=5, bev=0)
        for k in range(1, len(pts) - 1, 2):
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.017)
            mesh_obj(f"string_bulb_{s}_{k}", bm, M["bulb"], coll, g2b(pts[k][0], pts[k][1] - 0.04, pts[k][2]))["uv"] = "box"
            bulbs.append(pts[k])
    return coll, bulbs


# ---------- lights (positions carry into Godot; brightness is retuned there) ----------

def add_light(name, kind, pos, color, watts, radius=0.05, coll=None, **kw):
    ld = bpy.data.lights.new(name, kind)
    ld.color = color
    ld.energy = watts
    if hasattr(ld, "shadow_soft_size"):
        ld.shadow_soft_size = radius
    for k, v in kw.items():
        setattr(ld, k, v)
    o = bpy.data.objects.new(name, ld)
    o.location = g2b(*pos)
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def lights(coll, bulbs):
    warm = (1.0, 0.66, 0.38)  # ~2700K
    add_light("light_lamp_main", "POINT", (0.0, H - 0.68, 0.4), warm, 520, 0.06, coll)
    add_light("light_lamp_bed", "POINT", (-3.4, 0.86, 0.2), warm, 60, 0.04, coll)
    add_light("light_vanity", "POINT", (3.7, 2.0, 2.45), (1.0, 0.72, 0.48), 45, 0.08, coll)
    add_light("light_locker_tag", "POINT", (3.05, 1.3, -2.3), (1.0, 0.6, 0.3), 1.5, 0.02, coll)
    # string lights: one real light per ~5 bulbs (art bible 8.6)
    for k in range(0, len(bulbs), 5):
        x, y, z = bulbs[k]
        add_light(f"light_string_{k}", "POINT", (x, y - 0.06, z), warm, 35, 0.03, coll)
    # the topside monitor throws a little pale, cold light: the only cool light in the room
    add_light("light_monitor", "AREA", (2.6, 2.15, -3.3), (0.85, 0.9, 1.0), 10, coll=coll, size=1.2)


# ---------- preview render ----------

def setup_render(out_png, cam_pos, look_at, fov=48.0, res=(1280, 720), samples=64):
    scn = bpy.context.scene
    cam = scn.camera
    if cam is None:
        cd = bpy.data.cameras.new("preview_cam")
        cam = bpy.data.objects.new("preview_cam", cd)
        scn.collection.objects.link(cam)
        scn.camera = cam
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = math.radians(fov)
    cam.location = g2b(*cam_pos)
    d = g2b(*look_at) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.filepath = out_png
    scn.view_settings.view_transform = "AgX"
    w = scn.world or bpy.data.worlds.new("world")
    scn.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.09, 0.05, 0.025, 1)  # warm brown fill: shadows brown, never black
    bg.inputs[1].default_value = 1.0
    scn.view_settings.exposure = 0.4
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(WORK, exist_ok=True)
    pics = make_pictures()
    coll, bulbs = build(pics)
    for o in list(coll.objects):
        finalize(o)
    lights(coll, bulbs)
    tris = sum(len(p.vertices) - 2 for o in coll.objects if o.type == "MESH" for p in o.data.polygons)
    mats = {s.material.name for o in coll.objects if o.type == "MESH" for s in o.material_slots if s.material}
    print(f"objects {len(coll.objects)}  triangles {tris}  materials {len(mats)}")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "env_sanctuary_quarters.blend"))
    if DO_RENDER:
        bpy.data.objects["front_wall"].hide_render = True
        setup_render(os.path.join(WORK, "preview_front.png"), (0.6, 1.75, 4.6), (-0.2, 1.3, -3.2))
        setup_render(os.path.join(WORK, "preview_corner.png"), (-2.6, 1.7, 2.6), (3.0, 1.1, -1.5))
    if DO_EXPORT:
        os.makedirs(MODELS, exist_ok=True)
        bpy.ops.object.select_all(action="DESELECT")
        for o in coll.objects:
            o.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(MODELS, "env_sanctuary_quarters.glb"),
            export_format="GLB", use_selection=True, export_apply=True,
            export_yup=True, export_tangents=True, export_lights=True,
            export_image_format="NONE", export_materials="EXPORT",
        )


if __name__ == "__main__":
    main()
