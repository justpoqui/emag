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
Layout in Godot differs from the web game: the hallway is 5 m wide
(z -8.6..-3.6: boardwalk by the shops, abandoned rails by the doors), so the
Trade Hall, Workshop and Checkout are built 2 m further north than in
src/sanctuary.js. The quarters and the lift don't move.
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
ROOMS = ["hallway", "trade_hall", "clinic", "radio", "workshop", "checkout", "lift"]
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


def chalk_texture(key, title, lines, seed, w=1024, h=576):
    """A slate chalkboard in hand chalk: smudged ghosts of old writing under
    today's, a title, lines and a few tally ticks."""
    r = np.random.default_rng(seed)
    base = 0.13 + 0.03 * noise_img(w, h, (5, 3), seed) + 0.02 * noise_img(w, h, (40, 24), seed + 1)
    col = np.stack([base * 0.95, base * 1.02, base], -1)
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    smudge = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(smudge)
    for _ in range(16):  # where yesterday's drops were wiped off with the rag
        x, y = r.uniform(0, w), r.uniform(0, h)
        sd.ellipse((x - r.uniform(80, 200), y - r.uniform(15, 35), x + r.uniform(80, 200), y + r.uniform(15, 35)), fill=int(r.uniform(14, 26)))
    sm = np.asarray(smudge.filter(ImageFilter.GaussianBlur(14))).astype(float) / 255
    col = col + sm[..., None] * np.array([0.8, 0.8, 0.76])
    d.text((w / 2, 70), title, font=font(84), fill=230, anchor="mm")
    d.line((w * 0.2, 122, w * 0.8, 126), fill=200, width=4)
    for k, (left, right) in enumerate(lines):
        y = 200 + k * 112
        d.text((70, y), left, font=font(58), fill=225, anchor="lm")
        d.text((w - 70, y), right, font=font(44, bold=False), fill=205, anchor="rm")
    a = np.asarray(m.filter(ImageFilter.GaussianBlur(1.1))).astype(float) / 255
    a *= np.clip(0.55 + 0.6 * noise_img(w, h, (90, 50), seed + 2), 0, 1)  # chalk catches the grain unevenly
    col = col * (1 - a[..., None]) + np.array([0.86, 0.85, 0.8]) * a[..., None]
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, f"{key}_albedo.png"))


def anatomy_texture():
    """Nia's hand-drawn body chart: an outline of a person, the places that
    bleed worst marked, KNOW WHERE IT HURTS along the bottom."""
    w, h = 384, 640
    im = Image.new("RGB", (w, h), (216, 206, 182))
    d = ImageDraw.Draw(im)
    ink = (52, 44, 36)
    cx = w // 2
    d.ellipse((cx - 38, 60, cx + 38, 150), outline=ink, width=5)  # head
    d.line((cx, 150, cx, 170), fill=ink, width=5)
    d.polygon([(cx - 80, 175), (cx + 80, 175), (cx + 60, 360), (cx - 60, 360)], outline=ink, width=5)  # torso
    for s_ in (-1, 1):
        d.line((cx + s_ * 80, 180, cx + s_ * 125, 330, cx + s_ * 135, 430), fill=ink, width=5, joint="curve")  # arms
        d.line((cx + s_ * 45, 360, cx + s_ * 60, 470, cx + s_ * 62, 575), fill=ink, width=5, joint="curve")  # legs
    for x, y in ((cx - 18, 230), (cx + 40, 300), (cx - 52, 455), (cx + 112, 320)):  # where it bleeds worst
        d.ellipse((x - 11, y - 11, x + 11, y + 11), outline=(120, 70, 40), width=4)
    d.text((cx, 34), "THE BODY", font=font(34), fill=ink, anchor="mm")
    d.text((cx, 610), "KNOW WHERE IT HURTS", font=font(24), fill=ink, anchor="mm")
    a = np.asarray(im).astype(float) / 255 * (0.84 + 0.16 * noise_img(w, h, (6, 9), 171))[..., None]
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, "paper_anatomy_albedo.png"))


def scorch_texture():
    """Scorch on rock: soot black at the heart, fading out in ragged licks."""
    W = 512
    yy, xx = np.mgrid[0:W, 0:W] / W - 0.5
    rad = np.sqrt(xx ** 2 + (yy * 1.2) ** 2) * 2
    n = 0.6 * noise_img(W, W, (8, 8), 81) + 0.4 * noise_img(W, W, (30, 30), 82)
    a = np.clip((1 - rad) * 1.8 + (n - 0.5) * 1.2, 0, 1) ** 0.9
    col = np.stack([np.full((W, W), 0.06), np.full((W, W), 0.05), np.full((W, W), 0.04)], -1)
    rgba = np.dstack([(col * 255).astype(np.uint8), (np.clip(a * 1.3, 0, 1) * 255).astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").save(os.path.join(TEX, "decal_scorch_albedo.png"))


def target_texture():
    """A paper target pinned up by Tobias, full of holes, most near the middle."""
    w, h = 384, 512
    im = Image.new("RGB", (w, h), (214, 204, 182))
    d = ImageDraw.Draw(im)
    cx, cy = w // 2, 220
    for k, r_ in enumerate((150, 115, 80, 45)):
        d.ellipse((cx - r_, cy - r_, cx + r_, cy + r_), outline=(44, 38, 32), width=6)
    d.ellipse((cx - 18, cy - 18, cx + 18, cy + 18), fill=(150, 70, 52))
    r = np.random.default_rng(97)
    for _ in range(26):
        rr, a = abs(r.normal(0, 55)), r.uniform(0, 2 * math.pi)
        x, y = cx + rr * math.cos(a), cy + rr * math.sin(a)
        d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(24, 20, 16))
    d.text((cx, 430), "TOBIAS · 25 M", font=font(30), fill=(44, 38, 32), anchor="mm")
    a = np.asarray(im).astype(float) / 255 * (0.85 + 0.15 * noise_img(w, h, (6, 8), 98))[..., None]
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(TEX, "paper_target_albedo.png"))


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
    painted_board("sign_rules", [("HOUSE RULES", 0.18, 64, (0.87, 0.81, 0.71)), ("NO LOADED GUNS", 0.42, 44, (0.82, 0.76, 0.66)),
                                 ("TRY BEFORE YOU BUY", 0.62, 44, (0.82, 0.76, 0.66)), ("NO CREDIT. EVER.", 0.82, 44, (0.78, 0.62, 0.42))],
                  w=768, h=480, seed=41)
    painted_board("sign_notices", [("NOTICES", 0.5, 120, (0.87, 0.81, 0.71))], w=768, h=200, paint=(0.24, 0.18, 0.13), seed=40)
    for key, text, c in (("neon_noodles", "NOODLES", (0.85, 0.34, 0.48)), ("neon_bunks", "BUNKS", (0.91, 0.58, 0.23)),
                         ("neon_clinic", "CLINIC", (0.94, 0.7, 0.35)), ("neon_water", "WATER · RATION", (0.91, 0.58, 0.23)),
                         ("neon_radio", "RADIO & PARTS", (0.85, 0.34, 0.48)), ("neon_market", "MARKET", (0.91, 0.58, 0.23))):
        neon_texture(key, text, c, px=78 if len(text) < 9 else 56)
    painted_board("sign_clinic_rules", [("CLEAN HANDS", 0.3, 92, (0.87, 0.81, 0.71)), ("NO HUSK BLOOD", 0.62, 52, (0.78, 0.62, 0.42)),
                                        ("PAST THE LINE", 0.84, 52, (0.78, 0.62, 0.42))], w=640, h=360, paint=(0.3, 0.33, 0.3), seed=42)
    painted_board("sign_we_buy", [("WE BUY", 0.24, 96, (0.87, 0.81, 0.71)), ("SCRAP  ·  WIRE  ·  RUBBER", 0.58, 46, (0.82, 0.76, 0.66)),
                                  ("HUSK PARTS  ·  GOOD PRICES", 0.82, 40, (0.78, 0.62, 0.42))], w=768, h=420, paint=(0.33, 0.29, 0.17), seed=43)
    for i, word in enumerate(("SCRAP", "WIRE", "RUBBER")):
        painted_board(f"sign_bin_{i}", [(word, 0.55, 110, (0.87, 0.81, 0.71))], w=512, h=180, paint=(0.24, 0.22, 0.18), seed=44 + i)
    # Nia's prices: what she sells, at the game's prices (src/config.js: value x BUY_MARKUP 2.5)
    painted_board("sign_clinic_prices", [("PRICES", 0.13, 64, (0.87, 0.81, 0.71)), ("BANDAGE ............ 100", 0.33, 40, (0.82, 0.76, 0.66)),
                                         ("HERBAL MED KIT ..... 350", 0.5, 40, (0.82, 0.76, 0.66)), ("SHIELD CELL ........ 300", 0.67, 40, (0.82, 0.76, 0.66)),
                                         ("SHIELDS FROM ....... 750", 0.84, 40, (0.78, 0.62, 0.42))], w=768, h=560, paint=(0.3, 0.33, 0.3), seed=48)
    painted_board("sign_return_kit", [("RETURN WHAT", 0.32, 80, (0.87, 0.81, 0.71)), ("YOU BORROW", 0.72, 80, (0.87, 0.81, 0.71))], w=640, h=300, seed=49)
    chalk_texture("chalk_drops", "TODAY'S DROPS", [("GOLDEN HOUR", "standard"), ("NIGHT RAID", "rich, crowded"), ("DUST STORM", "short sight")], 50)
    anatomy_texture()
    paper_texture("paper_clinic_1", "CHECK-UPS", ["Okoro - stitches out", "Vance - cough again", "Hale - ankle, rest", "Ash - shield burn"], 96)
    paper_texture("paper_clinic_2", "BOIL IT", ["Water for wounds", "boiled, then cooled", "No exceptions"], 97)
    map_board_texture()
    paper_texture("paper_notice_1", "RATIONS", ["Thursday, after shift", "Bring your own tin", "No tin, no ration"], 91)
    paper_texture("paper_notice_2", "LIFT CREW", ["Wanted: 2 hands", "Ask at Checkout", "Pay in scrap"], 92)
    paper_texture("paper_notice_3", "CURFEW 22:00", ["Lamps out on the street", "Keep the shaft quiet"], 93)
    paper_texture("paper_signout", "SIGNED OUT", ["M. Okoro   GOLDEN", "~ R. Vance   NIGHT", "T. Hale    STORM", "~ J. Ash    NIGHT", "D. Mori    GOLDEN", "~ K. Bell   STORM"], 94)
    scorch_texture()
    target_texture()


# ---------- building blocks ----------

def rock_wall(name, M, coll, axis, coord, a0, a1, facing, doors=(), door_h=2.6, depth=0.12, seed=1, step=0.05):
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
        kit.displaced_panel(f"{name}_{k}", M["rock"], coll, pos, w + 0.1, hgt, rot, step=step, depth=depth, seed=seed + k)


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
    cu.bevel_depth = 0.011 if size >= 0.3 else 0.0085
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

HALL_N = -8.6  # the hallway's north wall: widened from 3 m to 5 m (author request)
HALL_S = -3.6  # the south wall, against the quarters and the shopfronts
TRACK_Z = -7.55  # the abandoned rails run along the north side, by the doors
WALK_N = -6.3  # the boardwalk runs along the south side, by the shops
ROOM_SHIFT = -2.0  # Trade Hall, Workshop and Checkout sit 2 m further north
OPEN_SHOPS = (17.8, 27.4)  # shopfronts with rooms behind them: Nia's clinic, Pell's radio & parts
SET_X = (-4.4, 0.4, 2.6, 6.2, 11.0, 16.4, 21.2, 26.0, 28.6, 32.4)  # timber mine sets down the hallway


def check_clearance(coll, movers=("hall_duct", "hall_shaft", "hall_grille", "hall_ac"), fixed=("hall_set",)):
    """Reports any ventilation part whose bounds cut into a timber post, cap
    or brace (author: vents never go into posts or pillars). Returns the
    clashes; the build prints them."""
    def bounds(o):
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]
    a = [(o.name, *bounds(o)) for o in coll.objects if o.type == "MESH" and o.name.startswith(movers)]
    b = [(o.name, *bounds(o)) for o in coll.objects if o.type == "MESH" and o.name.startswith(fixed)]
    clash = []
    for na, lo1, hi1 in a:
        for nb, lo2, hi2 in b:
            if all(lo1[i] < hi2[i] - 0.005 and lo2[i] < hi1[i] - 0.005 for i in range(3)):
                clash.append((na, nb))
    return clash


def build_hallway(M, P, coll):
    room = "hallway"
    z0, z1 = HALL_N, HALL_S
    floor_ceiling("hall", M, coll, -5, 33, z0, z1, seed=21)
    rock_wall("hall_north", M, coll, "x", z0, -5, 33, +1, doors=((4, 1.8), (14, 1.8), (23.75, 1.8)), seed=22, step=0.07)
    rock_wall("hall_south_w", M, coll, "x", z1, -5, -4, -1, seed=30)
    rock_wall("hall_south_e", M, coll, "x", z1, 4, 33, -1, doors=tuple((x, 1.8) for x in OPEN_SHOPS), seed=31, step=0.07)
    rock_wall("hall_west", M, coll, "z", -5, z0, z1, +1, seed=32)
    rock_wall("hall_east_n", M, coll, "z", 33, z0, -6.6, -1, seed=33)  # the lift opens off the walkway side
    for at in (4, 14, 23.75):
        door_portal(f"hall_door_{at}", M, coll, "x", at, z0 - 0.12, 0.3)
    # timber mine sets spanning the wider tunnel
    for k, x in enumerate(SET_X):
        mine_set(f"hall_set{k}", M, coll, x, z0 + 0.18, z1 - 0.18)

    # the boardwalk: planks laid lengthwise in staggered runs, a kerb beam on its edge
    for row, z in enumerate(np.arange(z1 - 0.28, WALK_N + 0.1, -0.25)):
        x = -4.9 + (row % 3) * 0.9
        k = 0
        while x < 32.9:
            length = min(rng.uniform(2.4, 3.8), 32.9 - x)
            kit.box(f"walk_plank{row}_{k}", M["timber"], coll, (x + length / 2, 0.06, z), (length - 0.02, 0.05, 0.23),
                    rot=(rng.uniform(-0.004, 0.004), 0, rng.uniform(-0.003, 0.003)), bev=0.008, grain="long")
            x += length
            k += 1
    kit.box("walk_kerb", M["timber"], coll, (14.0, 0.07, WALK_N - 0.06), (37.8, 0.14, 0.14), bev=0.015, grain="long")

    # the old cart rails: abandoned, so rusted, broken up, half buried (author request)
    x = -4.4
    seg = 0
    while x < 32.8:
        length = min(rng.uniform(2.2, 4.0), 32.8 - x)
        if not (11.5 < x < 14.5):  # one length has been pulled up and taken
            for k, z in enumerate((TRACK_Z + 0.25, TRACK_Z - 0.25)):
                kit.box(f"hall_rail{seg}_{k}", M["rust"], coll, (x + length / 2, 0.006 + rng.uniform(-0.012, 0.006), z + rng.uniform(-0.015, 0.015)),
                        (length - 0.03, 0.06, 0.05), rot=(rng.uniform(-0.01, 0.01), rng.uniform(-0.004, 0.004), rng.uniform(-0.006, 0.006)), bev=0.008)
        x += length + rng.uniform(0.02, 0.08)
        seg += 1
    for k, x in enumerate(np.arange(-4.4, 33, 0.6)):
        roll = rng.random()
        if roll < 0.2:
            continue  # missing
        if roll < 0.35:  # split: a short stub, knocked askew
            kit.box(f"hall_sleeper{k}", M["timber_rot"], coll, (x + rng.uniform(-0.1, 0.1), 0.005, TRACK_Z + rng.choice((-0.25, 0.25))), (0.13, 0.035, rng.uniform(0.3, 0.45)),
                    rot=(0, 0, rng.uniform(-0.6, 0.6)), bev=0.01, grain="long")
            continue
        kit.box(f"hall_sleeper{k}", M["timber_rot"], coll, (x + rng.uniform(-0.04, 0.04), -0.004, TRACK_Z + rng.uniform(-0.04, 0.04)), (0.13, 0.04, 0.82),
                rot=(rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(-0.12, 0.12)), bev=0.01, grain="long")
    # plank crossings from the boardwalk over the rails to each door
    for at in (4, 14, 23.75):
        for j in range(5):
            kit.box(f"walk_cross{int(at)}_{j}", M["timber"], coll, (at - 0.5 + j * 0.25, 0.07, (WALK_N + z0) / 2), (0.23, 0.05, abs(z0 - WALK_N) - 0.1),
                    rot=(0, 0, rng.uniform(-0.01, 0.01)), bev=0.008, grain="long")

    # the ore cart left on the rails at the dead end, barrels beside it
    kit.box("hall_cart", M["steel"], coll, (-4.2, 0.6, TRACK_Z), (0.9, 0.5, 1.1), bev=0.03)
    kit.box("hall_cart_base", M["dark"], coll, (-4.2, 0.28, TRACK_Z), (0.72, 0.1, 0.92), bev=0.01)
    for dx in (-0.3, 0.3):
        for dz in (-0.38, 0.38):
            kit.cylinder(f"hall_cart_wheel_{dx}_{dz}", M["dark"], coll, (-4.2 + dx - 0.04, 0.13, TRACK_Z + dz), (-4.2 + dx + 0.04, 0.13, TRACK_Z + dz), 0.11, segments=16)
    rocks("hall_cart_ore", M, coll, (-4.2, 0.82, TRACK_Z), 6, (0.25, 0.08, 0.35))
    for k, (x, z) in enumerate(((-4.6, z0 + 0.45), (-4.55, WALK_N + 0.35))):
        barrel(f"hall_barrel{k}", M, coll, x, z)

    # the sealed tunnel where the Husks nearly broke in (art bible 6): a mine
    # portal on the north wall, packed with timber and scrap, the rock scorched
    tx = -2.4
    door_portal("hall_sealed", M, coll, "x", tx, z0 + 0.05, 0.22, w=1.6, h=2.4)
    kit.box("hall_sealed_back", M["dark"], coll, (tx, 1.2, z0 - 0.06), (1.62, 2.4, 0.04), bev=0)
    for k in range(7):
        y = 0.25 + k * 0.33
        kit.box(f"hall_sealed_plank{k}", M["timber"], coll, (tx + rng.uniform(-0.05, 0.05), y, z0 + 0.1), (1.75, 0.24, 0.05), rot=(0, rng.uniform(-0.05, 0.05), rng.uniform(-0.12, 0.12)), bev=0.01, grain="long")
    for k in range(3):
        kit.box(f"hall_sealed_plate{k}", M["steel"], coll, (tx + rng.uniform(-0.45, 0.45), rng.uniform(0.5, 2.0), z0 + 0.14), (rng.uniform(0.4, 0.7), rng.uniform(0.3, 0.5), 0.02), rot=(0, 0, rng.uniform(-0.3, 0.3)), bev=0.004)
    kit.box("hall_sealed_brace", M["timber"], coll, (tx, 1.2, z0 + 0.16), (0.14, 2.7, 0.08), rot=(0, 0, 0.55), bev=0.01, grain="long")
    # soot rises: the scorch spreads up and out around the boarded opening
    kit.plane("hall_sealed_scorch", M["scorch"], coll, (tx, 2.15, z0 + 0.045), 5.0, 3.0, (R90, 0, 0))
    rocks("hall_sealed_rubble", M, coll, (tx, 0.0, z0 + 0.35), 9, (0.8, 0.05, 0.2), size=(0.08, 0.2))

    # the air: an air handler at the east end feeds the duct along the north
    # side; vent grilles breathe out of its underside, and shafts rise from it
    # up through the rock to the surface
    # The duct hangs just under the timber caps and clear of the knee braces
    # (author: vents never run into posts or beams); it sits over the rails,
    # above the door heads. check_clearance() verifies this on every build.
    dz = TRACK_Z - 0.05
    dy0, dy1 = 2.8, 3.08  # duct bottom / top: above the door heads (2.78), below the caps (3.13)
    dyc = (dy0 + dy1) / 2
    kit.box("hall_duct", M["steel"], coll, (14, dyc, dz), (37.8, dy1 - dy0, 0.5), bev=0.02)
    for k, x in enumerate(np.arange(-4, 33, 3)):
        if min(abs(x - sx) for sx in SET_X) > 0.3:
            kit.box(f"hall_duct_band{k}", M["dark"], coll, (x, dyc, dz), (0.05, dy1 - dy0 + 0.04, 0.54), bev=0.004)
    for k, x in enumerate(np.arange(-2.5, 32, 4.5)):  # louvred grilles on the underside
        kit.box(f"hall_grille{k}", M["dark"], coll, (x, dy0 - 0.012, dz), (0.6, 0.02, 0.36), bev=0.004)
        for j in range(6):
            kit.box(f"hall_grille{k}_slat{j}", M["bare"], coll, (x - 0.25 + j * 0.1, dy0 - 0.028, dz), (0.025, 0.03, 0.32), rot=(0, 0.5, 0), bev=0.002)
    for k, x in enumerate((1.5, 10.0, 19.5, 27.3)):  # ventilation shafts up to the surface, between the sets
        kit.box(f"hall_shaft{k}", M["steel"], coll, (x, (dy1 + H + 0.6) / 2, dz), (0.44, H + 0.6 - dy1, 0.44), bev=0.015)
        kit.box(f"hall_shaft{k}_collar", M["dark"], coll, (x, H - 0.03, dz), (0.66, 0.06, 0.66), bev=0.01)
        for j in range(4):  # bolts round the collar
            ox, oz = ((-0.27, -0.27), (0.27, -0.27), (-0.27, 0.27), (0.27, 0.27))[j]
            kit.cylinder(f"hall_shaft{k}_bolt{j}", M["bare"], coll, (x + ox, H - 0.07, dz + oz), (x + ox, H - 0.05, dz + oz), 0.012, segments=6, bev=0)
        kit.box(f"hall_shaft{k}_damper", M["dark"], coll, (x + 0.3, H - 0.05, dz), (0.06, 0.08, 0.12), bev=0.01)
    ax = 32.1
    kit.box("hall_ac_unit", M["steel_locker"], coll, (ax, 0.75, dz - 0.15), (1.2, 1.5, 0.9), bev=0.03)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=0.38)
    kit.mesh_obj("hall_ac_fan_face", bm, M["dark"], coll, kit.g2b(ax - 0.61, 0.8, dz - 0.15), (R90, 0, -R90), smooth=False)["uv"] = "box"
    for j in range(5):  # the fan guard
        kit.box(f"hall_ac_guard{j}", M["bare"], coll, (ax - 0.63, 0.5 + j * 0.15, dz - 0.15), (0.02, 0.02, 0.76), bev=0)
    kit.box("hall_ac_riser", M["steel"], coll, (ax - 0.1, (1.5 + dy0) / 2, dz), (0.44, dy0 - 1.5, 0.44), bev=0.015)
    kit.box("hall_ac_panel", M["dark"], coll, (ax + 0.2, 1.1, dz + 0.31), (0.36, 0.42, 0.02), bev=0.005)
    light(room, "hall_ac_lamp", "POINT", (ax - 0.4, 1.3, dz + 0.5), (0.94, 0.7, 0.35), 6, coll=coll)

    # lamps over the walkway, string lights down the middle
    for k, x in enumerate((0, 9, 18.5, 28)):
        work_lamp(f"hall_lamp{k}", M, coll, x, H - 0.75, -5.2, room, watts=260)
    for k, x in enumerate((9.0, 19.0, 29.0)):  # between the doors, clear of the neon
        work_lamp(f"hall_track_lamp{k}", M, coll, x, H - 0.8, dz + 0.6, room, watts=160)
    string_lights("hall_string", M, coll, room, [((x, H - 0.35, -6.2), (x + 4.6, H - 0.35, -6.2)) for x in np.arange(-4.2, 32, 4.6)], sag=0.35, every=6, watts=25)

    # shopfronts cut into the south wall
    for k, (x, neon, colour) in enumerate(((6.4, "neon_noodles", (0.85, 0.34, 0.48)), (13.2, "neon_bunks", (0.91, 0.58, 0.23)),
                                          (17.8, "neon_clinic", (0.94, 0.7, 0.35)), (23.4, "neon_water", (0.91, 0.58, 0.23)),
                                          (27.4, "neon_radio", (0.85, 0.34, 0.48)))):
        z = -3.66
        if x in OPEN_SHOPS:  # open for business: the shutter rolled up into its drum under the lintel
            kit.cylinder(f"shop{k}_drum", M["steel"], coll, (x - 0.86, 2.4, z + 0.02), (x + 0.86, 2.4, z + 0.02), 0.13, segments=16)
            for s_ in (-1, 1):
                kit.box(f"shop{k}_drum_bracket{s_}", M["dark"], coll, (x + s_ * 0.88, 2.4, z + 0.02), (0.04, 0.3, 0.3), bev=0.008)
            kit.box(f"shop{k}_shutter_lip", M["dark"], coll, (x, 2.26, z - 0.1), (1.7, 0.04, 0.03), bev=0.005)
            kit.box(f"shop{k}_lintel", M["timber"], coll, (x, 2.62, z - 0.06), (2.0, 0.14, 0.14), bev=0.012, grain="long")
        else:
            kit.box(f"shop{k}_shutter", M["steel"], coll, (x, 1.1, z), (1.7, 2.1, 0.05), bev=0.01)
            for j, y in enumerate(np.arange(0.17, 2.1, 0.12)):
                kit.box(f"shop{k}_rib{j}", M["dark"], coll, (x, y, z - 0.03), (1.66, 0.02, 0.012), bev=0)
        for s in (-1, 1):
            kit.box(f"shop{k}_post{s}", M["timber"], coll, (x + s * 0.92, 1.15, z - 0.06), (0.12, 2.3, 0.12), rot=(0, 0, 0.01 * s), bev=0.012, grain="long")
        kit.box(f"shop{k}_awning", M["blanket"] if k % 2 else M["canvas"], coll, (x, 2.45, z - 0.32), (2.0, 0.05, 0.62), rot=(-0.3, 0, 0), soft=True, puff=0.3)
        kit.box(f"shop{k}_neon_back", M["dark"], coll, (x, 2.88, z - 0.05), (1.75, 0.46, 0.03), bev=0.006)
        kit.plane(f"shop{k}_neon", P[neon], coll, (x, 2.88, z - 0.07), 1.7, 0.42, (R90, 0, math.pi))
        if x not in OPEN_SHOPS:
            crate(f"shop{k}_counter", M, coll, (x + 0.45, 0.38, -3.98), (0.55, 0.6, 0.4))
        light(room, f"shop{k}_neon_light", "POINT", (x, 2.6, -4.3), colour, 18, coll=coll)

    # north wall: a grow rack, the notice board, a water tank
    gx, gz = 9.2, z0 + 0.24
    kit.box("grow_frame", M["steel"], coll, (gx, 0.95, gz), (1.6, 1.9, 0.32), bev=0.02)
    for k, y in enumerate((0.45, 1.05, 1.65)):
        kit.box(f"grow_shelf{k}", M["dark"], coll, (gx, y - 0.18, gz + 0.06), (1.5, 0.03, 0.28), bev=0.004)
        kit.box(f"grow_tray{k}", M["earth"], coll, (gx, y - 0.13, gz + 0.06), (1.4, 0.07, 0.24), bev=0.01)
        kit.box(f"grow_strip{k}", M["grow"], coll, (gx, y + 0.22, gz + 0.12), (1.4, 0.015, 0.02), bev=0)
        for j in range(6):
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rng.uniform(0.07, 0.11))
            kit.mesh_obj(f"grow_leaf{k}_{j}", bm, M["leaf"], coll, kit.g2b(gx - 0.6 + j * 0.24, y - 0.03, gz + 0.08), tuple(rng.uniform(0, 3, 3)))["uv"] = "box"
    light(room, "grow_light", "POINT", (gx, 1.4, gz + 0.5), (0.85, 0.42, 0.55), 22, coll=coll)
    board("notices", P["sign_notices"], coll, (18.6, 2.05, z0 + 0.18), 1.4, 0.36, (R90, 0, 0), timber=M["timber"])
    kit.box("notices_cork", M["plank"], coll, (18.6, 1.45, z0 + 0.16), (1.5, 0.8, 0.04), bev=0.01)
    for k, (dx, dy, key) in enumerate(((-0.45, 0.05, "paper_notice_1"), (0.05, -0.05, "paper_notice_2"), (0.5, 0.08, "paper_notice_3"))):
        kit.plane(f"notice_paper{k}", P[key], coll, (18.6 + dx, 1.45 + dy, z0 + 0.185), 0.3, 0.38, (R90, 0, rng.uniform(-0.12, 0.12)))
    barrel("hall_tank", M, coll, 30.4, z0 + 0.55, r=0.38, h=1.6)
    kit.cylinder("hall_tank_pipe", M["steel"], coll, (30.4, 1.6, z0 + 0.3), (30.4, H, z0 + 0.3), 0.05)
    # laundry strung across the west end
    a, b = (-0.9, 3.0, z0 + 0.15), (1.6, 2.95, -3.7)
    kit.cylinder("laundry_line", M["canvas"], coll, a, b, 0.004, segments=5, bev=0)
    for k, tint in enumerate(("blanket", "mattress", "canvas", "blanket")):
        t = (k + 1) / 5
        p = [a[i] + (b[i] - a[i]) * t for i in range(3)]
        kit.box(f"laundry{k}", M[tint], coll, (p[0], p[1] - 0.22, p[2]), (0.34, 0.4, 0.02), rot=(0, 0, -math.atan2(b[0] - a[0], b[2] - a[2]) + R90), soft=True, puff=0.3)
    # handmade neon over each doorway, hung from the ceiling on chains
    for at, text, colour in ((4, "GUNSMITH", (0.91, 0.58, 0.23)), (14, "WORKSHOP", (0.94, 0.7, 0.35)), (23.75, "CHECKOUT", (0.85, 0.34, 0.48))):
        neon_sign(f"hall_neon_{int(at)}", text, colour, coll, room, (at, 2.62, dz + 0.5), 0.0, size=0.38)
    neon_sign("hall_neon_quarters", "YOUR QUARTERS", (0.91, 0.58, 0.23), coll, room, (-2.0, 2.95, -3.72), math.pi, size=0.2)
    neon_sign("hall_neon_lift", "LIFT", (0.18, 0.9, 0.82), coll, room, (32.6, 2.85, -5.1), -R90, size=0.3)
    # benches on the boardwalk
    for k, x in enumerate((9, 20.6)):  # clear of the open shop doors
        kit.box(f"hall_bench{k}_seat", M["timber"], coll, (x, 0.53, -3.95), (2.0, 0.07, 0.42), bev=0.015, grain="long")
        for s in (-0.85, 0.85):
            kit.box(f"hall_bench{k}_leg{s}", M["timber"], coll, (x + s, 0.3, -3.95), (0.08, 0.44, 0.38), bev=0.01)
    return [((-3.8, 1.75, -4.4), (12.0, 1.5, -6.6)),
            ((11.0, 1.7, -7.6), (14.5, 1.9, -3.6)), ((-0.6, 1.6, -5.6), (-2.4, 1.4, -8.6)),
            ((8.5, 1.55, -4.2), (4.0, 2.4, -8.6)), ((-3.6, 1.6, -7.8), (-1.5, 2.6, -3.6)),
            ((28.0, 1.9, -4.6), (32.5, 2.4, -8.0)),
            ((14.2, 1.7, -7.2), (18.4, 1.3, -3.2)), ((23.6, 1.7, -7.2), (27.8, 1.3, -3.2))]  # the open CLINIC and RADIO & PARTS shopfronts


def ammo_can(name, M, coll, x, y, z, yaw=0.0):
    kit.box(name, M["steel_locker"], coll, (x, y + 0.09, z), (0.28, 0.18, 0.14), rot=(0, 0, yaw), bev=0.012)
    kit.box(f"{name}_lid", M["dark"], coll, (x, y + 0.185, z), (0.29, 0.02, 0.15), rot=(0, 0, yaw), bev=0.004)
    kit.box(f"{name}_handle", M["bare"], coll, (x, y + 0.205, z), (0.12, 0.012, 0.02), rot=(0, 0, yaw), bev=0.003)


def glass_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.6, 0.56, 1)
    b.inputs["Roughness"].default_value = 0.08
    b.inputs["Alpha"].default_value = 0.1
    return m


# ---------- the real guns on display ----------
# Shops show the actual weapon models (tools/blender/build_weapons.py,
# godot/models/weapons/wpn_<gun>.gltf), not stand-ins. Each placement is
# recorded here; Godot instances the weapon scenes (guns_<room>.tscn) so the
# shop shares the guns' meshes instead of baking copies into the room.
DISPLAY = {}  # room -> [(gun, centre (game space), 3x3 rotation (game space))]
_C = np.array([[1.0, 0, 0], [0, 0, -1.0], [0, 1.0, 0]])  # game -> Blender, as kit.g2b


def gun_rot(yaw=0.0, pitch=0.0, roll=0.0):
    """A game-space rotation for a gun (gun frame: +z muzzle, +y up, +x its
    right side): roll about the barrel, then pitch, then yaw."""
    cy, sy, cp, sp, cr, sr = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch), math.cos(roll), math.sin(roll)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return ry @ rx @ rz


def show_gun(room, gun, centre, rot):
    """Puts a real gun in a room, its bounding box centred on `centre`."""
    DISPLAY.setdefault(room, []).append((gun, centre, rot))


def build_display_guns(room):
    """Builds the room's displayed guns in Blender (for previews; they are not
    merged into the room export) and returns [(gun, origin, rot)] with each
    gun's own origin, for the Godot scene."""
    import build_weapons as bw
    if not hasattr(build_display_guns, "M"):
        build_display_guns.M = bw.gun_materials()
    coll = bpy.data.collections.new(f"{room}_display_guns")
    bpy.context.scene.collection.children.link(coll)
    placed = []
    for k, (gun, centre, rot) in enumerate(DISPLAY.get(room, [])):
        tmp = bpy.data.collections.new(f"{room}_gun{k}")
        bpy.context.scene.collection.children.link(tmp)
        bw.GUNS[gun](build_display_guns.M, tmp)
        for o in list(tmp.objects):
            if o.type != "MESH":
                bpy.data.objects.remove(o)
                continue
            kit.finalize(o)
        pts = np.array([tuple(o.matrix_world @ v.co) for o in tmp.objects for v in o.data.vertices])
        lo, hi = pts.min(0), pts.max(0)
        c = _C.T @ ((lo + hi) / 2)  # bounding-box centre in the gun frame
        origin = np.array(centre) - rot @ c
        mb = Matrix(((_C @ rot @ _C.T).tolist()))
        m4 = mb.to_4x4()
        m4.translation = Vector(kit.g2b(*origin))
        for o in list(tmp.objects):
            o.matrix_world = m4 @ o.matrix_world
            tmp.objects.unlink(o)
            coll.objects.link(o)
        bpy.data.collections.remove(tmp)
        placed.append((gun, origin, rot))
    return placed


def write_guns(room, placed):
    """Writes godot/scenes/sanctuary/guns_<room>.tscn: one instance of
    godot/models/weapons/wpn_<gun>.gltf per displayed gun."""
    guns = sorted({g for g, _, _ in placed})
    out = [f'[gd_scene load_steps={len(guns) + 1} format=3]', '']
    for k, g in enumerate(guns):
        out.append(f'[ext_resource type="PackedScene" path="res://models/weapons/wpn_{g}.gltf" id="{k + 1}_{g}"]')
    out += ['', f'[node name="Guns_{room}" type="Node3D"]']
    for k, (g, o, r) in enumerate(placed):
        t = ", ".join(f"{v:.5g}" for v in r.reshape(-1)) + f", {o[0]:.4f}, {o[1]:.4f}, {o[2]:.4f}"
        out += ['', f'[node name="{g}_{k}" parent="." instance=ExtResource("{guns.index(g) + 1}_{g}")]', f'transform = Transform3D({t})']
    with open(os.path.join(SCENES, f"guns_{room}.tscn"), "w") as f:
        f.write("\n".join(out) + "\n")


def build_trade_hall(M, P, coll):
    """Tobias's gun shop (author: each trader gets a room of their own; the
    Trade Hall is Tobias's). Customer side by the door, his workshop behind
    a glass-topped display counter."""
    room = "trade_hall"
    x0, x1, z0, z1 = -0.5, 8.87, -15, -6.85
    floor_ceiling("trade", M, coll, x0, x1, z0, z1, seed=41)
    rock_wall("trade_west", M, coll, "z", x0, z0, z1, +1, seed=42)
    rock_wall("trade_east", M, coll, "z", x1, z0, z1, -1, seed=43)
    rock_wall("trade_back", M, coll, "x", z0, x0, x1, +1, seed=44)
    rock_wall("trade_front", M, coll, "x", z1, x0, x1, -1, doors=((4, 1.8),), seed=45)
    for k, z in enumerate((-8.4, -10.0)):  # old steel arch ribs, clear of the counter and bench
        pts = [(4.2 + 4.6 * math.cos(a), -1.2 + 4.6 * math.sin(a), z) for a in np.linspace(0.12, math.pi - 0.12, 25)]
        for j in range(len(pts) - 1):
            kit.cylinder(f"trade_rib{k}_{j}", M["dark"], coll, pts[j], pts[j + 1], 0.06, segments=8, bev=0)
    glass = glass_material("mat_glass_case_01")

    # --- the counter: a timber-framed display case with a glass top, pistols under the glass ---
    cz = -11.0
    for k, (ca, cb) in enumerate(((0.4, 3.4), (3.6, 7.2))):
        cx, cw = (ca + cb) / 2, cb - ca
        kit.box(f"gun_case{k}_body", M["plank"], coll, (cx, 0.45, cz), (cw, 0.9, 0.62), bev=0.015)
        kit.box(f"gun_case{k}_rail_f", M["timber"], coll, (cx, 0.95, cz + 0.29), (cw, 0.06, 0.05), bev=0.01, grain="long")
        kit.box(f"gun_case{k}_rail_b", M["timber"], coll, (cx, 0.95, cz - 0.29), (cw, 0.06, 0.05), bev=0.01, grain="long")
        for s in (-1, 1):
            kit.box(f"gun_case{k}_end{s}", M["timber"], coll, (cx + s * (cw / 2 - 0.03), 0.95, cz), (0.06, 0.06, 0.62), bev=0.01)
        kit.box(f"gun_case{k}_bed", M["canvas"], coll, (cx, 0.9, cz), (cw - 0.1, 0.01, 0.52), bev=0)  # the cloth the guns lie on
        kit.plane(f"gun_case{k}_glass", glass, coll, (cx, 0.975, cz), cw - 0.08, 0.54, (0, 0, 0))
        # under the glass, lying on their sides on the cloth: revolvers, and Sparrows in the long case
        lay = ("hammerhead", "hammerhead", "hammerhead", "hammerhead") if k == 0 else ("sparrow", "hammerhead", "sparrow", "hammerhead")
        step = cw / len(lay)
        for j, g in enumerate(lay):
            show_gun(room, g, (ca + step * (j + 0.5), 0.93, cz + (-1) ** j * 0.04), gun_rot(yaw=R90 + (-1) ** j * 0.12, roll=R90))
        kit.box(f"gun_case{k}_kick", M["rust"], coll, (cx, 0.05, cz + 0.31), (cw, 0.1, 0.02), bev=0.004)
    kit.box("gun_case_flap", M["timber"], coll, (7.75, 0.95, cz), (1.0, 0.05, 0.62), rot=(0, 0.0, 0), bev=0.01, grain="long")  # the hinged flap behind it
    kit.box("gun_case_flap_hinge", M["bare"], coll, (7.22, 0.97, cz), (0.04, 0.03, 0.5), bev=0.005)
    kit.box("gun_bell", M["bare"], coll, (2.0, 1.01, cz + 0.15), (0.08, 0.04, 0.08), bev=0.02)
    kit.box("gun_ledger", M["blanket"], coll, (5.2, 1.0, cz + 0.05), (0.34, 0.03, 0.26), rot=(0, 0, 0.25), bev=0.008)

    # --- the gun wall: pegboard across the back, long guns and pistols on hooks ---
    kit.box("gun_wall_board", M["plank"], coll, (4.2, 1.75, z0 + 0.12), (7.2, 2.1, 0.04), bev=0.01)
    for k in range(5):
        kit.box(f"gun_wall_rail{k}", M["timber"], coll, (4.2, 0.95 + k * 0.45, z0 + 0.15), (7.2, 0.05, 0.03), bev=0.006, grain="long")
    wall = (  # rows of the pegboard, top to bottom: the long guns, the rifles, the cheap stuff
        (2.42, ("heron", "boar", "heron")),
        (1.9, ("badger", "mule", "badger", "sparrow")),
        (1.4, ("mule", "boar", "sparrow", "mule")),
    )
    for row, (y, guns) in enumerate(wall):
        step = 7.0 / len(guns)
        for j, g in enumerate(guns):
            gx = 0.7 + step * (j + 0.5) + rng.uniform(-0.05, 0.05)
            # hung muzzle west with the right side facing the shop
            show_gun(room, g, (gx, y, z0 + 0.185), gun_rot(yaw=-R90))
            for hx in (-0.28, 0.28):  # the hooks it hangs on
                kit.box(f"gun_wall{row}_{j}_hook{hx}", M["bare"], coll, (gx + hx, y - 0.07, z0 + 0.17), (0.015, 0.05, 0.07), bev=0.002)
    for j in range(5):  # revolvers on pegs along the bottom rail
        show_gun(room, "hammerhead", (1.3 + j * 1.4, 0.98, z0 + 0.17), gun_rot(yaw=-R90))
        kit.box(f"gun_wall_peg{j}", M["bare"], coll, (1.3 + j * 1.4 + 0.02, 0.94, z0 + 0.17), (0.012, 0.012, 0.07), bev=0.002)
    board("gun_sign", P["sign_trader_0"], coll, (4.2, 3.0, z0 + 0.14), 1.6, 0.52, (R90, 0, 0), timber=M["timber"])

    # --- the work bench along the west wall: vise, grinder, a rifle stripped on a cloth ---
    bx, bz = x0 + 0.55, -13.4
    kit.box("gun_bench_top", M["timber"], coll, (bx, 0.9, bz), (0.8, 0.07, 2.6), bev=0.015, grain="long")
    kit.box("gun_bench_frame", M["rust"], coll, (bx, 0.43, bz), (0.72, 0.86, 2.5), bev=0.02)
    kit.box("gun_bench_vise", M["dark"], coll, (bx + 0.25, 1.02, bz - 1.0), (0.2, 0.16, 0.22), bev=0.015)
    kit.box("gun_bench_vise_jaw", M["bare"], coll, (bx + 0.37, 1.04, bz - 1.0), (0.04, 0.12, 0.2), bev=0.005)
    kit.cylinder("gun_bench_grinder", M["steel_locker"], coll, (bx - 0.05, 1.04, bz + 1.05), (bx + 0.15, 1.04, bz + 1.05), 0.09, segments=16)
    kit.cylinder("gun_bench_grinder_wheel", M["rock"], coll, (bx + 0.15, 1.04, bz + 1.05), (bx + 0.2, 1.04, bz + 1.05), 0.08, segments=16)
    kit.box("gun_bench_cloth", M["canvas"], coll, (bx, 0.94, bz), (0.6, 0.01, 1.0), rot=(0, 0, 0.05), bev=0)
    parts = (("rust", (0.25, 0.04, 0.05)), ("timber", (0.3, 0.06, 0.05)), ("dark", (0.2, 0.05, 0.05)), ("dark", (0.06, 0.1, 0.03)), ("bare", (0.05, 0.02, 0.02)), ("bare", (0.08, 0.015, 0.015)))
    for k, (mat, size) in enumerate(parts):
        kit.box(f"gun_bench_part{k}", M[mat], coll, (bx + rng.uniform(-0.2, 0.2), 0.96, bz + rng.uniform(-0.4, 0.4)), (size[2], size[1], size[0]), rot=(0, 0, rng.uniform(-0.6, 0.6)), bev=0.005)
    kit.cylinder("gun_bench_barrel_loose", M["dark"], coll, (bx - 0.15, 0.96, bz - 0.45), (bx - 0.1, 0.96, bz + 0.25), 0.012)
    for k in range(3):  # oil tins
        kit.cylinder(f"gun_bench_oil{k}", M["steel_locker" if k else "rust"], coll, (bx - 0.25 + k * 0.1, 0.94, bz + 0.6), (bx - 0.25 + k * 0.1, 1.06, bz + 0.6), 0.035, segments=12)
    work_lamp("gun_bench_lamp", M, coll, bx + 0.1, 1.9, bz, room, watts=110)

    # --- the east wall: a tall gun rack and the locked armoury cabinet ---
    rx = x1 - 0.35
    kit.box("gun_rack_base", M["timber"], coll, (rx, 0.12, -13.9), (0.4, 0.24, 1.3), bev=0.015)
    kit.box("gun_rack_top", M["timber"], coll, (rx, 1.25, -13.9), (0.25, 0.08, 1.3), bev=0.012, grain="long")
    for j, g in enumerate(("boar", "badger", "heron", "mule")):  # stood muzzle up, butts on the base, trigger side to the room
        h = {"boar": 1.18, "badger": 0.97, "heron": 1.46, "mule": 0.97}[g]
        show_gun(room, g, (rx - 0.02, 0.25 + h / 2, -14.4 + j * 0.3), gun_rot(yaw=math.pi, pitch=-R90))
    cab_z = -12.2
    kit.box("gun_cabinet", M["steel_locker"], coll, (x1 - 0.35, 1.0, cab_z), (0.6, 2.0, 1.1), bev=0.025)
    kit.box("gun_cabinet_seam", M["dark"], coll, (x1 - 0.652, 1.0, cab_z), (0.006, 1.9, 0.01), bev=0)
    kit.box("gun_cabinet_lockbar", M["rust"], coll, (x1 - 0.67, 1.05, cab_z), (0.03, 0.06, 1.0), bev=0.006)
    kit.box("gun_cabinet_padlock", M["bare"], coll, (x1 - 0.69, 1.0, cab_z), (0.03, 0.08, 0.06), bev=0.01)

    # --- stock and clutter behind the counter: ammo cans, drums, cleaning rods ---
    for k in range(9):
        ammo_can(f"gun_ammo{k}", M, coll, 2.0 + (k % 3) * 0.32, (k // 3) * 0.2, -14.35, yaw=rng.uniform(-0.1, 0.1))
    for k in range(5):
        ammo_can(f"gun_ammo_b{k}", M, coll, 5.6 + (k % 2) * 0.32, (k // 2) * 0.2, -14.3, yaw=rng.uniform(-0.15, 0.15))
    barrel("gun_drum0", M, coll, 7.3, -14.3, r=0.28, h=0.85, mat="rust")
    barrel("gun_drum1", M, coll, 7.9, -14.1, r=0.28, h=0.85, mat="steel_locker")
    kit.box("gun_rods_box", M["plank"], coll, (0.9, 0.3, -14.4), (0.25, 0.6, 0.25), bev=0.012)
    for k in range(5):
        kit.cylinder(f"gun_rod{k}", M["bare"], coll, (0.84 + k * 0.03, 0.55, -14.4), (0.82 + k * 0.035, 1.35, -14.42), 0.005, segments=6, bev=0)

    # --- customer side: a shot-up paper target, a rifle on a plaque, a stool, a spittoon ---
    kit.box("gun_plaque", M["timber"], coll, (x0 + 0.08, 1.8, -8.6), (0.04, 0.4, 1.7), bev=0.012)
    show_gun(room, "heron", (x0 + 0.14, 1.8, -8.6), gun_rot())  # Tobias's best, muzzle to the door
    kit.plane("gun_target", P["paper_target"], coll, (x1 - 0.12, 1.45, -8.3), 0.5, 0.65, (R90, 0, -R90))
    kit.box("gun_stool_seat", M["timber"], coll, (2.6, 0.65, -9.6), (0.4, 0.05, 0.4), bev=0.02)
    for s in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        kit.box(f"gun_stool_leg{s}", M["rust"], coll, (2.6 + s[0] * 0.15, 0.31, -9.6 + s[1] * 0.15), (0.03, 0.62, 0.03), bev=0.004)
    barrel("gun_spittoon", M, coll, 3.1, -10.4, r=0.12, h=0.2, mat="rust")

    # --- customer side, lived in: plank panelling, second-hand shotguns in a barrel,
    # a sand-filled test drum, a waiting bench, the house rules ---
    for side, wx, rot in (("w", x0 + 0.07, R90), ("e", x1 - 0.07, -R90)):
        kit.box(f"gun_wainscot_{side}", M["plank"], coll, (wx, 0.6, -8.9), (0.04, 1.2, 3.6), bev=0.008)
        kit.box(f"gun_wainscot_{side}_cap", M["timber"], coll, (wx, 1.22, -8.9), (0.08, 0.05, 3.7), bev=0.008, grain="long")
    barrel("gun_umbrella", M, coll, 1.0, -7.6, r=0.25, h=0.75, mat="rust")
    for j, g in enumerate(("boar", "mule", "boar", "mule")):  # second-hand guns stood muzzle up, leaning out
        a = j / 4 * 2 * math.pi + 0.4
        h = {"boar": 1.18, "mule": 0.97}[g]
        show_gun(room, g, (1.0 + 0.1 * math.cos(a), 0.12 + h / 2, -7.6 + 0.1 * math.sin(a)), gun_rot(yaw=-a + R90, pitch=-R90 + 0.12))
    barrel("gun_testdrum", M, coll, 7.9, -7.7, r=0.32, h=0.95, mat="steel")
    rocks("gun_testdrum_sand", M, coll, (7.9, 0.94, -7.7), 4, (0.12, 0.02, 0.12), size=(0.06, 0.1))
    kit.box("gun_wait_bench", M["timber"], coll, (x0 + 0.35, 0.45, -9.0), (0.4, 0.07, 1.8), bev=0.015, grain="long")
    for dz_ in (-0.75, 0.75):
        kit.box(f"gun_wait_bench_leg{dz_}", M["rust"], coll, (x0 + 0.35, 0.22, -9.0 + dz_), (0.36, 0.44, 0.06), bev=0.006)
    board("gun_rules", P["sign_rules"], coll, (x1 - 0.1, 2.0, -9.6), 1.1, 0.7, (R90, 0, -R90), timber=M["timber"])

    # --- light: lamps over the counter, one on the gun wall, the bench lamp above ---
    for k, x in enumerate((2.0, 5.6)):
        work_lamp(f"gun_counter_lamp{k}", M, coll, x, 2.2, cz - 0.1, room, watts=200)
    for k, x in enumerate((1.8, 6.6)):  # lamps washing the gun wall
        light(room, f"gun_wall_light{k}", "POINT", (x, 2.9, z0 + 0.9), WARM, 110, coll=coll)
    light(room, "gun_entry_light", "POINT", (4.0, 2.7, -8.0), WARM, 60, coll=coll)
    return [((4.0, 1.65, -7.2), (4.2, 1.5, -14.5)), ((7.6, 1.6, -8.0), (1.5, 1.0, -13.5)), ((1.6, 1.5, -10.2), (0.2, 1.0, -13.5))]


def shop_shell(name, M, coll, x0, x1, z0, z1, door_x, seed):
    """A room dug south of the hallway behind a shopfront: hewn walls, the
    doorway on the north side, timber beams across the roof."""
    floor_ceiling(name, M, coll, x0, x1, z0, z1, seed=seed)
    rock_wall(f"{name}_front", M, coll, "x", z0, x0, x1, +1, doors=((door_x, 1.8),), seed=seed + 1)
    rock_wall(f"{name}_back", M, coll, "x", z1, x0, x1, -1, seed=seed + 2)
    rock_wall(f"{name}_west", M, coll, "z", x0, z0, z1, +1, seed=seed + 3)
    rock_wall(f"{name}_east", M, coll, "z", x1, z0, z1, -1, seed=seed + 4)
    door_portal(f"{name}_door", M, coll, "x", door_x, z0 + 0.1, 0.25)
    for k, z in enumerate(np.linspace(z0 + 1.2, z1 - 0.6, 3)):  # roof beams across the room
        kit.box(f"{name}_beam{k}", M["timber"], coll, ((x0 + x1) / 2, H - 0.15, z), (x1 - x0, 0.22, 0.22),
                rot=(0, 0, rng.uniform(-0.01, 0.01)), bev=0.02, grain="long")


def shop_counter(name, M, coll, x0, x1, z, flap_w=0.7):
    """A trader's counter across the room: plank front, worn timber top, a
    lifting flap at the east end."""
    cx, w = (x0 + x1 - flap_w) / 2, x1 - x0 - flap_w
    kit.box(f"{name}_body", M["plank"], coll, (cx, 0.47, z), (w, 0.94, 0.6), bev=0.015)
    kit.box(f"{name}_top", M["timber"], coll, (cx, 0.97, z), (w + 0.08, 0.06, 0.7), bev=0.012, grain="long")
    kit.box(f"{name}_kick", M["rust"], coll, (cx, 0.06, z - 0.31), (w, 0.12, 0.02), bev=0.004)
    for j in range(int(w / 0.6)):  # the boards' battens
        kit.box(f"{name}_batten{j}", M["timber"], coll, (x0 + 0.3 + j * 0.6, 0.47, z - 0.31), (0.07, 0.86, 0.03), bev=0.006)
    kit.box(f"{name}_flap", M["timber"], coll, (x1 - flap_w / 2, 0.97, z), (flap_w - 0.04, 0.05, 0.66), bev=0.01, grain="long")
    kit.box(f"{name}_flap_hinge", M["bare"], coll, (x1 - flap_w + 0.02, 0.99, z), (0.03, 0.03, 0.5), bev=0.004)


def build_clinic(M, P, coll):
    """Nia's clinic behind the CLINIC shopfront (author: each trader gets a
    room of their own). A clean room in a dirty place: a counter of bandages
    and satchels, two cots behind a curtain, the medicine cabinet, shield
    packs on the wall. No red cross (art bible 5.2)."""
    room = "clinic"
    x0, x1, z0, z1 = 15.55, 20.05, -3.45, 2.6
    dx = OPEN_SHOPS[0]
    shop_shell("clinic", M, coll, x0, x1, z0, z1, dx, seed=81)
    bottle, ice, bone = M["bottle"], M["ice"], M["bone"]

    cz = -0.95
    # behind the counter she keeps a plank floor, scrubbed
    for k, x in enumerate(np.arange(x0 + 0.15, x1 - 0.1, 0.3)):
        kit.box(f"clinic_deck{k}", M["plank"], coll, (x, 0.035, (cz + 0.3 + z1) / 2), (0.28, 0.04, z1 - cz - 0.35), bev=0.006, grain="long")
    shop_counter("clinic_counter", M, coll, x0 + 0.15, x1 - 0.1, cz)
    # on the counter: rolled bandages, a tray of instruments, her satchel, a jar of swabs, the ledger
    for k in range(7):
        kit.cylinder(f"clinic_bandage{k}", bone, coll, (16.0 + (k % 4) * 0.13, 1.0 + (k // 4) * 0.09, cz + 0.12), (16.0 + (k % 4) * 0.13, 1.08 + (k // 4) * 0.09, cz + 0.12), 0.045, segments=12)
    kit.box("clinic_tray", M["bare"], coll, (17.1, 1.01, cz + 0.05), (0.42, 0.02, 0.28), bev=0.008)
    for k in range(4):
        kit.box(f"clinic_tool{k}", M["bare"], coll, (16.97 + k * 0.08, 1.027, cz + 0.05 + rng.uniform(-0.05, 0.05)), (0.012, 0.008, 0.18), rot=(0, 0, rng.uniform(-0.2, 0.2)), bev=0.002)
    kit.box("clinic_satchel", M["canvas"], coll, (18.0, 1.12, cz - 0.05), (0.4, 0.26, 0.14), rot=(0, 0, 0.2), soft=True, puff=0.35)
    kit.box("clinic_satchel_patch", bone, coll, (18.0, 1.14, cz - 0.123), (0.12, 0.12, 0.01), rot=(0, 0, 0.2), bev=0.002)
    kit.box("clinic_satchel_flap", M["canvas"], coll, (18.0, 1.22, cz - 0.06), (0.41, 0.06, 0.16), rot=(0.25, 0, 0.2), soft=True, puff=0.3)
    kit.cylinder("clinic_jar", bottle, coll, (18.55, 1.0, cz + 0.12), (18.55, 1.2, cz + 0.12), 0.06, segments=16)
    kit.cylinder("clinic_jar_swabs", bone, coll, (18.55, 1.0, cz + 0.12), (18.55, 1.17, cz + 0.12), 0.05, segments=12)
    kit.box("clinic_ledger", M["blanket"], coll, (16.6, 1.015, cz - 0.15), (0.32, 0.03, 0.24), rot=(0, 0, -0.15), bev=0.008)
    board("clinic_sign", P["sign_trader_1"], coll, ((x0 + x1) / 2, 2.45, cz - 0.1), 1.5, 0.48, (R90, 0, math.pi), timber=M["timber"])
    for s_ in (-1, 1):
        kit.cylinder(f"clinic_sign_chain{s_}", M["dark"], coll, ((x0 + x1) / 2 + s_ * 0.65, 2.7, cz - 0.1), ((x0 + x1) / 2 + s_ * 0.65, H - 0.26, cz - 0.1), 0.008, segments=5, bev=0)
    work_lamp("clinic_counter_lamp", M, coll, 17.0, 2.15, cz + 0.2, room, watts=180)

    # the cots behind the counter, a curtain on a rail between them
    for k, cx in enumerate((16.05, 19.55)):
        cz_ = 1.45
        kit.box(f"clinic_cot{k}_frame", M["steel_locker"], coll, (cx, 0.45, cz_), (0.78, 0.06, 1.9), bev=0.015)
        for s1 in (-1, 1):
            for s2 in (-1, 1):
                kit.cylinder(f"clinic_cot{k}_leg{s1}{s2}", M["steel_locker"], coll, (cx + s1 * 0.35, 0, cz_ + s2 * 0.9), (cx + s1 * 0.35, 0.45, cz_ + s2 * 0.9), 0.02, segments=8)
        kit.box(f"clinic_cot{k}_mattress", M["mattress"], coll, (cx, 0.54, cz_), (0.72, 0.12, 1.84), soft=True, puff=0.25)
        kit.box(f"clinic_cot{k}_blanket", M["blanket"] if k else bone, coll, (cx, 0.61, cz_ - 0.25 if k else cz_ - 0.35), (0.76, 0.04, 1.1), soft=True, puff=0.4)
        kit.box(f"clinic_cot{k}_pillow", bone, coll, (cx, 0.63, cz_ + 0.72), (0.5, 0.1, 0.3), soft=True, puff=0.5)
        kit.box(f"clinic_cot{k}_head", M["steel_locker"], coll, (cx, 0.72, cz_ + 0.95), (0.78, 0.55, 0.04), bev=0.012)
    kit.cylinder("clinic_curtain_rail", M["bare"], coll, (16.75, 2.3, 0.2), (16.75, 2.3, 2.5), 0.012, segments=8)
    for k in range(14):  # canvas hanging in folds from rings, bunched up at the back where it's pulled open
        z = 0.3 + k * (0.12 if k < 10 else 0.06)
        x = 16.75 + 0.035 * math.sin(k * 1.9)
        kit.box(f"clinic_curtain{k}", bone, coll, (x, 1.3, z), (0.02, 1.9, 0.14), rot=(0, 0, (-1) ** k * 0.5), soft=True, puff=0.15)  # each fold turned a little either way
        kit.cylinder(f"clinic_curtain_ring{k}", M["bare"], coll, (x, 2.27, z - 0.012), (x, 2.27, z + 0.012), 0.018, segments=8, bev=0)
    # an IV stand by the first cot, a bag hung on it
    kit.cylinder("clinic_iv_pole", M["bare"], coll, (16.6, 0, 1.0), (16.6, 1.95, 1.0), 0.012, segments=8)
    kit.cylinder("clinic_iv_base", M["dark"], coll, (16.6, 0, 1.0), (16.6, 0.04, 1.0), 0.2, segments=5, bev=0.004)
    kit.box("clinic_iv_bag", bone, coll, (16.6, 1.75, 1.04), (0.14, 0.22, 0.04), soft=True, puff=0.5)
    kit.cylinder("clinic_iv_line", M["canvas"], coll, (16.6, 1.62, 1.05), (16.25, 0.7, 1.2), 0.003, segments=4, bev=0)
    work_lamp("clinic_surgery_lamp", M, coll, 19.55, 1.95, 1.4, room, watts=320)

    # the medicine shelves on the back wall: an open steel case crowded with brown bottles, boxes and rolled bandages
    mx, mz = 17.8, z1 - 0.32
    kit.box("clinic_cabinet_back", M["steel_locker"], coll, (mx, 1.0, mz + 0.19), (1.3, 2.0, 0.03), bev=0.006)
    for s_ in (-1, 1):
        kit.box(f"clinic_cabinet_side{s_}", M["steel_locker"], coll, (mx + s_ * 0.64, 1.0, mz), (0.03, 2.0, 0.42), bev=0.006)
    kit.box("clinic_cabinet_top", M["steel_locker"], coll, (mx, 2.0, mz), (1.32, 0.04, 0.44), bev=0.008)
    for k, y in enumerate((0.1, 0.55, 1.0, 1.45)):
        kit.box(f"clinic_shelf{k}", M["dark"], coll, (mx, y, mz), (1.26, 0.025, 0.38), bev=0.003)
        for j in range(9):
            bx = mx - 0.54 + j * 0.135 + rng.uniform(-0.02, 0.02)
            h = rng.uniform(0.12, 0.26)
            pick = (j + k) % 4
            if pick == 0:
                kit.box(f"clinic_box{k}_{j}", bone, coll, (bx, y + 0.08, mz - 0.03), (0.11, 0.14, 0.17), rot=(0, 0, rng.uniform(-0.15, 0.15)), bev=0.006)
            elif pick == 1:
                kit.cylinder(f"clinic_roll{k}_{j}", bone, coll, (bx, y + 0.015, mz - 0.06), (bx, y + 0.095, mz - 0.06), 0.045, segments=12)
            else:
                kit.cylinder(f"clinic_bottle{k}_{j}", bottle, coll, (bx, y + 0.013, mz - 0.05), (bx, y + 0.013 + h, mz - 0.05), 0.033, segments=10)
                kit.cylinder(f"clinic_bottle{k}_{j}_cork", M["timber"], coll, (bx, y + 0.013 + h, mz - 0.05), (bx, y + 0.035 + h, mz - 0.05), 0.016, segments=8, bev=0)
    for k in range(3):  # labels chalked on the shelf edges
        kit.box(f"clinic_shelf_label{k}", bone, coll, (mx - 0.35 + k * 0.35, 0.56 + k * 0.45, mz - 0.2), (0.12, 0.03, 0.005), bev=0)
    light(room, "clinic_cabinet_light", "POINT", (mx, 1.5, mz - 0.75), WARM, 45, coll=coll)
    # a wash basin and a jug; the steriliser pot on a burner
    kit.cylinder("clinic_basin_stand", M["dark"], coll, (x1 - 0.35, 0, 0.1), (x1 - 0.35, 0.8, 0.1), 0.025, segments=8)
    kit.cylinder("clinic_basin", M["bare"], coll, (x1 - 0.35, 0.8, 0.1), (x1 - 0.35, 0.92, 0.1), 0.22, segments=20)
    kit.cylinder("clinic_jug", M["steel_locker"], coll, (19.3, 0, 0.15), (19.3, 0.32, 0.15), 0.1, segments=12)
    kit.box("clinic_burner", M["dark"], coll, (x0 + 0.35, 0.75, 0.05), (0.4, 0.06, 0.4), bev=0.008)
    for s1 in (-1, 1):
        kit.box(f"clinic_burner_leg{s1}", M["dark"], coll, (x0 + 0.35 + s1 * 0.16, 0.37, 0.05), (0.04, 0.74, 0.36), bev=0.004)
    kit.cylinder("clinic_steriliser", M["bare"], coll, (x0 + 0.35, 0.78, 0.05), (x0 + 0.35, 1.0, 0.05), 0.15, segments=16)
    kit.cylinder("clinic_steriliser_lid", M["bare"], coll, (x0 + 0.35, 1.0, 0.05), (x0 + 0.35, 1.03, 0.05), 0.16, segments=16, bev=0.006)
    kit.cylinder("clinic_flame", M["bulb"], coll, (x0 + 0.35, 0.69, 0.05), (x0 + 0.35, 0.72, 0.05), 0.07, segments=10, bev=0)
    light(room, "clinic_burner_glow", "POINT", (x0 + 0.35, 0.6, 0.3), (1.0, 0.55, 0.3), 8, coll=coll)

    # customer side: shield packs and cells on a rack, a bench, the house rule, empty jars for refills
    sx = x0 + 0.1
    kit.box("clinic_shield_board", M["plank"], coll, (sx, 1.5, -2.35), (0.04, 1.4, 1.6), bev=0.01)
    for k, (z, y) in enumerate(((-2.85, 1.75), (-2.3, 1.75), (-1.8, 1.75))):  # shield packs: bevelled metal cases, scratched, never glowing
        kit.box(f"clinic_shield_pack{k}", M["steel_locker"] if k != 1 else M["steel"], coll, (sx + 0.1, y, z), (0.14, 0.42, 0.34), bev=0.03)
        kit.box(f"clinic_shield_pack{k}_strap", M["canvas"], coll, (sx + 0.18, y, z), (0.02, 0.48, 0.06), bev=0.004)
        kit.box(f"clinic_shield_pack{k}_hook", M["bare"], coll, (sx + 0.06, y + 0.25, z), (0.08, 0.02, 0.02), bev=0.003)
    for k in range(6):  # shield cells: hexagons, the one shape kept for shields (art bible 3)
        z = -2.95 + (k % 3) * 0.3
        y = 1.02 + (k // 3) * 0.2
        kit.cylinder(f"clinic_shield_cell{k}", ice, coll, (sx + 0.03, y, z), (sx + 0.12, y, z), 0.075, segments=6, bev=0.006)
    kit.box("clinic_cell_shelf", M["timber"], coll, (sx + 0.1, 0.9, -2.65), (0.2, 0.04, 1.0), bev=0.006, grain="long")
    kit.box("clinic_wait_bench", M["timber"], coll, (x1 - 0.3, 0.45, -2.45), (0.38, 0.06, 1.5), bev=0.015, grain="long")
    for dz_ in (-0.6, 0.6):
        kit.box(f"clinic_wait_leg{dz_}", M["rust"], coll, (x1 - 0.3, 0.22, -2.45 + dz_), (0.34, 0.44, 0.05), bev=0.005)
    board("clinic_rules", P["sign_clinic_rules"], coll, (x1 - 0.07, 1.6, -2.45), 0.9, 0.5, (R90, 0, -R90), timber=M["timber"])
    kit.box("clinic_line", bone, coll, ((x0 + x1) / 2 - 0.35, 0.012, cz - 0.6), (x1 - x0 - 1.0, 0.004, 0.06), bev=0)  # "the line", painted on the floor
    crate("clinic_jar_crate", M, coll, (x0 + 0.45, 0.2, -1.55), (0.5, 0.4, 0.4), yaw=0.1)
    for k in range(4):
        kit.cylinder(f"clinic_empty_jar{k}", bottle, coll, (x0 + 0.33 + (k % 2) * 0.22, 0.4, -1.65 + (k // 2) * 0.18), (x0 + 0.33 + (k % 2) * 0.22, 0.55, -1.65 + (k // 2) * 0.18), 0.05, segments=10)
    # --- a shop as well as a clinic: a price board, a display shelf by the door, a bell ---
    board("clinic_prices", P["sign_clinic_prices"], coll, (x1 - 0.07, 2.45, -2.45), 0.86, 0.62, (R90, 0, -R90), timber=M["timber"])
    for k, y in enumerate((0.45, 0.95, 1.45)):
        kit.box(f"clinic_display{k}", M["timber"], coll, (16.36, y, -3.22), (0.95, 0.04, 0.34), bev=0.006, grain="long")
        for j in range(4):
            px = 16.01 + j * 0.23
            if (j + k) % 2:  # a med kit: a canvas case with Nia's stitched patch
                kit.box(f"clinic_kit{k}_{j}", M["canvas"], coll, (px, y + 0.09, -3.2), (0.19, 0.14, 0.12), rot=(0, 0, rng.uniform(-0.1, 0.1)), soft=True, puff=0.3)
                kit.box(f"clinic_kit{k}_{j}_patch", bone, coll, (px, y + 0.1, -3.135), (0.06, 0.06, 0.006), bev=0)
            else:  # a tin of bandages
                kit.cylinder(f"clinic_tin{k}_{j}", M["steel_locker"], coll, (px, y + 0.02, -3.2), (px, y + 0.16, -3.2), 0.06, segments=12)
    for s_ in (-1, 1):
        kit.box(f"clinic_display_side{s_}", M["timber"], coll, (16.36 + s_ * 0.49, 0.95, -3.22), (0.04, 1.9, 0.34), bev=0.006)
    kit.cylinder("clinic_bell", M["hazard"], coll, (18.75, 1.0, cz - 0.2), (18.75, 1.07, cz - 0.2), 0.05, segments=14, bev=0.01)
    kit.cylinder("clinic_bell_knob", M["dark"], coll, (18.75, 1.07, cz - 0.2), (18.75, 1.1, cz - 0.2), 0.012, segments=8, bev=0)
    kit.cylinder("clinic_plant_pot", M["rust"], coll, (19.2, 1.0, cz + 0.15), (19.2, 1.13, cz + 0.15), 0.07, segments=12)
    for j in range(5):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rng.uniform(0.04, 0.06))
        kit.mesh_obj(f"clinic_plant_leaf{j}", bm, M["leaf"], coll, kit.g2b(19.2 + rng.uniform(-0.05, 0.05), 1.17 + rng.uniform(0, 0.08), cz + 0.15 + rng.uniform(-0.05, 0.05)), tuple(rng.uniform(0, 3, 3)))["uv"] = "box"
    # crutches leaning by the bench
    for k in range(2):
        kit.cylinder(f"clinic_crutch{k}", M["timber"], coll, (x1 - 0.28 - k * 0.12, 0.0, -1.55), (x1 - 0.12 - k * 0.12, 1.3, -1.6), 0.016, segments=8)
        kit.box(f"clinic_crutch{k}_pad", M["canvas"], coll, (x1 - 0.12 - k * 0.12, 1.33, -1.6), (0.05, 0.05, 0.2), soft=True, puff=0.4)
    # dried herbs hanging in bunches from the front beam
    for k in range(7):
        hx = 15.9 + k * 0.6 + rng.uniform(-0.1, 0.1)
        kit.cylinder(f"clinic_herb{k}_string", M["canvas"], coll, (hx, H - 0.26, -2.25), (hx, H - 0.55, -2.25), 0.003, segments=4, bev=0)
        for j in range(4):
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.01, radius2=0.05, depth=0.22)
            kit.mesh_obj(f"clinic_herb{k}_{j}", bm, M["leaf"] if (k + j) % 3 else M["timber_rot"], coll,
                         kit.g2b(hx + rng.uniform(-0.03, 0.03), H - 0.66, -2.25 + rng.uniform(-0.03, 0.03)), (rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 0))["uv"] = "box"

    # --- behind the counter: her satchels on pegs, her old dive pack, a stool, towels drying ---
    for k in range(3):
        sz_ = -0.35 + k * 0.42
        kit.box(f"clinic_peg{k}", M["timber"], coll, (x0 + 0.1, 1.85, sz_), (0.1, 0.03, 0.03), bev=0.004)
        kit.box(f"clinic_hung_satchel{k}", M["canvas"] if k != 1 else M["blanket"], coll, (x0 + 0.13, 1.6, sz_), (0.12, 0.34, 0.3), rot=(0, 0, rng.uniform(-0.06, 0.06)), soft=True, puff=0.35)
        kit.box(f"clinic_hung_satchel{k}_patch", bone, coll, (x0 + 0.195, 1.6, sz_), (0.006, 0.08, 0.08), bev=0)
        kit.cylinder(f"clinic_hung_strap{k}", M["canvas"], coll, (x0 + 0.13, 1.77, sz_ - 0.13), (x0 + 0.11, 1.86, sz_), 0.008, segments=5, bev=0)
    # Nia was a Diver: her old pack hangs over the basin, scratched, patched, stickers peeling
    kit.box("clinic_dive_pack", M["steel_locker"], coll, (x1 - 0.17, 1.7, 0.15), (0.2, 0.5, 0.36), bev=0.035)
    kit.box("clinic_dive_pack_flap", M["canvas"], coll, (x1 - 0.27, 1.88, 0.15), (0.04, 0.14, 0.32), soft=True, puff=0.3)
    for s_ in (-1, 1):
        kit.box(f"clinic_dive_pack_strap{s_}", M["canvas"], coll, (x1 - 0.28, 1.62, 0.15 + s_ * 0.11), (0.02, 0.46, 0.04), bev=0.003)
    kit.box("clinic_dive_patch", bone, coll, (x1 - 0.275, 1.55, 0.05), (0.004, 0.07, 0.09), bev=0)
    kit.box("clinic_stool", M["timber"], coll, (17.9, 0.6, -0.25), (0.34, 0.05, 0.34), bev=0.02)
    for s1 in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        kit.box(f"clinic_stool_leg{s1}", M["rust"], coll, (17.9 + s1[0] * 0.13, 0.29, -0.25 + s1[1] * 0.13), (0.03, 0.58, 0.03), bev=0.004)
    for k in range(4):  # clean towels folded on top of the medicine shelves, one over the basin's edge
        kit.box(f"clinic_towel{k}", bone if k % 2 else M["mattress"], coll, (17.45 + (k // 2) * 0.7, 2.06 + (k % 2) * 0.06, z1 - 0.32), (0.34, 0.06, 0.28), rot=(0, 0, rng.uniform(-0.08, 0.08)), soft=True, puff=0.4)
    kit.box("clinic_towel_basin", bone, coll, (x1 - 0.35, 0.86, -0.13), (0.3, 0.14, 0.03), rot=(0.4, 0, 0), soft=True, puff=0.4)
    kit.cylinder("clinic_bucket", M["steel"], coll, (18.85, 0, 0.2), (18.85, 0.28, 0.2), 0.13, segments=14)
    kit.cylinder("clinic_mop", M["timber"], coll, (18.9, 0.05, 0.25), (19.05, 1.3, 0.4), 0.014, segments=6)
    # papers on the walls: the body chart over the first cot, her check-up list and a notice by the second
    kit.plane("clinic_anatomy", P["paper_anatomy"], coll, (16.3, 1.75, z1 - 0.07), 0.42, 0.7, (R90, 0, math.pi))
    kit.plane("clinic_note1", P["paper_clinic_1"], coll, (19.0, 1.7, z1 - 0.07), 0.26, 0.33, (R90, 0, math.pi + 0.06))
    kit.plane("clinic_note2", P["paper_clinic_2"], coll, (19.4, 1.62, z1 - 0.07), 0.24, 0.3, (R90, 0, math.pi - 0.08))
    light(room, "clinic_entry_light", "POINT", (dx, 2.6, -2.7), WARM, 50, coll=coll)
    return [((dx, 1.65, -3.2), (dx, 1.1, 2.4)), ((x1 - 0.4, 1.7, -3.0), (16.4, 0.9, 1.2)), ((17.2, 1.65, -0.35), (19.4, 0.8, 1.7))]


def build_radio(M, P, coll):
    """Pell's radio and parts shop behind the RADIO & PARTS shopfront: the
    buyer. Crates stacked to the roof (art bible), sorting bins, a spring
    scale over the counter, the radio desk that keeps the Sanctuary talking."""
    room = "radio"
    x0, x1, z0, z1 = 25.05, 29.95, -3.45, 2.4
    dx = OPEN_SHOPS[1]
    shop_shell("radio", M, coll, x0, x1, z0, z1, dx, seed=91)
    board_green = M["circuit"]
    cz = -0.95
    shop_counter("radio_counter", M, coll, x0 + 0.15, x1 - 0.1, cz)

    # the spring scale hanging over the counter, a pan of wire on it; the ledger and a cash tin
    sx_ = 26.9
    kit.cylinder("radio_scale_chain", M["dark"], coll, (sx_, H - 0.26, cz), (sx_, 1.9, cz), 0.008, segments=5, bev=0)
    kit.cylinder("radio_scale_body", M["bare"], coll, (sx_, 1.62, cz), (sx_, 1.9, cz), 0.04, segments=14)
    kit.cylinder("radio_scale_dial", M["mattress"], coll, (sx_, 1.76, cz - 0.04), (sx_, 1.76, cz - 0.045), 0.032, segments=16, bev=0)
    kit.cylinder("radio_scale_hook", M["dark"], coll, (sx_, 1.48, cz), (sx_, 1.62, cz), 0.006, segments=5, bev=0)
    for k in range(3):
        a = k * 2 * math.pi / 3
        kit.cylinder(f"radio_scale_cord{k}", M["dark"], coll, (sx_, 1.48, cz), (sx_ + 0.16 * math.cos(a), 1.2, cz + 0.16 * math.sin(a)), 0.003, segments=4, bev=0)
    kit.cylinder("radio_scale_pan", M["bare"], coll, (sx_, 1.17, cz), (sx_, 1.2, cz), 0.19, segments=20, bev=0.006)
    kit.cylinder("radio_scale_load", M["rust"], coll, (sx_, 1.2, cz), (sx_, 1.25, cz), 0.12, segments=10, bev=0.01)
    kit.box("radio_ledger", M["blanket"], coll, (27.9, 1.015, cz - 0.1), (0.34, 0.04, 0.26), rot=(0, 0, 0.2), bev=0.01)
    kit.box("radio_ledger_pencil", M["timber"], coll, (28.15, 1.04, cz - 0.05), (0.015, 0.015, 0.16), rot=(0, 0, 0.6), bev=0.003)
    kit.box("radio_cashtin", M["steel_locker"], coll, (25.7, 1.04, cz), (0.3, 0.1, 0.22), bev=0.01)
    board("radio_sign", P["sign_trader_2"], coll, ((x0 + x1) / 2, 2.45, cz - 0.1), 1.5, 0.48, (R90, 0, math.pi), timber=M["timber"])
    for s_ in (-1, 1):
        kit.cylinder(f"radio_sign_chain{s_}", M["dark"], coll, ((x0 + x1) / 2 + s_ * 0.65, 2.7, cz - 0.1), ((x0 + x1) / 2 + s_ * 0.65, H - 0.26, cz - 0.1), 0.008, segments=5, bev=0)
    work_lamp("radio_counter_lamp", M, coll, 26.1, 2.1, cz + 0.15, room, watts=180)

    # the back wall: steel shelving to the roof, radios, parts drawers, wire spools, crates
    for k, x in enumerate((25.75, 27.1, 28.45)):
        sx = x + 0.6
        for s_ in (-1, 1):
            kit.box(f"radio_shelf{k}_post{s_}", M["steel"], coll, (x + s_ * 0.62, 1.4, z1 - 0.35), (0.04, 2.8, 0.04), bev=0.004)
        for j, y in enumerate((0.3, 0.95, 1.6, 2.25)):
            kit.box(f"radio_shelf{k}_{j}", M["steel"], coll, (x, y, z1 - 0.35), (1.3, 0.03, 0.5), bev=0.004)
            for i in range(3):
                bx = x - 0.4 + i * 0.4
                pick = (k * 4 + j * 3 + i) % 5
                if pick == 0:  # a radio: a case, a speaker grille, a dial
                    kit.box(f"radio_set{k}_{j}_{i}", M["steel_locker"] if i % 2 else M["timber"], coll, (bx, y + 0.13, z1 - 0.4), (0.34, 0.22, 0.24), bev=0.012)
                    kit.box(f"radio_set{k}_{j}_{i}_grille", M["dark"], coll, (bx - 0.06, y + 0.13, z1 - 0.525), (0.15, 0.15, 0.01), bev=0.002)
                    kit.cylinder(f"radio_set{k}_{j}_{i}_dial", M["mattress"], coll, (bx + 0.1, y + 0.14, z1 - 0.52), (bx + 0.1, y + 0.14, z1 - 0.53), 0.035, segments=12, bev=0)
                elif pick == 1:  # a parts drawer cabinet
                    kit.box(f"radio_drawers{k}_{j}_{i}", M["steel_locker"], coll, (bx, y + 0.15, z1 - 0.4), (0.34, 0.27, 0.3), bev=0.008)
                    for d in range(6):
                        kit.box(f"radio_drawer{k}_{j}_{i}_{d}", M["dark"], coll, (bx - 0.1 + (d % 3) * 0.1, y + 0.08 + (d // 3) * 0.12, z1 - 0.552), (0.08, 0.09, 0.01), bev=0.002)
                elif pick == 2:  # a spool of wire
                    kit.cylinder(f"radio_spool{k}_{j}_{i}", M["rust"], coll, (bx - 0.09, y + 0.13, z1 - 0.4), (bx + 0.09, y + 0.13, z1 - 0.4), 0.12, segments=16)
                    kit.cylinder(f"radio_spool{k}_{j}_{i}_core", M["timber"], coll, (bx - 0.11, y + 0.13, z1 - 0.4), (bx + 0.11, y + 0.13, z1 - 0.4), 0.13, segments=16, bev=0.004)
                elif pick == 3:  # a stack of circuit boards
                    for b in range(3):
                        kit.box(f"radio_boards{k}_{j}_{i}_{b}", board_green, coll, (bx, y + 0.03 + b * 0.025, z1 - 0.4), (0.3, 0.012, 0.22), rot=(0, rng.uniform(-0.2, 0.2), 0), bev=0.002)
                else:  # a crate
                    crate(f"radio_crate{k}_{j}_{i}", M, coll, (bx, y + 0.15, z1 - 0.4), (0.34, 0.28, 0.34), yaw=rng.uniform(-0.1, 0.1))
    # the radio desk on the east side behind the counter: sets stacked up, dials lit, an aerial lead up through the roof
    rx = x1 - 0.4
    kit.box("radio_desk", M["timber"], coll, (rx, 0.78, 0.35), (0.7, 0.06, 1.5), bev=0.012, grain="long")
    for dz_ in (-0.65, 0.65):
        kit.box(f"radio_desk_leg{dz_}", M["rust"], coll, (rx, 0.38, 0.35 + dz_), (0.6, 0.76, 0.05), bev=0.005)
    for k, (y, w) in enumerate(((0.95, 1.2), (1.21, 1.0), (1.43, 0.7))):
        kit.box(f"radio_desk_set{k}", M["dark"] if k != 1 else M["steel_locker"], coll, (rx + 0.1, y, 0.35), (0.42, 0.26 if k < 2 else 0.18, w), bev=0.012)
        for j in range(int(w / 0.18)):
            kit.box(f"radio_desk_set{k}_lamp{j}", M["bulb"], coll, (rx - 0.115, y + 0.05, 0.35 - w / 2 + 0.12 + j * 0.18), (0.01, 0.025, 0.035), bev=0)
            kit.cylinder(f"radio_desk_set{k}_knob{j}", M["bare"], coll, (rx - 0.11, y - 0.05, 0.35 - w / 2 + 0.12 + j * 0.18), (rx - 0.13, y - 0.05, 0.35 - w / 2 + 0.12 + j * 0.18), 0.018, segments=10, bev=0)
    kit.box("radio_headphones", M["dark"], coll, (rx - 0.25, 0.84, 0.75), (0.18, 0.05, 0.2), rot=(0, 0, 0.4), soft=True, puff=0.4)
    kit.cylinder("radio_mic", M["bare"], coll, (rx - 0.2, 0.81, 0.0), (rx - 0.22, 1.0, -0.02), 0.012, segments=8)
    kit.cylinder("radio_mic_head", M["dark"], coll, (rx - 0.22, 1.0, -0.02), (rx - 0.24, 1.06, -0.03), 0.028, segments=12)
    kit.cylinder("radio_aerial_lead", M["dark"], coll, (rx + 0.25, 1.55, 0.35), (rx + 0.25, H, 0.35), 0.012, segments=6)
    kit.box("radio_stool", M["timber"], coll, (rx - 0.6, 0.55, 0.35), (0.36, 0.05, 0.36), bev=0.02)
    for s1 in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        kit.box(f"radio_stool_leg{s1}", M["rust"], coll, (rx - 0.6 + s1[0] * 0.14, 0.27, 0.35 + s1[1] * 0.14), (0.03, 0.54, 0.03), bev=0.004)
    light(room, "radio_desk_glow", "POINT", (rx - 0.4, 1.2, 0.35), (1.0, 0.62, 0.32), 20, coll=coll)
    work_lamp("radio_back_lamp", M, coll, 27.0, 2.2, 1.4, room, watts=150)

    # customer side: sorting bins with painted labels, crates stacked to the roof, a stack of tyres, coils on the wall
    for k, bx in enumerate((25.45, 26.12)):  # against the front wall, either side clear of the door
        kit.box(f"radio_bin{k}", M["rust"], coll, (bx, 0.35, -3.05), (0.62, 0.7, 0.6), bev=0.02)
        board(f"radio_bin{k}_label", P[f"sign_bin_{k}"], coll, (bx, 0.55, -2.74), 0.5, 0.18, (R90, 0, 0), thick=0.02)
    rocks("radio_bin0_scrap", M, coll, (25.45, 0.62, -3.05), 4, (0.2, 0.04, 0.18), size=(0.06, 0.1))
    for k in range(4):
        kit.cylinder(f"radio_bin1_coil{k}", M["rust"], coll, (25.97 + k * 0.1, 0.66, -3.08), (25.97 + k * 0.1, 0.7, -3.08), 0.1, segments=12, bev=0)
    for k in range(4):  # the RUBBER bin: tyres stacked
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=0.3, radius2=0.3, depth=0.16)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.12)
        kit.mesh_obj(f"radio_tyre{k}", bm, M["dark"], coll, kit.g2b(28.75 + rng.uniform(-0.03, 0.03), 0.08 + k * 0.17, -3.0), (0, 0, rng.uniform(0, 3)))["uv"] = "box"
    board("radio_bin2_label", P["sign_bin_2"], coll, (28.75, 1.0, -3.3), 0.5, 0.18, (R90, 0, 0), timber=M["timber"], thick=0.02)  # nailed to the wall over the tyres
    for k in range(4):  # crates up the west wall, nearly to the roof
        crate(f"radio_stack{k}", M, coll, (x0 + 0.4 + rng.uniform(-0.03, 0.03), 0.34 + k * 0.69, -2.0), yaw=rng.uniform(-0.08, 0.08))
    board("radio_we_buy", P["sign_we_buy"], coll, (x1 - 0.07, 1.65, -2.4), 1.1, 0.6, (R90, 0, -R90), timber=M["timber"])
    for k in range(3):  # coils of cable hung on pegs by the sign
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=0.16, radius2=0.16, depth=0.05)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
        kit.mesh_obj(f"radio_cable_coil{k}", bm, M["dark"] if k % 2 else M["rust"], coll, kit.g2b(x1 - 0.1, 1.1 + k * 0.02, -3.0 + k * 0.38), (0, R90, 0))["uv"] = "box"
    light(room, "radio_entry_light", "POINT", (dx, 2.6, -2.6), WARM, 50, coll=coll)
    return [((dx, 1.65, -3.2), (dx, 1.1, 2.2)), ((26.1, 1.7, -3.25), (29.3, 1.0, 0.9)), ((29.5, 1.6, -2.0), (25.8, 1.2, 1.6))]


def tool_board(name, M, coll, pos, w, facing_rot, seed):
    """A pegboard over a bench with its tools hung on it: hammers, spanners,
    files, a saw. pos is the board's centre; facing_rot as for board()."""
    x, y, z = pos
    rz = facing_rot[2]
    along_x = abs(rz) < 0.01 or abs(abs(rz) - math.pi) < 0.01
    kit.box(f"{name}_board", M["plank"], coll, pos, (w, 0.7, 0.03) if along_x else (0.03, 0.7, w), bev=0.008)
    r = np.random.default_rng(seed)
    n = int(w / 0.16)
    off = 0.03 if abs(rz) < 0.01 else -0.03 if abs(abs(rz) - math.pi) < 0.01 else (0.03 if rz > 0 else -0.03)
    for k in range(n):
        t = -w / 2 + 0.1 + k * (w - 0.2) / max(1, n - 1)
        kind = r.integers(0, 4)
        size = ((0.03, 0.26, 0.012), (0.025, 0.2, 0.01), (0.015, 0.24, 0.008), (0.1, 0.3, 0.006))[kind]
        mat = (M["timber"], M["bare"], M["dark"], M["bare"])[kind]
        px, pz = (x + t, z + off) if along_x else (x + off, z + t)
        sz = size if along_x else (size[2], size[1], size[0])
        kit.box(f"{name}_tool{k}", mat, coll, (px, y + r.uniform(-0.1, 0.1), pz), sz, rot=(0, 0, r.uniform(-0.15, 0.15)), bev=0.003)
        if kind == 0:  # a hammer head
            hx, hz = (px, pz) if along_x else (px, pz)
            kit.box(f"{name}_tool{k}_head", M["dark"], coll, (hx, y + 0.14, hz), (0.1, 0.035, 0.03) if along_x else (0.03, 0.035, 0.1), bev=0.006)


def build_workshop(M, P, coll):
    """The Workshop: seven benches, each with its own tools and its work in
    progress; the salvage bench among broken gear; a chain hoist with an
    engine on it down the middle (art bible: dense, but clear in front of
    each bench)."""
    room = "workshop"
    x0, x1, z0, z1 = 9.13, 18.87, -15, -6.85
    floor_ceiling("work", M, coll, x0, x1, z0, z1, seed=51)
    rock_wall("work_west", M, coll, "z", x0, z0, z1, +1, seed=52)
    rock_wall("work_east", M, coll, "z", x1, z0, z1, -1, seed=53)
    rock_wall("work_back", M, coll, "x", z0, x0, x1, +1, seed=54)
    rock_wall("work_front", M, coll, "x", z1, x0, x1, -1, doors=((14, 1.8),), seed=55)
    door_portal("work_door", M, coll, "x", 14, z1 - 0.1, 0.25)
    for k, z in enumerate((-9.7, -12.8)):  # old steel arch ribs, as in the Trade Hall, in the gaps between the side benches
        pts = [(14 + 4.7 * math.cos(a), -1.25 + 4.65 * math.sin(a), z) for a in np.linspace(0.12, math.pi - 0.12, 25)]
        for j in range(len(pts) - 1):
            kit.cylinder(f"work_rib{k}_{j}", M["dark"], coll, pts[j], pts[j + 1], 0.06, segments=8, bev=0)
    # overhead beams, a steel rail and a chain hoist with an engine block on its hook
    for k, x in enumerate((11.6, 14, 16.4)):
        kit.box(f"work_beam{k}", M["timber"], coll, (x, H - 0.14, -10.9), (0.22, 0.24, 8.2), bev=0.025, grain="long")
    kit.box("work_rail", M["dark"], coll, (14, H - 0.42, -10.9), (0.12, 0.14, 8.2), bev=0.01)
    kit.box("work_trolley", M["rust"], coll, (14, H - 0.55, -10.8), (0.24, 0.14, 0.3), bev=0.015)
    for i in range(12):
        kit.cylinder(f"work_chain{i}", M["dark"], coll, (14, H - 0.6 - i * 0.07, -10.8), (14, H - 0.66 - i * 0.07, -10.8), 0.012, segments=6, bev=0)
    kit.box("work_hook", M["bare"], coll, (14, H - 1.5, -10.8), (0.06, 0.16, 0.04), bev=0.01)
    ey = 1.25
    kit.box("work_engine", M["rust"], coll, (14, ey, -10.8), (0.62, 0.48, 0.42), bev=0.04)
    kit.box("work_engine_head", M["dark"], coll, (14, ey + 0.3, -10.8), (0.56, 0.14, 0.32), bev=0.02)
    for k in range(4):
        kit.cylinder(f"work_engine_stud{k}", M["bare"], coll, (13.79 + k * 0.14, ey + 0.37, -10.8), (13.79 + k * 0.14, ey + 0.41, -10.8), 0.02, segments=6, bev=0)
    for s_ in (-1, 1):
        kit.cylinder(f"work_engine_sling{s_}", M["dark"], coll, (14, H - 1.58, -10.8), (14 + s_ * 0.25, ey + 0.38, -10.8), 0.008, segments=5, bev=0)
    kit.box("work_engine_stand", M["timber"], coll, (14, 0.45, -10.8), (0.8, 0.12, 0.5), bev=0.015)  # the trestle it will come down onto
    for s_ in (-1, 1):
        kit.box(f"work_engine_trestle{s_}", M["timber"], coll, (14 + s_ * 0.32, 0.2, -10.8), (0.08, 0.4, 0.45), bev=0.01)
    work_lamp("work_lamp", M, coll, 12.2, H - 0.85, -10.2, room, watts=380)  # off the hoist line, clear of the door view

    # the seven benches: top, legs, a shelf under, a pegboard of tools over the wall ones, the board saying what it is for
    spots = ((11, -14.3, 0), (14, -14.3, 0), (17, -14.3, 0), (9.85, -11.0, R90), (18.15, -11.0, -R90), (18.15, -8.4, -R90), (9.85, -8.4, R90))
    for i, (x, z, r) in enumerate(spots):
        along = r == 0
        w, d = (2.2, 0.9) if along else (0.9, 2.2)
        kit.box(f"bench{i}_top", M["timber"], coll, (x, 0.88, z), (w, 0.07, d), bev=0.015, grain="long")
        kit.box(f"bench{i}_shelf", M["plank"], coll, (x, 0.2, z), (w - 0.12, 0.04, d - 0.12), bev=0.008)
        for s1 in (-1, 1):
            for s2 in (-1, 1):
                lx_, lz_ = (x + s1 * (w / 2 - 0.08), z + s2 * (d / 2 - 0.08))
                kit.box(f"bench{i}_leg{s1}{s2}", M["steel"], coll, (lx_, 0.42, lz_), (0.06, 0.84, 0.06), bev=0.006)
        vx, vz = (x - 0.75, z + 0.25) if along else (x + (0.25 if r > 0 else -0.25), z - 0.75)
        kit.box(f"bench{i}_vise", M["dark"], coll, (vx, 1.0, vz), (0.2, 0.17, 0.18), bev=0.015)
        kit.cylinder(f"bench{i}_vise_bar", M["bare"], coll, (vx - 0.13, 1.0, vz) if along else (vx, 1.0, vz - 0.13), (vx + 0.13, 1.0, vz) if along else (vx, 1.0, vz + 0.13), 0.008, segments=6, bev=0)
        tx, tz = (x + 0.75, z - 0.2) if along else (x - (0.2 if r > 0 else -0.2), z + 0.75)
        kit.box(f"bench{i}_toolbox", M["blanket"] if i >= 5 else M["steel_locker"], coll, (tx, 0.99, tz), (0.36, 0.16, 0.2), rot=(0, 0, rng.uniform(-0.3, 0.3)), bev=0.012)
        if along:
            board(f"bench{i}_sign", P[f"sign_bench_{i}"], coll, (x, 2.05, z - 0.4), 1.3, 0.4, (R90, 0, 0), timber=M["timber"])
            tool_board(f"bench{i}_tools", M, coll, (x, 1.45, z - 0.42), 2.0, (R90, 0, 0), seed=60 + i)
        else:
            bx = x - 0.4 if r > 0 else x + 0.4
            board(f"bench{i}_sign", P[f"sign_bench_{i}"], coll, (bx, 2.05, z), 1.3, 0.4, (R90, 0, r), timber=M["timber"])
            tool_board(f"bench{i}_tools", M, coll, (bx - (0.02 if r > 0 else -0.02), 1.45, z), 2.0, (R90, 0, r), seed=60 + i)
        lx, lz = (x, z + 0.1) if along else (x + (0.2 if r > 0 else -0.2), z)
        light(room, f"bench{i}_light", "POINT", (lx, 2.2, lz), WARM, 45, coll=coll)

    # the work on each bench
    y = 0.915
    # 0 WEAPONS: a Mule in the vise, being cleaned; rods and a rag
    show_gun(room, "mule", (11.1, y + 0.13, -14.1), gun_rot(yaw=-R90, roll=R90))
    for k in range(3):
        kit.cylinder(f"bench0_rod{k}", M["bare"], coll, (10.3 + k * 0.03, y + 0.01, -14.5), (11.0 + k * 0.03, y + 0.01, -14.55), 0.004, segments=5, bev=0)
    kit.box("bench0_rag", M["canvas"], coll, (11.7, y + 0.015, -14.05), (0.25, 0.02, 0.2), rot=(0, 0, 0.4), soft=True, puff=0.4)
    # 1 AMMO: a reloading press, bowls of brass, ammo cans under
    kit.box("bench1_press_base", M["dark"], coll, (13.6, y + 0.03, -14.35), (0.2, 0.06, 0.2), bev=0.01)
    kit.cylinder("bench1_press_post", M["bare"], coll, (13.6, y + 0.06, -14.45), (13.6, y + 0.45, -14.45), 0.025, segments=10)
    kit.box("bench1_press_head", M["dark"], coll, (13.6, y + 0.45, -14.38), (0.12, 0.1, 0.18), bev=0.01)
    kit.cylinder("bench1_press_handle", M["bare"], coll, (13.66, y + 0.45, -14.3), (13.9, y + 0.62, -14.1), 0.01, segments=6)
    for k in range(3):
        kit.cylinder(f"bench1_bowl{k}", M["steel_locker"], coll, (14.1 + k * 0.22, y, -14.15), (14.1 + k * 0.22, y + 0.06, -14.15), 0.09, segments=14)
        kit.cylinder(f"bench1_brass{k}", M["hazard"], coll, (14.1 + k * 0.22, y + 0.04, -14.15), (14.1 + k * 0.22, y + 0.065, -14.15), 0.075, segments=10, bev=0.01)
    for k in range(3):
        ammo_can(f"bench1_can{k}", M, coll, 13.3 + k * 0.36, 0.22, -14.3)
    # 2 SHIELDS: a shield pack open on the bench, its hex cells laid out
    kit.box("bench2_pack", M["steel_locker"], coll, (16.6, y + 0.06, -14.25), (0.36, 0.12, 0.44), bev=0.03)
    kit.box("bench2_pack_lid", M["steel_locker"], coll, (16.6, y + 0.24, -14.5), (0.36, 0.3, 0.03), rot=(-0.25, 0, 0), bev=0.012)
    for k in range(5):
        kit.cylinder(f"bench2_cell{k}", M["ice"], coll, (17.0 + (k % 3) * 0.17, y, -14.2 + (k // 3) * 0.17), (17.0 + (k % 3) * 0.17, y + 0.05, -14.2 + (k // 3) * 0.17), 0.07, segments=6, bev=0.006)
    kit.cylinder("bench2_meter_lead", M["dark"], coll, (16.75, y + 0.1, -14.2), (17.3, y + 0.02, -14.1), 0.004, segments=4, bev=0)
    kit.box("bench2_meter", M["dark"], coll, (17.4, y + 0.05, -14.45), (0.16, 0.1, 0.12), bev=0.01)
    # 3 MEDICAL (west wall): jars, bottles, rolled bandages, a pestle
    for k in range(5):
        kit.cylinder(f"bench3_bottle{k}", M["bottle"], coll, (9.75, y, -11.6 + k * 0.12), (9.75, y + rng.uniform(0.12, 0.22), -11.6 + k * 0.12), 0.035, segments=10)
    for k in range(4):
        kit.cylinder(f"bench3_bandage{k}", M["bone"], coll, (10.05, y, -11.0 + k * 0.11), (10.05, y + 0.08, -11.0 + k * 0.11), 0.045, segments=12)
    kit.cylinder("bench3_mortar", M["rock"], coll, (10.0, y, -10.45), (10.0, y + 0.09, -10.45), 0.07, segments=14)
    kit.cylinder("bench3_pestle", M["rock"], coll, (10.0, y + 0.05, -10.45), (10.07, y + 0.18, -10.4), 0.015, segments=8)
    # 4 EXPLOSIVES (east wall): a sandbag wall in front, canisters, a coil of fuse, a careful note
    for k in range(3):  # sandbags stacked beside the bench, not in front of it
        kit.box(f"bench4_sandbag{k}", M["canvas"], coll, (18.3 - (k % 2) * 0.3, 0.12 + (k // 2) * 0.2, -12.4), (0.3, 0.2, 0.5), rot=(0, 0, R90 + rng.uniform(-0.1, 0.1)), soft=True, puff=0.5)
    for k in range(4):
        kit.cylinder(f"bench4_canister{k}", M["steel_locker"], coll, (18.1, y, -11.5 + k * 0.14), (18.1, y + 0.16, -11.5 + k * 0.14), 0.05, segments=12)
        kit.cylinder(f"bench4_canister{k}_cap", M["dark"], coll, (18.1, y + 0.16, -11.5 + k * 0.14), (18.1, y + 0.18, -11.5 + k * 0.14), 0.03, segments=8, bev=0)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=0.09, radius2=0.09, depth=0.03)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
    kit.mesh_obj("bench4_fuse", bm, M["canvas"], coll, kit.g2b(18.2, y + 0.02, -10.6))["uv"] = "box"
    # 5 REPAIR (east wall): a welding cart with two gas bottles, a mask, a grinder
    kit.box("bench5_cart", M["rust"], coll, (17.45, 0.35, -9.1), (0.5, 0.06, 0.4), bev=0.01)
    for k, zz in enumerate((-9.2, -9.0)):
        kit.cylinder(f"bench5_bottle{k}", M["steel_locker"] if k else M["dark"], coll, (17.45, 0.38, zz), (17.45, 1.35, zz), 0.09, segments=16)
        kit.cylinder(f"bench5_bottle{k}_valve", M["bare"], coll, (17.45, 1.35, zz), (17.45, 1.43, zz), 0.03, segments=8)
    for s_ in (-1, 1):
        kit.cylinder(f"bench5_wheel{s_}", M["dark"], coll, (17.45 + s_ * 0.25, 0.12, -9.1), (17.45 + s_ * 0.29, 0.12, -9.1), 0.12, segments=14)
    kit.cylinder("bench5_hose", M["dark"], coll, (17.45, 1.4, -9.05), (18.0, y + 0.02, -8.6), 0.008, segments=5, bev=0)
    kit.box("bench5_mask", M["dark"], coll, (18.05, y + 0.08, -8.0), (0.18, 0.15, 0.22), rot=(0, 0, 0.3), bev=0.03)
    kit.box("bench5_mask_glass", M["glass"], coll, (17.96, y + 0.1, -8.0), (0.01, 0.05, 0.12), rot=(0, 0, 0.3), bev=0.004)
    kit.cylinder("bench5_grinder", M["steel_locker"], coll, (18.1, y + 0.05, -8.9), (18.1, y + 0.05, -8.6), 0.05, segments=12)
    kit.cylinder("bench5_grinder_disc", M["dark"], coll, (18.0, y + 0.05, -8.94), (18.2, y + 0.05, -8.94), 0.06, segments=16, bev=0)
    # 6 SALVAGE (west wall): broken radios, a husk plate, heaps of gear around it
    for k in range(2):
        kit.box(f"bench6_radio{k}", M["steel_locker"], coll, (9.9, y + 0.12, -8.9 + k * 0.5), (0.3, 0.22, 0.34), rot=(0, 0, rng.uniform(-0.2, 0.2)), bev=0.012)
    kit.box("bench6_radio_open", M["circuit"], coll, (9.95, y + 0.01, -7.9), (0.28, 0.012, 0.22), rot=(0, 0, 0.15), bev=0.002)
    rocks("work_scrap", M, coll, (10.3, 0.0, -7.6), 6, (0.3, 0.1, 0.4))
    for k in range(6):
        kit.box(f"work_scrap_plate{k}", M["steel"] if k % 2 else M["rust"], coll, (10.1 + rng.uniform(-0.25, 0.25), 0.08 + k * 0.05, -7.65 + rng.uniform(-0.3, 0.3)), (0.5, 0.03, 0.35), rot=(rng.uniform(-0.3, 0.3), rng.uniform(-1, 1), rng.uniform(-0.3, 0.3)), bev=0.005)
    for k in range(2):  # tyres and a broken wheel in the heap
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=0.28, radius2=0.28, depth=0.15)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.11)
        kit.mesh_obj(f"work_scrap_tyre{k}", bm, M["dark"], coll, kit.g2b(10.6 + k * 0.2, 0.08 + k * 0.15, -7.4 - k * 0.2), (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0))["uv"] = "box"

    # the middle: a rolling tool chest, the drum of oily rags, a parts rack by the door
    kit.box("work_chest", M["steel_locker"], coll, (12.4, 0.55, -12.4), (0.75, 1.0, 0.5), bev=0.02)
    for k in range(5):
        kit.box(f"work_chest_drawer{k}", M["dark"], coll, (12.4, 0.25 + k * 0.17, -12.14), (0.68, 0.13, 0.01), bev=0.004)
        kit.box(f"work_chest_pull{k}", M["bare"], coll, (12.4, 0.27 + k * 0.17, -12.13), (0.3, 0.015, 0.02), bev=0.003)
    for s1 in (-1, 1):
        for s2 in (-1, 1):
            kit.cylinder(f"work_chest_castor{s1}{s2}", M["dark"], coll, (12.4 + s1 * 0.32 - 0.02, 0.04, -12.4 + s2 * 0.2), (12.4 + s1 * 0.32 + 0.02, 0.04, -12.4 + s2 * 0.2), 0.04, segments=10)
    barrel("work_drum", M, coll, 12.6, -7.35, r=0.3, h=0.9, mat="steel_locker")
    kit.box("work_drum_rags", M["blanket"], coll, (12.6, 0.93, -7.35), (0.4, 0.1, 0.4), soft=True, puff=0.5)
    for k in range(3):
        kit.box(f"work_rack_shelf{k}", M["steel"], coll, (15.6, 0.35 + k * 0.55, -7.2), (1.2, 0.03, 0.4), bev=0.004)
        for j in range(3):
            crate(f"work_rack{k}_{j}", M, coll, (15.2 + j * 0.4, 0.5 + k * 0.55, -7.2), (0.34, 0.26, 0.34), yaw=rng.uniform(-0.1, 0.1))
    for s1 in (-1, 1):
        for s2 in (-1, 1):
            kit.box(f"work_rack_post{s1}{s2}", M["steel"], coll, (15.6 + s1 * 0.58, 0.85, -7.2 + s2 * 0.18), (0.03, 1.7, 0.03), bev=0.003)
    return [((14, 1.7, -7.4), (14, 1.2, -14.0)), ((10.6, 1.8, -8.9), (17.0, 1.0, -13.0)), ((17.3, 1.7, -8.9), (11.5, 1.0, -13.5))]


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
    # today's drops, chalked up on a big slate behind the desk: the room's focus (art bible)
    kit.box("check_chalk_frame", M["timber"], coll, (23.75, 1.65, -14.86), (2.06, 1.2, 0.06), bev=0.015, grain="long")
    kit.plane("check_chalk", P["chalk_drops"], coll, (23.75, 1.65, -14.825), 1.9, 1.07, (R90, 0, 0))
    kit.box("check_chalk_ledge", M["timber"], coll, (23.75, 1.03, -14.8), (2.0, 0.03, 0.08), bev=0.005, grain="long")
    for k in range(3):
        kit.cylinder(f"check_chalk_stick{k}", M["bone"], coll, (23.0 + k * 0.12, 1.055, -14.79), (23.07 + k * 0.12, 1.055, -14.79), 0.007, segments=6, bev=0)
    kit.box("check_chalk_rag", M["canvas"], coll, (24.5, 1.06, -14.79), (0.16, 0.03, 0.07), soft=True, puff=0.4)
    light(room, "check_chalk_light", "POINT", (23.75, 2.3, -14.15), (1.0, 0.72, 0.45), 70, coll=coll)
    # the desk, in use: a radio set, a kettle on a burner, mugs, a clipboard, a lamp, a chair behind
    kit.box("check_desk_radio", M["steel_locker"], coll, (23.4, 1.17, -12.85), (0.5, 0.26, 0.28), bev=0.012)
    kit.box("check_desk_radio_grille", M["dark"], coll, (23.28, 1.17, -12.705), (0.18, 0.16, 0.01), bev=0.002)
    for j in range(3):
        kit.cylinder(f"check_desk_radio_knob{j}", M["bare"], coll, (23.5 + j * 0.06, 1.12, -12.71), (23.5 + j * 0.06, 1.12, -12.69), 0.014, segments=10, bev=0)
    kit.box("check_desk_radio_lamp", M["bulb"], coll, (23.58, 1.22, -12.705), (0.06, 0.02, 0.01), bev=0)
    kit.cylinder("check_desk_aerial", M["bare"], coll, (23.6, 1.3, -12.9), (23.75, 1.75, -12.95), 0.004, segments=4, bev=0)
    kit.box("check_burner", M["dark"], coll, (25.05, 1.08, -12.75), (0.22, 0.06, 0.22), bev=0.008)
    kit.cylinder("check_kettle", M["steel"], coll, (25.05, 1.11, -12.75), (25.05, 1.27, -12.75), 0.085, segments=14)
    kit.cylinder("check_kettle_spout", M["steel"], coll, (25.1, 1.18, -12.72), (25.2, 1.25, -12.66), 0.012, segments=6)
    for k in range(3):
        kit.cylinder(f"check_mug{k}", M["steel_locker"] if k % 2 else M["bone"], coll, (24.4 + k * 0.13, 1.045, -12.35 - (k % 2) * 0.1), (24.4 + k * 0.13, 1.14, -12.35 - (k % 2) * 0.1), 0.035, segments=10)
    kit.box("check_clipboard", M["timber"], coll, (22.95, 1.05, -12.35), (0.24, 0.012, 0.32), rot=(0, 0, -0.2), bev=0.003)
    kit.box("check_clipboard_paper", M["bone"], coll, (22.95, 1.058, -12.34), (0.21, 0.004, 0.26), rot=(0, 0, -0.2), bev=0)
    kit.cylinder("check_desk_lamp_arm", M["dark"], coll, (22.3, 1.045, -12.85), (22.4, 1.45, -12.7), 0.01, segments=6)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=14, radius1=0.09, radius2=0.03, depth=0.1)
    kit.mesh_obj("check_desk_lamp_shade", bm, M["steel"], coll, kit.g2b(22.45, 1.42, -12.62), (0.4, 0, 0))["uv"] = "box"
    light(room, "check_desk_lamp_light", "POINT", (22.5, 1.3, -12.5), WARM, 25, coll=coll)
    kit.box("check_chair_seat", M["timber"], coll, (23.75, 0.48, -13.35), (0.45, 0.05, 0.42), bev=0.02)
    kit.box("check_chair_back", M["timber"], coll, (23.75, 0.8, -13.55), (0.42, 0.55, 0.04), rot=(-0.1, 0, 0), bev=0.015)
    for s1 in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        kit.box(f"check_chair_leg{s1}", M["rust"], coll, (23.75 + s1[0] * 0.18, 0.23, -13.35 + s1[1] * 0.17), (0.03, 0.46, 0.03), bev=0.004)
    kit.box("check_filing", M["steel_locker"], coll, (21.9, 0.65, -14.6), (0.5, 1.3, 0.55), bev=0.015)
    for k in range(3):
        kit.box(f"check_filing_drawer{k}", M["dark"], coll, (21.9, 0.28 + k * 0.38, -14.32), (0.42, 0.3, 0.01), bev=0.004)
        kit.box(f"check_filing_pull{k}", M["bare"], coll, (21.9, 0.36 + k * 0.38, -14.31), (0.14, 0.02, 0.02), bev=0.003)
    kit.box("check_logbook", M["blanket"], coll, (22.6, 1.06, -12.5), (0.4, 0.04, 0.3), rot=(0, 0, 0.15), bev=0.01)
    kit.plane("check_signout", P["paper_signout"], coll, (25.0, 1.048, -12.45), 0.28, 0.35, (0, 0, -0.2))
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
    door_portal("check_door", M, coll, "x", 23.75, z1 - 0.1, 0.25)

    # a queue to the desk: posts and a sagging rope
    for k, (x, z) in enumerate(((22.2, -9.0), (22.2, -11.2), (25.3, -9.0), (25.3, -11.2))):
        kit.cylinder(f"check_post{k}", M["bare"], coll, (x, 0, z), (x, 0.95, z), 0.025, segments=10)
        kit.cylinder(f"check_post{k}_foot", M["dark"], coll, (x, 0, z), (x, 0.04, z), 0.14, segments=14, bev=0.006)
    for k, (a_, b_) in enumerate((((22.2, -9.0), (22.2, -11.2)), ((25.3, -9.0), (25.3, -11.2)))):
        pts = [(a_[0], 0.92 - 0.12 * math.sin(t * math.pi), a_[1] + (b_[1] - a_[1]) * t) for t in np.linspace(0, 1, 7)]
        for j in range(6):
            kit.cylinder(f"check_rope{k}_{j}", M["canvas"], coll, pts[j], pts[j + 1], 0.012, segments=6, bev=0)
    # gear lockers down the east wall, south of the radio rack; one hangs open with a jacket inside
    for k in range(5):
        lz = -14.55 + k * 0.52
        kit.box(f"check_locker{k}", M["steel_locker"], coll, (28.2, 0.95, lz), (0.5, 1.9, 0.5), bev=0.015)
        for v in range(3):
            kit.box(f"check_locker{k}_vent{v}", M["dark"], coll, (27.945, 1.65 + v * 0.05, lz), (0.01, 0.015, 0.3), bev=0)
        kit.box(f"check_locker{k}_handle", M["bare"], coll, (27.94, 1.0, lz + 0.18), (0.02, 0.12, 0.02), bev=0.004)
        if k == 2:
            kit.box(f"check_locker{k}_door", M["steel_locker"], coll, (27.75, 0.95, lz - 0.36), (0.02, 1.86, 0.48), rot=(0, 0, -0.9), bev=0.008)
            kit.box(f"check_locker{k}_jacket", M["blanket"], coll, (28.1, 1.25, lz), (0.12, 0.8, 0.4), soft=True, puff=0.4)
    kit.box("check_locker_bench", M["timber"], coll, (27.45, 0.45, -13.5), (0.36, 0.06, 2.0), bev=0.015, grain="long")
    for dz_ in (-0.85, 0.85):
        kit.box(f"check_locker_bench_leg{dz_}", M["rust"], coll, (27.45, 0.22, -13.5 + dz_), (0.32, 0.44, 0.05), bev=0.005)
    kit.box("check_boots", M["dark"], coll, (27.5, 0.07, -12.8), (0.14, 0.14, 0.3), rot=(0, 0, 0.2), bev=0.03)
    # the remembering wall (art bible: everything remembers): photos of Divers who did not come back, tallies, candles
    kit.box("check_memory_board", M["plank"], coll, (19.24, 1.55, -13.6), (0.04, 1.1, 1.6), bev=0.01)
    for k in range(9):
        kit.plane(f"check_memory_photo{k}", M["photo"], coll, (19.27, 1.25 + (k // 3) * 0.32, -14.15 + (k % 3) * 0.5 + rng.uniform(-0.05, 0.05)), 0.2, 0.26, (R90, 0, R90 + rng.uniform(-0.1, 0.1)))
    kit.plane("check_memory_tally", M["tally"], coll, (19.272, 1.9, -13.0), 0.5, 0.25, (R90, 0, R90))
    kit.box("check_memory_shelf", M["timber"], coll, (19.35, 0.95, -13.6), (0.22, 0.04, 1.4), bev=0.006, grain="long")
    for k in range(6):
        cz_ = -14.15 + k * 0.22
        kit.cylinder(f"check_candle{k}", M["bone"], coll, (19.35, 0.97, cz_), (19.35, 0.97 + rng.uniform(0.05, 0.14), cz_), 0.02, segments=8)
    light(room, "check_candles", "POINT", (19.6, 1.2, -13.6), (1.0, 0.6, 0.3), 10, coll=coll)
    # coats on hooks by the door, supply crates and a water barrel
    for k in range(4):
        kit.box(f"check_hook{k}", M["bare"], coll, (20.0 + k * 0.35, 1.75, z1 - 0.08), (0.02, 0.02, 0.08), bev=0.002)
        if k != 2:
            kit.box(f"check_coat{k}", M["canvas"] if k % 2 else M["blanket"], coll, (20.0 + k * 0.35, 1.3, z1 - 0.14), (0.3, 0.85, 0.1), soft=True, puff=0.35)
    for k in range(3):
        crate(f"check_supply{k}", M, coll, (26.9 + (k % 2) * 0.72, 0.34 + (k // 2) * 0.68, -7.4), yaw=rng.uniform(-0.08, 0.08))
    barrel("check_water", M, coll, 21.6, -7.4, r=0.3, h=1.0, mat="steel_locker")
    kit.cylinder("check_water_tap", M["bare"], coll, (21.6, 0.25, -7.7), (21.6, 0.25, -7.78), 0.015, segments=6)
    kit.cylinder("check_cup", M["steel"], coll, (21.6, 1.0, -7.45), (21.6, 1.08, -7.45), 0.035, segments=10)
    # a rack of packs and headlamps on the west wall, ready to go out
    kit.box("check_gear_rail", M["timber"], coll, (19.24, 1.75, -8.7), (0.05, 0.08, 1.5), bev=0.006, grain="long")
    for k in range(3):
        gz = -9.25 + k * 0.5
        kit.box(f"check_gear_hook{k}", M["bare"], coll, (19.3, 1.72, gz), (0.08, 0.02, 0.02), bev=0.003)
        kit.box(f"check_gear_pack{k}", M["canvas"] if k != 1 else M["blanket"], coll, (19.4, 1.4, gz), (0.24, 0.55, 0.36), rot=(0, 0, rng.uniform(-0.05, 0.05)), soft=True, puff=0.35)
        kit.box(f"check_gear_pack{k}_flap", M["canvas"], coll, (19.46, 1.62, gz), (0.2, 0.12, 0.34), soft=True, puff=0.3)
    for k in range(2):
        hz = -9.0 + k * 0.5
        kit.cylinder(f"check_headlamp{k}_band", M["dark"], coll, (19.3, 2.05, hz - 0.08), (19.3, 2.05, hz + 0.08), 0.06, segments=12, bev=0)
        kit.cylinder(f"check_headlamp{k}_lamp", M["bare"], coll, (19.33, 2.0, hz), (19.38, 2.0, hz), 0.025, segments=10)
    # the loan table: torches, flares, rope and rations, and the board that says bring them back
    kit.box("check_loan_table", M["timber"], coll, (27.0, 0.8, -11.55), (0.6, 0.05, 1.1), bev=0.012, grain="long")
    for s1 in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        kit.box(f"check_loan_leg{s1}", M["rust"], coll, (27.0 + s1[0] * 0.25, 0.39, -11.55 + s1[1] * 0.5), (0.04, 0.78, 0.04), bev=0.004)
    for k in range(4):
        tz = -11.95 + k * 0.1
        kit.cylinder(f"check_torch{k}", M["dark"], coll, (26.85, 0.85, tz), (27.07, 0.85, tz + 0.02), 0.022, segments=10)
        kit.cylinder(f"check_torch{k}_lens", M["bare"], coll, (27.07, 0.85, tz + 0.02), (27.1, 0.85, tz + 0.02), 0.028, segments=10, bev=0)
    kit.box("check_flare_box", M["plank"], coll, (27.05, 0.9, -11.35), (0.3, 0.14, 0.2), bev=0.01)
    for k in range(5):
        kit.cylinder(f"check_flare{k}", M["blanket"], coll, (26.95 + k * 0.05, 0.92, -11.35), (26.95 + k * 0.05, 1.02, -11.35), 0.014, segments=6, bev=0)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=18, radius1=0.15, radius2=0.15, depth=0.06)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.05)
    kit.mesh_obj("check_rope_coil", bm, M["canvas"], coll, kit.g2b(27.0, 0.86, -11.08))["uv"] = "box"
    for k in range(4):
        kit.cylinder(f"check_ration{k}", M["steel"], coll, (26.4 + (k % 2) * 0.16, 0.0 + (k // 2) * 0.13, -11.2), (26.4 + (k % 2) * 0.16, 0.12 + (k // 2) * 0.13, -11.2), 0.06, segments=12)
    board("check_return", P["sign_return_kit"], coll, (28.43, 1.75, -11.55), 0.9, 0.42, (R90, 0, -R90), timber=M["timber"])
    # a worn rug under the queue, string lights across the roof, a clock over the lockers
    kit.box("check_rug", M["rug"], coll, (23.75, 0.012, -10.5), (2.6, 0.012, 1.9), rot=(0, 0, 0.04), bev=0.004)
    string_lights("check_string", M, coll, room, [((19.4, 3.0, -9.0), (28.2, 3.05, -9.0)), ((19.4, 3.05, -12.2), (28.2, 3.0, -12.2))], sag=0.3, every=6, watts=20)
    kit.cylinder("check_clock", M["bone"], coll, (27.3, 2.4, -14.86), (27.3, 2.4, -14.82), 0.16, segments=24, bev=0.004)
    kit.cylinder("check_clock_rim", M["dark"], coll, (27.3, 2.4, -14.87), (27.3, 2.4, -14.83), 0.175, segments=24, bev=0.006)
    kit.box("check_clock_hour", M["dark"], coll, (27.3, 2.44, -14.81), (0.012, 0.09, 0.004), rot=(0, 0, 0.0), bev=0)
    kit.box("check_clock_min", M["dark"], coll, (27.35, 2.4, -14.81), (0.11, 0.01, 0.004), bev=0)
    return [((23.75, 1.7, -7.4), (23.75, 1.3, -14.0)), ((27.0, 1.7, -8.0), (19.5, 1.5, -11.5)), ((20.6, 1.6, -8.0), (27.5, 1.2, -13.8))]


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
    kit.cylinder("lift_cable", M["dark"], coll, (34.8, H - 0.3, -5.1), (34.8, H + 4.6, -5.5), 0.025)
    kit.box("lift_threshold", M["bulb"], coll, (x0 + 0.05, 0.012, -5.1), (0.1, 0.02, 3.0), bev=0)
    # Lift Teal beacon on the back wall: the way out (art bible 4)
    kit.box("lift_beacon", M["teal"], coll, (x1 - 0.11, 1.3, -5.1), (0.04, 0.6, 0.8), bev=0.01)
    light(room, "lift_beacon_light", "POINT", (x1 - 0.6, 1.4, -5.1), (0.18, 0.9, 0.82), 40, coll=coll)
    # the only cool light in the Sanctuary: a thin sliver of daylight down the shaft
    light(room, "lift_daylight", "SPOT", (34.8, H + 4, -5.1), (0.85, 0.9, 1.0), 900, coll=coll,
          spot_size=math.radians(22), spot_blend=0.4)
    rock_wall("lift_south", M, coll, "x", z1 + 0.15, x0, x1, -1, depth=0.1, seed=71)
    rock_wall("lift_north", M, coll, "x", z0 - 0.15, x0, x1, +1, depth=0.1, seed=72)
    # the shaft above the cage: rock up to where the daylight comes in, a timber collar at the roof line
    top = H + 6.0
    for k, (pos, w, rot) in enumerate((((34.75, (H + top) / 2, z1 + 0.15), x1 - x0 + 0.3, (R90, 0, math.pi)),
                                      ((34.75, (H + top) / 2, z0 - 0.15), x1 - x0 + 0.3, (R90, 0, 0)),
                                      ((x1 + 0.05, (H + top) / 2, -5.1), z1 - z0 + 0.3, (R90, 0, -R90)),
                                      ((x0 - 0.05, (H + top) / 2, -5.1), z1 - z0 + 0.3, (R90, 0, R90)))):
        kit.displaced_panel(f"lift_shaft{k}", M["rock"], coll, pos, w + 0.7, top - H, rot, step=0.08, depth=0.12, seed=73 + k)  # overlapping at the corners
    # the top of the shaft: open sky, the one cool light in the Sanctuary
    sky = kit.pbr("mat_daylight_01", None, tint=(0.85, 0.9, 1.0), emission=(0.8, 0.88, 1.0), emission_strength=3.0)
    kit.plane("lift_sky", sky, coll, (34.75, top - 0.05, -5.1), x1 - x0 + 0.6, z1 - z0 + 0.6, (math.pi, 0, 0))
    for k, z in enumerate((z0 - 0.05, z1 + 0.05)):
        kit.box(f"lift_collar{k}", M["timber"], coll, (34.75, H + 0.1, z), (x1 - x0 + 0.4, 0.26, 0.22), bev=0.02, grain="long")
    # the sheave wheel the cable runs over, on a steel beam across the shaft
    sy = H + 4.6
    kit.box("lift_sheave_beam", M["dark"], coll, (34.8, sy + 0.45, -5.1), (0.2, 0.2, 3.3), bev=0.015)
    ring_pts = [(34.8, sy + 0.4 * math.sin(a), -5.1 + 0.4 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 25)]
    for j in range(24):
        kit.cylinder(f"lift_sheave_rim{j}", M["rust"], coll, ring_pts[j], ring_pts[j + 1], 0.04, segments=8, bev=0)
    for j in range(6):
        a = j * math.pi / 3
        kit.cylinder(f"lift_sheave_spoke{j}", M["rust"], coll, (34.8, sy, -5.1), (34.8, sy + 0.38 * math.sin(a), -5.1 + 0.38 * math.cos(a)), 0.025, segments=6, bev=0)
    kit.cylinder("lift_sheave_hub", M["dark"], coll, (34.7, sy, -5.1), (34.9, sy, -5.1), 0.08, segments=12)
    kit.cylinder("lift_cable_down", M["dark"], coll, (34.8, sy + 0.4, -4.7), (34.8, 0.4, -4.7), 0.018, segments=6)  # to the counterweight side
    # counterweight guides on the back wall, the weight hanging high
    for s_ in (-1, 1):
        kit.box(f"lift_guide{s_}", M["dark"], coll, (x1 - 0.18, top / 2, -4.7 + s_ * 0.3), (0.08, top, 0.06), bev=0.006)
    kit.box("lift_counterweight", M["rust"], coll, (x1 - 0.2, H + 1.2, -4.7), (0.2, 0.9, 0.5), bev=0.02)
    # the folding gate, pushed open against the north side
    for k in range(7):
        zz = z0 + 0.22 + (k % 2) * 0.06
        kit.box(f"lift_gate_bar{k}", M["bare"], coll, (x0 + 0.08 + k * 0.035, 1.1, zz), (0.015, 2.1, 0.015), bev=0.003)
    for k in range(6):
        kit.box(f"lift_gate_x{k}", M["dark"], coll, (x0 + 0.13 + k * 0.035, 1.1, z0 + 0.25), (0.01, 2.2, 0.01), rot=(0.0, 0, 0.12 if k % 2 else -0.12), bev=0)
    # the control post: a pedestal, a brass-handled lever, two lamps (teal go, amber wait), a bell
    px, pz = x0 + 0.35, z1 - 0.35
    kit.box("lift_control", M["steel_locker"], coll, (px, 0.55, pz), (0.32, 1.1, 0.26), bev=0.02)
    kit.box("lift_control_top", M["dark"], coll, (px, 1.12, pz), (0.36, 0.05, 0.3), rot=(0, 0, 0.15), bev=0.01)
    kit.cylinder("lift_lever", M["bare"], coll, (px, 1.14, pz), (px - 0.12, 1.45, pz), 0.012, segments=8)
    kit.cylinder("lift_lever_knob", M["hazard"], coll, (px - 0.12, 1.45, pz), (px - 0.14, 1.5, pz), 0.025, segments=10)
    kit.cylinder("lift_lamp_go", M["teal"], coll, (px + 0.08, 1.14, pz - 0.08), (px + 0.08, 1.19, pz - 0.08), 0.025, segments=10, bev=0)
    kit.cylinder("lift_lamp_wait", M["bulb"], coll, (px + 0.08, 1.14, pz + 0.06), (px + 0.08, 1.19, pz + 0.06), 0.025, segments=10, bev=0)
    kit.cylinder("lift_bell", M["hazard"], coll, (px, 2.2, z1 - 0.13), (px, 2.32, z1 - 0.13), 0.09, segments=14, bev=0.01)
    # faded hazard stripes on the threshold and the frame: worn paint over rusted steel
    for k in range(10):
        kit.box(f"lift_stripe{k}", M["hazard"] if k % 2 == 0 else M["dark"], coll, (x0 - 0.3, 0.008, z0 + 0.15 + k * 0.3), (0.5, 0.012, 0.3), rot=(0, 0, 0.0), bev=0)
    for k in range(10):
        kit.box(f"lift_frame_stripe{k}", M["hazard"] if k % 2 == 0 else M["dark"], coll, (x0 - 0.085, H - 0.1, z0 + 0.15 + k * 0.3), (0.012, 0.18, 0.3), bev=0)
    board("lift_sign", P["sign_lift"], coll, (x1 - 0.14, 2.3, -5.75), 1.0, 0.26, (R90, 0, -R90), timber=M["timber"])  # over the beacon, facing the way in
    return [((31.0, 1.7, -5.1), (36.0, 1.2, -5.1)), ((33.4, 1.4, -4.0), (35.6, 4.5, -5.6))]


BUILDERS = {"hallway": build_hallway, "trade_hall": build_trade_hall, "clinic": build_clinic, "radio": build_radio, "workshop": build_workshop,
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
    M["rust"] = kit.pbr("mat_metal_rust_01", "steel", tint=(0.62, 0.38, 0.24), rough=None)
    M["timber_rot"] = kit.pbr("mat_timber_rotten_01", "timber", tint=(0.62, 0.58, 0.52))
    global M_TIMBER, M_DARK
    M_TIMBER, M_DARK = M["timber"], M["dark"]
    M["scorch"] = kit.picture_material("mat_decal_scorch_01", os.path.join(TEX, "decal_scorch_albedo.png"), alpha=True, rough=0.9)
    M["grow"] = kit.pbr("mat_grow_light_01", None, tint=(0.95, 0.6, 0.7), emission=(0.85, 0.34, 0.48), emission_strength=8.0)
    M["bottle"] = kit.pbr("mat_bottle_amber_01", None, tint=(0.05, 0.016, 0.004), rough=0.12)  # dark brown glass (linear values)
    M["ice"] = kit.pbr("mat_shield_cell_01", None, tint=(0.62, 0.85, 0.94), rough=0.3, metal=0.6)  # Shield Ice, never glowing
    M["bone"] = kit.pbr("mat_cloth_bone_01", "canvas", tint=(0.93, 0.9, 0.82))
    M["circuit"] = kit.pbr("mat_circuit_board_01", "canvas", tint=(0.2, 0.3, 0.2), rough=0.5)
    M["hazard"] = kit.pbr("mat_paint_hazard_01", "steel", tint=(0.86, 0.66, 0.3))  # faded hazard paint, worn to rust
    M["teal"] = kit.pbr("mat_lift_teal_01", None, tint=(0.03, 0.2, 0.18), emission=(0.18, 0.9, 0.82), emission_strength=6.0)
    P = {}
    for key in ("sign_rules", "sign_trade_hall", "sign_workshop", "sign_checkout_door", "sign_lift", "sign_quarters", "sign_checkout",
                "sign_notices", "sign_clinic_rules", "sign_clinic_prices", "sign_return_kit", "sign_we_buy", *[f"sign_bin_{i}" for i in range(3)], *[f"sign_trader_{i}" for i in range(3)], *[f"sign_bench_{i}" for i in range(7)]):
        P[key] = kit.pbr(f"mat_{key}_01", key)
    for key in ("neon_noodles", "neon_bunks", "neon_clinic", "neon_water", "neon_radio", "neon_market"):
        P[key] = kit.picture_material(f"mat_{key}_01", os.path.join(TEX, f"{key}_albedo.png"), emission_strength=5.0, rough=0.3)
    for key in ("map_board", "paper_notice_1", "paper_notice_2", "paper_notice_3", "paper_signout", "paper_target",
                "paper_anatomy", "paper_clinic_1", "paper_clinic_2", "chalk_drops"):
        P[key] = kit.picture_material(f"mat_{key}_01", os.path.join(TEX, f"{key}_albedo.png"), rough=0.85)
    views = {}
    for room in rooms:
        coll = bpy.data.collections.new(f"env_sanctuary_{room}")
        bpy.context.scene.collection.children.link(coll)
        views[room] = BUILDERS[room](M, P, coll)
        if room in ("trade_hall", "workshop", "checkout"):  # 2 m further north, behind the wider hallway
            for o in coll.objects:
                o.location.y -= ROOM_SHIFT  # game z -> Blender -y
            LIGHTS[room] = [(n, k, (p[0], p[1], p[2] + ROOM_SHIFT), c, w, kw) for n, k, p, c, w, kw in LIGHTS.get(room, [])]
            views[room] = [((c[0], c[1], c[2] + ROOM_SHIFT), (l[0], l[1], l[2] + ROOM_SHIFT)) for c, l in views[room]]
        if room in ("trade_hall", "workshop", "checkout"):
            DISPLAY[room] = [(g, (c[0], c[1], c[2] + ROOM_SHIFT), r) for g, c, r in DISPLAY.get(room, [])]
        for o in list(coll.objects):
            kit.finalize(o)
        if DISPLAY.get(room):
            placed = build_display_guns(room)
            if "--export" in sys.argv:
                write_guns(room, placed)
            print(f"{room}: displayed guns {len(placed)}")
        if room == "hallway":
            clashes = check_clearance(coll)
            print(f"hallway clearance: {len(clashes)} clashes" + "".join(f"\n  {a} x {b}" for a, b in clashes[:20]))
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
            only = arg("--views")
            for k, (cam, look) in enumerate(views[room]):
                if only and str(k) not in only.split(","):
                    continue
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
