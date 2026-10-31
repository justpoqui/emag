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

def rock():
    """Hewn mine rock: chisel facets, cracks, soot and damp patches."""
    base = fbm(1, 2.3)
    facets = ridged(fbm(2, 1.7))
    chisel = ridged(fbm(8, 1.2, lo=24.0))  # tool marks and small facets
    cracks = smooth(0.93, 0.99, ridged(fbm(3, 1.3)))
    h = 0.45 * base + 0.3 * facets + 0.22 * chisel - 0.3 * cracks + 0.12 * fbm(4, 0.6)
    tone = fbm(5, 2.6)
    col = mix(hexcol("#4a4239"), hexcol("#8c8170"), smooth(0.15, 0.95, 0.6 * h + 0.4 * tone))
    soot = smooth(0.55, 0.85, fbm(6, 3.0))  # soot and damp from the lamps and seepage
    col = mix(col, hexcol("#2a2520"), soot * 0.55)
    col = mix(col, hexcol("#221d18"), cracks * 0.8)
    rough = 0.86 + 0.1 * fbm(7, 1.5) - 0.1 * soot
    save("rock", col, h, rough, np.zeros_like(h), 22.0, 3.0)


def timber():
    """Old mine timber: dark, split along the grain, oil-stained."""
    grain = fbm(11, 2.0, stretch=(1.0, 0.08))  # long along v
    fine = fbm(12, 1.2, stretch=(1.0, 0.05))
    splits = smooth(0.95, 0.995, ridged(fbm(13, 1.6, stretch=(1.0, 0.04))))
    h = 0.6 * grain + 0.3 * fine - 0.4 * splits
    col = mix(hexcol("#2c2018"), hexcol("#5e4a35"), smooth(0.2, 0.9, 0.7 * grain + 0.3 * fine))
    stain = smooth(0.6, 0.9, fbm(14, 3.0))
    col = mix(col, hexcol("#1e1712"), stain * 0.5)
    col = mix(col, hexcol("#140f0b"), splits * 0.85)
    rough = 0.78 + 0.12 * fine - 0.12 * stain
    save("timber", col, h, rough, np.zeros_like(h), 6.0, 2.0)


def plank():
    """Survivor plank walls: mismatched boards, flaking old paint, nail rust."""
    boards = 10  # 0.2 m boards across a 2 m tile
    u = np.arange(SIZE) / SIZE
    board_id = np.floor(u * boards).astype(int)
    edge = np.abs((u * boards) % 1.0 - 0.5) * 2.0
    gap = smooth(0.94, 0.99, edge)[None, :].repeat(SIZE, 0)
    rng = np.random.default_rng(21)
    tint = rng.uniform(0.75, 1.15, boards)[board_id][None, :].repeat(SIZE, 0)
    painted = (rng.random(boards) < 0.5)[board_id][None, :].repeat(SIZE, 0)
    grain = fbm(22, 2.0, stretch=(1.0, 0.06))
    h = 0.5 * grain - 0.6 * gap
    wood = mix(hexcol("#4a3a2a"), hexcol("#7a6448"), smooth(0.2, 0.9, grain)) * tint[..., None]
    paint = mix(hexcol("#5d6658"), hexcol("#7d8576"), fbm(23, 2.5))  # faded sage-grey paint
    flake = smooth(0.45, 0.6, fbm(24, 1.4)) * painted
    col = mix(wood, paint, flake)
    h = h + 0.15 * flake
    col = mix(col, hexcol("#16110c"), gap * 0.9)
    rough = np.where(flake > 0.5, 0.7, 0.85) + 0.05 * fbm(25, 1.5)
    save("plank", col, h, rough, np.zeros_like(h), 5.0, 2.0)


def steel():
    """Painted steel (lockers, frames): chipped to bare metal, rust from chips."""
    mottle = fbm(31, 2.4)
    chips = smooth(0.62, 0.68, fbm(32, 1.1) * 0.6 + fbm(33, 2.2) * 0.4)
    dents = fbm(34, 2.8)
    rust_src = smooth(0.7, 0.8, fbm(35, 1.0))
    streak = np.clip(blur(np.roll(rust_src, 0, 0), 2.0), 0, 1)
    # rust bleeds downward (towards higher rows) from chips
    for k in range(1, 24, 3):
        streak = np.maximum(streak, np.roll(rust_src, k * SIZE // 256, 0) * (1 - k / 24))
    streak = blur(streak, 3.0) * 0.8
    paint = mix(hexcol("#47513f"), hexcol("#606a56"), mottle)
    col = mix(paint, hexcol("#5e3a24"), np.clip(streak, 0, 1) * 0.7)
    col = mix(col, hexcol("#7c858f"), chips)
    h = 0.3 * dents - 0.25 * chips
    rough = mix(np.full((SIZE, SIZE, 1), 0.58), np.full((SIZE, SIZE, 1), 0.35), chips)[..., 0] + 0.25 * np.clip(streak, 0, 1)
    metal = chips
    save("steel", col, h, rough, metal, 4.0, 1.5)


def canvas():
    """Canvas and blanket cloth: weave, fading, stains."""
    u = np.arange(SIZE)
    weave_n = SIZE // 4
    wu = np.sin(u * 2 * np.pi * weave_n / SIZE)
    weave = (wu[None, :] * wu[:, None]) * 0.5 + 0.5
    stains = smooth(0.55, 0.85, fbm(41, 2.8))
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
