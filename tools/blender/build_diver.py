"""Builds the base Diver in Blender: the player character without its
wardrobe layers (art bible 5.1), rigged and animated for the Godot
controller (godot/scripts/raider.gd).

- Body: realistic adult proportions, ~1.8 m, standing on y = 0 and facing
  +z (the game's forward). A fitted base shirt and trousers, boots, bare
  hands, a neutral head: the layer the Field Jacket, pack, hats and hair go
  over. Modelled with a skin modifier over a joint graph, then subdivided.
- Skeleton: bones named as Godot's SkeletonProfileHumanoid (Hips, Spine,
  Chest, UpperChest, Neck, Head, LeftUpperArm ... RightToes), so Godot can
  retarget and attach gear without renaming.
- Weights: computed from the distance to each bone, kept to its own side
  of the body, so legs and arms never pull on each other.
- Animations (in place, looping where it makes sense): idle, walk, run,
  crouch_idle, crouch_walk, jump. Exported as glTF animations; Godot's
  importer puts them on the model's AnimationPlayer.
- Budget (art bible 8.4): Diver LOD0 40k triangles, 3 materials.

Run with the Blender Python module (bpy), plus numpy, Pillow and scikit-image (the hands are fused with marching cubes):
    python tools/blender/build_diver.py <work dir> [--render] [--sheets [--only walk,run]] [--export]
--export writes godot/models/characters/char_diver_base.glb.
"""

import ast
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402  (first: it makes bmesh and mathutils importable)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Euler, Matrix, Quaternion, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
from PIL import Image  # noqa: E402

import build_quarters as kit  # noqa: E402

ROOT = kit.ROOT
CMODELS = os.path.join(ROOT, "godot", "models", "characters")
FPS = 30

# ---------- the skeleton (game space: y up, the Diver faces +z, its left is +x) ----------
# name: (head, tail, parent)
# The arms are rigged ARM_DROP degrees down from a 35-degree A-pose, so they
# sit close to the body (about 15 degrees out): standing only lowers them a
# few degrees more, and the shoulder keeps its shape instead of flaring like a
# pad. Every arm landmark (elbow, wrist, hand, fingers, cuff) goes through
# arm_pt / arm_vec, a turn about the shoulder joint in the body's front plane.
ARM_DROP = 20.0
SHOULDER_JOINT = (0.17, 1.45, -0.02)  # the left one; the right mirrors it


def arm_vec(v, sx):
    a = math.radians(-sx * ARM_DROP)
    x, y, z = v
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z)


def arm_pt(p, sx):
    """An arm landmark given for the 35-degree A-pose, turned down by ARM_DROP."""
    j = (sx * SHOULDER_JOINT[0], SHOULDER_JOINT[1], SHOULDER_JOINT[2])
    x, y, z = arm_vec((p[0] - j[0], p[1] - j[1], p[2] - j[2]), sx)
    return (j[0] + x, j[1] + y, j[2] + z)


BONES = {
    "Hips": ((0, 0.96, 0), (0, 1.06, 0), None),
    "Spine": ((0, 1.06, 0), (0, 1.18, 0.0), "Hips"),
    "Chest": ((0, 1.18, 0), (0, 1.32, -0.005), "Spine"),
    "UpperChest": ((0, 1.32, -0.005), (0, 1.46, -0.01), "Chest"),
    "Neck": ((0, 1.46, -0.01), (0, 1.56, 0.0), "UpperChest"),
    "Head": ((0, 1.56, 0.0), (0, 1.78, 0.01), "Neck"),
}
for side, sx in (("Left", 1), ("Right", -1)):
    BONES.update({
        f"{side}Shoulder": ((sx * 0.03, 1.43, -0.01), (sx * 0.17, 1.45, -0.02), "UpperChest"),
        f"{side}UpperArm": ((sx * 0.17, 1.45, -0.02), arm_pt((sx * 0.33, 1.22, -0.02), sx), f"{side}Shoulder"),
        f"{side}LowerArm": (arm_pt((sx * 0.33, 1.22, -0.02), sx), arm_pt((sx * 0.47, 1.02, 0.01), sx), f"{side}UpperArm"),
        f"{side}Hand": (arm_pt((sx * 0.465, 1.03, 0.01), sx), arm_pt((sx * 0.505, 0.955, 0.016), sx), f"{side}LowerArm"),
        f"{side}UpperLeg": ((sx * 0.095, 0.95, 0), (sx * 0.105, 0.52, 0.01), "Hips"),
        f"{side}LowerLeg": ((sx * 0.105, 0.52, 0.01), (sx * 0.11, 0.1, -0.01), f"{side}UpperLeg"),
        f"{side}Foot": ((sx * 0.11, 0.1, -0.01), (sx * 0.11, 0.03, 0.125), f"{side}LowerLeg"),
        f"{side}Toes": ((sx * 0.11, 0.03, 0.125), (sx * 0.11, 0.025, 0.2), f"{side}Foot"),
    })


# ---------- the hands ----------
# Each hand hangs from the wrist down the forearm's line, palm to the thigh, thumb forward.
# Its frame: d along the hand, e across the knuckles (forward), n out of the palm (inwards).

def hand_frame(sx):
    w = np.array(arm_pt((sx * 0.465, 1.03, 0.01), sx))
    d = np.array(arm_vec((sx * 0.065, -0.11, 0.01), sx))
    d /= np.linalg.norm(d)
    n = np.array(arm_vec((-sx, 0.0, 0.0), sx))
    n -= d * (n @ d)
    n /= np.linalg.norm(n)
    e = -np.cross(d, n) * sx  # forward (+z) for both hands: the thumb and index lead
    e /= np.linalg.norm(e)
    return w, d, e, n


# (name, offset across the knuckles, segment lengths, radius at the base)
FINGERS = (("Index", 0.028, (0.042, 0.026, 0.021), 0.0083), ("Middle", 0.0095, (0.046, 0.029, 0.022), 0.0086),
           ("Ring", -0.009, (0.043, 0.027, 0.021), 0.0081), ("Little", -0.026, (0.034, 0.02, 0.018), 0.007))
FINGER_FAN = 1.4  # how far the fingers fan apart: enough that neighbours never touch at rest
FINGER_REST_CURL = (14.0, 22.0, 16.0)  # degrees each joint bends towards the palm at rest: a relaxed hand


def finger_chains(sx):
    """Joint positions (game space) of each finger and the thumb, curled a little."""
    w, d, e, n = hand_frame(sx)
    chains = {}
    for name, off, segs, r in FINGERS:
        knuckle = w + d * (0.088 - 0.004 * abs(off) / 0.028) + e * off
        pts, dirn = [knuckle], d + e * (off * FINGER_FAN)
        dirn /= np.linalg.norm(dirn)
        for k, ln in enumerate(segs):
            a = math.radians(FINGER_REST_CURL[k])
            dirn = dirn * math.cos(a) + n * math.sin(a)
            dirn /= np.linalg.norm(dirn)
            pts.append(pts[-1] + dirn * ln)
        chains[name] = (pts, r)
    base = w + d * 0.022 + e * 0.026 + n * 0.01
    dirn = d * 0.88 + e * 0.2 + n * 0.3  # hangs along the index finger, a little forward, not splayed
    dirn /= np.linalg.norm(dirn)
    pts = [base]
    for k, ln in enumerate((0.042, 0.032, 0.027)):
        a = math.radians((6, 14, 12)[k])
        dirn = dirn * math.cos(a) + n * math.sin(a)
        dirn /= np.linalg.norm(dirn)
        pts.append(pts[-1] + dirn * ln)
    chains["Thumb"] = (pts, 0.0115)
    return chains


# A fist. The fingers close by FINGER_FIST degrees (+x) and the palm cups by
# PALM_CUP; the thumb then lies over the backs of the index and middle fingers'
# middle bones, its pad pressing down, its tip at the middle finger. Each thumb
# bone's hinge is solved so that closing it by THUMB_FIST degrees puts it there;
# half of each is a loose grip.
FINGER_FIST = (90.0, 108.0, 72.0)  # proximal, intermediate, distal
PALM_CUP = {"Index": 0.0, "Middle": 3.0, "Ring": 8.0, "Little": 14.0}  # metacarpals in a fist
THUMB_FIST_AT = ((0.058, 0.048, 0.018), (0.068, 0.042, 0.048), (0.064, 0.014, 0.053))  # knuckle, middle joint, tip


def _rot(axis, ang):
    x, y, z = axis
    c, s_ = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s_, x * z * C + y * s_],
                     [y * x * C + z * s_, c + y * y * C, y * z * C - x * s_],
                     [z * x * C - y * s_, z * y * C + x * s_, c + z * z * C]])


def fist_finger(sx, fname):
    """Joint positions of a finger closed by FINGER_FIST, and the direction its
    back faces at the middle bone."""
    w, d, e, n = hand_frame(sx)
    rest = [np.array(p) for p in finger_chains(sx)[fname][0]]
    parent, pos, out = np.eye(3), [rest[0]], None
    for k in range(3):
        y = rest[k + 1] - rest[k]
        ln = np.linalg.norm(y)
        y /= ln
        z = n - y * (n @ y)
        z /= np.linalg.norm(z)
        parent = parent @ _rot(np.cross(y, z), math.radians(FINGER_FIST[k]))
        pos.append(pos[-1] + parent @ y * ln)
        if k == 1:
            out = parent @ -z  # the back of the middle bone
    return pos, out


def solve_thumb(sx):
    """Per thumb bone: the direction its +x rotation curls it towards, and the
    angle (degrees) that takes it to its place in the fist."""
    w, d, e, n = hand_frame(sx)
    rest = [np.array(p) for p in finger_chains(sx)["Thumb"][0]]
    # In a fist the thumb's first bone runs up the side of the palm, its middle
    # bone stands beside the index finger's first bone (no gap for the web to
    # show), and its tip folds across onto the middle finger. Hand-frame
    # (d, e, n) from the wrist, checked against fist_finger's joint positions.
    mcp, ip, tip = (w + d * a + e * b + n * c for a, b, c in THUMB_FIST_AT)
    goal = [rest[0], mcp, ip, tip]
    parent = np.eye(3)
    tos, angles = [], []
    for k in range(3):
        y = rest[k + 1] - rest[k]
        y /= np.linalg.norm(y)
        g = goal[k + 1] - goal[k]
        g = parent.T @ (g / np.linalg.norm(g))  # the goal in this bone's rest frame
        axis = np.cross(y, g)
        axis /= np.linalg.norm(axis)
        ang = math.acos(max(-1.0, min(1.0, float(y @ g))))
        tos.append(np.cross(axis, y))  # +x (the axis) turns y towards this
        angles.append(math.degrees(ang))
        parent = parent @ _rot(axis, ang)
    return tos, tuple(round(a, 1) for a in angles)


FINGER_BONES = []
FINGER_CURL_TO = {}  # bone -> game-space direction the finger curls towards (out of the palm)
for side, sx in (("Left", 1), ("Right", -1)):
    _, palm_d, palm_e, palm_n = hand_frame(sx)
    _tos, THUMB_FIST = solve_thumb(sx)
    thumb_to = dict(zip(("Metacarpal", "Proximal", "Distal"), _tos))
    w_, _, _, _ = hand_frame(sx)
    for fname, (pts, _) in finger_chains(sx).items():
        names = ("Metacarpal", "Proximal", "Distal") if fname == "Thumb" else ("Proximal", "Intermediate", "Distal")
        parent = f"{side}Hand"
        if fname != "Thumb":  # the palm's long bones: wrist to knuckle, so the palm can cup
            off = dict((f[0], f[1]) for f in FINGERS)[fname]
            bn = f"{side}{fname}Metacarpal"
            BONES[bn] = (tuple(w_ + palm_d * 0.022 + palm_e * off * 0.5), tuple(pts[0]), parent)
            FINGER_BONES.append(bn)
            FINGER_CURL_TO[bn] = tuple(palm_n)
            parent = bn
        for k, nm in enumerate(names):
            bn = f"{side}{fname}{nm}"
            BONES[bn] = (tuple(pts[k]), tuple(pts[k + 1]), parent)
            FINGER_BONES.append(bn)
            FINGER_CURL_TO[bn] = tuple(thumb_to[nm] if fname == "Thumb" else palm_n)
            parent = bn


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


# ---------- the body ----------
# The joint graph the skin modifier wraps: (name, position, (radius across, radius front-back)), and edges.
SKIN_TEX = os.path.join(ROOT, "godot", "textures", "characters")
SKIN_UV = (0.25, 0.5)  # every skin face samples the plain skin half of the skin texture
NAIL_U = (0.55, 0.95)  # nails use the right half, base (v 0) to free edge (v 1)


def make_skin_texture():
    """The skin's texture: plain weathered skin on the left half; on the right
    the nail, one even colour, paler and pinker than the skin and glossier, so
    each nail reads clearly against the finger."""
    os.makedirs(SKIN_TEX, exist_ok=True)
    W, H = 64, 64
    alb = Image.new("RGB", (W, H), (124, 97, 80))  # sRGB of the old linear tint (0.2, 0.12, 0.08)
    orm = Image.new("RGB", (W, H), (255, 140, 0))  # roughness 0.55
    for y in range(H):
        for x in range(W // 2, W):
            alb.putpixel((x, y), (196, 158, 148))  # the nail
            orm.putpixel((x, y), (255, 70, 0))  # roughness 0.27: nails shine where skin doesn't
    alb.save(os.path.join(SKIN_TEX, "diver_skin_albedo.png"))
    orm.save(os.path.join(SKIN_TEX, "diver_skin_orm.png"))
    Image.new("RGB", (W, H), (128, 128, 255)).save(os.path.join(SKIN_TEX, "diver_skin_normal.png"))


def materials():
    """Three materials (art bible 8.4): the base clothes, the skin, the boots."""
    make_skin_texture()
    return {
        "cloth": kit.pbr("mat_diver_base_cloth_01", "canvas", tint=(0.5, 0.48, 0.42)),  # a faded, dusty base layer
        "skin": kit.pbr("mat_diver_skin_01", os.path.relpath(os.path.join(SKIN_TEX, "diver_skin"), kit.TEX)),  # skin and nails
        "boots": kit.pbr("mat_diver_boots_01", None, tint=(0.035, 0.024, 0.016), rough=0.62),  # worn dark leather (linear values)
    }


def build_head(M, coll):
    """The head: a skull shaped from a sphere, the jaw tapering to the chin,
    a brow, eye sockets, a nose and ears pushed out of it. Neutral and
    tired-looking at most (art bible 5.1: mostly seen from behind)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=28, radius=1.0)
    cx, cy, cz = 0.0, 1.675, 0.005
    for v in bm.verts:
        x, z_up, y_back = v.co.x, v.co.z, -v.co.y  # unit sphere: x across, z up, -y = game +z (the face)
        gx, gy, gz = x * 0.08, z_up * 0.112, y_back * 0.1
        if z_up < 0:  # the jaw narrows and comes forward to the chin
            t = min(1.0, -z_up)
            gx *= 1 - 0.32 * t ** 1.5
            gz = gz * (1 - 0.15 * t) + 0.012 * t
        if gz < 0:  # the back of the skull rounds out
            gz *= 1.08
        def bump(px, py, pz, r, amt):
            d2 = ((gx - px) ** 2 + (gy - py) ** 2 + (gz - pz) ** 2) / (r * r)
            return amt * math.exp(-d2)
        front = max(0.0, y_back)
        gz += bump(0, -0.015, 0.1, 0.018, 0.022) * front  # the nose
        gz += bump(0, 0.03, 0.095, 0.035, 0.008) * front  # the brow
        gz += bump(0, -0.085, 0.085, 0.025, 0.008) * front  # the chin
        for sx in (-1, 1):
            gz -= bump(sx * 0.032, 0.008, 0.09, 0.018, 0.012) * front  # eye sockets
            gx += sx * bump(sx * 0.08, -0.005, -0.005, 0.022, 0.016)  # ears
        v.co = Vector(kit.g2b(cx + gx, cy + gy, cz + gz))
    o = kit.mesh_obj("char_diver_head", bm, M["skin"], coll, (0, 0, 0), (0, 0, 0))
    for poly in o.data.polygons:
        poly.use_smooth = True
    o["uv"] = "box"
    return o


COLLAR = ((0.0, 1.502, -0.01), (0.0, 1.42, -0.02), (0.0, 1.58, 0.0))  # centre, and the axis it runs along
CUFF = tuple(arm_pt(p, 1) for p in ((0.455, 1.045, 0.008), (0.39, 1.13, -0.005), (0.47, 1.02, 0.01)))  # the left cuff; the right mirrors it


def trims(M, coll):
    """A ribbed collar, cuffs and boot tops: clean edges where the shirt meets
    the skin and the trousers meet the boots."""
    out = []
    def band(name, mat, centre, r, depth, axis_from, axis_to, thick=0.006):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=r, radius2=r * 0.97, depth=depth)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=thick)
        d = (Vector(kit.g2b(*axis_to)) - Vector(kit.g2b(*axis_from))).normalized()
        o = kit.mesh_obj(name, bm, mat, coll, kit.g2b(*centre), d.to_track_quat("Z", "Y").to_euler())
        o["uv"] = "box"
        for poly in o.data.polygons:
            poly.use_smooth = True
        out.append(o)
    band("diver_collar", M["cloth"], COLLAR[0], 0.069, 0.026, COLLAR[1], COLLAR[2])
    for sx in (-1, 1):
        mirror = lambda p: (sx * p[0], p[1], p[2])
        band(f"diver_cuff{sx}", M["cloth"], mirror(CUFF[0]), 0.035, 0.026, mirror(CUFF[1]), mirror(CUFF[2]))
        band(f"diver_boot_top{sx}", M["boots"], (sx * 0.11, 0.203, -0.004), 0.058, 0.018, (sx * 0.11, 0.0, -0.004), (sx * 0.11, 0.3, -0.004), thick=0.008)
    return out


def skin_chain(name, mat, coll, pts, radii, levels=1):
    """A smooth tube through game-space points with a radius at each: a skin
    modifier on a simple chain (no branches), subdivided."""
    bm = bmesh.new()
    vs = [bm.verts.new(kit.g2b(*p)) for p in pts]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    sk = o.modifiers.new("Skin", "SKIN")
    sk.use_smooth_shade = True
    for v, r in zip(me.skin_vertices[0].data, radii):
        v.radius = (r, r)
    me.skin_vertices[0].data[0].use_root = True
    sub = o.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = sub.render_levels = levels
    o["uv"] = "box"
    return o


def build_hands(M, coll):
    """Both hands: a palm shaped from a rounded block, four fingers and a thumb,
    each its own tube so it bends cleanly with its own bones."""
    parts = []
    for side, sx in (("Left", 1), ("Right", -1)):
        w, d, e, n = hand_frame(sx)

        def palm_point(u, t, z, cap):
            """Offset from the wrist of a palm surface point. u across the knuckles
            (-1 little finger, +1 index), t along the hand (0 wrist, 1 knuckles),
            z out of the palm (+1 palm side, -1 back); cap narrows the knuckle dome."""
            tc = min(1.0, max(0.0, t))
            width = 0.06 + 0.022 * min(1.0, tc / 0.6) ** 0.8  # a narrow wrist, widening to the knuckles
            thick = 0.031 + 0.006 * math.sin(math.pi * min(1.0, tc / 0.6)) - 0.008 * max(0.0, tc - 0.4) / 0.6
            lx, lz = u * width / 2 * cap, z * thick / 2 * cap
            back, front = max(0.0, -z), max(0.0, z)
            if t > 0:
                lz -= 0.003 * (1 - u * u) * back * cap  # the back arches over the bones
                for _, off, _, _ in FINGERS:  # each metacarpal: a knuckle dome and a tendon fanning to the wrist
                    uk = off / 0.041
                    lz -= 0.0042 * math.exp(-((u - uk) / 0.14) ** 2 - ((t - 0.97) / 0.08) ** 2) * back
                    ut = uk * (0.4 + 0.6 * tc)
                    lz -= 0.0007 * math.exp(-((u - ut) / 0.12) ** 2) * math.sin(math.pi * min(1.0, max(0.0, (t - 0.15) / 0.75))) * back
                # the palm side: the thumb's pad, the heel pad opposite, the hollow, the heart line
                lz += (0.0055 * max(0.0, u) ** 1.5 * (1 - tc) + 0.003 * max(0.0, -u) * (1 - tc) ** 0.5
                       - 0.0025 * (1 - u * u) * math.sin(math.pi * tc)
                       - 0.0007 * math.exp(-((t - 0.72 + 0.12 * u) / 0.035) ** 2)) * front
            lz -= 0.0022 * math.exp(-((u + 0.8) / 0.25) ** 2 - ((t - 0.02) / 0.08) ** 2) * back  # the ulna's knob, little-finger side
            lz += -0.001 * math.exp(-(t / 0.03) ** 2) * front  # the wrist crease
            return e * lx + d * (t * 0.094 - 0.008) + n * lz

        bm = bmesh.new()
        ring_n = 36
        # along the hand: from inside the cuff, through the palm, then a dome over the knuckles
        stations = [(t, 1.0) for t in np.linspace(-0.2, 0.9, 16)]
        stations += [(0.9 + 0.15 * math.sin(math.radians(a)), math.cos(math.radians(a)) ** 0.6) for a in (15, 30, 45, 60, 72, 84)]
        rings = []
        for t, cap in stations:
            ring = []
            for k in range(ring_n):
                th = k / ring_n * 2 * math.pi
                c_, s_ = math.cos(th), math.sin(th)
                u = math.copysign(abs(c_) ** 0.8, c_)  # a rounded oblong, flatter on the faces
                z = math.copysign(abs(s_) ** 0.85, s_)
                ring.append(palm_point(u, t, z, cap))
            if t < 0:  # inside the cuff it narrows into the forearm
                ring = [q * (1 + 0.12 * t) for q in ring]
            rings.append([bm.verts.new(Vector(kit.g2b(*(w + q)))) for q in ring])
        for r0, r1 in zip(rings, rings[1:]):
            for k in range(ring_n):
                bm.faces.new((r0[k], r0[(k + 1) % ring_n], r1[(k + 1) % ring_n], r1[k]))
        for ring, t in ((rings[0], stations[0][0]), (rings[-1], None)):
            c = sum((v.co for v in ring), Vector()) / ring_n
            if t is None:  # the very end of the dome
                c = c + Vector(kit.g2b(*(d * 0.004)))
            cv = bm.verts.new(c)
            for k in range(ring_n):
                bm.faces.new((ring[k], ring[(k + 1) % ring_n], cv))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])  # the frame is mirrored per side
        palm = kit.mesh_obj(f"diver_palm_{side}", bm, M["skin"], coll, (0, 0, 0), (0, 0, 0))
        for poly in palm.data.polygons:
            poly.use_smooth = True
        palm["uv"] = "box"
        palm["bones"] = ",".join([f"{side}Hand", f"{side}LowerArm"] + [f"{side}{f}{b}" for f, *_ in FINGERS for b in ("Metacarpal", "Proximal")]
                                 + [f"{side}ThumbMetacarpal"])
        palm["falloff"] = 0.016
        # the wrist end of the palm follows the hand bone; the rest, the metacarpals
        palm["segs"] = repr({f"{side}Hand": ([float(c) for c in w - d * 0.03], [float(c) for c in w + d * 0.012])})
        fingers = {}
        for fname, (pts, r) in finger_chains(sx).items():
            start = pts[0] - (pts[1] - pts[0]) / np.linalg.norm(pts[1] - pts[0]) * 0.012  # rooted inside the palm
            # Each joint swells into a knuckle and each segment narrows between
            # them, so the finger reads as three bones, not one tube.
            knuckle = (1.2, 1.06, 1.02, 0.88)  # at the base knuckle, the two middle joints, the tip
            waist = (0.86, 0.82, 0.8)  # mid-segment
            chain, radii = [start, pts[0]], [r * 1.05, r * knuckle[0]]
            for k in range(3):
                a, b = pts[k], pts[k + 1]
                chain += [a + (b - a) * 0.5, b]
                radii += [r * waist[k] * (1 - 0.07 * k), r * knuckle[k + 1] * (1 - 0.07 * k)]
            if fname == "Thumb":  # its first bone is wrapped in the thumb's muscle, a mound joining it to the palm
                radii = [0.017, 0.0175, 0.0155, 0.0128, 0.0112, 0.0118, 0.0106, 0.0094]
            o = skin_chain(f"diver_{side}{fname}", M["skin"], coll, chain, radii, levels=3)  # fine: only the fused hand keeps its shape
            names = ("Metacarpal", "Proximal", "Distal") if fname == "Thumb" else ("Proximal", "Intermediate", "Distal")
            root = f"{side}Hand" if fname == "Thumb" else f"{side}{fname}Metacarpal"
            o["bones"] = ",".join([root] + [f"{side}{fname}{nm}" for nm in names])
            o["falloff"] = 0.009
            fingers[fname] = o
        web = build_web(side, sx, palm_point, M, coll)
        sub = palm.modifiers.new("Subsurf", "SUBSURF")  # smooth the palm's loft for the distance field
        sub.levels = sub.render_levels = 2
        for o in (palm, *fingers.values(), web):
            kit.finalize(o)
        hand = fuse_hand(side, palm, fingers, web, M, coll)
        parts.append(hand)
        for fname, o in fingers.items():
            parts.append(build_nail(hand, o["bones"], o["falloff"], side, fname, M, coll))
        for o in (palm, *fingers.values(), web):
            bpy.data.objects.remove(o)
    return parts


def _smin(a, b, k):
    """Polynomial smooth minimum: the union of two distance fields with a
    rounded fillet k wide where they meet."""
    h = np.clip(k - np.abs(a - b), 0.0, None) / k
    return np.minimum(a, b) - h * h * k * 0.25


WEB_HALF = 0.0032  # half the web's thickness
FUSE_STEP = 0.0009  # metres per voxel when the hand's parts are fused into one skin
FUSE_TRIS = 5000  # triangles per fused hand
WEIGHT_RELAX = 4  # passes of weight smoothing over the fused hand


def fuse_hand(side, palm, fingers, web, M, coll):
    """One seamless hand from its parts: each part becomes a signed distance
    field, the fingers, the thumb and the web are blended into the palm with
    a rounded fillet (the fingers stay apart from each other), and the
    surface is rebuilt with marching cubes and reduced to FUSE_TRIS. Its
    weights blend each part's own bone weights across the fillets."""
    from skimage.measure import marching_cubes  # build-time only: pip install scikit-image
    parts = {"palm": palm, "web": web, **fingers}
    bvh = {k: BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get()) for k, o in parts.items()}
    boxes = {}
    for k, o in parts.items():
        vs = np.array([tuple(v.co) for v in o.data.vertices])
        boxes[k] = (vs.min(0) - 0.008, vs.max(0) + 0.008)
    lo = np.min([b[0] for b in boxes.values()], 0)
    hi = np.max([b[1] for b in boxes.values()], 0)
    h = FUSE_STEP
    axes = [np.arange(lo[i], hi[i] + h, h) for i in range(3)]
    gx, gy, gz = np.meshgrid(*axes, indexing="ij")
    pts = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], 1)
    field = {}
    for k in parts:
        d = np.full(len(pts), 0.05)
        b0, b1 = boxes[k]
        idx = np.nonzero(np.all((pts >= b0) & (pts <= b1), 1))[0]
        tree = bvh[k]
        for i in idx:
            co = Vector(pts[i])
            loc, nrm, _, dist = tree.find_nearest(co)
            if k == "web":  # a sheet: thick by WEB_HALF either side, no inside to test
                d[i] = dist - WEB_HALF
            else:
                d[i] = dist if (co - loc).dot(nrm) >= 0 else -dist
        field[k] = d
    base = _smin(field["palm"], field["web"], 0.003)
    sdf = _smin(base, field["Thumb"], 0.006)
    for f, *_ in FINGERS:
        sdf = np.minimum(sdf, _smin(base, field[f], 0.0042))
    vol = sdf.reshape(gx.shape)
    verts, faces, _, _ = marching_cubes(vol, level=0.0, spacing=(h, h, h))
    verts += lo
    bm = bmesh.new()
    bv = [bm.verts.new(Vector(v)) for v in verts]
    for f in faces:
        try:
            bm.faces.new((bv[f[0]], bv[f[1]], bv[f[2]]))
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=h * 0.05)
    # keep only the hand itself: drop any stray bubbles the field leaves
    islands, seen = [], set()
    for f0 in bm.faces:
        if f0 in seen:
            continue
        stack, isle = [f0], []
        seen.add(f0)
        while stack:
            f = stack.pop()
            isle.append(f)
            for e in f.edges:
                for g_ in e.link_faces:
                    if g_ not in seen:
                        seen.add(g_)
                        stack.append(g_)
        islands.append(isle)
    islands.sort(key=len)
    for isle in islands[:-1]:
        bmesh.ops.delete(bm, geom=isle, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    for _ in range(4):  # even out the voxel ripple; volume-preserving, so fingers keep their size
        bmesh.ops.smooth_laplacian_vert(bm, verts=bm.verts[:], lambda_factor=0.6, lambda_border=0.0,
                                        use_x=True, use_y=True, use_z=True, preserve_volume=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = kit.mesh_obj(f"diver_hand_{side}", bm, M["skin"], coll, (0, 0, 0), (0, 0, 0))
    dec = o.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = min(1.0, FUSE_TRIS / max(1, len(faces)))
    o["uv"] = "box"
    kit.finalize(o)
    bm = bmesh.new()  # relax the reduced mesh: evens out the facets the reduction leaves
    bm.from_mesh(o.data)
    for _ in range(3):
        bmesh.ops.smooth_laplacian_vert(bm, verts=bm.verts[:], lambda_factor=0.5, lambda_border=0.0,
                                        use_x=True, use_y=True, use_z=True, preserve_volume=True)
    bm.to_mesh(o.data)
    bm.free()
    for poly in o.data.polygons:
        poly.use_smooth = True
    # weights: each part's own bone weights, blended by how near each part's surface is
    vs = np.array([tuple(v.co) for v in o.data.vertices])
    g = np.stack([vs[:, 0], vs[:, 2], -vs[:, 1]], 1)
    near = np.zeros((len(vs), len(parts)))
    for j, k in enumerate(parts):
        tree = bvh[k]
        for i, v in enumerate(vs):
            loc, nrm, _, dist = tree.find_nearest(Vector(v))
            if k == "web":
                near[i, j] = max(0.0, dist - WEB_HALF)
            else:
                near[i, j] = max(0.0, dist) if (Vector(v) - loc).dot(nrm) >= 0 else 0.0
    blend = np.exp(-(near - near.min(1, keepdims=True)) / 0.0018)
    blend /= blend.sum(1, keepdims=True)
    total = {}
    for j, (k, part) in enumerate(parts.items()):
        allowed = part["bones"].split(",")
        segs = ast.literal_eval(part["segs"]) if part.get("segs") else {}
        w = bone_weights(g, allowed, part["falloff"], segs)
        for c, n in enumerate(allowed):
            total[n] = total.get(n, 0) + blend[:, j] * w[:, c]
    write_weights(o, total, relax=WEIGHT_RELAX)
    o["weighted"] = True
    return o


def write_weights(o, total, relax):
    """Vertex groups from {bone: per-vertex weight}: relaxed across the surface
    (skin stretches evenly over joints instead of tearing where one part's
    weights meet another's), at most four influences, normalised."""
    names = list(total)
    W = np.stack([total[n] for n in names], 1)
    edges = np.array([tuple(e.vertices) for e in o.data.edges])
    deg = np.bincount(edges.ravel(), minlength=len(W)).astype(float)[:, None]
    for _ in range(relax):
        acc = np.zeros_like(W)
        np.add.at(acc, edges[:, 0], W[edges[:, 1]])
        np.add.at(acc, edges[:, 1], W[edges[:, 0]])
        W = 0.5 * W + 0.5 * acc / np.maximum(deg, 1)
    keep = np.argsort(-W, 1)[:, :4]
    mask = np.zeros_like(W, bool)
    np.put_along_axis(mask, keep, True, 1)
    W = np.where(mask, W, 0)
    W /= W.sum(1, keepdims=True)
    for c, n in enumerate(names):
        vg = o.vertex_groups.new(name=n)
        for i in np.nonzero(W[:, c] > 0.01)[0]:
            vg.add([int(i)], float(W[i, c]), "REPLACE")


def build_nail(finger, bones, falloff, side, fname, M, coll):
    """A fingernail: a thin, evenly curved shell over the back of the last
    finger bone, sized from the finger's measured thickness, ending before the
    fingertip rounds off."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(finger, dg)
    distal = f"{side}{fname}Distal"
    a_, b_ = (np.array(p) for p in BONES[distal][:2])
    ln = np.linalg.norm(b_ - a_)
    y = (b_ - a_) / ln
    curl = np.array(FINGER_CURL_TO[distal])
    back = -(curl - y * (curl @ y))  # the back of the finger: away from the way it curls
    back /= np.linalg.norm(back)
    side_ = np.cross(y, back)
    big = 1.25 if fname == "Thumb" else 1.0
    cols, rows = 9, 8
    # the finger's surface under every point of the nail, measured from the
    # bone's axis, then smoothed (an even curved shell, not a copy of the
    # finger's facets) but never let below the surface
    grid = []
    for i in range(rows):
        row = []
        for j in range(cols):
            a = j / (cols - 1) * 2 - 1
            s0 = 0.3 + 0.12 * (1 - math.sqrt(max(0.0, 1 - a * a)))  # the cuticle's curve
            s1 = 0.9 - 0.08 * a * a  # the rounded free edge, short of the fingertip's curve
            sv = i / (rows - 1)
            s_ = s0 + (s1 - s0) * sv
            ang = math.radians(50 * big) * a
            dirn = back * math.cos(ang) + side_ * math.sin(ang)
            origin = a_ + y * ln * s_
            hit = bvh.ray_cast(Vector(kit.g2b(*origin)), Vector(kit.g2b(*dirn)))
            row.append((a, sv, origin, dirn, hit[3] if hit[0] is not None else 0.007))
        grid.append(row)
    raw = np.array([[c[4] for c in row] for row in grid])
    pad = np.pad(raw, 1, mode="edge")
    smooth = sum(pad[1 + di:1 + di + rows, 1 + dj:1 + dj + cols] for di in (-1, 0, 1) for dj in (-1, 0, 1)) / 9
    surf = np.maximum(smooth, raw)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    outer, inner, uv = [], [], []
    for i in range(rows):
        orow, irow, uvrow = [], [], []
        for j in range(cols):
            a, sv, origin, dirn, _ = grid[i][j]
            rr = float(surf[i, j])
            lift = 0.00045 * (1 - 0.5 * abs(a)) * (1 - 0.5 * (1 - sv) ** 4)  # thinnest at the sides and under the cuticle
            orow.append(bm.verts.new(Vector(kit.g2b(*(origin + dirn * (rr + 0.0003 + lift))))))
            irow.append(bm.verts.new(Vector(kit.g2b(*(origin + dirn * (rr - 0.0006))))))
            uvrow.append((NAIL_U[0] + (NAIL_U[1] - NAIL_U[0]) * (a + 1) / 2, sv))
        outer.append(orow)
        inner.append(irow)
        uv.append(uvrow)

    def face(vs, uvs):
        f = bm.faces.new(vs)
        for lp, t in zip(f.loops, uvs):
            lp[uvl].uv = t
    for i in range(rows - 1):
        for j in range(cols - 1):
            q = ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))
            face([outer[r][c] for r, c in q], [uv[r][c] for r, c in q])
            face([inner[r][c] for r, c in reversed(q)], [uv[r][c] for r, c in reversed(q)])
    ring = [(0, j) for j in range(cols)] + [(i, cols - 1) for i in range(1, rows)]
    ring += [(rows - 1, j) for j in range(cols - 2, -1, -1)] + [(i, 0) for i in range(rows - 2, 0, -1)]
    for k in range(len(ring)):
        (r0, c0), (r1, c1) = ring[k], ring[(k + 1) % len(ring)]
        face([outer[r0][c0], outer[r1][c1], inner[r1][c1], inner[r0][c0]], [uv[r0][c0], uv[r1][c1], uv[r1][c1], uv[r0][c0]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = kit.mesh_obj(f"diver_nail_{side}{fname}", bm, M["skin"], coll, (0, 0, 0), (0, 0, 0))
    for poly in o.data.polygons:
        poly.use_smooth = True
    o["uv"] = "keep"
    o["bones"] = bones  # weighted like the finger under it, so the two bend as one
    o["falloff"] = falloff
    return o


def build_web(side, sx, palm_point, M, coll):
    """The web of skin between the thumb and the index finger: a fleshy sheet
    from the thumb's first bones to the side of the palm, its free edge curving
    back towards the wrist. It stretches between the thumb's bones and the
    index finger's, so the gap fills as the thumb swings out or tucks in."""
    w, d, e, n = hand_frame(sx)
    thumb = [np.array(p) for p in finger_chains(sx)["Thumb"][0]]
    line_a = [thumb[0], thumb[1], thumb[1] + (thumb[2] - thumb[1]) * 0.4]  # along the thumb

    def A(u):
        x = u * 2
        k = min(1, int(x))
        return line_a[k] + (line_a[k + 1] - line_a[k]) * (x - k)

    def B(u):  # along the index side of the palm, wrist to knuckle
        return w + palm_point(0.8, 0.1 + 0.8 * u, 0.0, 1.0)

    nu, nv = 12, 10
    grid = []
    for i in range(nu + 1):
        row = []
        for j in range(nv + 1):
            v = j / nv
            u = i / nu * (1 - 0.34 * math.sin(math.pi * v) ** 0.8)  # the free edge curves back
            row.append((A(u) * (1 - v) + B(u) * v, i / nu))
        grid.append(row)
    # the web's centre sheet; fuse_hand gives it its thickness (WEB_HALF), which
    # also rounds its free edge
    bm = bmesh.new()
    vv = [[bm.verts.new(Vector(kit.g2b(*grid[i][j][0]))) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((vv[i][j], vv[i][j + 1], vv[i + 1][j + 1], vv[i + 1][j]))
    o = kit.mesh_obj(f"diver_web_{side}", bm, M["skin"], coll, (0, 0, 0), (0, 0, 0))
    for poly in o.data.polygons:
        poly.use_smooth = True
    o["uv"] = "box"
    # the palm side follows the index finger's metacarpal (it barely moves), never
    # its first finger bone, which swings 90 degrees into a fist and would tear the web
    o["bones"] = ",".join(f"{side}{b}" for b in ("Hand", "ThumbMetacarpal", "ThumbProximal", "IndexMetacarpal"))
    o["falloff"] = 0.014
    return o


def superellipse(cx, cz_, w, bottom, top, n_pts=16, p_low=3.2, p_high=2.2):
    """A boot cross-section in the x-y plane at depth cz_: flat-bottomed,
    rounded on top."""
    out = []
    for k in range(n_pts):
        a = k / n_pts * 2 * math.pi
        c, s_ = math.cos(a), math.sin(a)
        p = p_low if s_ < 0 else p_high
        x = w / 2 * math.copysign(abs(c) ** (2 / p), c)
        y = (bottom + top) / 2 + (top - bottom) / 2 * math.copysign(abs(s_) ** (2 / p), s_)
        out.append((cx + x, y, cz_))
    return out


def build_boots(M, coll):
    """Work boots: a last-shaped upper lofted heel to toe, a flat sole with a
    heel block, laces over the instep and an ankle shaft the trousers tuck
    into (art bible 5.1)."""
    parts = []
    B = M["boots"]
    # (t heel to toe, width, top, toe spring): the heel rises into the ankle shaft, the instep
    # slopes down to the toe box; one closed piece, so there is no joint between foot and shaft
    profile = ((0.0, 0.09, 0.2, 0.0), (0.1, 0.104, 0.205, 0.0), (0.22, 0.108, 0.205, 0.0), (0.32, 0.104, 0.185, 0.0),
               (0.4, 0.1, 0.14, 0.0), (0.5, 0.1, 0.105, 0.0), (0.62, 0.102, 0.08, 0.0), (0.74, 0.102, 0.066, 0.001),
               (0.85, 0.096, 0.058, 0.004), (0.94, 0.08, 0.052, 0.009), (1.0, 0.05, 0.044, 0.015))
    z0, z1, sole = -0.07, 0.205, 0.013
    for side, sx in (("Left", 1), ("Right", -1)):
        cx = sx * 0.11
        bm = bmesh.new()
        rings = []
        for t, wd, top, spring in profile:
            z = z0 + (z1 - z0) * t
            rings.append([bm.verts.new(kit.g2b(*p)) for p in superellipse(cx, z, wd, sole + spring, top + spring)])
        for a, b in zip(rings, rings[1:]):
            for j in range(16):
                bm.faces.new((a[j], a[(j + 1) % 16], b[(j + 1) % 16], b[j]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        upper = kit.mesh_obj(f"diver_boot_{side}", bm, B, coll, (0, 0, 0), (0, 0, 0))
        sub = upper.modifiers.new("Subsurf", "SUBSURF")
        sub.levels = sub.render_levels = 1
        for poly in upper.data.polygons:
            poly.use_smooth = True
        upper["uv"] = "box"
        parts.append(upper)
        # the sole: the footprint, extruded, with a heel block under the back
        foot = [(cx + wd / 2 * 1.04, z0 + (z1 - z0) * t) for t, wd, _, _ in profile]
        foot += [(cx - wd / 2 * 1.04, z0 + (z1 - z0) * t) for t, wd, _, _ in reversed(profile)]
        bm = bmesh.new()
        vs = [bm.verts.new(kit.g2b(x, 0.0, z)) for x, z in foot]
        face = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        moved = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=kit.g2b(0, sole + 0.002, 0), verts=moved)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        so = kit.mesh_obj(f"diver_sole_{side}", bm, B, coll, (0, 0, 0), (0, 0, 0))
        kit.bevel(so, 0.003, 2, weighted=False)
        so["uv"] = "box"
        parts.append(so)
        parts.append(kit.box(f"diver_heel_{side}", B, coll, (cx, -0.004 + 0.012, z0 + 0.04), (0.066, 0.024, 0.06), bev=0.004))
        # laces across the instep, lying on its slope, and the tongue's edge beside them
        ts = [q[0] for q in profile]
        tops = [q[2] + q[3] for q in profile]
        for k in range(5):
            t = 0.36 + k * 0.06
            z = z0 + (z1 - z0) * t
            top = float(np.interp(t, ts, tops))
            dt = 0.01
            slope = math.atan2(float(np.interp(t + dt, ts, tops)) - float(np.interp(t - dt, ts, tops)), (z1 - z0) * 2 * dt)
            # the box is tipped about game x to lie on the instep (Blender Euler x is the same axis)
            parts.append(kit.box(f"diver_lace_{side}{k}", B, coll, (cx, top - 0.004, z), (0.05, 0.006, 0.006), rot=(slope, 0, 0), bev=0.0015))
        for o in parts[-8:]:
            o["bones"] = f"{side}Foot,{side}Toes,{side}LowerLeg"
            o["falloff"] = 0.045
    return parts


# ---------- the body ----------
# The body is built like the hands: anatomical masses (bones' cores, muscles,
# fat) as distance fields, blended with smooth unions, rebuilt as one surface
# by marching cubes, reduced to BODY_TRIS and weighted region by region.

BODY_STEP = 0.0045  # metres per voxel
BODY_TRIS = 12000


def _sd_round_cone(p, a, b, ra, rb):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1) - (ra + (rb - ra) * t)


def _sd_ellipsoid(p, c, frame, radii):
    q = (p - c) @ frame.T  # into the ellipsoid's axes
    r = np.asarray(radii)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def _limb_frame(a, b, sx):
    """Axes of a limb segment: along it, outward from the body, to the front."""
    u = (b - a) / np.linalg.norm(b - a)
    f = np.array((0.0, 0.0, 1.0)) - u * u[2]
    f /= np.linalg.norm(f)
    o = np.cross(f, u)
    if o[0] * sx < 0:
        o = -o
    return np.stack([u, o, f])


AXES = np.eye(3)  # world-aligned: (x across, y up, z front)
RIBS = (np.array((0.0, 1.31, 0.0)), AXES, (0.138, 0.14, 0.1))  # the upper ribcage, widest at the armpits: pecs and lats lie over it


def body_regions():
    """{region: (bones, [primitive, ...][, weighting segments])}; a primitive is (kind, args, k):
    kind "e" an ellipsoid (centre, frame, radii along the frame's axes),
    "c" a round cone (a, b, ra, rb), "s" a layer over an ellipsoid (the
    ellipsoid, the layer's thickness, the ellipsoid outlining it: a muscle
    sheet that follows the ribs); k is the fillet it blends in with."""
    P = lambda *v: np.array(v, float)
    torso = [
        ("e", (P(0, 0.945, -0.005), AXES, (0.13, 0.09, 0.09)), 0.0),  # pelvis, the basin
        ("e", (P(0, 0.96, -0.078), AXES, (0.045, 0.06, 0.016)), 0.02),  # the sacrum, flat at the base of the spine
        ("e", (P(0, 0.93, 0.05), AXES, (0.085, 0.06, 0.03)), 0.05),  # the lower belly, down to the pubic bone
        ("e", (P(0, 1.06, 0.0), AXES, (0.133, 0.12, 0.076)), 0.06),  # the waist: one long curve from the ribs out over the hips
        ("e", RIBS, 0.03),  # upper ribcage
        ("e", (P(0, 1.17, 0.0), AXES, (0.128, 0.11, 0.088)), 0.04),  # the lower ribs, tapering to the waist
        ("e", (P(0, 1.405, -0.014), AXES, (0.15, 0.058, 0.085)), 0.035),  # shoulder girdle: collarbones to shoulder blades
        ("s", (RIBS, 0.006, (P(0, 1.31, -0.1), AXES, (0.085, 0.15, 0.05))), 0.0),  # middle and lower trapezius: the diamond between the blades
        ("e", (P(0, 1.1, 0.05), AXES, (0.06, 0.14, 0.03)), 0.02),  # the abdominal wall, flat and firm
        ("c", (P(0, 1.41, -0.016), P(0, 1.635, 0.0), 0.06, 0.053), 0.025),  # neck
        ("e", (P(0, 0.87, 0.026), AXES, (0.055, 0.045, 0.045)), 0.025),  # groin
    ]
    for sx in (1, -1):
        torso += [
            ("s", (RIBS, 0.012, (P(sx * 0.075, 1.37, 0.1), AXES, (0.095, 0.07, 0.09))), 0.0),  # pectoral: a plate over the ribs
            ("s", (RIBS, 0.009, (P(sx * 0.11, 1.27, -0.07), AXES, (0.08, 0.15, 0.09))), 0.0),  # latissimus over the ribs
            ("c", (P(sx * 0.048, 1.478, -0.033), P(sx * 0.17, 1.428, -0.03), 0.026, 0.016), 0.045),  # upper trapezius, sloping from the neck down to the shoulder's point
            ("c", (P(sx * 0.115, 1.415, -0.07), P(sx * 0.19, 1.405, -0.045), 0.026, 0.03), 0.04),  # the back of the shoulder: blade into rear deltoid
            ("e", (P(sx * 0.03, 1.13, -0.066), AXES, (0.032, 0.19, 0.021)), 0.025),  # the long muscles beside the spine, mid-back to pelvis
            ("s", (RIBS, 0.01, (P(sx * 0.072, 1.36, -0.1), AXES, (0.05, 0.072, 0.05))), 0.0),  # the shoulder blade, a plate on the upper back
            ("c", (P(sx * 0.035, 1.395, -0.098), P(sx * 0.145, 1.44, -0.07), 0.006, 0.005), 0.016),  # its spine, the ridge out to the shoulder
            ("c", (P(sx * 0.1, 1.31, -0.075), P(sx * 0.165, 1.385, -0.045), 0.014, 0.017), 0.035),  # teres major: the back of the armpit, into the arm
            ("e", (P(sx * 0.066, 0.895, -0.05), AXES, (0.07, 0.08, 0.05)), 0.02),  # gluteus maximus
            ("e", (P(sx * 0.106, 0.95, -0.025), AXES, (0.036, 0.05, 0.05)), 0.05),  # gluteus medius, the upper outer hip
            ("e", (P(sx * 0.088, 0.99, 0.06), AXES, (0.012, 0.012, 0.01)), 0.03),  # the hip bone's front point
            ("e", (P(sx * 0.03, 0.985, -0.083), AXES, (0.009, 0.009, 0.006)), -0.006),  # a dimple of the lower back
        ]
    torso.append(("c", (P(0, 1.43, -0.104), P(0, 0.99, -0.088), 0.005, 0.004), -0.022))  # the furrow down the spine
    regions = {"torso": (["Hips", "Spine", "Chest", "UpperChest", "Neck", "Head", "LeftShoulder", "RightShoulder",
                          "LeftUpperLeg", "RightUpperLeg"], torso)}
    for side, sx in (("Left", 1), ("Right", -1)):
        S, E, W = (np.array(BONES[f"{side}UpperArm"][0], float), np.array(BONES[f"{side}LowerArm"][0], float),
                   np.array(BONES[f"{side}LowerArm"][1], float))
        ua, fa = _limb_frame(S, E, sx), _limb_frame(E, W, sx)
        Lu, Lf = np.linalg.norm(E - S), np.linalg.norm(W - E)
        u, o, f = ua
        v, o2, f2 = fa
        arm = [
            ("c", (S + u * 0.03, E, 0.034, 0.031), 0.0),  # the upper arm's core, its head tucked under the shoulder's point
            ("e", (S + u * 0.082 + o * 0.012 - f * 0.004, ua, (0.072, 0.046, 0.056)), 0.026),  # deltoid: rounds over the shoulder's point, no higher than it
            ("e", (S + u * Lu * 0.56 + f * 0.017, ua, (0.088, 0.033, 0.033)), 0.012),  # biceps
            ("e", (S + u * Lu * 0.44 - f * 0.021, ua, (0.1, 0.036, 0.034)), 0.012),  # triceps
            ("e", (E - f * 0.012, ua, (0.03, 0.032, 0.03)), 0.012),  # the elbow's point
            ("c", (E, W, 0.032, 0.021), 0.012),  # the forearm's core
            ("e", (E + v * Lf * 0.3 + o2 * 0.006, fa, (0.088, 0.04, 0.035)), 0.016),  # forearm muscles, thick below the elbow
            ("e", (W - v * 0.022, fa, (0.034, 0.028, 0.02)), 0.01),  # the wrist, flat and wide
        ]
        # the shoulder's cap goes with the upper arm, not the collarbone: weigh the
        # collarbone by its inner part only, and the upper arm from above its joint
        segs = {f"{side}Shoulder": (P(sx * 0.03, 1.43, -0.01), P(sx * 0.1, 1.44, -0.014)),
                f"{side}UpperArm": (S + np.array((-sx * 0.04, 0.03, 0.0)), E)}
        regions[f"arm_{side}"] = ([f"{side}Shoulder", f"{side}UpperArm", f"{side}LowerArm", f"{side}Hand", "UpperChest"], arm, segs)
        H, K, A = (np.array(BONES[f"{side}UpperLeg"][0], float), np.array(BONES[f"{side}LowerLeg"][0], float),
                   np.array(BONES[f"{side}LowerLeg"][1], float))
        th, sh = _limb_frame(H, K, sx), _limb_frame(K, A, sx)
        Lt, Ls = np.linalg.norm(K - H), np.linalg.norm(A - K)
        u, o, f = th
        v, o2, f2 = sh
        leg = [
            ("c", (H + u * 0.05, K, 0.066, 0.047), 0.0),  # the thigh's core, its top tucked into the pelvis
            ("e", (H + o * 0.044 + u * 0.07, th, (0.035, 0.026, 0.033)), 0.025),  # the greater trochanter: the hip's width
            ("e", (H + u * Lt * 0.22 + f * 0.04 + o * 0.018, th, (0.09, 0.03, 0.026)), 0.016),  # the hip flexors, front of the hip into the thigh
            ("e", (H + u * Lt * 0.48 + f * 0.024, th, (0.21, 0.062, 0.06)), 0.018),  # quadriceps
            ("e", (H + u * Lt * 0.84 + f * 0.018 - o * 0.028, th, (0.066, 0.04, 0.04)), 0.014),  # the teardrop above the knee
            ("e", (H + u * Lt * 0.45 + o * 0.026, th, (0.18, 0.046, 0.054)), 0.016),  # the outer thigh
            ("e", (H + u * Lt * 0.5 - f * 0.03, th, (0.19, 0.054, 0.05)), 0.016),  # hamstrings
            ("e", (H + u * Lt * 0.27 - o * 0.03, th, (0.13, 0.044, 0.054)), 0.018),  # the inner thigh
            ("e", (K, AXES, (0.047, 0.047, 0.046)), 0.016),  # the knee
            ("e", (K + f * 0.042, sh, (0.03, 0.025, 0.012)), 0.01),  # the kneecap
            ("c", (K, A, 0.043, 0.027), 0.012),  # the shin's core
            ("e", (K + v * Ls * 0.24 - f2 * 0.034 - o2 * 0.012, sh, (0.11, 0.035, 0.035)), 0.012),  # calf, inner head
            ("e", (K + v * Ls * 0.21 - f2 * 0.032 + o2 * 0.013, sh, (0.1, 0.032, 0.032)), 0.012),  # calf, outer head
            ("e", (K + v * Ls * 0.5 - f2 * 0.018, sh, (0.15, 0.038, 0.034)), 0.016),  # the deep calf muscle under them
            ("e", (K + v * Ls * 0.3 + f2 * 0.02 + o2 * 0.012, sh, (0.12, 0.021, 0.019)), 0.01),  # the shin muscle
            ("e", (P(sx * 0.11, 0.2, -0.006), AXES, (0.047, 0.06, 0.05)), 0.02),  # trousers bunched into the boot
        ]
        regions[f"leg_{side}"] = (["Hips", f"{side}UpperLeg", f"{side}LowerLeg", f"{side}Foot"], leg)
    return regions


REGION_JOIN = {"arm": 0.04, "leg": 0.034}  # fillets where the limbs meet the torso


def _region_field(p, prims):
    d = None
    for kind, args, k in prims:  # k > 0 blends in, 0 is a hard union, k < 0 carves a dimple with fillet |k|
        if kind == "e":
            di = _sd_ellipsoid(p, *args)
        elif kind == "c":
            di = _sd_round_cone(p, *args)
        else:
            base, thick, outline = args  # thickest inside the outline, fading out over its last 3 cm
            fade = np.clip(-_sd_ellipsoid(p, *outline) / 0.03, 0.0, 1.0)
            di = _sd_ellipsoid(p, *base) - thick * fade * fade * (3 - 2 * fade)
        if d is None:
            d = di
        elif k < 0:
            d = -_smin(-d, di, -k)  # smooth subtraction
        else:
            d = _smin(d, di, k) if k > 0 else np.minimum(d, di)
    return d


def body_field(p, regions, parts=False):
    """The body's distance field at game-space points (and each region's)."""
    fields = {r: _region_field(p, reg[1]).astype(np.float32) for r, reg in regions.items()}
    t = fields["torso"]
    out = None
    for r, d in fields.items():
        if r == "torso":
            continue
        j = _smin(t, d, REGION_JOIN[r.split("_")[0]])
        out = j if out is None else np.minimum(out, j)  # the limbs never blend into each other
    return (out, fields) if parts else out


def build_body(M, coll):
    """The body from neck to ankles (the head, hands and boots are their own
    pieces): anatomical masses fused into one skin, in the fitted base layer."""
    from skimage.measure import marching_cubes
    regions = body_regions()
    h = BODY_STEP
    lo, hi = np.array((-0.53, 0.06, -0.19)), np.array((0.53, 1.66, 0.19))
    axes = [np.arange(lo[i], hi[i] + h, h) for i in range(3)]
    gx, gy, gz = np.meshgrid(*axes, indexing="ij")
    pts = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], 1).astype(np.float32)
    sdf = np.concatenate([body_field(pts[i:i + 400000], regions) for i in range(0, len(pts), 400000)])
    verts, faces, _, _ = marching_cubes(sdf.reshape(gx.shape), level=0.0, spacing=(h, h, h))
    verts += lo
    bm = bmesh.new()
    bv = [bm.verts.new(Vector(kit.g2b(*v))) for v in verts]
    for f in faces:
        try:
            bm.faces.new((bv[f[0]], bv[f[1]], bv[f[2]]))
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=h * 0.05)
    for _ in range(3):
        bmesh.ops.smooth_laplacian_vert(bm, verts=bm.verts[:], lambda_factor=0.5, lambda_border=0.0,
                                        use_x=True, use_y=True, use_z=True, preserve_volume=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = kit.mesh_obj("char_diver_base", bm, M["cloth"], coll, (0, 0, 0), (0, 0, 0))
    dec = o.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = min(1.0, BODY_TRIS / max(1, len(faces)))
    o["uv"] = "box"
    kit.finalize(o)
    for m in ("skin", "boots"):
        o.data.materials.append(M[m])
    # cut the surface exactly where the shirt ends, under the middle of the
    # collar and of each cuff, so the skin's edge is a clean line hidden by the band
    cuts = [(np.array(COLLAR[0]), np.array((0.0, 1.0, 0.0)), 0.11)]
    for sx in (1, -1):
        centre = np.array(CUFF[0]) * (sx, 1, 1)
        axis = (np.array(CUFF[2]) - np.array(CUFF[1])) * (sx, 1, 1)
        cuts.append((centre, axis / np.linalg.norm(axis), 0.07))
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for centre, nrm, reach in cuts:
        cb, nb = Vector(kit.g2b(*centre)), Vector(kit.g2b(*nrm))
        near = [f for f in bm.faces if (f.calc_center_median() - cb).length < reach]
        geom = list({e for f in near for e in f.edges}) + near + list({v for f in near for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=cb, plane_no=nb)
    bm.to_mesh(o.data)
    bm.free()
    # skin above the collar and past the wrists; boots below the boot tops; the rest is the base layer
    for poly in o.data.polygons:
        c = poly.center  # Blender coords
        gp = np.array((c.x, c.z, -c.y))
        skin = gp[1] > COLLAR[0][1] and np.hypot(gp[0], gp[2] - COLLAR[0][2]) < 0.09
        for centre, nrm, reach in cuts[1:]:
            skin |= (np.linalg.norm(gp - centre) < reach) and (gp - centre) @ nrm > 0
        poly.material_index = 1 if skin else (2 if gp[1] < 0.17 else 0)
        poly.use_smooth = True
    # weights: each region's bones, blended by how near each region's surface is
    vs = np.array([tuple(v.co) for v in o.data.vertices])
    g = np.stack([vs[:, 0], vs[:, 2], -vs[:, 1]], 1)
    _, fields = body_field(g, regions, parts=True)
    names = list(regions)
    dist = np.stack([np.maximum(fields[r], 0.0) for r in names], 1)
    blend = np.exp(-(dist - dist.min(1, keepdims=True)) / 0.012)
    blend /= blend.sum(1, keepdims=True)
    total = {}
    for j, r in enumerate(names):
        allowed = regions[r][0]
        w = bone_weights(g, allowed, 0.035, regions[r][2] if len(regions[r]) > 2 else None)
        for c, n in enumerate(allowed):
            total[n] = total.get(n, 0) + blend[:, j] * w[:, c]
    write_weights(o, total, relax=4)
    o["weighted"] = True
    return o


# ---------- the rig ----------

def build_armature(coll):
    ad = bpy.data.armatures.new("rig_diver")
    rig = bpy.data.objects.new("rig_diver", ad)
    coll.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, parent) in BONES.items():
        b = ad.edit_bones.new(name)
        b.head = Vector(kit.g2b(*h))
        b.tail = Vector(kit.g2b(*t))
        b.roll = 0.0
    for name, (_, _, parent) in BONES.items():
        if parent:
            ad.edit_bones[name].parent = ad.edit_bones[parent]
            ad.edit_bones[name].use_connect = (ad.edit_bones[parent].tail - ad.edit_bones[name].head).length < 1e-4
    for b in ad.edit_bones:  # every bone's local x across the body, so "bend forward" is a rotation about x
        b.align_roll(Vector((0, -1, 0)) if abs((b.tail - b.head).normalized().z) > 0.7 else Vector((0, 0, 1)))
    for name, to in FINGER_CURL_TO.items():  # fingers and thumb: +x curls them into the palm (a grip)
        ad.edit_bones[name].align_roll(Vector(kit.g2b(*to)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def skin_uv(o, skin):
    """Point every skin face (not the nails) at the plain skin of the skin texture."""
    if o.get("uv") == "keep" or not o.data.uv_layers:
        return
    uvs = o.data.uv_layers.active.data
    for poly in o.data.polygons:
        if o.data.materials[poly.material_index] == skin:
            for li in poly.loop_indices:
                uvs[li].uv = SKIN_UV


def bone_weights(g, allowed, falloff, segs=None):
    """Weights (points x allowed bones) from the distance of game-space points
    to each bone's segment, sharpened, at most three influences."""
    segs = segs or {}
    d = np.zeros((len(g), len(allowed)))
    for j, n in enumerate(allowed):
        h, t = segs.get(n, BONES[n][:2])
        d[:, j] = seg_dist(g, np.array(h, float), np.array(t, float))
        if n.startswith("Left"):
            d[g[:, 0] < -0.02, j] = 9.0
        if n.startswith("Right"):
            d[g[:, 0] > 0.02, j] = 9.0
        if "Shoulder" in n:
            d[:, j] *= 1.6  # the clavicle only moves a little skin
        if n in ("Hips", "Spine", "Chest", "UpperChest", "Neck", "Head"):
            d[np.abs(g[:, 0]) > 0.2, j] = 9.0  # the trunk doesn't own the arms
    w = np.exp(-(d / falloff) ** 2 * 0.5) + 1e-9
    best = np.argsort(d, 1)[:, :3]
    mask = np.zeros_like(w, bool)
    np.put_along_axis(mask, best, True, 1)
    w = np.where(mask, w, 0)
    return w / w.sum(1, keepdims=True)


def part_weights(o, allowed, falloff):
    """Vertex groups from bone_weights. The body keeps each limb to its own
    side and the trunk's bones off the arms; a hand or boot only knows its
    own bones."""
    vs = np.array([tuple(o.matrix_world @ v.co) for v in o.data.vertices])
    g = np.stack([vs[:, 0], vs[:, 2], -vs[:, 1]], 1)  # Blender -> game
    segs = ast.literal_eval(o["segs"]) if o.get("segs") else {}  # bone -> (head, tail) used for weighting instead
    w = bone_weights(g, allowed, falloff, segs)
    for j, n in enumerate(allowed):
        vg = o.vertex_groups.get(n) or o.vertex_groups.new(name=n)
        for i in np.nonzero(w[:, j] > 0.01)[0]:
            vg.add([int(i)], float(w[i, j]), "REPLACE")


def bind(body, rig):
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    body.parent = rig


# ---------- the animations ----------
# A pose is {bone: (rx, ry, rz)} in degrees, about the bone's own axes (x across the body),
# checked with joint test renders: positive x bends the spine and neck forward, swings a
# thigh or upper arm forward, folds an elbow and lifts the toes; a knee folds back with
# negative x. A shoulder shrugs with +x and rolls forward with -z. Feet are counter-rotated
# to stay level. Hips also take a location (x, y, z) in game metres.
LEAN = 1.0


def legs(pose, side, thigh, knee, foot_extra=0.0):
    """A leg from the thigh and knee angles, the foot kept level unless told otherwise."""
    pose[f"{side}UpperLeg"] = (thigh, 0, 0)
    pose[f"{side}LowerLeg"] = (-knee, 0, 0)
    pose[f"{side}Foot"] = (-(thigh - knee) + foot_extra, 0, 0)

def key_pose(rig, frame, pose, hips_loc=(0, 0, 0)):
    for pb in rig.pose.bones:
        rx, ry, rz = pose.get(pb.name, (0, 0, 0))
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
        pb.keyframe_insert("rotation_euler", frame=frame)
    hb = rig.pose.bones["Hips"]
    # pose-bone location is in the bone's rest frame, which for Hips is the game's (x left, y up, z forward)
    hb.location = (hips_loc[0], hips_loc[1], hips_loc[2])
    hb.keyframe_insert("location", frame=frame)


ARM_HANG = 27.0 - ARM_DROP  # degrees the arms come down from the rig's pose: hanging close to the body, just clear of the hips
HAND_RELAX = ((10.0, 14.0, 8.0), (4.0, 10.0, 8.0))  # fingers (first, middle, last joint), thumb: a relaxed hand


def arms_down(pose, swing=0.0, bend=14.0, shrug=-2.0):
    """Arms hanging naturally from the A-pose: close to the body, the elbows
    soft, palms to the thighs, shoulders relaxed down (`shrug`), the hands
    loosely curled. The left arm swings forward by `swing` degrees and the
    right arm back; the elbow folds by `bend`, more as the arm comes forward,
    and the shoulder rolls with the arm."""
    for side, sx in (("Left", 1), ("Right", -1)):
        s = swing * (1 if side == "Left" else -1)
        pose[f"{side}Shoulder"] = (shrug, 0, -0.22 * s)
        pose[f"{side}UpperArm"] = (s + 3.0, 0, -sx * ARM_HANG)  # a little forward of straight down, as arms hang
        pose[f"{side}LowerArm"] = (bend + max(0.0, s) * 0.7, 0, 0)
        pose[f"{side}Hand"] = (-0.15 * s, 0, 0)  # the wrist trails the swing
        for f, *_ in FINGERS:
            for nm, a in zip(("Proximal", "Intermediate", "Distal"), HAND_RELAX[0]):
                pose[f"{side}{f}{nm}"] = (a, 0, 0)
        for nm, a in zip(("Metacarpal", "Proximal", "Distal"), HAND_RELAX[1]):
            pose[f"{side}Thumb{nm}"] = (a, 0, 0)
    return pose


def cycle(rig, name, frames, stride, knee, arm, bob, lean, crouch=0.0, elbow=15.0, ankle=12.0,
          yaw=7.0, drop=4.0, sway=0.022, twist=10.0):
    """A walk/run cycle in place: legs swing by `stride`, knees bend by `knee`,
    arms counter-swing and the body leans forward. The pelvis turns with the
    forward leg (`yaw`), dips on the swinging leg's side (`drop`) and shifts
    over the planted foot (`sway`, metres); the chest twists against it
    (`twist`) and bends sideways to keep the shoulders level; the neck
    cancels both so the head keeps looking where the Diver goes. The body
    is highest passing over the planted foot, lowest as the heel lands."""
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    for f in range(0, frames + 1, 2):
        ph = f / frames * 2 * math.pi
        s = math.sin(ph)
        pose = {}
        swing = {}
        for side, sgn in (("Left", 1), ("Right", -1)):
            leg = s * sgn
            lift = max(0.0, -math.cos(ph + (0 if sgn > 0 else math.pi)))  # the knee folds as the leg swings through
            swing[side] = lift
            # the ankle: toes up as the heel strikes in front, pushing off through the toes behind
            legs(pose, side, stride * leg + crouch * 1.2, knee * (0.25 + lift) + crouch * 2.0, foot_extra=ankle * leg)
        arms_down(pose, swing=-arm * s, bend=elbow, shrug=2.5 * abs(math.sin(ph)))  # each arm swings against its own leg
        # the pelvis (Hips' axes match the game's: x left, y up, z forward)
        roll = drop * (swing["Right"] - swing["Left"])  # the swinging leg's hip dips
        pose["Hips"] = (0, -yaw * s, roll)  # -y turns the left hip forward with the left leg
        pose["Spine"] = (LEAN * (lean + crouch * 0.4), twist * 0.6 * s, -roll * 0.8)  # twist back against the pelvis, level the shoulders
        pose["Chest"] = (0, twist * 0.4 * s, -roll * 0.3)
        pose["Neck"] = (-LEAN * (lean * 0.6 + crouch * 0.3), (yaw - twist) * s, roll * 0.1)  # the head looks ahead through it all
        x = sway * (swing["Right"] - swing["Left"])  # over the planted foot
        y = -bob * abs(math.sin(ph)) - crouch * 0.0063  # high passing over the foot, low at heel strike; bent legs lower the hips
        key_pose(rig, f, pose, (x, y, 0))
    return act


def build_actions(rig):
    rig.animation_data_create()
    acts = []
    # idle: breathing, a slow weight shift
    act = bpy.data.actions.new("idle")
    rig.animation_data.action = act
    for f in range(0, 91, 10):
        ph = f / 90 * 2 * math.pi
        pose = arms_down({}, swing=1.5 * math.sin(ph))
        pose["Chest"] = (-1.5 * math.sin(ph), 0, 0)
        pose["Spine"] = (LEAN * 2, 0, 1.2 * math.sin(ph))
        for side in ("Left", "Right"):
            legs(pose, side, 4, 7)  # knees soft, never locked
            pose[f"{side}UpperLeg"] = (4, 0, 1.5 * math.sin(ph))
        key_pose(rig, f, pose, (0.006 * math.sin(ph), -0.002 - 0.004 * (1 + math.sin(ph * 2)) / 2, 0))
    acts.append(act)
    acts.append(cycle(rig, "walk", 32, stride=24, knee=30, arm=18, bob=0.025, lean=4, elbow=18, ankle=12, yaw=7, drop=4, sway=0.022, twist=10))
    acts.append(cycle(rig, "run", 20, stride=38, knee=62, arm=40, bob=0.05, lean=12, elbow=85, ankle=18, yaw=10, drop=5, sway=0.012, twist=16))
    # crouch: hips dropped, knees bent, leaning forward
    act = bpy.data.actions.new("crouch_idle")
    rig.animation_data.action = act
    for f in range(0, 61, 15):
        ph = f / 60 * 2 * math.pi
        pose = arms_down({}, swing=2 * math.sin(ph), bend=30)
        for side in ("Left", "Right"):
            legs(pose, side, 62, 100)
        pose["Spine"] = (LEAN * (24 + 1.5 * math.sin(ph)), 0, 0)
        pose["Neck"] = (-LEAN * 18, 0, 0)
        key_pose(rig, f, pose, (0, -0.318, 0.0))  # as far as the bent legs (thigh 62, knee 100) bring the hips down
    acts.append(act)
    acts.append(cycle(rig, "crouch_walk", 36, stride=20, knee=22, arm=10, bob=0.015, lean=18, crouch=48, elbow=40, ankle=8, yaw=5, drop=3, sway=0.03, twist=7))
    # jump: crouch, launch, tuck, reach for the ground
    act = bpy.data.actions.new("jump")
    rig.animation_data.action = act
    for f, thigh, knee, arm, y in ((0, -10, 18, 0, -0.04), (4, 6, 4, -30, 0.0), (10, -40, 70, -20, 0.02), (18, -25, 40, 10, 0.0), (24, -10, 15, 0, -0.02)):
        pose = arms_down({}, swing=arm)
        for side in ("Left", "Right"):
            legs(pose, side, -thigh, knee)
        pose["Spine"] = (LEAN * 8, 0, 0)
        key_pose(rig, f, pose, (0, y, 0))
    acts.append(act)
    for act in acts:  # each action on its own NLA track so the glTF exporter writes them all
        tr = rig.animation_data.nla_tracks.new()
        tr.name = act.name
        tr.strips.new(act.name, 0, act)
        act.use_fake_user = True
    rig.animation_data.action = None
    return acts


# ---------- render & export ----------

def studio(cam, look, out, res=(1200, 900), samples=48):
    scn = bpy.context.scene
    for o in [o for o in scn.objects if o.name.startswith("studio_")]:
        bpy.data.objects.remove(o)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6.0)
    kit.mesh_obj("studio_floor", bm, kit.pbr("mat_studio", None, tint=(0.09, 0.08, 0.07), rough=0.85), scn.collection, (0, 0, 0))
    kit.add_light("studio_key", "AREA", (1.6, 2.6, 2.4), (1.0, 0.85, 0.7), 420, coll=scn.collection, size=1.5)
    kit.add_light("studio_fill", "AREA", (-2.2, 1.6, 1.2), (0.8, 0.82, 0.86), 140, coll=scn.collection, size=2.0)
    kit.add_light("studio_rim", "AREA", (0.0, 2.2, -2.4), (1.0, 0.9, 0.8), 260, coll=scn.collection, size=1.2)
    for o in scn.objects:
        if o.name.startswith("studio_") and o.type == "LIGHT":
            d = Vector(kit.g2b(0, 1.0, 0)) - o.location
            o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    kit.setup_render(out, cam, look, fov=34, res=res, samples=samples)
    scn.world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.028, 0.025, 1)


def pose_sheet(rig, act, out_dir, n=6):
    """Renders n frames across an action into one contact sheet."""
    from PIL import Image
    rig.animation_data.action = act
    f0, f1 = act.frame_range
    sheet = Image.new("RGB", (480 * n, 1200))
    for row, cam in enumerate(((2.6, 1.3, 1.6), (0.0, 1.1, 3.4))):  # three-quarter, then front on (sway, hip drop)
        for k in range(n):
            f = f0 + (f1 - f0) * k / n
            bpy.context.scene.frame_set(int(round(f)))
            p = os.path.join(out_dir, f"diver_{act.name}_{row}_{k}.png")
            studio(cam, (0, 0.85, 0), p, res=(480, 600), samples=16)
            sheet.paste(Image.open(p), (480 * k, 600 * row))
    sheet.save(os.path.join(out_dir, f"sheet_diver_{act.name}.png"))
    rig.animation_data.action = None


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(kit.WORK, exist_ok=True)
    bpy.context.scene.render.fps = FPS
    M = materials()
    coll = bpy.data.collections.new("char_diver")
    bpy.context.scene.collection.children.link(coll)
    body = build_body(M, coll)
    head = build_head(M, coll)
    bands = trims(M, coll)
    hands = build_hands(M, coll)
    boots = build_boots(M, coll)
    trunk_bones = [n for n in BONES if n not in FINGER_BONES]
    for o in (body, head, *bands, *hands, *boots):
        if o.get("weighted"):  # the fused hands come finalized and weighted
            skin_uv(o, M["skin"])
            continue
        kit.finalize(o)
        skin_uv(o, M["skin"])
        if o.get("bones"):
            part_weights(o, o["bones"].split(","), o["falloff"])
        else:
            part_weights(o, [n for n in trunk_bones if "Toes" not in n], 0.035)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (head, *bands, *hands, *boots):
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    rig = build_armature(coll)
    bind(body, rig)
    acts = build_actions(rig)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f"diver: vertices {len(body.data.vertices)}  triangles {tris}  materials {len(body.data.materials)}  bones {len(BONES)}  actions {[a.name for a in acts]}")
    if "--render" in sys.argv:
        hw = hand_frame(1)[0]  # the left wrist, for the hand close-ups
        views = (((2.4, 1.4, 3.4), (0, 0.95, 0)), ((-2.6, 1.5, -3.0), (0, 0.95, 0)), ((0.6, 1.65, 1.1), (0, 1.55, 0)),
                 (tuple(hw + (0.38, 0.02, 0.44)), tuple(hw + (0.02, -0.08, 0.01))), ((0.55, 0.32, 0.65), (0.1, 0.06, 0.06)),
                 (tuple(hw + (-0.26, -0.03, 0.84)), tuple(hw + (0.0, -0.08, 0.02))),  # + a hand from the side, the boots, a hand from the front
                 ((0, 1.0, 3.6), (0, 0.92, 0)), ((0, 1.0, -3.6), (0, 0.92, 0)),  # front, back
                 ((3.6, 1.0, 0), (0, 0.92, 0)), ((-3.6, 1.0, 0), (0, 0.92, 0)))  # left side, right side
        for k, (cam, look) in enumerate(views):
            if k == 6:  # front, back and sides: as the Diver stands in the game (idle), not the A-pose it is rigged in
                rig.animation_data.action = acts[0]
                bpy.context.scene.frame_set(0)
            studio(cam, look, os.path.join(kit.WORK, f"preview_diver_{k}.png"))
        rig.animation_data.action = None
    if "--sheets" in sys.argv:
        only = (arg("--only") or "").split(",")
        for act in acts:
            if act.name in only or only == [""]:
                pose_sheet(rig, act, kit.WORK)
    if "--export" in sys.argv:
        os.makedirs(CMODELS, exist_ok=True)
        bpy.ops.object.select_all(action="DESELECT")
        body.select_set(True)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(CMODELS, "char_diver_base.glb"), export_format="GLB", use_selection=True,
            export_yup=True, export_apply=False, export_skins=True, export_animations=True,
            export_animation_mode="NLA_TRACKS", export_tangents=True, export_materials="EXPORT", export_image_format="AUTO",
        )


if __name__ == "__main__":
    main()
