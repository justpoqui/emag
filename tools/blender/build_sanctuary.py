"""Builds the rest of the Patron's Sanctuary in Blender: the hallway, the
Trade Hall, the Workshop, the Checkout and the Lift.

Same kit and rules as build_quarters.py (design/art/art-bible.md): the old
mine underneath (hewn rock, timber sets), the survivor town on top (plank,
salvaged steel, painted boards, cloth), warm lamps with brown shadows, neon
only in amber, sodium or dusty rose, and Lift Teal only at the lift (the way
out). Footprints and interaction spots match src/sanctuary.js.

Run with the Blender Python module (bpy):
    python tools/blender/build_sanctuary.py <work dir> [--rooms a,b] [--render] [--export]
Rooms: hallway, trade_hall, workshop, checkout, lift (default: all).
--export writes godot/models/sanctuary/env_sanctuary_<room>.gltf (+ .bin)
and godot/scenes/sanctuary/lights_<room>.tscn (that room's lamps for Godot).
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402  (first: it makes bmesh and mathutils importable)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

import build_quarters as kit  # noqa: E402

ROOT = kit.ROOT
TEX = kit.TEX
H = kit.H
R90 = math.pi / 2
SCENES = os.path.join(ROOT, "godot", "scenes", "sanctuary")
rng = np.random.default_rng(11)
ROOMS = ["hallway", "trade_hall", "workshop", "checkout", "lift"]
WARM = (1.0, 0.66, 0.38)
LIGHTS = {}  # room -> [(name, kind, pos, colour, watts, extra)]


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


# ---------- pictures: painted boards, neon, the map board, notices ----------

def font(size, bold=True):
    return ImageFont.truetype(kit.FONT if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)


def noise_img(w, h, cells, seed):
    g = np.random.default_rng(seed).random((max(2, int(cells[1])), max(2, int(cells[0]))))
    return np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(float) / 255


def save_set(key, col, height, rough, strength=6.0):
    du = np.roll(height, -1, 1) - np.roll(height, 1, 1)
    dv = np.roll(height, -1, 0) - np.roll(height, 1, 0)
    n = np.stack([-du * strength, dv * strength, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, f"{key}_albedo.png"))
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(TEX, f"{key}_normal.png"))
    orm = np.stack([np.ones_like(rough), np.clip(rough, 0, 1), np.zeros_like(rough)], -1)
    Image.fromarray((orm * 255).astype(np.uint8)).save(os.path.join(TEX, f"{key}_orm.png"))


def painted_board(key, lines, w=1024, h=256, paint=(0.19, 0.22, 0.2), seed=1):
    """A hand-painted signboard: horizontal boards, dark paint worn to wood at
    the edges, letters placed by hand. lines = [(text, y 0..1, px, (r,g,b))]."""
    yy, xx = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    grain = 0.6 * noise_img(w, h, (6, 40), seed) + 0.4 * noise_img(w, h, (30, 160), seed + 1)
    nb = max(1, round(h / 85))
    seam = np.clip((np.abs((yy * nb) % 1.0 - 0.5) * 2 - 0.93) / 0.06, 0, 1)
    wood = np.stack([0.3 + 0.12 * grain, 0.23 + 0.09 * grain, 0.16 + 0.06 * grain], -1)
    chips = 0.6 * noise_img(w, h, (14, 6), seed + 2) + 0.4 * noise_img(w, h, (70, 30), seed + 3)
    edge = np.clip(np.minimum(np.minimum(xx, 1 - xx) * 8, np.minimum(yy, 1 - yy) * 4), 0, 1)
    keep = np.clip((chips - 0.35 + 0.25 * edge) * 6, 0, 1)
    col = wood * (1 - keep[..., None]) + np.array(paint) * (0.92 + 0.12 * grain)[..., None] * keep[..., None]
    lt = np.zeros((h, w))
    r = np.random.default_rng(seed + 4)
    for text, yf, px, c in lines:
        m = Image.new("L", (w, h), 0)
        f = font(px)
        widths = [f.getlength(ch) for ch in text]
        x = w / 2 - sum(widths) / 2
        for ch, cw in zip(text, widths):
            if ch != " ":
                g = Image.new("L", (int(px * 1.6), int(px * 1.6)), 0)
                ImageDraw.Draw(g).text((g.width / 2, g.height / 2), ch, font=f, fill=255, anchor="mm")
                g = g.rotate(r.uniform(-2.5, 2.5), resample=Image.BICUBIC)
                m.paste(g, (int(x + cw / 2 - g.width / 2), int(yf * h - g.height / 2 + r.uniform(-2, 2))), g)
            x += cw
        a = np.asarray(m.filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255
        a = np.clip((a - 0.5) * 3 + 0.5, 0, 1) * np.clip((chips - 0.2) * 5, 0, 1)
        col = col * (1 - a[..., None]) + np.array(c) * (0.85 + 0.2 * grain)[..., None] * a[..., None]
        lt = np.maximum(lt, a)
    col *= (1 - 0.55 * seam)[..., None]
    col *= (1 - 0.3 * np.clip(noise_img(w, h, (3, 2), seed + 5) - 0.45, 0, 1))[..., None]  # soot
    save_set(key, col, 0.5 * grain + 0.25 * keep + 0.15 * lt - 0.8 * seam, 0.86 - 0.14 * keep)


def neon_texture(key, text, colour, w=512, h=128, px=78):
    """Neon tube lettering on a dark backing: the albedo doubles as emission."""
    c = np.array(colour)
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).text((w / 2, h / 2), text, font=font(px), fill=255, anchor="mm")
    core = np.asarray(glow.filter(ImageFilter.GaussianBlur(1.0))).astype(float) / 255
    tube = np.asarray(glow.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(5))).astype(float) / 255
    base = np.full((h, w, 3), 0.04)
    col = base + c * tube[..., None] * 0.6 + (c * 0.6 + 0.4) * core[..., None]
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, f"{key}_albedo.png"))


def map_board_texture():
    """The Checkout's survey map of the Dustline: worn paper, ink roads,
    district names, the four lifts, pins and string."""
    W = 1024
    r = np.random.default_rng(71)
    paper = np.stack([0.82, 0.77, 0.66]) * (0.9 + 0.12 * noise_img(W, W, (8, 8), 72))[..., None]
    paper *= (1 - 0.25 * np.clip(noise_img(W, W, (5, 5), 73) - 0.55, 0, 1) * 2)[..., None]  # stains
    im = Image.fromarray((np.clip(paper, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    ink = (52, 46, 40)
    for _ in range(14):  # contour lines
        cx, cy, rad = r.uniform(0, W), r.uniform(0, W), r.uniform(60, 260)
        d.ellipse((cx - rad, cy - rad * 0.7, cx + rad, cy + rad * 0.7), outline=(150, 136, 110), width=2)
    d.line((60, 520, 960, 500), fill=ink, width=10)  # the crossroads
    d.line((510, 60, 520, 960), fill=ink, width=10)
    d.line((520, 500, 820, 820), fill=ink, width=5)
    for x, y, name in ((430, 430, "TOWN"), (250, 260, "CONTAINER YARD"), (760, 300, "HUSK HULL"),
                       (300, 780, "CRUCIBLE WORKS"), (800, 800, "REFINERY"), (760, 600, "FARMLAND")):
        d.text((x, y), name, font=font(30), fill=ink, anchor="mm")
    for x, y in ((120, 160), (900, 120), (880, 880), (140, 900)):  # lifts
        d.polygon([(x, y - 22), (x - 20, y + 14), (x + 20, y + 14)], outline=ink, width=5)
    pins = [(430, 470), (300, 820), (770, 340), (810, 840)]
    for a, b in zip(pins, pins[1:]):
        d.line((*a, *b), fill=(150, 70, 52), width=3)
    for x, y in pins:
        d.ellipse((x - 11, y - 11, x + 11, y + 11), fill=(150, 70, 52))
    d.text((W / 2, 40), "THE DUSTLINE · SURVEY", font=font(40), fill=ink, anchor="mm")
    a = np.asarray(im).astype(float) / 255
    a *= (0.85 + 0.15 * noise_img(W, W, (60, 60), 74))[..., None]
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, "map_board_albedo.png"))


def paper_texture(key, title, lines, seed, w=256, h=320, colour=(0.86, 0.82, 0.72)):
    im = Image.new("RGB", (w, h), tuple(int(c * 255) for c in colour))
    d = ImageDraw.Draw(im)
    d.text((w / 2, 34), title, font=font(26), fill=(44, 38, 32), anchor="mm")
    r = np.random.default_rng(seed)
    y = 74
    for ln in lines:
        d.text((18, y), ln, font=font(17, bold=False), fill=(60, 52, 44))
        if ln.startswith("~"):
            d.line((16, y + 10, 18 + 9.5 * len(ln), y + 8 + r.uniform(-3, 3)), fill=(120, 50, 40), width=3)
        y += 26
    a = np.asarray(im).astype(float) / 255
    a *= (0.88 + 0.12 * noise_img(w, h, (6, 7), seed))[..., None]
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, f"{key}_albedo.png"))


def scorch_texture():
    """Scorch on rock: soot black at the heart, fading out in ragged licks."""
    W = 512
    yy, xx = np.mgrid[0:W, 0:W] / W - 0.5
    rad = np.sqrt(xx ** 2 + (yy * 1.2) ** 2) * 2
    n = 0.6 * noise_img(W, W, (8, 8), 81) + 0.4 * noise_img(W, W, (30, 30), 82)
    a = np.clip((1 - rad) * 1.6 + (n - 0.5) * 1.2, 0, 1) ** 1.5
    col = np.stack([np.full((W, W), 0.06), np.full((W, W), 0.05), np.full((W, W), 0.04)], -1)
    rgba = np.dstack([(col * 255).astype(np.uint8), (np.clip(a * 1.3, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").save(os.path.join(TEX, "decal_scorch_albedo.png"))


def make_room_pictures():
    painted_board("sign_trade_hall", [("TRADE HALL", 0.55, 120, (0.87, 0.81, 0.71))], seed=11)
    painted_board("sign_workshop", [("WORKSHOP", 0.55, 120, (0.87, 0.81, 0.71))], seed=12)
    painted_board("sign_checkout_door", [("CHECKOUT", 0.55, 120, (0.87, 0.81, 0.71))], seed=13)
    painted_board("sign_lift", [("LIFT  >  TOPSIDE", 0.55, 104, (0.87, 0.81, 0.71))], paint=(0.16, 0.24, 0.23), seed=14)
    painted_board("sign_quarters", [("YOUR QUARTERS", 0.55, 96, (0.82, 0.76, 0.66))], paint=(0.24, 0.18, 0.13), seed=15)
    painted_board("sign_checkout", [("CHECKOUT", 0.4, 116, (0.87, 0.81, 0.71)), ("PICK YOUR DROP  ·  SIGN OUT", 0.78, 44, (0.78, 0.62, 0.42))], seed=16)
    for i, (who, what) in enumerate((("TOBIAS", "GUNSMITH"), ("NIA", "MEDIC"), ("PELL", "SCRAP BUYER"))):
        painted_board(f"sign_trader_{i}", [(who, 0.4, 110, (0.87, 0.81, 0.71)), (what, 0.78, 48, (0.78, 0.62, 0.42))], w=768, seed=20 + i)
    benches = ("WEAPONS", "AMMO", "SHIELDS", "MEDICAL", "EXPLOSIVES", "REPAIR", "SALVAGE")
    for i, b in enumerate(benches):
        painted_board(f"sign_bench_{i}", [(b, 0.55, 100 if len(b) < 9 else 84, (0.87, 0.81, 0.71))], w=640, h=200, seed=30 + i)
    painted_board("sign_notices", [("NOTICES", 0.5, 120, (0.87, 0.81, 0.71))], w=768, h=200, paint=(0.24, 0.18, 0.13), seed=40)
    for key, text, c in (("neon_noodles", "NOODLES", (0.85, 0.34, 0.48)), ("neon_bunks", "BUNKS", (0.91, 0.58, 0.23)),
                         ("neon_clinic", "CLINIC", (0.94, 0.7, 0.35)), ("neon_water", "WATER · RATION", (0.91, 0.58, 0.23)),
                         ("neon_radio", "RADIO & PARTS", (0.85, 0.34, 0.48)), ("neon_market", "MARKET", (0.91, 0.58, 0.23))):
        neon_texture(key, text, c, px=78 if len(text) < 9 else 56)
    map_board_texture()
    paper_texture("paper_notice_1", "RATIONS", ["Thursday, after shift", "Bring your own tin", "No tin, no ration"], 91)
    paper_texture("paper_notice_2", "LIFT CREW", ["Wanted: 2 hands", "Ask at Checkout", "Pay in scrap"], 92)
    paper_texture("paper_notice_3", "CURFEW 22:00", ["Lamps out on the street", "Keep the shaft quiet"], 93)
    paper_texture("paper_signout", "SIGNED OUT", ["M. Okoro   GOLDEN", "~ R. Vance   NIGHT", "T. Hale    STORM", "~ J. Ash    NIGHT", "D. Mori    GOLDEN", "~ K. Bell   STORM"], 94)
    paper_texture("paper_drops", "TODAY'S DROPS", ["GOLDEN HOUR  standard", "NIGHT RAID   rich, crowded", "DUST STORM   short sight"], 95, colour=(0.2, 0.19, 0.16))
    scorch_texture()


# ---------- building blocks ----------

def rock_wall(name, M, coll, axis, coord, a0, a1, facing, doors=(), door_h=2.6, depth=0.12, seed=1):
    """A hewn rock wall from a0 to a1 along `axis` ('x' or 'z') at `coord`,
    facing +1/-1 along the other axis, with door openings [(centre, width)]."""
    pieces = []
    cur = a0
    for at, w in sorted(doors):
        if at - w / 2 > cur:
            pieces.append((cur, at - w / 2, 0.0, H))
        pieces.append((at - w / 2, at + w / 2, door_h, H))
        cur = at + w / 2
    if a1 > cur:
        pieces.append((cur, a1, 0.0, H))
    for k, (p0, p1, y0, y1) in enumerate(pieces):
        mid, w, hgt, cy = (p0 + p1) / 2, p1 - p0, y1 - y0 + 0.1, (y0 + y1) / 2
        if axis == "x":
            pos = (mid, cy, coord)
            rot = (R90, 0, 0) if facing > 0 else (R90, 0, math.pi)
        else:
            pos = (coord, cy, mid)
            rot = (R90, 0, R90) if facing > 0 else (R90, 0, -R90)
        kit.displaced_panel(f"{name}_{k}", M["rock"], coll, pos, w + 0.1, hgt, rot, depth=depth, seed=seed + k)


def floor_ceiling(name, M, coll, x0, x1, z0, z1, floor_mat="earth", seed=1):
    cx, cz, w, d = (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 0.2, z1 - z0 + 0.2
    kit.displaced_panel(f"{name}_floor", M[floor_mat], coll, (cx, 0.0, cz), w, d, (0, 0, 0), step=0.12,
                        depth=0.03, seed=seed, facet=0.6, lumps=False, tilt=0.02, edge=0.15)
    kit.displaced_panel(f"{name}_ceiling", M["rock_ceiling"], coll, (cx, H, cz), w, d, (math.pi, 0, 0), step=0.09,
                        depth=0.22, seed=seed + 1)


def door_portal(name, M, coll, axis, at, coord, depth, w=1.8, h=2.6):
    """A timber mine portal lining a door through a thick rock wall."""
    t = 0.14
    for s in (-1, 1):
        if axis == "x":
            kit.box(f"{name}_post_{s}", M["timber"], coll, (at + s * (w / 2 + t / 2), h / 2, coord), (t, h, depth), rot=(0, 0, 0.012 * s), bev=0.02, grain="long")
        else:
            kit.box(f"{name}_post_{s}", M["timber"], coll, (coord, h / 2, at + s * (w / 2 + t / 2)), (depth, h, t), bev=0.02, grain="long")
    if axis == "x":
        kit.box(f"{name}_head", M["timber"], coll, (at, h + 0.09, coord), (w + 2 * t + 0.1, 0.18, depth + 0.04), bev=0.02, grain="long")
    else:
        kit.box(f"{name}_head", M["timber"], coll, (coord, h + 0.09, at), (depth + 0.04, 0.18, w + 2 * t + 0.1), bev=0.02, grain="long")


def mine_set(name, M, coll, x, z0, z1, braces=True):
    """Post, cap, post across a tunnel (along z), slightly out of true."""
    lean = rng.uniform(-0.02, 0.02)
    for k, z in enumerate((z0, z1)):
        kit.box(f"{name}_post{k}", M["timber"], coll, (x, H / 2 - 0.05, z), (0.2, H - 0.1, 0.18), rot=(lean, 0, rng.uniform(-0.015, 0.015)), bev=0.025, grain="long")
    kit.box(f"{name}_cap", M["timber"], coll, (x, H - 0.16, (z0 + z1) / 2), (0.2, 0.22, abs(z1 - z0) + 0.25), rot=(0, rng.uniform(-0.01, 0.01), 0), bev=0.025, grain="long")
    if braces:
        for k, (z, r) in enumerate(((min(z0, z1) + 0.3, 0.75), (max(z0, z1) - 0.3, -0.75))):
            kit.box(f"{name}_brace{k}", M["timber"], coll, (x, H - 0.48, z), (0.12, 0.62, 0.1), rot=(r, 0, 0), bev=0.012, grain="long")


def work_lamp(name, M, coll, x, y, z, room, watts=260, cord_top=H):
    """A caged work lamp hanging on its cord, plus its light."""
    kit.cylinder(f"{name}_cord", M["dark"], coll, (x, y + 0.1, z), (x, cord_top, z), 0.008)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=0.2, radius2=0.06, depth=0.14)
    kit.mesh_obj(f"{name}_shade", bm, M["steel"], coll, kit.g2b(x, y + 0.07, z))["uv"] = "box"
    for k, dy in enumerate((-0.04, -0.12)):
        ring = [(x + 0.1 * math.cos(a), y + dy, z + 0.1 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 13)]
        for j in range(12):
            kit.cylinder(f"{name}_cage_{k}_{j}", M["dark"], coll, ring[j], ring[j + 1], 0.005, segments=5, bev=0)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.06)
    kit.mesh_obj(f"{name}_bulb", bm, M["bulb"], coll, kit.g2b(x, y - 0.02, z))["uv"] = "box"
    light(room, f"{name}_light", "POINT", (x, y - 0.08, z), WARM, watts, coll=coll)


def string_lights(name, M, coll, room, pts_pairs, sag=0.3, every=5, watts=30):
    bulbs = []
    for s, (a, b) in enumerate(pts_pairs):
        n = max(4, int(math.dist(a, b) / 0.35))
        pts = kit.catenary(a, b, sag, n)
        for k in range(len(pts) - 1):
            kit.cylinder(f"{name}_wire_{s}_{k}", M["dark"], coll, pts[k], pts[k + 1], 0.004, segments=5, bev=0)
        for k in range(1, len(pts) - 1, 2):
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.017)
            kit.mesh_obj(f"{name}_bulb_{s}_{k}", bm, M["bulb"], coll, kit.g2b(pts[k][0], pts[k][1] - 0.04, pts[k][2]))["uv"] = "box"
            bulbs.append(pts[k])
    for k in range(every // 2, len(bulbs), every):  # one real light per `every` bulbs
        x, y, z = bulbs[k]
        light(room, f"{name}_light_{k}", "POINT", (x, y - 0.06, z), WARM, watts, coll=coll)


def board(name, mat, coll, pos, w, h, facing_rot, timber=None, thick=0.05, tilt=0.0):
    """A painted board: a timber backing with the painted face on the front."""
    x, y, z = pos
    rx, ry, rz = facing_rot
    if timber is not None:
        kit.box(f"{name}_board", timber, coll, pos, (w + 0.04, h + 0.04, thick) if abs(rz) < 0.01 or abs(abs(rz) - math.pi) < 0.01 else (thick, h + 0.04, w + 0.04),
                rot=(tilt, 0, 0), bev=0.01, grain="long")
    off = thick / 2 + 0.002
    if abs(rz) < 0.01:
        fz = (x, y, z + off)
    elif abs(abs(rz) - math.pi) < 0.01:
        fz = (x, y, z - off)
    elif rz > 0:
        fz = (x + off, y, z)
    else:
        fz = (x - off, y, z)
    kit.plane(f"{name}_face", mat, coll, fz, w, h, (rx + tilt, ry, rz))


_neon_font = None


def neon_sign(name, text, colour, coll, room, pos, facing, size=0.26):
    """A handmade neon sign hung from the ceiling: glass tube bent along the
    letters (with a hand-made wobble), on a scrap plank backing, on two
    chains. facing: Blender Z rotation (0 faces game +z, pi faces -z,
    -pi/2 faces -x)."""
    global _neon_font
    if _neon_font is None:
        _neon_font = bpy.data.fonts.load(kit.FONT)
    x, y, z = pos
    cu = bpy.data.curves.new(f"{name}_text", "FONT")
    cu.body = text
    cu.font = _neon_font
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.fill_mode = "NONE"
    cu.bevel_depth = 0.0075
    cu.bevel_resolution = 2
    cu.resolution_u = 6
    tobj = bpy.data.objects.new(f"{name}_tmp", cu)
    coll.objects.link(tobj)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tobj.evaluated_get(dg), depsgraph=dg)
    width = tobj.dimensions.x
    coll.objects.unlink(tobj)
    bpy.data.objects.remove(tobj)
    r = np.random.default_rng(abs(hash(name)) % 2 ** 32)
    phase = r.uniform(0, 6, 4)
    for v in me.vertices:  # bent by hand: a slow wobble, never quite straight
        v.co.x += 0.003 * math.sin(v.co.y * 31 + phase[0]) + 0.002 * math.sin(v.co.x * 17 + phase[1])
        v.co.y += 0.003 * math.sin(v.co.x * 23 + phase[2])
        v.co.z += 0.004 * math.sin(v.co.x * 9 + phase[3])
    mat = kit.pbr(f"mat_neon_{name}", None, tint=tuple(0.3 + 0.7 * c for c in colour), emission=colour, emission_strength=14.0, rough=0.15)
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    off = 0.05  # tubes stand off the backing on little clips
    fx, fz = {0: (0, off), 1: (0, -off), 2: (-off, 0)}[{0.0: 0, round(math.pi, 3): 1}.get(round(abs(facing), 3), 2)]
    t = bpy.data.objects.new(f"{name}_tube", me)
    t.location = kit.g2b(x + fx, y, z + fz)
    t.rotation_euler = (R90, 0, facing)
    coll.objects.link(t)
    t["uv"] = "box"
    w, hgt = width + 0.24, size * 1.5
    along_x = abs(fx) < 1e-6
    kit.box(f"{name}_backing", M_TIMBER, coll, (x, y, z), (w, hgt, 0.035) if along_x else (0.035, hgt, w),
            rot=(0, 0, r.uniform(-0.02, 0.02)), bev=0.008, grain="long")
    for s in (-1, 1):
        cx = x + (s * w * 0.38 if along_x else 0)
        cz = z + (0 if along_x else s * w * 0.38)
        kit.cylinder(f"{name}_chain{s}", M_DARK, coll, (cx, y + hgt / 2, cz), (cx, H - 0.02, cz), 0.006, segments=6, bev=0)
    kit.box(f"{name}_transformer", M_DARK, coll, (x + (0.0 if along_x else 0), y - hgt / 2 - 0.08, z), (0.14, 0.09, 0.08), bev=0.01)
    light(room, f"{name}_glow", "POINT", (x + fx * 4, y - 0.15, z + fz * 4), colour, 30, coll=coll)


M_TIMBER = None
M_DARK = None


def light(room, name, kind, pos, colour, watts, coll=None, **kw):
    LIGHTS.setdefault(room, []).append((name, kind, pos, colour, watts, kw))
    return kit.add_light(name, kind, pos, colour, watts, 0.05, coll, **kw)


def crate(name, M, coll, pos, size=(0.7, 0.68, 0.7), yaw=0.0):
    kit.box(name, M["plank"], coll, pos, size, rot=(0, 0, yaw), bev=0.02)
    x, y, z = pos
    for k, dy in enumerate((-size[1] / 2 + 0.06, size[1] / 2 - 0.06)):
        kit.box(f"{name}_band{k}", M["steel"], coll, (x, y + dy, z), (size[0] + 0.01, 0.04, size[2] + 0.01), rot=(0, 0, yaw), bev=0.004)


def barrel(name, M, coll, x, z, r=0.28, h=0.85, mat="steel"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=22, radius1=r, radius2=r, depth=h)
    o = kit.mesh_obj(name, bm, M[mat], coll, kit.g2b(x, h / 2, z))
    kit.bevel(o, 0.02, 2)
    o["uv"] = "box"
    for k, y in enumerate((0.15, h / 2, h - 0.15)):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=22, radius1=r + 0.012, radius2=r + 0.012, depth=0.04)
        kit.mesh_obj(f"{name}_hoop{k}", bm, M["dark"], coll, kit.g2b(x, y, z))["uv"] = "box"


def rocks(name, M, coll, centre, count, spread, size=(0.12, 0.2)):
    for k in range(count):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rng.uniform(*size))
        for v in bm.verts:
            v.co *= rng.uniform(0.75, 1.2)
        x = centre[0] + rng.uniform(-spread[0], spread[0])
        y = centre[1] + rng.uniform(0, spread[1])
        z = centre[2] + rng.uniform(-spread[2], spread[2])
        o = kit.mesh_obj(f"{name}_{k}", bm, M["rock"], coll, kit.g2b(x, y, z), tuple(rng.uniform(0, 3, 3)))
        o.data.set_sharp_from_angle(angle=math.radians(30))
        o["uv"] = "box"


# ---------- rooms ----------

def build_hallway(M, P, coll):
    room = "hallway"
    z0, z1 = -6.6, -3.6
    floor_ceiling("hall", M, coll, -5, 33, z0, z1, seed=21)
    rock_wall("hall_north", M, coll, "x", z0, -5, 33, +1, doors=((4, 1.8), (14, 1.8), (23.75, 1.8)), seed=22)
    rock_wall("hall_south_w", M, coll, "x", z1, -5, -4, -1, seed=30)
    rock_wall("hall_south_e", M, coll, "x", z1, 4, 33, -1, seed=31)
    rock_wall("hall_west", M, coll, "z", -5, z0, z1, +1, seed=32)
    for at in (4, 14, 23.75):
        door_portal(f"hall_door_{at}", M, coll, "x", at, -6.72, 0.3)
    # timber mine sets along the tunnel, and the rails on their sleepers
    for k, x in enumerate((-4.4, 0.4, 2.6, 6.2, 11.0, 16.4, 21.2, 26.0, 28.6, 32.4)):
        mine_set(f"hall_set{k}", M, coll, x, -6.42, -3.78)
    for k, z in enumerate((-4.85, -5.35)):
        kit.box(f"hall_rail{k}", M["bare"], coll, (14.1, 0.035, z), (37.6, 0.06, 0.05), bev=0.008)
    for k, x in enumerate(np.arange(-4.4, 33, 0.6)):
        kit.box(f"hall_sleeper{k}", M["timber"], coll, (x + rng.uniform(-0.03, 0.03), 0.02, -5.1), (0.13, 0.04, 0.82), rot=(0, 0, rng.uniform(-0.05, 0.05)), bev=0.008, grain="long")
    # the ore cart at the dead end, barrels beside it
    kit.box("hall_cart", M["steel"], coll, (-4.2, 0.6, -5.1), (0.9, 0.5, 1.1), bev=0.03)
    kit.box("hall_cart_base", M["dark"], coll, (-4.2, 0.28, -5.1), (0.72, 0.1, 0.92), bev=0.01)
    for dx in (-0.3, 0.3):
        for dz in (-0.38, 0.38):
            kit.cylinder(f"hall_cart_wheel_{dx}_{dz}", M["dark"], coll, (-4.2 + dx - 0.04, 0.13, -5.1 + dz), (-4.2 + dx + 0.04, 0.13, -5.1 + dz), 0.11, segments=16)
    rocks("hall_cart_ore", M, coll, (-4.2, 0.82, -5.1), 6, (0.25, 0.08, 0.35))
    for k, (x, z) in enumerate(((-4.6, -6.15), (-4.6, -4.05))):
        barrel(f"hall_barrel{k}", M, coll, x, z)
    # the sealed tunnel where the Husks nearly broke in (art bible 6): a mine
    # portal on the north wall, packed with timber and scrap, the rock scorched
    tx = -2.4
    door_portal("hall_sealed", M, coll, "x", tx, -6.55, 0.22, w=1.6, h=2.4)
    kit.box("hall_sealed_back", M["dark"], coll, (tx, 1.2, -6.66), (1.62, 2.4, 0.04), bev=0)
    for k in range(7):
        y = 0.25 + k * 0.33
        kit.box(f"hall_sealed_plank{k}", M["timber"], coll, (tx + rng.uniform(-0.05, 0.05), y, -6.5), (1.75, 0.24, 0.05), rot=(0, rng.uniform(-0.05, 0.05), rng.uniform(-0.12, 0.12)), bev=0.01, grain="long")
    for k in range(3):
        kit.box(f"hall_sealed_plate{k}", M["steel"], coll, (tx + rng.uniform(-0.45, 0.45), rng.uniform(0.5, 2.0), -6.46), (rng.uniform(0.4, 0.7), rng.uniform(0.3, 0.5), 0.02), rot=(0, 0, rng.uniform(-0.3, 0.3)), bev=0.004)
    kit.box("hall_sealed_brace", M["timber"], coll, (tx, 1.2, -6.44), (0.14, 2.7, 0.08), rot=(0, 0, 0.55), bev=0.01, grain="long")
    kit.plane("hall_sealed_scorch", M["scorch"], coll, (tx, 1.5, -6.555), 3.4, 3.1, (R90, 0, 0))
    rocks("hall_sealed_rubble", M, coll, (tx, 0.0, -6.25), 9, (0.8, 0.05, 0.2), size=(0.08, 0.2))
    # cables and the vent duct along the ceiling
    kit.box("hall_duct", M["steel"], coll, (14, H - 0.25, -6.12), (37.8, 0.3, 0.45), bev=0.02)
    for k, x in enumerate(np.arange(-4, 33, 3)):
        kit.box(f"hall_duct_band{k}", M["dark"], coll, (x, H - 0.25, -6.12), (0.05, 0.34, 0.49), bev=0.004)
    for k in range(3):
        kit.cylinder(f"hall_cable{k}", M["dark"], coll, (-4.9, H - 0.45 - k * 0.05, -6.4 + k * 0.03), (32.9, H - 0.45 - k * 0.05, -6.4 + k * 0.03), 0.016, segments=6, bev=0)
    # lamps and string lights down the hallway
    for k, x in enumerate((0, 9, 18.5, 28)):
        work_lamp(f"hall_lamp{k}", M, coll, x, H - 0.75, -5.1, room, watts=240)
    string_lights("hall_string", M, coll, room, [((x, H - 0.35, -5.1), (x + 4.6, H - 0.35, -5.1)) for x in np.arange(-4.2, 32, 4.6)], sag=0.35, every=6, watts=25)
    # shopfronts cut into the south wall
    for k, (x, neon, colour) in enumerate(((6.4, "neon_noodles", (0.85, 0.34, 0.48)), (13.2, "neon_bunks", (0.91, 0.58, 0.23)),
                                          (17.8, "neon_clinic", (0.94, 0.7, 0.35)), (23.4, "neon_water", (0.91, 0.58, 0.23)),
                                          (27.4, "neon_radio", (0.85, 0.34, 0.48)))):
        z = -3.66
        kit.box(f"shop{k}_shutter", M["steel"], coll, (x, 1.05, z), (1.7, 2.1, 0.05), bev=0.01)
        for j, y in enumerate(np.arange(0.12, 2.05, 0.12)):
            kit.box(f"shop{k}_rib{j}", M["dark"], coll, (x, y, z - 0.03), (1.66, 0.02, 0.012), bev=0)
        for s in (-1, 1):
            kit.box(f"shop{k}_post{s}", M["timber"], coll, (x + s * 0.92, 1.15, z - 0.06), (0.12, 2.3, 0.12), rot=(0, 0, 0.01 * s), bev=0.012, grain="long")
        kit.box(f"shop{k}_awning", M["blanket"] if k % 2 else M["canvas"], coll, (x, 2.4, z - 0.32), (2.0, 0.05, 0.62), rot=(-0.3, 0, 0), soft=True, puff=0.3)
        kit.box(f"shop{k}_neon_back", M["dark"], coll, (x, 2.85, z - 0.05), (1.75, 0.46, 0.03), bev=0.006)
        kit.plane(f"shop{k}_neon", P[neon], coll, (x, 2.85, z - 0.07), 1.7, 0.42, (R90, 0, math.pi))
        crate(f"shop{k}_counter", M, coll, (x + 0.45, 0.3, -3.98), (0.55, 0.6, 0.4))
        light(room, f"shop{k}_neon_light", "POINT", (x, 2.6, -4.2), colour, 18, coll=coll)
    # north wall: a grow rack, the notice board, a water tank
    gx = 9.2
    kit.box("grow_frame", M["steel"], coll, (gx, 0.95, -6.36), (1.6, 1.9, 0.32), bev=0.02)
    for k, y in enumerate((0.45, 1.05, 1.65)):
        kit.box(f"grow_shelf{k}", M["dark"], coll, (gx, y - 0.18, -6.3), (1.5, 0.03, 0.28), bev=0.004)
        kit.box(f"grow_tray{k}", M["earth"], coll, (gx, y - 0.13, -6.3), (1.4, 0.07, 0.24), bev=0.01)
        kit.box(f"grow_strip{k}", M["grow"], coll, (gx, y + 0.22, -6.24), (1.4, 0.015, 0.02), bev=0)
        for j in range(6):
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rng.uniform(0.07, 0.11))
            kit.mesh_obj(f"grow_leaf{k}_{j}", bm, M["leaf"], coll, kit.g2b(gx - 0.6 + j * 0.24, y - 0.03, -6.28), tuple(rng.uniform(0, 3, 3)))["uv"] = "box"
    light(room, "grow_light", "POINT", (gx, 1.4, -5.9), (0.85, 0.42, 0.55), 22, coll=coll)
    board("notices", P["sign_notices"], coll, (18.6, 2.05, -6.42), 1.4, 0.36, (R90, 0, 0), timber=M["timber"])
    kit.box("notices_cork", M["plank"], coll, (18.6, 1.45, -6.44), (1.5, 0.8, 0.04), bev=0.01)
    for k, (dx, dy, key) in enumerate(((-0.45, 0.05, "paper_notice_1"), (0.05, -0.05, "paper_notice_2"), (0.5, 0.08, "paper_notice_3"))):
        kit.plane(f"notice_paper{k}", P[key], coll, (18.6 + dx, 1.45 + dy, -6.415), 0.3, 0.38, (R90, 0, rng.uniform(-0.12, 0.12)))
    barrel("hall_tank", M, coll, 31.2, -6.05, r=0.38, h=1.6)
    kit.cylinder("hall_tank_pipe", M["steel"], coll, (31.2, 1.6, -6.3), (31.2, H, -6.3), 0.05)
    # laundry strung across the west end
    a, b = (-0.9, 3.0, -6.45), (1.6, 2.95, -3.7)
    kit.cylinder("laundry_line", M["canvas"], coll, a, b, 0.004, segments=5, bev=0)
    for k, tint in enumerate(("blanket", "mattress", "canvas", "blanket")):
        t = (k + 1) / 5
        p = [a[i] + (b[i] - a[i]) * t for i in range(3)]
        kit.box(f"laundry{k}", M[tint], coll, (p[0], p[1] - 0.22, p[2]), (0.34, 0.4, 0.02), rot=(0, 0, -math.atan2(b[0] - a[0], b[2] - a[2]) + R90), soft=True, puff=0.3)
    # door signs and benches along the hall
    # handmade neon over each doorway, hung from the ceiling on chains
    for at, text, colour in ((4, "TRADE HALL", (0.91, 0.58, 0.23)), (14, "WORKSHOP", (0.94, 0.7, 0.35)), (23.75, "CHECKOUT", (0.85, 0.34, 0.48))):
        neon_sign(f"hall_neon_{int(at)}", text, colour, coll, room, (at, 2.72, -5.72), 0.0, size=0.3)
    neon_sign("hall_neon_quarters", "YOUR QUARTERS", (0.91, 0.58, 0.23), coll, room, (-2.0, 2.95, -3.72), math.pi, size=0.2)
    neon_sign("hall_neon_lift", "LIFT", (0.18, 0.9, 0.82), coll, room, (32.6, 2.85, -5.1), -R90, size=0.3)
    for k, x in enumerate((9, 19)):
        kit.box(f"hall_bench{k}_seat", M["timber"], coll, (x, 0.45, -3.95), (2.0, 0.07, 0.42), bev=0.015, grain="long")
        for s in (-0.85, 0.85):
            kit.box(f"hall_bench{k}_leg{s}", M["timber"], coll, (x + s, 0.22, -3.95), (0.08, 0.44, 0.38), bev=0.01)
    return [((-3.8, 1.75, -4.0), (12.0, 1.5, -5.6)),
            ((11.0, 1.7, -6.2), (14.5, 1.9, -3.6)), ((-1.0, 1.6, -4.2), (-2.4, 1.4, -6.6)),
            ((8.5, 1.55, -3.9), (4.0, 2.6, -6.6)), ((-3.6, 1.6, -6.2), (-1.5, 2.6, -3.6))]


def build_trade_hall(M, P, coll):
    room = "trade_hall"
    x0, x1, z0, z1 = -0.5, 8.87, -15, -6.85
    floor_ceiling("trade", M, coll, x0, x1, z0, z1, seed=41)
    rock_wall("trade_west", M, coll, "z", x0, z0, z1, +1, seed=42)
    rock_wall("trade_east", M, coll, "z", x1, z0, z1, -1, seed=43)
    rock_wall("trade_back", M, coll, "x", z0, x0, x1, +1, seed=44)
    rock_wall("trade_front", M, coll, "x", z1, x0, x1, -1, doors=((4, 1.8),), seed=45)
    # steel arch ribs, and the market neon over the door
    for k, z in enumerate((-8.6, -10.4, -12.4)):
        pts = [(4.2 + 4.6 * math.cos(a), -1.2 + 4.6 * math.sin(a), z) for a in np.linspace(0.12, math.pi - 0.12, 25)]
        for j in range(len(pts) - 1):
            kit.cylinder(f"trade_rib{k}_{j}", M["dark"], coll, pts[j], pts[j + 1], 0.06, segments=8, bev=0)
    kit.box("trade_market_back", M["dark"], coll, (4.25, 3.0, -6.92), (2.5, 0.65, 0.03), bev=0.006)
    kit.plane("trade_market_neon", P["neon_market"], coll, (4.25, 3.0, -6.94), 2.4, 0.6, (R90, 0, math.pi))
    light(room, "trade_market_light", "POINT", (4.25, 2.7, -7.4), (0.91, 0.58, 0.23), 30, coll=coll)
    work_lamp("trade_lamp", M, coll, 4.25, H - 0.8, -10.5, room, watts=380)
    string_lights("trade_string", M, coll, room, [((-0.3, H - 0.4, -8.0), (8.7, H - 0.4, -8.0)), ((-0.3, H - 0.4, -11.6), (8.7, H - 0.4, -11.6))], sag=0.4, every=5, watts=28)
    # the three stalls: counter, cloth awning on posts, shelves of stock, name board
    stalls = ((1.6, "blanket", "gun"), (4.25, "canvas", "med"), (6.9, "mattress", "scrap"))
    for i, (x, awning, kind) in enumerate(stalls):
        z = -13.2
        kit.box(f"stall{i}_counter", M["plank"], coll, (x, 0.55, z + 1.3), (2.2, 1.1, 0.6), bev=0.02)
        kit.box(f"stall{i}_top", M["timber"], coll, (x, 1.13, z + 1.3), (2.3, 0.06, 0.72), bev=0.012, grain="long")
        for s in (-1, 1):
            kit.box(f"stall{i}_pole{s}", M["timber"], coll, (x + s * 1.12, 1.55, z + 1.6), (0.08, 3.1, 0.08), bev=0.01, grain="long")
        kit.box(f"stall{i}_awning", M[awning], coll, (x, 3.05, z + 0.9), (2.4, 0.04, 1.6), rot=(-0.25, 0, 0), soft=True, puff=0.3)
        kit.box(f"stall{i}_shelves", M["timber"], coll, (x, 1.4, z - 0.85), (2.3, 2.8, 0.3), bev=0.015)
        for k in range(3):
            kit.box(f"stall{i}_shelf{k}", M["plank"], coll, (x, 1.59 + k * 0.42, z - 0.6), (2.2, 0.04, 0.32), bev=0.006)
        board(f"stall{i}_sign", P[f"sign_trader_{i}"], coll, (x, 2.55, z + 1.66), 1.45, 0.48, (R90, 0, 0), timber=M["timber"], tilt=-0.12)
        light(room, f"stall{i}_light", "POINT", (x, 2.45, z + 0.6), WARM, 70, coll=coll)
        for k in range(3):  # stock on the shelves, by trade
            y = 1.7 + k * 0.42
            for j in range(5):
                px = x - 0.85 + j * 0.42 + rng.uniform(-0.04, 0.04)
                if kind == "gun":  # ammo tins and long gun cases
                    kit.box(f"stall{i}_tin{k}_{j}", M["steel"], coll, (px, y, z - 0.6), (0.24, 0.16, 0.18), bev=0.01)
                elif kind == "med":  # bandage rolls and bottles
                    kit.cylinder(f"stall{i}_roll{k}_{j}", M["mattress"], coll, (px - 0.08, y, z - 0.6), (px + 0.08, y, z - 0.6), 0.06, segments=12)
                else:  # boxes of junk
                    kit.box(f"stall{i}_junk{k}_{j}", M["canvas"], coll, (px, y - 0.02, z - 0.6), (0.3, 0.14 + 0.06 * rng.random(), 0.22), rot=(0, 0, rng.uniform(-0.2, 0.2)), bev=0.02)
        if kind == "gun":
            for j in range(2):
                kit.box(f"stall{i}_case{j}", M["dark"], coll, (x - 0.5 + j * 1.0, 1.2, z + 1.25), (0.9, 0.12, 0.28), rot=(0, 0, 0.1 - 0.2 * j), bev=0.02)
        elif kind == "med":
            kit.box(f"stall{i}_satchel", M["canvas"], coll, (x + 0.6, 1.3, z + 1.25), (0.42, 0.28, 0.16), soft=True, puff=0.3)
        else:  # Pell's hanging spring scale and ledger
            kit.cylinder(f"stall{i}_scale_chain", M["dark"], coll, (x - 0.6, 2.25, z + 1.3), (x - 0.6, 1.75, z + 1.3), 0.006)
            kit.cylinder(f"stall{i}_scale", M["bare"], coll, (x - 0.6, 1.75, z + 1.3), (x - 0.6, 1.55, z + 1.3), 0.04, segments=14)
            kit.box(f"stall{i}_ledger", M["blanket"], coll, (x + 0.5, 1.18, z + 1.3), (0.34, 0.04, 0.26), rot=(0, 0, 0.2), bev=0.01)
    for k, (x, z, n) in enumerate(((0.3, -7.4, 2), (8.3, -7.4, 1), (0.3, -8.2, 1))):
        for j in range(n):
            crate(f"trade_crate{k}_{j}", M, coll, (x, 0.35 + j * 0.7, z), yaw=rng.uniform(-0.2, 0.2))
    return [((4.25, 1.7, -7.4), (4.25, 1.3, -14.0)), ((0.6, 1.8, -8.0), (7.0, 1.2, -13.0))]


def build_workshop(M, P, coll):
    room = "workshop"
    x0, x1, z0, z1 = 9.13, 18.87, -15, -6.85
    floor_ceiling("work", M, coll, x0, x1, z0, z1, seed=51)
    rock_wall("work_west", M, coll, "z", x0, z0, z1, +1, seed=52)
    rock_wall("work_east", M, coll, "z", x1, z0, z1, -1, seed=53)
    rock_wall("work_back", M, coll, "x", z0, x0, x1, +1, seed=54)
    rock_wall("work_front", M, coll, "x", z1, x0, x1, -1, doors=((14, 1.8),), seed=55)
    # overhead beams, a steel rail and a chain hoist
    for k, x in enumerate((11.6, 14, 16.4)):
        kit.box(f"work_beam{k}", M["timber"], coll, (x, H - 0.14, -10.9), (0.22, 0.24, 8.2), bev=0.025, grain="long")
    kit.box("work_rail", M["dark"], coll, (14, H - 0.42, -10.9), (0.12, 0.14, 8.2), bev=0.01)
    for i in range(10):
        kit.cylinder(f"work_chain{i}", M["dark"], coll, (14, H - 0.5 - i * 0.07, -10.8), (14, H - 0.56 - i * 0.07, -10.8), 0.012, segments=6, bev=0)
    kit.box("work_hook", M["bare"], coll, (14, H - 1.25, -10.8), (0.06, 0.16, 0.04), bev=0.01)
    barrel("work_drum", M, coll, 12.6, -7.25, r=0.3, h=0.9, mat="steel_locker")
    work_lamp("work_lamp", M, coll, 14, H - 0.8, -10.8, room, watts=380)
    # the seven benches: top, frame, a vise, a toolbox, a board saying what it's for
    spots = ((11, -14.3, 0), (14, -14.3, 0), (17, -14.3, 0), (9.85, -11.0, R90), (18.15, -11.0, -R90), (18.15, -8.4, -R90), (9.85, -8.4, R90))
    for i, (x, z, r) in enumerate(spots):
        along = r == 0
        w, d = (2.2, 0.9) if along else (0.9, 2.2)
        kit.box(f"bench{i}_top", M["timber"], coll, (x, 0.87, z), (w, 0.08, d), bev=0.015, grain="long")
        kit.box(f"bench{i}_frame", M["steel"], coll, (x, 0.42, z), (w * 0.92, 0.82, d * 0.9), bev=0.02)
        vx, vz = (x - 0.6, z) if along else (x, z - 0.6)
        kit.box(f"bench{i}_vise", M["dark"], coll, (vx, 1.0, vz), (0.22, 0.18, 0.2), bev=0.015)
        tx, tz = (x + 0.55, z) if along else (x, z + 0.55)
        kit.box(f"bench{i}_toolbox", M["blanket"] if i >= 5 else M["steel_locker"], coll, (tx, 0.99, tz), (0.36, 0.16, 0.2), rot=(0, 0, rng.uniform(-0.3, 0.3)), bev=0.012)
        if along:
            board(f"bench{i}_sign", P[f"sign_bench_{i}"], coll, (x, 1.8, z - 0.4), 1.3, 0.4, (R90, 0, 0), timber=M["timber"])
        else:
            bx = x - 0.4 if r > 0 else x + 0.4
            board(f"bench{i}_sign", P[f"sign_bench_{i}"], coll, (bx, 1.8, z), 1.3, 0.4, (R90, 0, r), timber=M["timber"])
        lx, lz = (x, z + 0.1) if along else (x + (0.2 if r > 0 else -0.2), z)
        light(room, f"bench{i}_light", "POINT", (lx, 2.2, lz), WARM, 45, coll=coll)
    # the salvage bench sits among heaps of broken gear
    rocks("work_scrap", M, coll, (18.3, 0.0, -9.6), 6, (0.3, 0.1, 0.4))
    for k in range(5):
        kit.box(f"work_scrap_plate{k}", M["steel"], coll, (18.2 + rng.uniform(-0.2, 0.2), 0.08 + k * 0.05, -9.7 + rng.uniform(-0.3, 0.3)), (0.5, 0.03, 0.35), rot=(rng.uniform(-0.3, 0.3), rng.uniform(-1, 1), rng.uniform(-0.3, 0.3)), bev=0.005)
    return [((14, 1.7, -7.4), (14, 1.2, -14.0)), ((10.0, 1.8, -7.6), (17.0, 1.0, -13.0))]


def build_checkout(M, P, coll):
    room = "checkout"
    x0, x1, z0, z1 = 19.13, 28.5, -15, -6.85
    floor_ceiling("check", M, coll, x0, x1, z0, z1, seed=61)
    rock_wall("check_west", M, coll, "z", x0, z0, z1, +1, seed=62)
    rock_wall("check_east", M, coll, "z", x1, z0, z1, -1, seed=63)
    rock_wall("check_back", M, coll, "x", z0, x0, x1, +1, seed=64)
    rock_wall("check_front", M, coll, "x", z1, x0, x1, -1, doors=((23.75, 1.8),), seed=65)
    for k, z in enumerate((-7.4, -14.0)):
        pts = [(23.75 + 4.6 * math.cos(a), -1.35 + 4.75 * math.sin(a), z) for a in np.linspace(0.12, math.pi - 0.12, 25)]
        for j in range(len(pts) - 1):
            kit.cylinder(f"check_rib{k}_{j}", M["dark"], coll, pts[j], pts[j + 1], 0.06, segments=8, bev=0)
    # the sign-out desk: steel desk, the drop screen, a logbook and a lamp
    kit.box("check_desk", M["steel_locker"], coll, (23.75, 0.5, -12.6), (3.2, 1.0, 0.8), bev=0.02)
    kit.box("check_desk_top", M["timber"], coll, (23.75, 1.02, -12.6), (3.3, 0.05, 0.9), bev=0.01, grain="long")
    kit.box("check_screen_case", M["dark"], coll, (23.75, 1.4, -12.88), (1.5, 0.82, 0.08), rot=(0.25, 0, 0), bev=0.015)
    kit.plane("check_screen", P["paper_drops"], coll, (23.75, 1.405, -12.83), 1.36, 0.7, (R90 + 0.25, 0, 0))
    kit.box("check_logbook", M["blanket"], coll, (22.6, 1.06, -12.5), (0.4, 0.04, 0.3), rot=(0, 0, 0.15), bev=0.01)
    kit.plane("check_signout", P["paper_signout"], coll, (25.0, 1.048, -12.45), 0.28, 0.35, (0, 0, -0.2))
    light(room, "check_screen_light", "POINT", (23.75, 1.6, -12.3), (0.95, 0.72, 0.45), 25, coll=coll)
    board("check_sign", P["sign_checkout"], coll, (23.75, 2.6, -14.92), 2.4, 0.6, (R90, 0, 0), timber=M["timber"])
    # the survey map of the Dustline on the west wall, pinned and strung
    kit.box("check_map_frame", M["timber"], coll, (19.27, 1.75, -10.8), (0.06, 2.3, 2.3), bev=0.012)
    kit.plane("check_map", P["map_board"], coll, (19.31, 1.75, -10.8), 2.2, 2.2, (R90, 0, R90))
    light(room, "check_map_light", "POINT", (20.2, 2.8, -10.8), WARM, 60, coll=coll)
    # a rack of old radio gear on the east wall, amber lamps blinking
    kit.box("check_rack", M["steel"], coll, (28.15, 1.0, -10.2), (0.5, 2.0, 1.2), bev=0.02)
    for i in range(18):
        kit.box(f"check_rack_led{i}", M["bulb"], coll, (27.89, 0.4 + (i % 9) * 0.18, -10.5 + (i // 9) * 0.55), (0.01, 0.025, 0.04), bev=0)
    work_lamp("check_lamp", M, coll, 23.75, H - 0.8, -10.8, room, watts=320)
    return [((23.75, 1.7, -7.4), (23.75, 1.3, -14.0)), ((27.0, 1.7, -8.0), (19.5, 1.5, -11.5))]


def build_lift(M, P, coll):
    room = "lift"
    x0, x1, z0, z1 = 33.0, 36.5, -6.6, -3.6
    kit.box("lift_floor", M["dark"], coll, ((x0 + x1) / 2, -0.03, (z0 + z1) / 2), (x1 - x0, 0.06, z1 - z0), bev=0.01)
    for k in range(6):  # tread plate strips
        kit.box(f"lift_tread{k}", M["bare"], coll, (x0 + 0.3 + k * 0.58, 0.005, (z0 + z1) / 2), (0.08, 0.01, 2.8), bev=0.002)
    # the cage: bars on both sides and the back, a steel frame, an open shaft above
    for side, z in (("s", z1 - 0.12), ("n", z0 + 0.12)):
        for k, x in enumerate(np.arange(x0 + 0.3, x1, 0.28)):
            kit.cylinder(f"lift_bar_{side}{k}", M["steel"], coll, (x, 0, z), (x, H, z), 0.018, segments=8)
        kit.box(f"lift_rail_{side}", M["steel"], coll, ((x0 + x1) / 2, 1.1, z), (x1 - x0, 0.06, 0.06), bev=0.01)
    kit.box("lift_back", M["steel"], coll, (x1 - 0.05, H / 2, (z0 + z1) / 2), (0.1, H, z1 - z0), bev=0.01)
    for k, x in enumerate((x0, x1 - 0.1)):
        kit.box(f"lift_frame_top{k}", M["dark"], coll, (x, H - 0.1, (z0 + z1) / 2), (0.16, 0.2, z1 - z0), bev=0.015)
    kit.cylinder("lift_cable", M["dark"], coll, (34.8, H - 0.3, -5.1), (34.8, H + 6, -5.1), 0.025)
    kit.box("lift_threshold", M["bulb"], coll, (x0 + 0.05, 0.012, -5.1), (0.1, 0.02, 3.0), bev=0)
    # Lift Teal beacon on the back wall: the way out (art bible 4)
    kit.box("lift_beacon", M["teal"], coll, (x1 - 0.11, 1.3, -5.1), (0.04, 0.6, 0.8), bev=0.01)
    light(room, "lift_beacon_light", "POINT", (x1 - 0.6, 1.4, -5.1), (0.18, 0.9, 0.82), 40, coll=coll)
    # the only cool light in the Sanctuary: a thin sliver of daylight down the shaft
    light(room, "lift_daylight", "SPOT", (34.8, H + 4, -5.1), (0.85, 0.9, 1.0), 900, coll=coll,
          spot_size=math.radians(22), spot_blend=0.4)
    rock_wall("lift_south", M, coll, "x", z1 + 0.15, x0, x1, -1, depth=0.1, seed=71)
    rock_wall("lift_north", M, coll, "x", z0 - 0.15, x0, x1, +1, depth=0.1, seed=72)
    return [((31.0, 1.7, -5.1), (36.0, 1.2, -5.1))]


BUILDERS = {"hallway": build_hallway, "trade_hall": build_trade_hall, "workshop": build_workshop,
            "checkout": build_checkout, "lift": build_lift}


# ---------- Godot lights ----------

def basis_rows(direction):
    """Rows of a Godot basis whose -Z looks along `direction` (game space)."""
    f = np.array(direction, float)
    f /= np.linalg.norm(f)
    z = -f
    up = np.array([0.0, 1.0, 0.0]) if abs(z[1]) < 0.95 else np.array([1.0, 0.0, 0.0])
    x = np.cross(up, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    cols = np.stack([x, y, z], 1)  # basis columns
    return cols


def write_lights(room):
    """Writes godot/scenes/sanctuary/lights_<room>.tscn from the lights placed
    in Blender. Brightness maps from Blender watts to Godot energy as
    0.1 * sqrt(watts), range 0.35 * sqrt(watts) (tuned on the quarters);
    only lamps of 300 W and up cast shadows (art bible 8.6)."""
    os.makedirs(SCENES, exist_ok=True)
    out = ['[gd_scene format=3]', '', f'[node name="Lights_{room}" type="Node3D"]']
    for name, kind, (x, y, z), c, watts, kw in LIGHTS.get(room, []):
        energy = round(0.1 * math.sqrt(watts), 3)
        rng_ = round(max(2.5, 0.35 * math.sqrt(watts)), 2)
        node = "SpotLight3D" if kind == "SPOT" else "OmniLight3D"
        if kind == "SPOT":
            m = basis_rows((0, -1, 0))
            t = ", ".join(f"{v:.5g}" for v in m.reshape(-1)) + f", {x}, {y}, {z}"
            rng_ = round(H + 6, 2)
        else:
            t = f"1, 0, 0, 0, 1, 0, 0, 0, 1, {x}, {y}, {z}"
        out += ['', f'[node name="{name}" type="{node}" parent="."]', f'transform = Transform3D({t})',
                f'light_color = Color({c[0]:.3f}, {c[1]:.3f}, {c[2]:.3f}, 1)', f'light_energy = {energy}']
        if watts >= 300:
            out += ['shadow_enabled = true', 'distance_fade_enabled = true', 'distance_fade_begin = 20.0',
                    'distance_fade_shadow = 12.0', 'distance_fade_length = 5.0']
        if kind == "SPOT":
            out += [f'spot_range = {rng_}', f'spot_angle = {math.degrees(kw.get("spot_size", 0.6)) / 2:.1f}']
        else:
            out += [f'omni_range = {rng_}']
    with open(os.path.join(SCENES, f"lights_{room}.tscn"), "w") as f:
        f.write("\n".join(out) + "\n")


# ---------- main ----------

def main():
    rooms = (arg("--rooms") or ",".join(ROOMS)).split(",")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(kit.WORK, exist_ok=True)
    pics = kit.make_pictures()
    make_room_pictures()
    M = kit.make_materials(pics)
    global M_TIMBER, M_DARK
    M_TIMBER, M_DARK = M["timber"], M["dark"]
    M["scorch"] = kit.picture_material("mat_decal_scorch_01", os.path.join(TEX, "decal_scorch_albedo.png"), alpha=True, rough=0.9)
    M["grow"] = kit.pbr("mat_grow_light_01", None, tint=(0.95, 0.6, 0.7), emission=(0.85, 0.34, 0.48), emission_strength=8.0)
    M["teal"] = kit.pbr("mat_lift_teal_01", None, tint=(0.03, 0.2, 0.18), emission=(0.18, 0.9, 0.82), emission_strength=6.0)
    P = {}
    for key in ("sign_trade_hall", "sign_workshop", "sign_checkout_door", "sign_lift", "sign_quarters", "sign_checkout",
                "sign_notices", *[f"sign_trader_{i}" for i in range(3)], *[f"sign_bench_{i}" for i in range(7)]):
        P[key] = kit.pbr(f"mat_{key}_01", key)
    for key in ("neon_noodles", "neon_bunks", "neon_clinic", "neon_water", "neon_radio", "neon_market"):
        P[key] = kit.picture_material(f"mat_{key}_01", os.path.join(TEX, f"{key}_albedo.png"), emission_strength=5.0, rough=0.3)
    for key in ("map_board", "paper_notice_1", "paper_notice_2", "paper_notice_3", "paper_signout"):
        P[key] = kit.picture_material(f"mat_{key}_01", os.path.join(TEX, f"{key}_albedo.png"), rough=0.85)
    P["paper_drops"] = kit.picture_material("mat_screen_drops_01", os.path.join(TEX, "paper_drops_albedo.png"), emission_strength=1.2, rough=0.2)
    views = {}
    for room in rooms:
        coll = bpy.data.collections.new(f"env_sanctuary_{room}")
        bpy.context.scene.collection.children.link(coll)
        views[room] = BUILDERS[room](M, P, coll)
        for o in list(coll.objects):
            kit.finalize(o)
        tris = sum(len(p.vertices) - 2 for o in coll.objects if o.type == "MESH" for p in o.data.polygons)
        print(f"{room}: objects {len(coll.objects)}  triangles {tris}  lights {len(LIGHTS.get(room, []))}")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kit.WORK, "env_sanctuary_rooms.blend"))
    if "--render" in sys.argv:
        # the quarters too, so previews show the whole Sanctuary (never exported here)
        qcoll, qbulbs = kit.build(pics)
        for o in list(qcoll.objects):
            kit.finalize(o)
        kit.lights(qcoll, qbulbs)
        for room in rooms:
            for k, (cam, look) in enumerate(views[room]):
                kit.setup_render(os.path.join(kit.WORK, f"preview_{room}_{k}.png"), cam, look, fov=60, res=(1152, 648), samples=48)
    if "--export" in sys.argv:
        os.makedirs(kit.MODELS, exist_ok=True)
        for room in rooms:
            coll = bpy.data.collections[f"env_sanctuary_{room}"]
            kit.merge_by_material(coll, prefix=f"{room}_")
            bpy.ops.object.select_all(action="DESELECT")
            for o in coll.objects:
                if o.type == "MESH":
                    o.select_set(True)
            bpy.ops.export_scene.gltf(
                filepath=os.path.join(kit.MODELS, f"env_sanctuary_{room}.gltf"),
                export_format="GLTF_SEPARATE", export_texture_dir="../../textures/sanctuary",
                use_selection=True, export_apply=True, export_yup=True, export_tangents=True,
                export_lights=False, export_cameras=False, export_materials="EXPORT", export_image_format="AUTO",
            )
            write_lights(room)


if __name__ == "__main__":
    main()
