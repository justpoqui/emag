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
godot/models/sanctuary/env_sanctuary_quarters.gltf (+ .bin) with --export.
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

    # The signboard has its own painted-board texture set: dark paint over
    # horizontal boards, cream lettering, chipped where hands and weather wore it.
    W, Hs = 1024, 256
    yy, xx = np.mgrid[0:Hs, 0:W] / np.array([Hs, W])[:, None, None]
    r = np.random.default_rng(31)
    def noise(sx, sy, oct_=4, seed=0):
        rr = np.random.default_rng(seed)
        acc = np.zeros((Hs, W))
        for o_ in range(oct_):
            f = 2 ** o_
            small = rr.random((int(sy * f) + 2, int(sx * f) + 2))
            acc += np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((W, Hs), Image.BICUBIC)).astype(float) / 255 / f
        return acc / acc.max()
    grain = noise(6, 40, 4, 1)  # boards run horizontally
    boards = (np.floor(yy * 3) % 3)
    seam = np.abs((yy * 3) % 1.0 - 0.5) * 2
    seam = np.clip((seam - 0.93) / 0.06, 0, 1)
    wood = np.stack([0.30 + 0.12 * grain, 0.23 + 0.09 * grain, 0.16 + 0.06 * grain], -1) * (0.9 + 0.08 * boards[..., None])
    paint = np.array([0.19, 0.22, 0.20]) * (0.92 + 0.12 * noise(3, 2, 3, 2))[..., None]
    chips = noise(14, 6, 5, 3)
    edge = np.minimum(np.minimum(xx, 1 - xx) * 8, np.minimum(yy, 1 - yy) * 4)
    keep = np.clip((chips - 0.35 + 0.25 * np.clip(edge, 0, 1)) * 6, 0, 1)  # paint wears off at the edges first
    letters = Image.new("L", (W, Hs), 0)
    d = ImageDraw.Draw(letters)
    d.text((W // 2, 104), "PATRON'S SANCTUARY", font=font(80), fill=255, anchor="mm")
    accent = Image.new("L", (W, Hs), 0)
    da = ImageDraw.Draw(accent)
    da.text((W // 2, 198), "REST  ·  REARM  ·  RETURN", font=font(42), fill=255, anchor="mm")
    da.line((150, 156, W - 150, 156), fill=255, width=4)
    let = np.asarray(letters).astype(float) / 255 * np.clip((chips - 0.2) * 5, 0, 1)
    acc = np.asarray(accent).astype(float) / 255 * np.clip((chips - 0.25) * 5, 0, 1)
    col = wood * (1 - keep[..., None]) + paint * keep[..., None]
    col = col * (1 - let[..., None]) + np.array([0.87, 0.81, 0.71]) * let[..., None]
    col = col * (1 - acc[..., None]) + np.array([0.78, 0.62, 0.42]) * acc[..., None]
    col *= (1 - 0.6 * seam)[..., None]
    soot = noise(2, 1, 3, 4)
    col *= (1 - 0.35 * np.clip(soot - 0.4, 0, 1) - 0.25 * np.clip(0.3 - yy, 0, 1))[..., None]  # lamp soot along the top
    height = 0.5 * grain + 0.25 * keep + 0.15 * (let + acc) - 0.8 * seam
    du = np.roll(height, -1, 1) - np.roll(height, 1, 1)
    dv = np.roll(height, -1, 0) - np.roll(height, 1, 0)
    n = np.stack([-du * 6, dv * 6, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rough = 0.86 - 0.14 * keep - 0.05 * (let + acc)
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, "sign_sanctuary_albedo.png"))
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(TEX, "sign_sanctuary_normal.png"))
    orm = np.stack([np.clip(1 - 0.5 * seam, 0, 1), np.clip(rough, 0, 1), np.zeros_like(rough)], -1)
    Image.fromarray((orm * 255).astype(np.uint8)).save(os.path.join(TEX, "sign_sanctuary_orm.png"))

    # The rug: its own woven pattern, faded and worn pale in the middle where people stand
    R = 1024
    yy, xx = np.mgrid[0:R, 0:R] / R - 0.5
    rad = np.sqrt(xx ** 2 + yy ** 2) * 2  # 0 centre, 1 rim
    bands = np.select([rad < 0.18, rad < 0.24, rad < 0.62, rad < 0.7, rad < 0.86, rad < 0.92], [0, 1, 2, 1, 3, 1], 2)
    pal = np.array([[0.52, 0.4, 0.34], [0.33, 0.27, 0.23], [0.47, 0.35, 0.3], [0.56, 0.5, 0.4]])  # faded, under ~35% saturation
    col = pal[bands]
    ang = np.arctan2(yy, xx)
    diamonds = (np.abs(((ang / np.pi * 12) % 2) - 1) + np.abs(((rad - 0.78) / 0.08)) < 0.6) & (rad > 0.7) & (rad < 0.86)
    col[diamonds] = [0.3, 0.22, 0.17]
    weave = (np.sin(np.arange(R) * 2 * np.pi / 6)[None, :] * np.sin(np.arange(R) * 2 * np.pi / 6)[:, None]) * 0.5 + 0.5
    big = np.asarray(Image.fromarray((r.random((16, 16)) * 255).astype(np.uint8)).resize((R, R), Image.BICUBIC)).astype(float) / 255
    worn = np.clip((1 - rad * 1.5) * (0.6 + 0.6 * big), 0, 1)
    col = col * (0.88 + 0.12 * weave)[..., None]
    col = col * (1 - 0.35 * worn[..., None]) + np.array([0.55, 0.5, 0.42]) * 0.35 * worn[..., None]  # trodden pale
    stains = np.clip((np.asarray(Image.fromarray((r.random((10, 10)) * 255).astype(np.uint8)).resize((R, R), Image.BICUBIC)).astype(float) / 255 - 0.65) * 3, 0, 1)
    col *= (1 - 0.3 * stains)[..., None]
    h = 0.7 * weave - 0.3 * worn
    du = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    dv = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    n = np.stack([-du * 2.5, dv * 2.5, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, "rug_albedo.png"))
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(TEX, "rug_normal.png"))
    orm = np.stack([0.85 + 0.15 * weave, 0.95 - 0.1 * worn, np.zeros_like(h)], -1)
    Image.fromarray((np.clip(orm, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, "rug_orm.png"))

    # Stencil plate on the locker
    st = Image.new("RGB", (256, 96), (58, 64, 52))
    d = ImageDraw.Draw(st)
    d.text((128, 50), "STASH", font=font(64), fill=(214, 204, 182), anchor="mm")
    p = os.path.join(TEX, "sign_stash_albedo.png")
    grime(st, 0.6, 2).save(p)
    out["stash"] = p

    # The Divers' insignia: a shield holding the Sanctuary's headframe (the
    # lift tower over the shaft) above a downward dive chevron. Painted by
    # hand in Lamp Amber and bone. Motto: "WE COME BACK".
    def insignia(d, cx, cy, sc, amber=(198, 140, 74), bone=(222, 210, 186), field=(46, 50, 47)):
        def P(x, y):
            return (cx + x * sc, cy + y * sc)
        shield = [P(-100, -120), P(100, -120), P(100, 10), P(70, 80), P(0, 130), P(-70, 80), P(-100, 10)]
        d.polygon(shield, fill=field)
        d.line(shield + [shield[0]], fill=bone, width=max(2, int(9 * sc)), joint="curve")
        # headframe: two legs, cross braces, the sheave wheel on top
        lw = max(2, int(8 * sc))
        d.line([P(-58, 40), P(0, -82), P(58, 40)], fill=amber, width=lw, joint="curve")
        d.line([P(-36, -4), P(36, -4)], fill=amber, width=lw)
        d.line([P(-46, 18), P(18, -50)], fill=amber, width=max(1, lw // 2))
        d.line([P(46, 18), P(-18, -50)], fill=amber, width=max(1, lw // 2))
        d.ellipse([P(-17, -100), P(17, -66)], outline=amber, width=lw)
        # the dive chevron, pointing down the shaft
        d.line([P(-34, 52), P(0, 92), P(34, 52)], fill=bone, width=max(2, int(11 * sc)), joint="curve")

    def chip(im, seed, amount=0.5):
        """Paint worn off in patches: blend toward the cloth underneath."""
        a = np.asarray(im).astype(float)
        rr = np.random.default_rng(seed)
        n = np.asarray(Image.fromarray((rr.random((40, 30)) * 255).astype(np.uint8)).resize((a.shape[1], a.shape[0]), Image.BICUBIC)).astype(float) / 255
        n2 = np.asarray(Image.fromarray((rr.random((160, 120)) * 255).astype(np.uint8)).resize((a.shape[1], a.shape[0]), Image.BICUBIC)).astype(float) / 255
        worn = np.clip((0.6 * n + 0.4 * n2 - (1 - amount * 0.5)) * 6, 0, 1)
        return worn

    # the banner: painted canvas with a swallowtail, hung on a rod
    BW, BH = 768, 1024
    cloth = np.asarray(Image.open(os.path.join(TEX, "canvas_albedo.png")).convert("RGB").resize((BW, BH))).astype(float)
    # Everything on the banner is painted by hand: letters drawn one by one,
    # slightly off the line and turned; brush edges ragged; the paint soaks
    # into the weave (the cloth shows through it) and skips in dry streaks.
    rr = np.random.default_rng(44)
    yy, xx = np.mgrid[0:BH, 0:BW]

    def lowfreq(cells, seed):
        g = np.random.default_rng(seed).random((cells, cells))
        return np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((BW, BH), Image.BICUBIC)).astype(float) / 255

    def hand_text(text, cx, cy, size, seed):
        """A mask of `text`, each letter hand-placed: its own small turn,
        lift and size, with uneven spacing."""
        r_ = np.random.default_rng(seed)
        f = font(size)
        widths = [f.getlength(ch) for ch in text]
        track = size * 0.06
        x = cx - (sum(widths) + track * (len(text) - 1)) / 2
        m_ = Image.new("L", (BW, BH), 0)
        for ch, w in zip(text, widths):
            if ch != " ":
                g = Image.new("L", (int(size * 1.6), int(size * 1.6)), 0)
                ImageDraw.Draw(g).text((g.width / 2, g.height / 2), ch, font=font(int(size * r_.uniform(0.95, 1.05))), fill=255, anchor="mm")
                g = g.rotate(r_.uniform(-3.5, 3.5), resample=Image.BICUBIC)
                m_.paste(g, (int(x + w / 2 - g.width / 2 + r_.uniform(-2, 2)), int(cy - g.height / 2 + r_.uniform(-4, 4))), g)
            x += w + track * r_.uniform(0.6, 1.4)
        return np.asarray(m_).astype(float) / 255

    def brush(m_, seed, edge=0.25, dry=0.35):
        """Ragged brush edges, a slight wobble, and dry-brush streaks."""
        wob_x = (lowfreq(14, seed) - 0.5) * 5
        wob_y = (lowfreq(14, seed + 1) - 0.5) * 5
        sy = np.clip(yy + wob_y, 0, BH - 1).astype(int)
        sx = np.clip(xx + wob_x, 0, BW - 1).astype(int)
        m_ = m_[sy, sx]
        soft = np.asarray(Image.fromarray((m_ * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))).astype(float) / 255
        n = np.random.default_rng(seed + 2).random((BH, BW))
        n = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
        m_ = np.clip((soft - 0.5 + edge * (n - 0.5)) * 5 + 0.5, 0, 1)
        # dry patches where the brush ran out: irregular, slightly elongated blobs
        blobs = np.random.default_rng(seed + 3).random((BH // 10, BW // 22))
        blobs = np.asarray(Image.fromarray((blobs * 255).astype(np.uint8)).resize((BW, BH), Image.BICUBIC)).astype(float) / 255
        grit = np.random.default_rng(seed + 4).random((BH, BW))
        return m_ * (1 - dry * np.clip((blobs - 0.5) * 3 + 0.3 * (grit - 0.5), 0, 1))

    lum = cloth.mean(-1)
    lum = (lum - lum.min()) / max(np.ptp(lum), 1e-6)
    layers = []  # (mask, colour) painted in order
    emblem_c = Image.new("RGB", (BW, BH), (0, 0, 0))
    emblem_m = Image.new("L", (BW, BH), 0)
    insignia(ImageDraw.Draw(emblem_c), BW / 2, 486, 2.45, amber=(186, 134, 78), bone=(200, 190, 166))
    insignia(ImageDraw.Draw(emblem_m), BW / 2, 486, 2.45, amber=255, bone=255, field=255)
    layers.append((brush(np.asarray(emblem_m).astype(float) / 255, 50, edge=0.15, dry=0.2), np.asarray(emblem_c).astype(float)))
    layers.append((brush(hand_text("DIVERS", BW / 2, 92, 100, 51), 52, edge=0.35, dry=0.4), np.array([192, 180, 154], float)))
    layers.append((brush(hand_text("WE COME BACK", BW / 2, 850, 56, 53), 54, edge=0.35, dry=0.45), np.array([176, 128, 76], float)))
    wear = chip(Image.new("L", (BW, BH)), 41, 0.55)
    col = cloth * 0.8
    for m_, c_ in layers:
        a_ = m_ * (1 - wear) * 0.85  # paint never fully covers the cloth
        paint_ = c_ * (0.7 + 0.4 * lum)[..., None]  # the weave shows through the paint
        col = col * (1 - a_[..., None]) + paint_ * a_[..., None]
    col = np.asarray(grime(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 0.45, 42)).astype(float)
    alpha = np.full((BH, BW), 255, np.uint8)
    yy, xx = np.mgrid[0:BH, 0:BW]
    notch = (yy > BH - 150) & (np.abs(xx - BW / 2) < (yy - (BH - 150)) * (BW / 2) / 150)
    alpha[notch] = 0  # swallowtail
    fray = np.random.default_rng(43).random((BH, BW)) < 0.25
    alpha[(yy > BH - 160) & fray & ~notch & (np.abs(np.abs(xx - BW / 2) - (yy - (BH - 150)) * (BW / 2) / 150) < 6)] = 0
    banner = np.dstack([np.clip(col, 0, 255).astype(np.uint8), alpha])
    p = os.path.join(TEX, "banner_divers_albedo.png")
    Image.fromarray(banner, "RGBA").save(p)
    out["banner"] = p

    # Two old posters, sun-faded and torn at the corners: the insignia, and
    # the plating notice with a shield plate instead of a circle
    for key, title, sub, bg in (("poster_divers", "STAND WITH THE DIVERS", "WE COME BACK", (92, 104, 98)),
                                ("poster_plating", "KEEP YOUR PLATING", "CHECK IT EVERY DIVE", (128, 98, 74))):
        im = Image.new("RGBA", (360, 512), (*bg, 255))
        d = ImageDraw.Draw(im)
        if key == "poster_divers":
            insignia(d, 180, 200, 0.95)
        else:
            plate = [(110, 110), (250, 110), (250, 230), (180, 300), (110, 230)]
            d.polygon(plate, fill=(54, 58, 56))
            for bx_, by_ in ((128, 128), (232, 128), (128, 214), (232, 214)):
                d.ellipse((bx_ - 6, by_ - 6, bx_ + 6, by_ + 6), fill=(150, 146, 136))
        d.text((180, 380), title, font=font(26 if len(title) > 18 else 30), fill=(28, 26, 24), anchor="mm")
        d.text((180, 420), sub, font=font(20), fill=(48, 42, 36), anchor="mm")
        d.polygon([(0, 0), (40, 0), (0, 34)], fill=(0, 0, 0, 0))
        d.polygon([(360, 512), (300, 512), (360, 470)], fill=(0, 0, 0, 0))
        im = grime(im, 0.55, len(key))
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


def displaced_panel(name, mat, coll, pos, w, h, rot, step=0.05, depth=0.3, seed=1, facet=0.32, lumps=True, tilt=0.55, edge=0.08):
    """A hewn rock surface. Each chisel blow leaves a flat, tilted facet; the
    facets meet in sharp steps. The grid is pushed back (away from its normal),
    never into the room."""
    nx, ny = max(2, int(w / step)), max(2, int(h / step))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    r = np.random.default_rng(seed)
    verts = list(bm.verts)
    uv = np.array([(v.co.x * w, v.co.y * h) for v in verts])
    # jittered seeds, one facet each: height = c + a*du + b*dv
    gx, gy = np.meshgrid(np.arange(-w / 2, w / 2 + facet, facet), np.arange(-h / 2, h / 2 + facet, facet))
    seeds = np.stack([gx.ravel(), gy.ravel()], 1) + r.uniform(-0.45, 0.45, (gx.size, 2)) * facet
    c = r.uniform(0.25, 1.0, len(seeds)) * depth * 0.6
    slope = r.uniform(-tilt, tilt, (len(seeds), 2))
    hgt = np.empty(len(uv))
    for i in range(0, len(uv), 4096):
        chunk = uv[i:i + 4096]
        d = np.sqrt(((chunk[:, None, :] - seeds[None, :, :]) ** 2).sum(-1))
        # each facet's plane, blended over `edge` metres where facets meet, so
        # the steps between chisel facets are short sloped ridges, not stairs
        planes = c[None, :] + (slope[None, :, :] * (chunk[:, None, :] - seeds[None, :, :])).sum(-1)
        near = np.argsort(d, 1)[:, :3]
        dn = np.take_along_axis(d, near, 1)
        wgt = np.exp(-(dn - dn[:, :1]) / edge)
        wgt /= wgt.sum(1, keepdims=True)
        hgt[i:i + 4096] = (np.take_along_axis(planes, near, 1) * wgt).sum(1)
    if lumps:  # broad bulges of the rock face
        hgt += depth * 0.4 * (np.sin(uv[:, 0] * 1.7 + seed) * np.sin(uv[:, 1] * 2.3 + 2 * seed) * 0.5 + 0.5)
    hgt += r.normal(0, 0.004, len(uv))  # grit
    hgt = np.clip(hgt, 0, None)
    for v, (u_, v_), d in zip(verts, uv, hgt):
        v.co = Vector((u_, v_, -d))
    o = mesh_obj(name, bm, mat, coll, g2b(*pos), rot)
    o.data.set_sharp_from_angle(angle=math.radians(28))
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
        "rug": pbr("mat_rug_woven_01", "rug"),
        "bare": pbr("mat_metal_bare_01", None, tint=srgb("#7c858f"), rough=0.35, metal=1.0),
        "dark": pbr("mat_metal_dark_01", None, tint=srgb("#2a2c2e"), rough=0.5, metal=0.8),
        "glass": pbr("mat_glass_mirror_01", None, tint=srgb("#c8c4bc"), rough=0.04, metal=1.0),
        "bulb": pbr("mat_bulb_warm_01", None, tint=(1, 0.9, 0.75), emission=(1.0, 0.62, 0.32), emission_strength=25.0),
        "leaf": pbr("mat_leaf_01", None, tint=srgb("#5a6a3c"), rough=0.6),
        "sign": pbr("mat_sign_sanctuary_01", "sign_sanctuary"),
        "stash": picture_material("mat_sign_stash_01", pics["stash"], rough=0.6),
        "poster_divers": picture_material("mat_poster_divers_01", pics["poster_divers"], alpha=True),
        "banner": picture_material("mat_banner_divers_01", pics["banner"], rough=0.9, alpha=True),
        "poster_plating": picture_material("mat_poster_plating_01", pics["poster_plating"], alpha=True),
        "tally": picture_material("mat_decal_tally_01", pics["tally"], alpha=True),
        "photo": picture_material("mat_photo_family_01", pics["photo"], rough=0.5),
    }

    R90 = math.pi / 2

    # --- the old mine: hewn rock walls and ceiling, packed earth floor ---
    displaced_panel("rock_wall_west", M["rock"], coll, (-4.0, H / 2, 0), 7.3, H + 0.2, (R90, 0, R90), seed=1)
    displaced_panel("rock_wall_east", M["rock"], coll, (4.0, H / 2, 0), 7.3, H + 0.2, (R90, 0, -R90), seed=2)
    displaced_panel("rock_ceiling", M["rock_ceiling"], coll, (0, H, 0), 8.3, 7.3, (math.pi, 0, 0), step=0.07, depth=0.22, seed=3)
    floor = displaced_panel("earth_floor", M["earth"], coll, (0, 0.0, 0), 8.2, 7.2, (0, 0, 0), step=0.1, depth=0.03, seed=4, facet=0.6, lumps=False, tilt=0.02, edge=0.15)
    floor.data.set_sharp_from_angle(angle=math.radians(80))  # trodden earth stays smooth

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
    for k, y in enumerate((0.35, 1.25, 2.25)):  # battens nailed across the boards, stopping at the door frame
        x0, x1 = door_x + door_w / 2 + 0.14, 3.9
        box(f"timber_batten_r{k}", M["timber"], coll, ((x0 + x1) / 2, y, -3.44), (x1 - x0, 0.09, 0.04), rot=(0, 0.004 * (k - 1), 0), bev=0.006, grain="long")
        x0, x1 = -3.9, door_x - door_w / 2 - 0.14
        box(f"timber_batten_l{k}", M["timber"], coll, ((x0 + x1) / 2, y, -3.44), (x1 - x0, 0.09, 0.04), bev=0.006, grain="long")
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
        yaw = 0.3 * (k - 0.5)
        ox, oz = bx + 0.62 + dx, bz + 0.7
        box(f"boot_{k}_foot", M["canvas"], coll, (ox, 0.05, oz), (0.11, 0.1, 0.29), rot=(0, 0, yaw), soft=True, puff=0.3)
        box(f"boot_{k}_sole", M["dark"], coll, (ox, 0.012, oz), (0.115, 0.024, 0.3), rot=(0, 0, yaw), bev=0.008)
        box(f"boot_{k}_shaft", M["canvas"], coll, (ox - 0.1 * math.sin(yaw), 0.17, oz - 0.09 * math.cos(yaw)), (0.11, 0.2, 0.12), rot=(0.12, 0, yaw), soft=True, puff=0.3)

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
    box("locker_kickplate", M["bare"], coll, (lx - 0.302, 0.07, lz), (0.012, 0.1, 0.76), bev=0.003)
    for sz in (-0.34, 0.34):
        for sx in (-0.24, 0.24):
            box(f"locker_foot_{sx}_{sz}", M["dark"], coll, (lx + sx, 0.012, lz + sz), (0.06, 0.025, 0.06), bev=0.005)
    box("locker_padlock", M["bare"], coll, (lx - 0.345, 0.98, lz), (0.025, 0.06, 0.05), bev=0.008)
    cylinder("locker_padlock_shackle", M["bare"], coll, (lx - 0.345, 1.01, lz - 0.015), (lx - 0.345, 1.04, lz + 0.015), 0.004)
    plane("locker_note", M["mattress"], coll, (lx - 0.304, 1.62, lz - 0.21), 0.12, 0.15, (R90, 0.08, -R90))
    box("locker_box_top", M["canvas"], coll, (lx + 0.02, 2.11, lz + 0.12), (0.4, 0.22, 0.32), rot=(0, 0, 0.15), bev=0.01)
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
    box("pack_repair", M["canvas"], coll, (fx - 0.15, 0.64, fz), (0.36, 0.4, 0.24), rot=pr, soft=True, puff=0.38)
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

    # --- the Divers' banner: painted canvas hung from a rod on the plank wall ---
    wx, wy, wz = 2.55, 1.95, -3.4
    cylinder("banner_rod", M["dark"], coll, (wx - 0.62, wy + 0.78, wz), (wx + 0.62, wy + 0.78, wz), 0.014)
    for s_ in (-1, 1):
        cylinder(f"banner_cord_{s_}", M["canvas"], coll, (wx + s_ * 0.5, wy + 0.78, wz), (wx, wy + 1.05, wz - 0.02), 0.004, segments=5, bev=0)
    box("banner_nail", M["bare"], coll, (wx, wy + 1.05, wz - 0.03), (0.02, 0.02, 0.04), bev=0.004)
    bm = bmesh.new()
    bm.loops.layers.uv.new()
    bmesh.ops.create_grid(bm, x_segments=12, y_segments=16, size=0.5, calc_uvs=True)
    for v in bm.verts:
        u_, v_ = v.co.x + 0.5, v.co.y + 0.5
        v.co.x *= 1.1
        v.co.y *= 1.47
        v.co.z = 0.025 * math.sin(u_ * math.pi * 3) * (1 - v_) + 0.012 * math.sin(v_ * 7)  # hangs in soft folds
    o = mesh_obj("banner_divers", bm, M["banner"], coll, g2b(wx, wy, wz + 0.03), (R90, 0, 0))
    o["uv"] = "keep"

    # --- signboard, posters, tally marks, photo ---
    # the signboard: its own thick board, hung off the planks on two steel brackets
    sx_, sy_, sz_ = 0.2, 2.86, -3.34
    box("sign_board", M["timber"], coll, (sx_, sy_, sz_), (2.3, 0.6, 0.05), rot=(0.06, 0, 0.012), bev=0.012, grain="long")
    plane("sign_face", M["sign"], coll, (sx_, sy_ + 0.0015, sz_ + 0.027), 2.26, 0.565, (R90 + 0.06, 0, 0.012))
    for k, bx_ in enumerate((-0.75, 1.15)):
        box(f"sign_bracket_{k}", M["steel"], coll, (bx_, sy_ + 0.33, -3.4), (0.04, 0.04, 0.18), bev=0.006)
        cylinder(f"sign_hanger_{k}", M["dark"], coll, (bx_, sy_ + 0.33, -3.33), (bx_, sy_ + 0.27, -3.33), 0.006)
    plane("poster_divers", M["poster_divers"], coll, (-3.86, 1.75, 2.2), 0.7, 1.0, (R90, 0, R90 - 0.02))
    plane("poster_plating", M["poster_plating"], coll, (3.86, 1.75, 0.3), 0.7, 1.0, (R90, 0.03, -R90))
    plane("decal_tally", M["tally"], coll, (-3.0, 1.0, -3.455), 0.8, 0.4, (R90, 0, 0))
    plane("photo_family", M["photo"], coll, (-3.6, 1.15, -3.455), 0.18, 0.135, (R90, 0.05, 0))

    # --- rug: its own woven pattern, a little thickness, soft wrinkles ---
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=1.35)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(3):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    for v in bm.verts:
        x_, y_ = v.co.x, v.co.y
        v.co.z = 0.012 * max(0.0, math.sin(x_ * 3.1 + 0.4) * math.sin(y_ * 2.3)) + 0.006 * math.sin(x_ * 7 + y_ * 5)
    for f in bm.faces:
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x / 2.7 + 0.5, loop.vert.co.y / 2.7 + 0.5)
    o = mesh_obj("rug", bm, M["rug"], coll, g2b(0.1, 0.012, 0.3), (0, 0, 0.3))
    sol = o.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.008
    o["uv"] = "keep"

    # --- plant in a rusted can ---
    px, pz = -3.35, 2.75
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.17, radius2=0.19, depth=0.36)
    mesh_obj("plant_can", bm, M["steel"], coll, g2b(px, 0.18, pz))["uv"] = "box"
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=18, radius=0.165)
    mesh_obj("plant_soil", bm, M["earth"], coll, g2b(px, 0.34, pz))["uv"] = "box"
    for k in range(15):
        ang = k / 15 * 2 * math.pi * 2.3 + rng.uniform(-0.3, 0.3)
        tilt = rng.uniform(0.25, 0.6) if k < 6 else rng.uniform(0.6, 1.05)
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=4, size=0.5)
        for v in bm.verts:
            t = v.co.y + 0.5
            v.co.x *= 0.13 * math.sin(math.pi * min(1.0, t * 1.1)) + 0.01
            v.co.y = t * (0.5 if k < 6 else 0.62)
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
    # a small lamp over the banner, so the insignia reads from the doorway
    add_light("light_banner", "SPOT", (2.55, 3.0, -3.0), (1.0, 0.7, 0.45), 40, 0.05, coll, spot_size=math.radians(70), spot_blend=0.6)


# ---------- preview render ----------

def preview_hallway():
    """A dim stretch of the hallway behind the door, for preview renders only
    (never exported: in the game the real hallway is there)."""
    coll = bpy.data.collections.new("preview_only")
    bpy.context.scene.collection.children.link(coll)
    rock = bpy.data.materials["mat_rock_mine_01"]
    earth = bpy.data.materials["mat_earth_packed_01"]
    R90 = math.pi / 2
    displaced_panel("pv_hall_floor", earth, coll, (-1.0, 0.0, -5.1), 6.0, 3.0, (0, 0, 0), step=0.1, depth=0.02, seed=8, facet=0.6, lumps=False, tilt=0.02, edge=0.15)
    displaced_panel("pv_hall_back", rock, coll, (-1.0, H / 2, -6.6), 6.0, H + 0.2, (R90, 0, 0), seed=9)
    displaced_panel("pv_hall_ceiling", rock, coll, (-1.0, H, -5.1), 6.0, 3.0, (math.pi, 0, 0), step=0.07, seed=10)
    for o in list(coll.objects):
        finalize(o)
    add_light("pv_hall_light", "POINT", (-2.4, H - 0.7, -5.4), (1.0, 0.66, 0.38), 90, 0.05, coll)




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


def merge_by_material(coll, keep=()):
    """Joins every static mesh that shares a material into one mesh (art
    bible 8.4: fewer draw calls). Objects named in `keep` stay separate so
    the game can show or hide them (the front wall)."""
    groups = {}
    for o in coll.objects:
        if o.type == "MESH" and o.name not in keep and o.data.materials:
            groups.setdefault(o.data.materials[0].name, []).append(o)
    for name, objs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = merged.data.name = name.replace("mat_", "quarters_")


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
        preview_hallway()
        bpy.data.objects["front_wall"].hide_render = True
        setup_render(os.path.join(WORK, "preview_front.png"), (0.6, 1.75, 4.6), (-0.2, 1.3, -3.2))
        setup_render(os.path.join(WORK, "preview_corner.png"), (-2.6, 1.7, 2.6), (3.0, 1.1, -1.5))
    if DO_EXPORT:
        os.makedirs(MODELS, exist_ok=True)
        merge_by_material(coll, keep={"front_wall"})
        bpy.ops.object.select_all(action="DESELECT")
        for o in coll.objects:
            if o.type == "MESH":
                o.select_set(True)
        # .gltf + .bin with the textures left as the shared files in
        # godot/textures/sanctuary/ (art bible 8.12: never embedded). Lights
        # are authored in the Godot scene, where their brightness is tuned.
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(MODELS, "env_sanctuary_quarters.gltf"),
            export_format="GLTF_SEPARATE", export_texture_dir="../../textures/sanctuary",
            use_selection=True, export_apply=True, export_yup=True, export_tangents=True,
            export_lights=False, export_cameras=False, export_materials="EXPORT",
            export_image_format="AUTO",
        )

if __name__ == "__main__":
    main()
