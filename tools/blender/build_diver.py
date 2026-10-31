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

Run with the Blender Python module (bpy):
    python tools/blender/build_diver.py <work dir> [--render] [--sheets [--only walk,run]] [--export]
--export writes godot/models/characters/char_diver_base.glb.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402  (first: it makes bmesh and mathutils importable)
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Euler, Matrix, Quaternion, Vector  # noqa: E402

import build_quarters as kit  # noqa: E402

ROOT = kit.ROOT
CMODELS = os.path.join(ROOT, "godot", "models", "characters")
FPS = 30

# ---------- the skeleton (game space: y up, the Diver faces +z, its left is +x) ----------
# name: (head, tail, parent)
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
        f"{side}UpperArm": ((sx * 0.17, 1.45, -0.02), (sx * 0.33, 1.22, -0.02), f"{side}Shoulder"),
        f"{side}LowerArm": ((sx * 0.33, 1.22, -0.02), (sx * 0.47, 1.02, 0.01), f"{side}UpperArm"),
        f"{side}Hand": ((sx * 0.47, 1.02, 0.01), (sx * 0.53, 0.92, 0.02), f"{side}LowerArm"),
        f"{side}UpperLeg": ((sx * 0.095, 0.95, 0), (sx * 0.105, 0.52, 0.01), "Hips"),
        f"{side}LowerLeg": ((sx * 0.105, 0.52, 0.01), (sx * 0.11, 0.1, -0.01), f"{side}UpperLeg"),
        f"{side}Foot": ((sx * 0.11, 0.1, -0.01), (sx * 0.11, 0.035, 0.11), f"{side}LowerLeg"),
        f"{side}Toes": ((sx * 0.11, 0.035, 0.11), (sx * 0.11, 0.03, 0.18), f"{side}Foot"),
    })


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


# ---------- the body ----------
# The joint graph the skin modifier wraps: (name, position, (radius across, radius front-back)), and edges.
NODES = [
    ("pelvis", (0, 0.93, -0.012), (0.165, 0.125)),
    ("waist", (0, 1.06, 0.0), (0.15, 0.1)),
    ("ribs", (0, 1.2, 0.005), (0.165, 0.115)),
    ("chest", (0, 1.33, 0.012), (0.18, 0.12)),
    ("collar", (0, 1.44, -0.008), (0.17, 0.097)),
    ("neck", (0, 1.53, 0.0), (0.06, 0.062)),
    ("neck_top", (0, 1.61, 0.0), (0.055, 0.058)),  # runs up inside the head, which is modelled on its own
]
EDGES = [("pelvis", "waist"), ("waist", "ribs"), ("ribs", "chest"), ("chest", "collar"), ("collar", "neck"), ("neck", "neck_top")]
for side, sx in (("l", 1), ("r", -1)):
    NODES += [
        (f"shoulder_{side}", (sx * 0.195, 1.43, -0.015), (0.08, 0.074)),
        (f"bicep_{side}", (sx * 0.255, 1.33, -0.02), (0.054, 0.056)),
        (f"elbow_{side}", (sx * 0.33, 1.22, -0.02), (0.044, 0.044)),
        (f"forearm_{side}", (sx * 0.39, 1.13, -0.005), (0.046, 0.042)),
        (f"wrist_{side}", (sx * 0.465, 1.03, 0.01), (0.031, 0.023)),
        (f"palm_{side}", (sx * 0.505, 0.96, 0.015), (0.042, 0.019)),
        (f"fingers_{side}", (sx * 0.535, 0.895, 0.02), (0.036, 0.015)),
        (f"thumb_{side}", (sx * 0.49, 0.965, 0.052), (0.014, 0.014)),
        (f"hip_{side}", (sx * 0.1, 0.9, 0.0), (0.098, 0.1)),
        (f"thigh_{side}", (sx * 0.104, 0.72, 0.008), (0.085, 0.088)),
        (f"knee_{side}", (sx * 0.106, 0.52, 0.012), (0.058, 0.062)),
        (f"calf_{side}", (sx * 0.108, 0.37, -0.012), (0.062, 0.066)),
        (f"ankle_{side}", (sx * 0.11, 0.13, -0.008), (0.056, 0.06)),  # boot top
        (f"heel_{side}", (sx * 0.11, 0.05, -0.04), (0.052, 0.05)),
        (f"ball_{side}", (sx * 0.11, 0.045, 0.09), (0.056, 0.042)),
        (f"toe_{side}", (sx * 0.11, 0.045, 0.16), (0.048, 0.038)),
    ]
    EDGES += [("collar", f"shoulder_{side}"), (f"shoulder_{side}", f"bicep_{side}"), (f"bicep_{side}", f"elbow_{side}"),
              (f"elbow_{side}", f"forearm_{side}"), (f"forearm_{side}", f"wrist_{side}"),
              (f"wrist_{side}", f"palm_{side}"), (f"palm_{side}", f"fingers_{side}"), (f"palm_{side}", f"thumb_{side}"),
              ("pelvis", f"hip_{side}"), (f"hip_{side}", f"thigh_{side}"), (f"thigh_{side}", f"knee_{side}"),
              (f"knee_{side}", f"calf_{side}"), (f"calf_{side}", f"ankle_{side}"), (f"ankle_{side}", f"heel_{side}"),
              (f"heel_{side}", f"ball_{side}"), (f"ball_{side}", f"toe_{side}")]


def materials():
    """Three materials (art bible 8.4): the base clothes, the skin, the boots."""
    return {
        "cloth": kit.pbr("mat_diver_base_cloth_01", "canvas", tint=(0.5, 0.48, 0.42)),  # a faded, dusty base layer
        "skin": kit.pbr("mat_diver_skin_01", None, tint=(0.2, 0.12, 0.08), rough=0.55),  # linear values: a weathered mid skin tone
        "boots": kit.pbr("mat_diver_boots_01", "canvas", tint=(0.22, 0.18, 0.15)),
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
    band("diver_collar", M["cloth"], (0, 1.5, -0.002), 0.064, 0.024, (0, 1.42, -0.01), (0, 1.58, 0.005))
    for sx in (-1, 1):
        band(f"diver_cuff{sx}", M["cloth"], (sx * 0.455, 1.045, 0.008), 0.035, 0.026, (sx * 0.39, 1.13, -0.005), (sx * 0.47, 1.02, 0.01))
        band(f"diver_boot_top{sx}", M["boots"], (sx * 0.11, 0.14, -0.008), 0.064, 0.03, (sx * 0.11, 0.0, -0.008), (sx * 0.11, 0.3, -0.008), thick=0.008)
    return out


def build_body(M, coll):
    bm = bmesh.new()
    idx = {}
    for name, p, _ in NODES:
        idx[name] = bm.verts.new(kit.g2b(*p))
    for a, b in EDGES:
        bm.edges.new((idx[a], idx[b]))
    me = bpy.data.meshes.new("char_diver_base")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("char_diver_base", me)
    coll.objects.link(o)
    sk = o.modifiers.new("Skin", "SKIN")
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    rad = {name: r for name, _, r in NODES}
    for v, (name, _, _) in zip(me.skin_vertices[0].data, NODES):
        across, depth = rad[name]
        v.radius = (across, depth)  # Blender x = across, y = front-back (game z)
    me.skin_vertices[0].data[0].use_root = True
    sub = o.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = sub.render_levels = 2
    bpy.context.view_layer.objects.active = o
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
    o.modifiers.clear()
    o.data = me2
    for m in ("cloth", "skin", "boots"):
        o.data.materials.append(M[m])
    # skin above the collar and past the wrists; boots below the boot tops; the rest is the base layer
    for poly in o.data.polygons:
        c = poly.center  # Blender coords
        gx, gy = abs(c.x), c.z
        if gy > 1.505 or (gx > 0.458 and gy < 1.06):  # skin starts on the neck, above the collar
            poly.material_index = 1
        elif gy < 0.14:
            poly.material_index = 2
        else:
            poly.material_index = 0
        poly.use_smooth = True
    o["uv"] = "box"
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
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def skin_weights(body, rig):
    """Weights from the distance to each bone's segment, sharpened, with each
    limb kept to its own side and spine bones to the trunk."""
    vs = np.array([tuple(v.co) for v in body.data.vertices])
    g = np.stack([vs[:, 0], vs[:, 2], -vs[:, 1]], 1)  # Blender -> game
    names = list(BONES)
    d = np.zeros((len(vs), len(names)))
    for j, n in enumerate(names):
        h, t, _ = BONES[n]
        d[:, j] = seg_dist(g, np.array(h, float), np.array(t, float))
        if n.startswith("Left"):
            d[g[:, 0] < -0.02, j] = 9.0
        if n.startswith("Right"):
            d[g[:, 0] > 0.02, j] = 9.0
        if "Shoulder" in n:
            d[:, j] *= 1.6  # the clavicle only moves a little skin
        if n in ("Hips", "Spine", "Chest", "UpperChest", "Neck", "Head"):
            d[np.abs(g[:, 0]) > 0.2, j] = 9.0  # the trunk doesn't own the arms
    w = np.exp(-(d / 0.035) ** 2 * 0.5) + 1e-9
    best = np.argsort(d, 1)[:, :3]  # at most three influences
    mask = np.zeros_like(w, bool)
    np.put_along_axis(mask, best, True, 1)
    w = np.where(mask, w, 0)
    w /= w.sum(1, keepdims=True)
    for j, n in enumerate(names):
        vg = body.vertex_groups.new(name=n)
        for i in np.nonzero(w[:, j] > 0.01)[0]:
            vg.add([int(i)], float(w[i, j]), "REPLACE")
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


def arms_down(pose, swing=0.0, bend=12.0, shrug=0.0):
    """Arms hanging from the A-pose; the left arm swings forward by `swing`
    degrees and the right arm back. The elbow folds by `bend`, more as the
    arm comes forward; the shoulder rolls with the arm and lifts by `shrug`."""
    for side, sx in (("Left", 1), ("Right", -1)):
        s = swing * (1 if side == "Left" else -1)
        pose[f"{side}Shoulder"] = (shrug, 0, -0.22 * s)
        pose[f"{side}UpperArm"] = (s, 0, -sx * 22)
        pose[f"{side}LowerArm"] = (bend + max(0.0, s) * 0.7, 0, 0)
        pose[f"{side}Hand"] = (-0.15 * s, 0, 0)  # the wrist trails the swing
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
        pose["LeftUpperLeg"] = (0, 0, 1.5 * math.sin(ph))
        pose["RightUpperLeg"] = (0, 0, 1.5 * math.sin(ph))
        key_pose(rig, f, pose, (0.006 * math.sin(ph), -0.004 * (1 + math.sin(ph * 2)) / 2, 0))
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
    for o in (body, head, *bands):
        kit.finalize(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (head, *bands):
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    rig = build_armature(coll)
    skin_weights(body, rig)
    acts = build_actions(rig)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f"diver: vertices {len(body.data.vertices)}  triangles {tris}  materials {len(body.data.materials)}  bones {len(BONES)}  actions {[a.name for a in acts]}")
    if "--render" in sys.argv:
        for k, (cam, look) in enumerate((((2.4, 1.4, 3.4), (0, 0.95, 0)), ((-2.6, 1.5, -3.0), (0, 0.95, 0)), ((0.6, 1.65, 1.1), (0, 1.55, 0)))):
            studio(cam, look, os.path.join(kit.WORK, f"preview_diver_{k}.png"))
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
