"""Generates Scrapfall's shared tiling PBR materials for the Sanctuary.

Every map is built from periodic (FFT) noise, so it tiles with no seam.
Writes <name>_albedo.png (sRGB), <name>_normal.png (OpenGL, green up) and
<name>_orm.png (R = ambient occlusion, G = roughness, B = metallic) to
godot/textures/sanctuary/. Colours follow the art bible (Section 4: world
below ~35% saturation; Section 6.2 wear layers).

Run with the Blender Python (numpy + Pillow):
    python tools/blender/make_textures.py [size]
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "godot", "textures", "sanctuary")
SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 1024


# ---------- periodic noise ----------

def _freqs(n):
    f = np.fft.fftfreq(n) * n
    return np.meshgrid(f, f, indexing="ij")  # (rows = v, cols = u)


def fbm(seed, beta=2.0, stretch=(1.0, 1.0), lo=1.0):
    """Tileable 1/f^beta noise in 0..1. stretch=(sv, su) squashes features
    along an axis (e.g. wood grain), lo removes the very lowest frequencies."""
    rng = np.random.default_rng(seed)
    fv, fu = _freqs(SIZE)
    r = np.sqrt((fv * stretch[0]) ** 2 + (fu * stretch[1]) ** 2)
    r[0, 0] = 1.0
    amp = 1.0 / np.power(np.maximum(r, lo), beta / 2.0)
    amp[0, 0] = 0.0
    spec = np.fft.fft2(rng.standard_normal((SIZE, SIZE))) * amp
    n = np.real(np.fft.ifft2(spec))
    n -= n.min()
    return n / max(n.max(), 1e-9)


def blur(img, sigma):
    """Periodic Gaussian blur (sigma in pixels)."""
    fv, fu = _freqs(SIZE)
    g = np.exp(-2.0 * (np.pi * sigma / SIZE) ** 2 * (fv ** 2 + fu ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(img) * g))


def ridged(n):
    return 1.0 - np.abs(2.0 * n - 1.0)


def contour(n, width_px, level=0.5):
    """A continuous line of about width_px pixels along where n crosses level
    (distance to the crossing estimated from the gradient), 1 on the line."""
    gu = (np.roll(n, -1, 1) - np.roll(n, 1, 1)) * 0.5
    gv = (np.roll(n, -1, 0) - np.roll(n, 1, 0)) * 0.5
    dist = np.abs(n - level) / np.maximum(np.sqrt(gu ** 2 + gv ** 2), 1e-6)
    return np.clip(1.0 - dist / width_px, 0.0, 1.0)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def hexcol(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1.0 - t) + b * t


# ---------- outputs ----------

def normal_from_height(h, strength):
    # OpenGL / glTF: +Y (green) points up the texture, i.e. towards row 0.
    du = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    drow = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-du * strength, drow * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def ao_from_height(h, amount, sigma=6.0):
    cavity = h - blur(h, sigma)
    return np.clip(1.0 + cavity * amount, 0.35, 1.0)


def save(name, albedo, height, rough, metal, nstrength, ao_amount):
    os.makedirs(OUT, exist_ok=True)
    srgb = np.clip(albedo, 0, 1) ** (1 / 1.0)  # authored directly in sRGB
    Image.fromarray((srgb * 255).astype(np.uint8)).save(os.path.join(OUT, f"{name}_albedo.png"), optimize=True)
    nrm = normal_from_height(height, nstrength)
    Image.fromarray((nrm * 255).astype(np.uint8)).save(os.path.join(OUT, f"{name}_normal.png"), optimize=True)
    orm = np.stack([ao_from_height(height, ao_amount), np.clip(rough, 0, 1), np.clip(metal, 0, 1)], -1)
    Image.fromarray((orm * 255).astype(np.uint8)).save(os.path.join(OUT, f"{name}_orm.png"), optimize=True)
    print(name, "done")


# ---------- materials ----------

def voronoi(cells, seed):
    """Tileable jittered Voronoi with `cells` cells per side. Returns the
    nearest cell's id, the offset from its seed (pixels) and F2 - F1 (the
    distance to the nearest cell edge, in pixels)."""
    r = np.random.default_rng(seed)
    cs = SIZE / cells
    jit = r.random((cells, cells, 2))
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(float)
    ci, cj = (yy // cs).astype(int), (xx // cs).astype(int)
    f1 = np.full((SIZE, SIZE), 1e9)
    f2 = np.full((SIZE, SIZE), 1e9)
    best = np.zeros((SIZE, SIZE), int)
    off = np.zeros((SIZE, SIZE, 2))
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ni, nj = ci + di, cj + dj
            wi, wj = ni % cells, nj % cells
            sy = (ni + jit[wi, wj, 0]) * cs
            sx = (nj + jit[wi, wj, 1]) * cs
            dy, dx = yy - sy, xx - sx
            d = np.sqrt(dy ** 2 + dx ** 2)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            best = np.where(closer, wi * cells + wj, best)
            off[closer] = np.stack([dy, dx], -1)[closer]
            f1 = np.where(closer, d, f1)
    return best, off, f2 - f1


def rock():
    """Hewn mine rock: broken angular fragments at two sizes, each its own
    tone and chisel facet, with dark seams between them; faint bedding,
    a few pale veins, soot and damp."""
    r = np.random.default_rng(1)
    big_id, big_off, big_edge = voronoi(10, 101)
    small_id, small_off, small_edge = voronoi(34, 102)
    big_tone = r.random(10 * 10)[big_id]
    small_tone = r.random(34 * 34)[small_id]
    # every fragment is a small tilted plane: chiselled facets in the normal map
    big_slope = r.uniform(-0.012, 0.012, (100, 2))[big_id]
    small_slope = r.uniform(-0.012, 0.012, (34 * 34, 2))[small_id]
    facet_h = (big_slope * big_off).sum(-1) + (small_slope * small_off).sum(-1)
    seams_small = 1.0 - smooth(0.0, 2.2, small_edge)
    seams_big = 1.0 - smooth(0.0, 3.0, big_edge)
    # only some seams open up: most fragments meet without a visible line
    seams = np.maximum(seams_small * 0.06 * smooth(0.55, 0.8, fbm(21, 2.2)),
                       seams_big * smooth(0.7, 0.9, fbm(22, 2.4)))
    grain = blur(fbm(9, 1.0), 0.7)
    rows = np.arange(SIZE)[:, None] / SIZE
    strata = 0.5 + 0.5 * np.sin(2 * np.pi * (3 * rows + 0.6 * fbm(10, 3.0)))
    vein_n = blur(fbm(12, 3.0), 14.0)
    vein_n = (vein_n - vein_n.min()) / np.ptp(vein_n)
    veins = contour(vein_n, 1.4, 0.4) * smooth(0.6, 0.8, fbm(19, 2.6))
    big_tone = blur(big_tone, 2.0)
    small_tone = blur(small_tone, 1.5)
    h = facet_h + 0.2 * big_tone + 0.06 * small_tone + 0.08 * grain - 0.3 * seams + 0.03 * veins
    tone = 0.16 * big_tone + 0.05 * small_tone + 0.17 * strata + 0.62 * fbm(5, 2.6)
    col = mix(hexcol("#4a4238"), hexcol("#978b77"), smooth(0.1, 0.9, tone))
    col = mix(col, hexcol("#7c6a52"), smooth(0.7, 0.95, strata) * 0.2)  # faint ochre bands
    col = col * (0.82 + 0.36 * grain)[..., None]
    col = mix(col, hexcol("#b5a993"), veins * 0.7)
    col = mix(col, hexcol("#2a241d"), seams * 0.4)
    soot = smooth(0.55, 0.85, fbm(6, 3.0))
    col = mix(col, hexcol("#26211c"), soot * 0.45)
    rough = 0.82 + 0.12 * grain - 0.08 * soot - 0.2 * veins + 0.06 * seams
    save("rock", col, h, rough, np.zeros_like(h), 14.0, 3.0)


def timber():
    """Old mine timber, long abandoned (author direction): weathered grey at
    the surface, split along the grain, black with grime and old oil."""
    grain = fbm(11, 2.0, stretch=(1.0, 0.08))  # long along v
    fine = fbm(12, 1.2, stretch=(1.0, 0.05))
    splits = smooth(0.93, 0.99, ridged(fbm(13, 1.6, stretch=(1.0, 0.04))))
    checks = smooth(0.96, 0.995, ridged(fbm(15, 1.0, stretch=(1.0, 0.12))))  # short checking cracks
    h = 0.6 * grain + 0.3 * fine - 0.45 * splits - 0.25 * checks
    col = mix(hexcol("#2a2119"), hexcol("#5a4b3a"), smooth(0.2, 0.9, 0.7 * grain + 0.3 * fine))
    weather = smooth(0.35, 0.75, fbm(16, 2.6))  # sun-less grey weathering
    col = mix(col, hexcol("#5c5750"), weather * 0.45)
    stain = smooth(0.55, 0.85, fbm(14, 3.0))
    col = mix(col, hexcol("#17120e"), stain * 0.55)
    col = mix(col, hexcol("#120d09"), np.clip(splits + checks * 0.7, 0, 1) * 0.85)
    rough = 0.82 + 0.1 * fine - 0.1 * stain + 0.05 * weather
    save("timber", col, h, rough, np.zeros_like(h), 7.0, 2.2)


def plank():
    """Survivor plank walls: mismatched boards, flaking old paint, nail rust."""
    boards = 10  # 0.2 m boards across a 2 m tile
    u = np.arange(SIZE) / SIZE
    board_id = np.floor(u * boards).astype(int)
    edge = np.abs((u * boards) % 1.0 - 0.5) * 2.0
    gap = smooth(0.94, 0.99, edge)[None, :].repeat(SIZE, 0)
    rng = np.random.default_rng(21)
    tint = rng.uniform(0.75, 1.15, boards)[board_id][None, :].repeat(SIZE, 0)
    # each board carries a different amount of old paint: some bare, some mostly painted
    cover = rng.choice([0.0, 0.0, 0.25, 0.5, 0.75, 0.9], boards)[board_id][None, :].repeat(SIZE, 0)
    grain = fbm(22, 2.0, stretch=(1.0, 0.06))
    h = 0.5 * grain - 0.6 * gap
    wood = mix(hexcol("#4a3a2a"), hexcol("#7a6448"), smooth(0.2, 0.9, grain)) * tint[..., None]
    paint = mix(hexcol("#5a6455"), hexcol("#808878"), fbm(23, 3.0))  # faded sage-grey paint
    patches = 0.55 * fbm(24, 3.2) + 0.3 * fbm(26, 1.6) + 0.15 * fbm(27, 0.9)  # worn areas, ragged edges
    # per board, paint survives where `patches` is in its top `cover` share
    thr = np.ones_like(patches)
    for b in range(boards):
        cols = board_id == b
        c = cover[0, cols][0]
        if c > 0:
            thr[:, cols] = np.quantile(patches[:, cols], 1.0 - c)
    flake = smooth(thr - 0.015, thr + 0.015, patches) * (cover > 0)
    lip = smooth(0.0, 0.6, flake) - smooth(0.6, 1.0, flake)  # a dark rim where paint lifts
    col = mix(wood, paint, flake)
    col = mix(col, hexcol("#2a231b"), np.clip(lip, 0, 1) * 0.5)
    h = h + 0.2 * flake
    col = mix(col, hexcol("#16110c"), gap * 0.9)
    col = mix(col, hexcol("#1d1813"), smooth(0.5, 0.85, fbm(28, 3.0)) * 0.4)  # years of grime
    rough = np.where(flake > 0.5, 0.68, 0.86) + 0.05 * fbm(25, 1.5)
    save("plank", col, h, rough, np.zeros_like(h), 5.0, 2.0)


def steel():
    """Old painted steel, long abandoned (author direction): the paint mostly
    gone, big rust patches with pitting, rust streaks run down from them, a
    little bare metal left on worn edges."""
    mottle = fbm(31, 2.4)
    rust_big = smooth(0.5, 0.62, 0.6 * fbm(36, 3.0) + 0.4 * fbm(37, 1.6))  # large rusted-through areas
    flake = smooth(0.55, 0.62, fbm(32, 1.1) * 0.6 + fbm(33, 2.2) * 0.4)  # paint flaking at the edge of the rust
    rust = np.clip(rust_big + flake * 0.7, 0, 1)
    pits = smooth(0.8, 0.88, fbm(38, 0.9)) * rust
    bare = smooth(0.85, 0.9, fbm(39, 1.2)) * (1 - rust)  # a few rubbed-bright spots
    dents = fbm(34, 2.8)
    src = smooth(0.5, 0.7, rust)
    streak = src.copy()
    for k in range(1, 40, 2):  # rust bleeds downward (towards higher rows)
        streak = np.maximum(streak, np.roll(src, k * SIZE // 200, 0) * (1 - k / 40) ** 1.5)
    streak = blur(streak, 2.0) * (0.6 + 0.4 * fbm(40, 1.4, stretch=(0.15, 1.0)))
    paint = mix(hexcol("#434b3c"), hexcol("#59604f"), mottle)
    paint = mix(paint, hexcol("#6b6a5a"), smooth(0.5, 0.9, fbm(41, 3.0)) * 0.4)  # faded, chalky
    rust_col = mix(hexcol("#3a2a20"), hexcol("#6a4a34"), fbm(42, 1.3))  # dull, dark, under ~35% saturation
    rust_col = mix(rust_col, hexcol("#2a1a12"), pits)
    col = mix(paint, hexcol("#55392a"), np.clip(streak, 0, 1) * 0.6)
    col = mix(col, rust_col, rust)
    col = mix(col, hexcol("#6f7680"), bare)
    grime = smooth(0.5, 0.85, fbm(43, 2.8))
    col = mix(col, hexcol("#1f1b16"), grime * 0.35)
    h = 0.25 * dents - 0.25 * rust * fbm(44, 0.8) - 0.3 * pits + 0.08 * flake
    rough = 0.62 + 0.3 * rust - 0.3 * bare + 0.05 * grime
    metal = np.clip(bare + 0.3 * (1 - rust) * (1 - grime), 0, 1) * 0.8
    save("steel", col, h, rough, metal, 6.0, 1.8)


def canvas():
    """Canvas and blanket cloth: weave, fading, stains."""
    u = np.arange(SIZE)
    weave_n = SIZE // 4
    wu = np.sin(u * 2 * np.pi * weave_n / SIZE)
    weave = (wu[None, :] * wu[:, None]) * 0.5 + 0.5
    stains = smooth(0.45, 0.8, fbm(41, 2.8))
    fade = fbm(42, 3.0)
    h = 0.6 * weave + 0.2 * fbm(43, 1.0)
    col = mix(hexcol("#57513f"), hexcol("#7a7258"), fade)
    col = col * (0.9 + 0.1 * weave)[..., None]
    col = mix(col, hexcol("#3a3326"), stains * 0.45)
    rough = 0.92 - 0.05 * stains
    save("canvas", col, h, rough, np.zeros_like(h), 3.0, 1.2)


def earth():
    """Packed earth floor: trodden dirt with grit and pebbles."""
    base = fbm(51, 2.2)
    grit = fbm(52, 0.6)
    pebbles = smooth(0.78, 0.84, fbm(53, 1.4))
    trodden = smooth(0.4, 0.8, fbm(54, 3.2))
    h = 0.4 * base + 0.15 * grit + 0.5 * pebbles - 0.2 * trodden
    col = mix(hexcol("#3f342a"), hexcol("#6a5a47"), smooth(0.2, 0.9, 0.7 * base + 0.3 * grit))
    col = mix(col, hexcol("#8a7d6a"), pebbles * 0.7)
    col = mix(col, hexcol("#2f2720"), trodden * 0.35)
    rough = 0.94 - 0.12 * trodden  # worn smooth where people walk
    save("earth", col, h, rough, np.zeros_like(h), 7.0, 2.2)


if __name__ == "__main__":
    for make in (rock, timber, plank, steel, canvas, earth):
        make()
