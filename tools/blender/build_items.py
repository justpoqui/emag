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

ROOT = kit.ROOT
IMODELS = os.path.join(ROOT, "godot", "models", "items")
ITEM_TILE = 0.15  # metres per texture repeat on small items: a fine weave at hand size
R90 = math.pi / 2


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


def item_materials():
    """One material per item (art bible 8.4), tinted from the shared set."""
    return {
        "cloth_bone": kit.pbr("mat_item_cloth_bone_01", "canvas", tint=(0.92, 0.88, 0.78)),  # old sheets, washed thin
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


ITEMS = {"bandage": build_bandage}


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
    M = item_materials()
    for item in items:
        coll = bpy.data.collections.new(f"prop_{item}_01")
        bpy.context.scene.collection.children.link(coll)
        info = ITEMS[item](M, coll)
        for o in list(coll.objects):
            kit.finalize(o)
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
            bpy.ops.object.select_all(action="DESELECT")
            for o in coll.objects:
                o.select_set(True)
            bpy.ops.export_scene.gltf(
                filepath=os.path.join(IMODELS, f"prop_{item}_01.gltf"), export_format="GLTF_SEPARATE",
                export_texture_dir="../../textures/sanctuary", use_selection=True, export_apply=True, export_yup=True,
                export_tangents=True, export_lights=False, export_cameras=False, export_materials="EXPORT",
                export_image_format="AUTO",
            )


if __name__ == "__main__":
    main()
