# Art Bible: Scrapfall

> **Status**: Draft
> **Owned By**: art-director
> **Last Updated**: 2026-10-30
> **Art Director Sign-Off (AD-ART-BIBLE)**: SKIPPED 2026-10-30 — solo mode

`/art-bible` writes these nine sections in this order and replaces each
section's `[To be designed]` line as that section is approved. A section still
holding its placeholder is incomplete; a later run fills only those.

## 1. Visual Identity Statement

**Rule: "Everything remembers."** Every surface, machine and room shows the
history that happened to it: wear, damage and repair are always readable, and
nothing looks new or untouched. Tiebreaker: when two options are otherwise
equal, pick the one that shows more evidence of past events.

**P1. Scars tell the story** (serves the learning Husk Network)
- Husks, Bulwarks and Cradles carry traces of past raids: scorch, patched
  armour, rebuilt parts, deliberate reinforcement. Cradles show organized
  growth; Bulwarks show fortification.
- The Network adapts, so adaptation must be visible: players read "they
  changed because of me" from the art.
- Test: *when a Husk or Husk-built space could look generic or adapted,
  choose adapted.*
- Every Husk keeps one glowing eye (its critical spot): the brightest, most
  saturated point on the Husk in every lighting condition.

**P2. Danger reads before detail** (serves short, tense runs)
- Realistic detail never beats silhouette and threat readability. Husk types,
  cover, exits and loot separate at a glance in Golden Hour, Night Raid and
  Dust Storm.
- Each Husk type has a unique silhouette that stays legible in every condition.
- Test: *when realism and readability conflict, choose readability, then add
  the realism back as secondary detail (surface wear, small props, decals).*
- Hero values and colours sit on threats, objectives and exits; surroundings
  stay lower in contrast.

**P3. The Sanctuary is warm, the Dustline is not** (serves the extraction loop
and the risk carried between raids)
- Topside is hostile, desaturated and dusty, with harsh light, wind and long
  grass. Golden Hour keeps its gold but as a harsh, bleached, dusty glare: the
  surface never feels as safe as the Sanctuary (author decision, 2026-10-30).
- The Sanctuary is the only place with warm, deliberate, human-scale light:
  string lights, neon shopfronts and lamps against dark timber and rock.
  Going down the lift feels like relief; going up is a risk you chose.
- Test: *when a space could feel neutral or safe, make light the signal: warm,
  local, human-made light means safe; cold, wide or harsh light means exposed.*
- No warm neon or string-light accents in Husk-controlled spaces.

**Anchors**
- Style: gritty semi-realistic. Realistic proportions, PBR materials, worn and
  dirty.
- Technical ceiling: Godot 4.7 Forward+ renderer, desktop only (a downloaded
  .exe; no web build, author decision 2026-10-30), authored in Blender. Wear
  lives mostly in textures and baked detail; real-time effects are allowed
  within the Section 8 budgets.

## 2. Mood & Atmosphere

**Global rules**
- Forward+ toolkit: directional light, live and emissive practicals, decals,
  depth and volumetric fog, ambient occlusion, reflection probes, sky
  gradient, tonemap/exposure, particle cards, vignette. Laptop minimum spec
  (Section 8) must still hold 30 fps on low settings, so heavy effects
  (volumetric fog, GI, screen-space reflections) need a low-settings fallback.
- Warm, local, human-made light = safe; cold, wide or harsh light = exposed (P3).
- Husk eyes and the lift beacon stay readable through fog (Storm, Night).
- Each state has its own key colour, contrast level and light shape. Two states
  matching on all three means one is wrong.

| State | Key light | Contrast | Carries the mood | Energy |
|---|---|---|---|---|
| Title / menus | Sanctuary lamps about 1 stop darker, vignette, one cold (6500K+) daylight shaft from the lift end | Medium | The cold sliver across the warm street: the risk upstairs | Low, slow camera drift |
| Sanctuary hub | 2400–3200K practicals; shadows dark brown, never black; neon only amber, sodium or dusty rose `#d9577a`, never red-orange | High, local | Catenary string lights over dark timber; lit doorways as warm rectangles | Low, ambient bustle |
| Golden Hour | Low hard sun (~25°, ~4800–5200K, gold-white), bleached highlights and horizon; **shadow fill neutral-cool and desaturated** (author decision, 2026-10-30); saturation ≤ ~40% | High | Long hard ruin shadows across pale dust, where Husks hide; wind in the grass | Medium-low |
| Night Raid | Moon 8000–10000K, deep navy fog, shadows navy not black; headlamp neutral-white ~5600K, never warm, hard-edged | Very high, local | The headlamp cone with dust motes; a Watcher beam crossing it | Low-medium, tense |
| Dust Storm | No sun disc or directional shadow; flat ochre-sepia; shapes dissolve by 40–60 m; saturation ≤ ~30% | Very low | Horizontal grit streaks; Husk eyes appear before their bodies | Medium-high, jittery |
| Husk combat | Overlay on any map: the eye is the light source (emissive first, at most 1–2 cheap point lights); desaturated periphery | Raised | Eye flare, the brightest, most saturated point on screen; thin red damage edge, never over the centre | Peak |
| Lift called | Map light plus local teal ring and column, the only cool saturated light topside; pulses with the countdown, ring shrinks | Medium, tightening | Teal beacon against red eyes closing in from the perimeter | High, rising |
| Death / results | Near-monochrome slate ~7000K, slow desaturating fade, no warm light | Low | Loadout greyed and scorched; only the safe-pocket item stays lit; a dim Husk eye on the "learned" line | Very low |
| Extraction return | Warm 2700K lamplight spilling from the lift doors; 1–2 s overexposed-to-normal ease-in | Soft, high-key | Warm light over dust-caked gear (the Diver keeps topside wear) | Low-medium, release |

## 3. Shape Language

**Core rules**
- **No blocky or low-poly geometry.** Models are realistic: bevelled edges, curves, real thickness and fine detail. The shape words in this section (low, tall, round, wide) describe how a thing reads from a distance, not how it is modelled.
- **Human-made looks built by hand:** slightly crooked, sagging, patched, mismatched materials.
- **Husk-made looks machined:** smooth flowing curves, symmetry, layered armour plates, precise seams.
- When a Husk adapts, its surface detail and add-ons change, never its outline (P1 visible adaptation + P2 stable silhouette).
- Test: every character can be told apart by type as a solid black shape 64 px tall. Every Husk can also be told apart in a Dust Storm at the far edge of its own sight range (16–38 m).
- Important things (heroes) have large, clear outlines and high contrast. Everything else is smaller, finer and lower in contrast (P2).

**Characters**
- Diver: realistic proportions, top-heavy outline (backpack, shield pack, weapon). Each hat and hair option changes the head outline. Never mistakable for a trader or a Husk.
- Traders (soft, draped, rounded clothing = human, safe; finalised in Section 5):

| NPC | Outline at a distance | Trait |
|---|---|---|
| Tobias, gunsmith | Wide, square-shouldered | Apron and bulk, bench tools |
| Nia, medic | Tall, narrow | Satchel, cross-body strap |
| Pell, buyer | Round, stooped | Stacks and crates around him |

- Husks (machined, armour-plated, scarred; each type has its own outline):

| Husk | How it looks | Tells it apart | Eye |
|---|---|---|---|
| Skitter | Low, flat crawler on splayed legs | Lowest and widest for its height | Front |
| Buzzer | Sleek, pointed drone with thruster pods on its sides | Airborne, small, pointed nose | Nose |
| Watcher | Round flyer; its eye is its lamp | Airborne, round; its light beam adds to its outline | Central lens (the lamp) |
| Pouncer | Heavy, crouching armoured beast, hind legs folded under it | Armoured shell, crouched ready to leap | Core on top |
| Warden | Towering walker with wide shoulders and twin miniguns | Several times Diver height | Core on back |

- Scars (P1): welds, patches and bolted-on plates, kept inside the outline. Eye shutters (the counter a Husk learned) are a visible plate partly covering the eye. At most one lopsided add-on per Husk, never big enough to change its outline.

**Environments**
- Sanctuary (mine): timber posts and beams slightly out of true, uneven rounded rock arches, low ceilings. Rails lead the eye to the lift (east end). String lights sag in loose curves. Shopfronts are painted signboards. Lit doorways, warm in the dark, are what guide the player.
- Dustline ruins: broken walls and columns, collapsed floors at odd angles, ragged skylines, heaped rubble. Objects are drawn as the real things: stacked, dented shipping containers; rusted, burnt-out car wrecks; refinery tanks, pipes and towers; a large, rocky mountain backdrop.
- Cover is solid with clear, readable tops, so the player sees at a glance what they can hide behind. Long grass is soft, low-contrast background.
- Husk-built: Bulwark = a thin tall spire inside rings of curved barricades (reads as a fortification from far away). Cradle = a low ring of clustered egg-shaped pods, dull and always dimmer than any eye (organised growth). Crashed hull = large, torn armour plates. No warm lighting accents in any of them (P3).

**UI shapes** (detail in Section 7)
- Panels: rectangles with cut corners, like stamped metal plates. No pill shapes or rounded cards. Wear only on the edges, never behind text.
- Husk-awareness UI (threat markers, "?", Network log): diamonds, chevrons, hexagons.
- Interact prompts and the lift marker: circles. Shields: hexagon cells. Rarity: number of pips on the frame (Section 4).

**Hero vs supporting**

| Hero (largest, clearest outline, highest contrast) | Supporting (finer, lower contrast) |
|---|---|
| Husk eyes and outlines | Ground, vegetation |
| Lift beacon | Rubble, ruin detail |
| Containers and loot glints | Props, decals, wear |
| Cover edges | Distant geometry |

- The eye is the smallest hero element: sized and given a glow so it reads at the Husk's own sight range.

## 4. Color System

**Saturation rule:** the world stays below about 35% saturation. Saturated
colour is reserved for meaning: Lamp Amber (Sanctuary only), Eye Red, Lift
Teal and loot rarity.

**Primary palette**

| Name | Hex | Meaning |
|---|---|---|
| Bleached Dust | `#cdb892` | Topside ground and sun-baked surfaces: exposed, dry |
| Rust Ochre | `#8c5230` | Rust, repairs, age; the Dust Storm's base (P1 history) |
| Mine Timber | `#3a2a1e` | Sanctuary structure and warm shadow: shelter |
| Lamp Amber | `#e8933a` | Human-made light, **Sanctuary only**: safe |
| Husk Slate | `#3c434c` | Husk hulls, night shadow, cold machine |
| Eye Red | `#ff4a2a` | Husk eyes and threat (matches the alert eye at `src/enemies.js:717`) |
| Lift Teal | `#2fe6d2` | The way out; the only cool saturated colour topside |

Support neutrals: Hull Edge Wear `#7c858f` (bare-metal edges keep Husk outlines
readable at night), Bone `#e8e2d4` (UI text), Soot `#14181d` (UI panels).

**Semantic colours**
- Husk eyes: one hue, Eye Red, for every Husk, always the brightest point on it
  (P1). State is shown by intensity, size and halo, not hue: neutral = dim,
  small, steady; warning = flare + halo + chirp; hostile = full, pulsing, large
  halo. Pouncers and Wardens are always at full intensity. Searching: a "?" in
  Bone with a dark outline.
- **Watcher** (author decision, 2026-10-30): its eye moves from yellow
  (`0xffcc20`) to Eye Red like every other Husk. Its beam is pale neutral-white
  when calm, orange when wary, red when alert (it was yellow `0xffe08a`, which
  clashed with Legendary gold and Lamp Amber).
- Loot rarity: keep the five current colours. They appear only on item UI and
  loot glints, never as world light or paint, and each also has a pip count
  (common 0 … legendary 4), frame style and name text.

| Rarity | Hex |
|---|---|
| Common | `#b7b2a6` |
| Uncommon | `#5fc46b` |
| Rare | `#3fa3e8` |
| Epic | `#c262e8` |
| Legendary | `#f2b233` (yellower than Lamp Amber; UI and glints only) |

- Lift / extraction: keep cyan, tuned to Lift Teal. Called = pulse with the
  countdown and a shrinking ring; open = steady and bright; closing = flicker.
- Shields: Ice `#9fd8f0`, low saturation, hex-cell pattern and a hex ripple on
  absorb (whiter than Lift Teal, hex-shaped unlike Rare blue).
- Health: Bone fill; below ~25% it turns Alert Red `#d9402c` and pulses (red
  family = "something can hurt you").

**Temperature by area**

| Area | Rule |
|---|---|
| Sanctuary | 2400–3200K practicals, warm brown shadows, neon only amber, sodium or rose. The most saturated place in the game. Only cool light: the daylight sliver down the lift shaft. |
| Golden Hour | Gold-white key ~4800–5200K, neutral-cool desaturated shadow fill, bleached horizon, saturation ≤ ~40%, no orange practicals. |
| Night Raid | Moon 8000–10000K, neutral-white headlamp ~5600K, near-monochrome navy. Only Eye Red, Lift Teal and rarity are saturated. |
| Dust Storm | Single-hue ochre-sepia fog, no directional shadow, saturation ≤ ~30%. Separation by value and emissives only. |
| Husk-controlled | Cold-shifted, Husk Slate surfaces, no warm accents (P3). Only light: eyes, dim pods, the pale Watcher beam. |

**UI palette**
- Soot panels at ~85% opacity, Bone text, secondary text `#a89f8c`. Contrast at
  least 4.5:1 for body text, 3:1 for large text and icons. UI is lighter and
  higher-contrast than the world (P2).
- Sanctuary and menu skin: Mine Timber-tinted panels, Lamp Amber accent.
  Raid HUD skin: Husk Slate panels, no amber, semantic colours only.
  Results: death uses the cold skin with red on "lost" only; success uses the
  amber skin.

**Colourblind risks and backups**

| Risk | Backup cue |
|---|---|
| Rarity green/gold/grey and blue/purple | Pip count, frame style, name text, glint pattern |
| Eye Red on ochre dust (Storm, protan) | Brightest point, halo, eye shape, Husk outline, warning chirp |
| Eye state ladder | Intensity, size, pulse, posture, "?" icon, sound |
| Lift Teal vs Rare blue vs Shield Ice | Lift: vertical column, shrinking ring, timer, HUD door icon, sound. Shield: hex pattern |
| Health white to red | Bar length, number, low-health icon and pulse, damage-direction wedge |

A dedicated colourblind mode is deferred to `design/accessibility-requirements.md`.

## 5. Character Design Direction

**Core rules**
- Realistic, never blocky (Section 3). Big shapes are modelled; small detail goes in textures.
- Humans look **hand-made and worn**: soft cloth, leather, tape, patches. Husks look **machined**: smooth plates, symmetry, precise seams.
- Nothing is clean, nothing is new ("Everything remembers").
- Only Husk eyes glow red. The Diver shows no light except the neutral-white headlamp at night (Section 2).
- No Husk plating on the Diver or traders: cloth = person, machined metal = Husk.

### 5.1 The Diver

**Who they are:** a scavenger who lives on what they bring back. Everything they wear or carry was found, swapped or fixed. Nothing matches, nothing looks like an army uniform.

**Body:** realistic adult proportions, about 1.8 m (Section 8). Face neutral and tired; it's mostly seen from behind, so it gets the least attention.

**The back matters most.** The camera sits behind the shoulder, so the player mostly sees the pack, the back of the hat or hair, and the back of the shirt. Spend the detail there.

| Gear every Diver has | Look |
|---|---|
| Backpack | Big, patched canvas; taped straps; things tied on. Gives the top-heavy outline (Section 3) |
| Shield pack | Bevelled metal case on the pack, scratched and stickered. Doesn't glow (the hit ripple is Section 4's) |
| Belt and pouches | Mismatched pouches, one different from the rest |
| Boots | Worn, scuffed and caked; with every trouser option |
| Gloves | Work gloves, fingertips worn through |
| Headlamp | Strap over the hat or hair; neutral white, night only |

| Wardrobe piece | Look | Outline / colour |
|---|---|---|
| Field Jacket | Canvas work jacket: chest pockets, hem close over the hips, scarf round the neck that doubles as a dust mask | Fuller upper body. Colour changes to faded rust ~`#8e7360` (was bright orange `0xc4672f`, ~76% saturated, too close to Eye Red and Lamp Amber) — author decision 2026-10-30 |
| Work Tee | Thin faded short-sleeve tee; Sanctuary patch faded to near grey; sweat and dust stains | Slimmer upper body; bare dusty forearms with small scrapes |
| Cargo Pants | Olive-grey, tucked into boots, bulging thigh pockets, knees worn pale or patched | Full legs |
| Utility Shorts | Cut-off, rolled cuffs, frayed edges | Bare shins. Colour ~`#6b5e4a` (was `0x6b5a42`, just over 35%) |
| Work Cap | Stiff brim, sweat-stained band, brim edge worn pale | Small point at the front of the head |
| Boonie Hat | Soft wide brim that droops; dust in the folds | Widest head outline |
| No hat | Bare head; dust in the hair | Smallest head |
| Short Crop | Short, choppy, a bit uneven, like a home cut | Tight round head |
| Ponytail | Tied with a scrap of cord; through the cap's back gap or under the boonie | A tail behind the head, which the camera sees clearly |

- All combinations must look right: no hat or hair poking through, scarf sits over either shirt's collar.

| Wear layer | Where | Always? |
|---|---|---|
| Dust | Heaviest on boots, shins, knees and hem; light on shoulders, hat brim, pack top | Yes |
| Sun fade | Shoulders, back, hat top | Yes |
| Use wear | Shiny or bare on strap edges, weapon grip, pocket lips | Yes |
| Repairs | Stitched tears, taped straps, mismatched patches | Yes |
| Damage | Small scorch on sleeves, torn fabric, scraped pack corners | Yes, kept small |

- **Dust is set by the map you drop into** (author decision, 2026-10-30): Dust Storm heaviest, Golden Hour standard, Night Raid lighter but damp. One dust-amount setting on the Diver's clothing and gear materials, chosen at deploy; no build-up during a raid.
- The Diver brings this wear into the Sanctuary (Section 2, extraction return): there, the Diver is the dustiest, palest person in the room.
- Wear is baked into textures. No decals on moving characters, because they slide over the mesh (technical-artist to confirm).

| Material (Section 8: 40k tris, 3 materials) | Holds |
|---|---|
| Clothing | All shirts and trousers, one shared 2048 set |
| Gear | Pack, shield pack, belt, boots, gloves, headlamp (2048) |
| Head | Skin, hair, hats (1024) |

- Names follow `char_diver_[part]`, e.g. `char_diver_jacket`, `char_diver_boonie`.

### 5.2 The traders

The traders are Divers too, retired or between dives (author, 2026-10-30): each keeps one sign of it, such as a faded dive patch, an old pack hung behind the counter, or a healed scar. Seen only in the Sanctuary, behind their counters under warm lamps. Their wear is Sanctuary wear (soot, damp, oil, mended cloth), not topside dust. They don't wear packs or carry weapons. Each has a different **brightness** (dark, light, middle), so they read apart in black and white too (P2).

| | Tobias, gunsmith | Nia, medic | Pell, buyer |
|---|---|---|---|
| Outline | Wide, square shoulders | Tall, narrow | Round, stooped |
| Clothing | Heavy leather apron over a work shirt, sleeves rolled, thick forearms | Long close-fitting coat to the knees, sleeves pushed up, hair wrapped back, cross-body satchel strap | Layers: coat over padded vest over knits; knitted scarf and beanie; fingerless gloves |
| Brightness | **Dark**: brown leather, charcoal | **Light**: bone and pale sage-grey | **Middle**: faded mustard-olive, patchwork |
| Signature prop | Magnifier goggles pushed up on his forehead | Hand-stitched canvas medic satchel with a bone-white stitched patch (**no red cross**: legally protected, and red means "Husk") | A hanging spring scale for weighing loot, and a battered ledger |
| Wear | Oil, soot, small burn holes, metal filings | Stained cuffs, many mends; hands kept clean | Grime, lint, frayed knits, patched elbows |
| Idle | Working at his bench, cleaning a part | Sorting and rolling bandages | Weighing items, writing in his ledger |

- Seen face-on and up close: faces and hands get more detail than the Diver's.
- Budget (Section 8): 30k tris, 3 materials (clothing, head, prop). Clothing under 35% saturation; the lamps provide the warmth.

### 5.3 Telling them apart at a glance

| Who | Where | Outline | Colour and material | Light | Movement |
|---|---|---|---|---|---|
| Diver | Everywhere | Upright human, top-heavy pack | Dusty, pale, faded cloth | Headlamp at night only | Weighty, human |
| Traders | Sanctuary counters | Wide / tall / round, no pack | Cloth, warm-lit, dark / light / middle | None of their own | Small work loops in place |
| Skitter | Topside | Low, flat, splayed legs | Husk Slate plates, pale bare edges | One red eye, front | Quick bursts, then freeze |
| Buzzer | In the air | Small, pointed, side thrusters | Slate | Red eye on the nose | Hovers, banks, darts |
| Watcher | In the air | Round, plus its beam | Slate | Red eye that is also its lamp | Slow drift, steady sweep |
| Pouncer | Topside | Heavy crouched shell | Thick slate armour | Red core on top | Still, then a coiled leap |
| Warden | The plaza | Towers over the Diver, wide shoulders, twin guns | Heaviest plating | Red core on its back | Slow, heavy steps |

- **Human = soft, uneven, no glow. Husk = hard, symmetrical, one red light.**

### 5.4 Husk design

| Part | Made in (Crucible Works) | Look |
|---|---|---|
| Hull plates | Casting Hall | Smooth layered slate plates, precise seams, pale bare-metal edges `#7c858f` |
| Eye / sensors | Optics Lab | One glass lens in a machined ring |
| Legs and joints | Actuator Works | Clean pistons and joints, tight fit, no loose cables |
| Core | Core Assembly | The glowing critical spot (Pouncer, Warden) |

- Salvaged human parts only as small detail **inside** gaps and joints (an old cable, a cast-over stamp): "the Network uses our things" (Section 6). Never on the outline, never rust: Husk metal wears with scorch and heat marks.

| Scar kind (P1) | Looks like | Made as |
|---|---|---|
| Battle wear | Scorch, dents, heat tint | Baked into the shared hull texture |
| Repairs | Clean replacement plates, neat welds, slightly newer surface | Scar add-on object |
| Learned changes | Eye shutters (a plate partly over the eye); extra plating where Divers hit most | Scar add-on object |

- At most 3 scar add-ons per Husk (`_scar_01`–`03`), sharing the hull material, inside the outline, at most one lopsided (Sections 3 and 8). Each raid can switch them on or off: a more scarred Husk reads as "it has met Divers like you".
- Husk repairs always look neater than human ones.
- Eye: one per Husk, always Eye Red `#ff4a2a`, always the brightest point (P1). State by brightness, size and glow, never colour (Section 4). Own object and material (`mat_husk_eye`), no LOD, visible to the Husk's sight range (Section 8). A shutter covers at most half the eye. No other red light on a Husk.

### 5.5 Pose and movement

| Who | Style |
|---|---|
| Diver | Realistic and weighty: weight shifts with each step, the pack bounces a little, leans into turns. Under a heavy load, lower and bent forward (suggestion for the animator) |
| Traders | Relaxed and human: small work loops, the odd glance up at the Diver. Never stiff |
| All Husks | Mechanical and precise: perfectly still between moves, fast exact turns, no human gestures. **The eye moves first**: it turns to you, then the body follows |
| Skitter | Quick insect-like steps, then freeze |
| Buzzer | Small hover corrections, sharp banks |
| Watcher | Smooth slow drift, the beam sweeping in even arcs |
| Pouncer | Long stillness, a visible coil, then the leap and a heavy landing |
| Warden | Slow heavy steps; upper body and guns turn separately from the legs |

### 5.6 How much detail survives at game distance

The raid camera is ~3.6 m behind the Diver; at 1080p the Diver is ~370 px tall, 1 cm ≈ 2 px. The Sanctuary camera's narrower view makes characters ~1.6× larger.

| Distance | What reads | Made with |
|---|---|---|
| Far (Husk sight range) | Outline and the red eye only | Model shape, eye glow |
| Middle (Diver on screen, traders from the doorway) | Clothing pieces, colour blocks, pack, pockets, where dust sits | Model shape and colour texture |
| Near (traders at the counter, the mirror) | Stitches, tape, buckles, fabric weave | Normal and colour textures only |

- Anything the player must notice on the Diver: at least ~3 cm (~6 px).
- Husk eye glow sized to read at the Husk's sight range (starting values, check in Godot): Skitter (16 m) ≥ ~12 cm; Buzzer and Pouncer (26 m) ≥ ~21 cm; Warden (38 m) ≥ ~31 cm.
- At distance (Section 8): Diver and traders lose straps first, never the head, hat or pack outline; Husks never lose outline, eye or outline-changing add-on.

## 6. Environment Design Language

**Core rules**
- Every place has a past, in three visible layers: **who built it → what
  happened to it → who uses it now.**
- Realistic, not blocky: rounded edges, real wall thickness, broken edges with
  jagged detail (Section 3).
- Main shapes stay simple and easy to read; fine detail goes in textures and
  small props (P2).
- Warm light only in the Sanctuary. Topside and Husk spaces stay cold or harsh (P3).

### 6.1 How places are built, and why

| Place | Who built it, then what happened | What it looks like |
|---|---|---|
| **Sanctuary** | A mining company dug it. It was abandoned, then survivors moved in and built a town inside. The Husks once nearly broke in. | Old mine parts underneath (rock walls, timber supports, cart rails, ventilation pipes). Survivor additions on top (plank walls, salvaged doors, painted signs, string lights, neon). Nothing matches, everything is repaired. One collapsed, sealed-off tunnel with scorch marks shows the break-in that almost happened (author decision, 2026-10-30). |
| **Dustline town** | A normal crossroads town. Wrecked in the fall, then held by the Husks for years. | Ordinary buildings (shops, houses, gas station) cracked, roofless and boarded up. Husk changes on top: machined plates over doorways, cables through windows, useful parts stripped out. |
| **Container yard** | A shipping depot, abandoned, then used as Husk storage. | Stacked, dented containers. Some opened neatly, as if by a machine; some sorted into rows that are too tidy. |
| **Refinery** | An industrial plant. It burned, and the Husks partly restarted it. | Tanks, pipes and towers with scorch and rust. A few lines freshly patched with clean Husk metal: a working part inside a dead plant. |
| **Crucible Works** | A human factory the Husks turned into their own. | Old brick and steel at the edges; the deeper you go, the cleaner, more symmetrical and machined it gets. The middle is fully Husk-made. |
| **Diver camps** | Built by Divers passing through; most overrun or left. | Tarps, crates, sandbags, sleeping rolls, built in a hurry and lopsided. Fires are cold ash (no warm light topside). |
| **Bulwarks / Cradles** | Built by Husks from scratch. | Smooth curves, symmetry, layered plates (Section 3). Patches and reinforcement show where Divers attacked (P1). |

Quick test: human-made looks put together by hand (crooked, mismatched,
patched); Husk-made looks manufactured (smooth, symmetrical, precise). In a
Husk-held human place both show, and the Husk parts are the newer layer.

### 6.2 Textures and materials

**Why realistic materials (PBR):** each surface is described the way the real
material behaves (how rough, whether metal, its colour), so one set of
textures looks right in Golden Hour, Night Raid, Dust Storm and Sanctuary
lamplight. Hand-painted textures would need repainting per condition and
fight the gritty style. Godot's standard material (StandardMaterial3D) runs
this well in the Forward+ renderer.

| Texture | What it does |
|---|---|
| Colour (albedo) | Base colour with wear painted in; below ~35% saturation (Section 4) |
| Roughness | Shiny vs dull: worn edges shinier, dust dull |
| Metal | Metal or not; rust counts as not metal |
| Normal | Small bumps (dents, grain, weld seams) without extra polygons |
| Ambient occlusion (AO) | Dark dirt in corners and cracks, baked in Blender |

**Wear layers, in order** (made in Blender, baked into the textures)
1. Base material: clean timber, steel, brick, concrete, Husk plate.
2. Age: fading, stains, rust spreading from bolts and joints.
3. Damage: chipped and bare-metal edges, cracks, dents, scorch.
4. Repair: patches, welds, new nails, tape, fresh paint over old (human);
   clean replacement plates (Husk).
5. Dirt by place: dust on top surfaces and wall bottoms topside; soot and damp
   in the Sanctuary's corners and ceilings.

**Rules**
- Dirt follows gravity and use: dust sits on top and in corners, worn away
  where hands and feet touch.
- One-off detail (a stain, a bullet hole, a sign) goes on Godot decals
  (Forward+ supports them), or on flat see-through cards where a decal would
  spread onto the wrong surface.
- One shared material set per surface type (timber, rock, steel, concrete,
  Husk plate), varied by wear level. No unique texture per object.
- Husk metal wears with scorch and heat marks, not rust; bare edges are Hull
  Edge Wear `#7c858f`.
- Texture sizes and polygon limits: Section 8.

### 6.3 How full each area is

- **Sparse:** few props, lots of open floor. **Medium:** props along the walls,
  the middle clear. **Dense:** props everywhere, only the walking path clear.
- Always: the walking path and anything you interact with (counters, benches,
  lift, loot) stay clear. The background can be busy; the path can't (P2).

| Area | How full | Main focus | Story it tells |
|---|---|---|---|
| Your quarters | Medium | Stash locker, weapon rack | One person lives here: bedroll, a few personal things, gear being repaired |
| Hallway | Sparse | The lift at the east end | Cart rails, a sagging string-light line and lit doorways lead the eye east |
| Trade Hall | Dense | The three traders' counters | A busy market: crates, goods stacked high, signboards; each counter shows its trader |
| Workshop | Dense | The 7 benches, each easy to tell apart | Tools hung up, offcuts, parts bins; the salvage bench among heaps of broken gear |
| Checkout | Medium | The drop-preview screen | A sign-out desk: logbook, pinned maps, a list of names (some crossed out) |
| Lift | Sparse | Lift cage, teal beacon | Old mine machinery, heavy cables, hand-painted warnings, cold light from above |
| Dustline town | Medium | Cover, openings, loot | Rubble, wrecked cars, boarded windows, things people left behind |
| Container yard | Medium-dense | Container lanes, open containers | Stacks make lanes; a few rows too neat (Husk sorting) |
| Refinery | Dense background, sparse routes | Walkways, ladders | Pipes and tanks make the skyline; ground routes stay open |
| Crucible Works | Dense and orderly | Production lines, exits | Tidier and more machined the deeper you go; no human mess in the middle |
| Diver camps | Sparse-medium | The loot cache | Left in a hurry: tipped crates, cold fire, torn tarp, a dropped pack |
| Bulwarks | Sparse inside the rings | The spire | Barricade rings, scorch and patches where Divers attacked |
| Cradles | Sparse | The pod ring | Pods in neat, dim clusters, nothing else nearby |

### 6.4 Telling the story without text ("Everything remembers")

- **Show the cause, not just the damage:** a scorch mark on the road next to
  the burnt car; a broken crate behind the bullet hole.
- **Every human area shows "people lived here":** a mug, a photo, a child's
  drawing, tally marks, a name painted on a locker.
- **Every Husk area shows "they learned":** a plate added where Divers shot
  before, a doorway sealed where Divers got in, wreckage cleared away tidily.
- **Repairs show who made them:** human repairs uneven and improvised; Husk
  repairs clean and exact.
- **Paths of use:** worn floors, faded trails, polished rails and handles.
- **Never say it outright:** no notes explaining the story; at most a scrawled
  word on a wall.
- **One clear story per spot**, small and off the main path, never competing
  with threats, loot or exits (P2).

| Detail | What it means |
|---|---|
| Tally marks, crossed-out names | People counting days and losses |
| Boarded windows with machined plates over them | People held out here; the Husks took it anyway |
| Neatly cut-open containers or cars | Husks stripped it for parts |
| Fresh Husk metal on an old human machine | The Network is using our things |
| Patches on a Bulwark facing a common Diver approach | The Husks reinforced the side Divers keep hitting (P1) |
| Cold camp with gear left behind | Divers who didn't make it |
| Sanctuary: repairs on top of repairs | People have survived here a long time |

### 6.5 Sanctuary first: Blender checklist

**Every room**
- [ ] Realistic main shapes: rounded edges, real thickness, no plain boxes.
- [ ] Timber posts and beams slightly out of line; rock arches uneven.
- [ ] Two clear layers: old mine underneath, survivor build-out on top.
- [ ] Materials from the shared set (rock, timber, steel, cloth, painted plank)
      with wear layers 1–5.
- [ ] Soot and damp in corners and along the ceiling; worn shiny spots where
      people touch things.
- [ ] Warm lamps (2400–3200K), brown shadows, never black (Section 2).
- [ ] Walking path and interact spots clear; one obvious main focus.
- [ ] At least one small "people live here" detail.
- [ ] Somewhere off the main path: the collapsed, sealed-off tunnel where the
      Husks nearly broke in (scorched rock, a barricade of timber and scrap,
      old repairs over it). Warm lamps nearby so it stays inside the safe space.
- [ ] Checked in Godot (Forward+ renderer) with a screenshot in
      `production/qa/evidence/`.

**Room by room**
- [ ] **Quarters:** locker and rack stand out; bedroll, a personal item, a gear
      repair in progress.
- [ ] **Hallway:** rails and sagging string lights lead to the lift; every door
      a warm lit rectangle; little clutter.
- [ ] **Trade Hall:** three counters recognisable from the doorway (Tobias:
      tools and guns; Nia: medical supplies and satchels; Pell: stacked
      crates); painted signboards; the busiest room.
- [ ] **Workshop:** 7 benches, each with its own tools; salvage bench among
      broken gear; dense, but clear in front of each bench.
- [ ] **Checkout:** sign-out desk, logbook, pinned maps; the drop-preview
      screen is the focus.
- [ ] **Lift:** heavy old mine machinery and cables, teal beacon, a thin slice
      of cold daylight from above (the only cool light in the Sanctuary).

## 7. UI/HUD Visual Direction

[To be designed] — diegetic versus screen-space HUD, typography (personality,
weight, size hierarchy, minimum readable size), iconography style, UI animation
feel, and any art-direction versus readability conflict and how it was decided.

## 8. Asset Standards

These are hard limits: a new or reworked asset that breaks one goes back
before it is merged. All numbers proposed and approved 2026-10-30. Items
marked **[unverified 4.7]** come from older Godot knowledge and need checking
in the 4.7 editor.

**Guiding rules**
- Realistic, bevelled models, never blocky (Section 3). Fine wear and detail
  go into textures, not extra triangles.
- Husk outlines survive every level of detail (P2): losing small detail is
  fine, losing the outline is not.
- Everything is built in real-world metres.

### 8.1 Target hardware and frame budget

Scrapfall ships as a downloaded Windows desktop game on the **Forward+**
renderer on every tier. No web build.

| Tier | Hardware | Resolution | Target | Frame time |
|---|---|---|---|---|
| **Low (minimum)** | GTX 1050 Ti / RX 570 class, 4 GB graphics memory | 1080p; 3D drawn at 67–75% and upscaled with FSR [unverified 4.7] | 30+ fps | ≤ 33 ms |
| **High (recommended)** | GTX 1060 class (6 GB) | 1080p native | 60 fps | ≤ 16.7 ms |

- **The minimum spec must be confirmed on real hardware** with a test scene at
  these budgets before art is locked to them.
- Laptop integrated graphics (Iris Xe, Vega 8) is not supported.
- Windows draws through D3D12 by default (since Godot 4.6, per the engine reference).

| Feature | Low | High | Source |
|---|---|---|---|
| Sun shadow splits | 2 | 4 | |
| Lamp shadow atlas | 2048 | 4096 | [unverified 4.7] |
| SSAO (corner shadows) | Half resolution | Full | [unverified 4.7] |
| SSIL, SSR (bounce light, screen reflections) | Off | On | SSR overhauled in 4.6 (reference) |
| Volumetric fog (Dust Storm, mine haze) | Off; plain depth fog | On | [unverified 4.7] |
| SDFGI (outdoor bounce light, Dustline) | Off | On | [unverified 4.7] |
| VoxelGI (indoor bounce light, Sanctuary) | Off; flat ambient | On | [unverified 4.7] |
| Anti-aliasing | FXAA | SMAA (4.5, reference) or MSAA 2x | |
| LOD bias | Coarser: about half the High triangles | Default | |

- Always on, both tiers: decals; reflection probes (one per Sanctuary room, so
  metal reflects the room, not the sky) [unverified 4.7]; occlusion culling
  (OccluderInstance3D, baked per district) [unverified 4.7]; Shader Baker
  (4.5, reference) so a material seen for the first time doesn't stutter.
- AreaLight3D is new in 4.7 (reference) but its cost is undocumented: High
  only, hero shopfronts only, after a test.

### 8.2 File formats

| What | Format | Rule |
|---|---|---|
| Source model | `.blend` | **Outside this repo** (shared drive or separate art repo). One asset or kit per file; high-poly bake source in a `_high` collection. |
| Game model | `.glb` | The only model format handed to Godot. |
| Texture source | `.psd` / `.kra` / `.spp` | **Outside this repo**, next to the `.blend`. |
| Game texture | `.png`, 8-bit, power of two | Colour maps sRGB; data maps (normal, ORM) linear. Separate files, never embedded in the `.glb`. |
| Normal maps | OpenGL (green up) | Never DirectX; in Substance pick the "OpenGL" preset. |

- Maps per material: `albedo`; `normal`; `orm` (R = ambient occlusion,
  G = roughness, B = metallic, the glTF layout) [verify in the 4.7 import
  dialog]; `emissive` only for Husk eyes, the lift beacon, lamps and neon.
  Transparency only for grass, foliage, chain-link and cloth tatters.
- Godot import: every 3D texture "VRAM Compressed", high quality, mipmaps on;
  normal maps imported as normal maps, ORM as linear. Never "Lossless" (an
  uncompressed 2048 texture uses ~21 MB of graphics memory instead of ~5.6 MB).

### 8.3 Naming

- Lowercase snake_case, two-digit variants: `[category]_[name]_[variant]`,
  e.g. `prop_barrel_02`.
- Prefixes: `char_` (Diver, traders), `husk_`, `wpn_`, `prop_`, `env_`
  (modules, rock, terrain), `dbr_` (debris), `hb_` (Husk-built), `dcl_`
  (decals), `veg_`.

| Inside the `.blend` | Pattern | Example |
|---|---|---|
| Object | prefix + name + part | `husk_skitter_body` |
| Collision | ends in `-colonly` / `-convcolonly` | `prop_crate_01-colonly` |
| Armature | `rig_[name]` | `rig_diver` |
| Animation action | `[name]_[action]_[nn]` | `diver_run_01` |
| Material | `mat_[surface]_[variant]` | `mat_rust_02` |
| Texture | `[material or asset]_[map].png` | `mat_rust_02_orm.png` |
| Bake helper | ends in `_high` | |
| Hand-made LOD | ends in `_lod1`, `_lod2` | |

- The Husk eye is always its own object and material (`mat_husk_eye`) so the
  game drives its brightness.
- Adaptation add-ons (patches, plates, eye shutters) are separate objects
  `_scar_[nn]` so each raid can show or hide them: at most 3 per Husk, sharing
  the hull material.
- Existing exports are renamed only when each one is reworked: a rename
  breaks scenes, so a programmer updates them at the same time.

### 8.4 Triangle and material budgets

Triangles counted after triangulation. Vertices ≤ 1.5 × triangles per mesh.
LOD0 is the full-detail model; LOD1/LOD2 are shown further away.

| Category | LOD0 max | LOD1 / LOD2 | Materials max |
|---|---|---|---|
| Diver | 40k | 15k / 5k | 3 |
| Trader | 30k | 12k / 4k | 3 |
| Small Husk (Skitter, Buzzer) | 8k | 3k / 1k | 2 (hull + eye) |
| Medium Husk (Watcher, Pouncer) | 15k | 6k / 2k | 2 |
| Large Husk (Warden) | 50k | 20k / 6k | 3 |
| Weapon in hand | 12k | 4k | 2 |
| Small prop | 3k | auto LOD, then hidden | 1 |
| Medium / large prop (car, container) | 15k | auto LOD | 2 |
| Husk-built (Bulwark, Cradle) | 35k | auto LOD | 2 |
| Environment module | 10k | auto LOD | 3 |
| Assembled building | 60k | | |
| Debris | 500 | none; hidden past 30 m | shared atlas |
| Terrain chunk (~64 m) | 50k | auto LOD | 1 (blended layers) |

| On screen | High | Low |
|---|---|---|
| All Husks | 250k triangles | about half |
| Whole Sanctuary view | 800k | about half |
| Whole Dustline view | 1.5M from the camera, 3M with shadows | about half |

- Draw calls: each material slot on each mesh is one draw, repeated in every
  shadow pass (a shadowed omni light up to 6 times). Forward+ does not merge
  separate meshes for you [unverified 4.7].
- Budgets per frame including shadows (Debugger → Monitors): High Dustline
  ≤ 2,000, Sanctuary ≤ 1,200; Low about 1,000 via shorter view ranges and
  fewer shadow splits.
- Unique materials: ≤ 80 per level.
- Merge static meshes sharing a material within 25–50 m areas; MultiMesh for
  repeats (bushes, sleepers, bulbs). Never merge across a whole district
  (worse culling, LOD and occlusion).

### 8.5 Textures

- Density: 1024 px/m for the Diver, traders and weapons; 512 px/m for the
  world. Hard cap 2048 × 2048, powers of two only.

| Asset | Texture sets |
|---|---|
| Diver | 2048 body + 2048 gear (+ 1024 head), 2–3 materials |
| Traders | 2048, ~1024 px/m |
| Weapons | 2048 big guns, 1024 small ones |
| Warden, Pouncer | 2048 at 512–1024 px/m, hull + eye |
| Skitter, Buzzer, Watcher | 1024 |
| Husk eye | 256 or a solid colour |
| Large props | 2048, or tiling + trim sheet |
| Small props | 1024, ~512 px/m |
| Environment modules | shared 2048 tiling sets + 2048 trim sheet |
| Rock | 2048 tiling + 1024 colour map |
| Debris | 512 shared atlas |
| Decals | 1024 atlas |
| Vegetation | 1024 atlas |

- At 512 px/m a 2048 tile covers only 4 × 4 m, so buildings must use shared
  tiling materials and trim sheets, with wear layered on by decals,
  vertex-colour masks and detail maps. No unique building textures.

| Graphics memory per loaded level (4 GB minimum card) | Budget |
|---|---|
| Textures | ≤ 1.5 GB (~90 full 2048 sets, characters, Husks and weapons included) |
| Meshes | ≤ 300 MB |
| Total | ≤ 3 GB |

- A full 2048 set (colour + normal + ORM) is ~14–17 MB; a 1024 set ~4 MB.
- Godot 4 has no texture streaming, so Low cannot shrink what a level loads
  [unverified 4.7].

### 8.6 Lights (Sanctuary lamps stay live)

- Forward+ sorts lights into screen tiles: no per-mesh limit. The cap is per
  view, shared by lights, decals and reflection probes
  (`max_clustered_elements`, default 512) [unverified 4.7]. The cost is how
  many lights overlap the same pixels and how many cast shadows.

| Rule | High | Low |
|---|---|---|
| Live lights visible in the Sanctuary | ≤ 64 | ≤ 32 |
| Lights reaching any one spot | ≤ 6 | ≤ 4 |
| Shadow-casting lamps on screen | ≤ 4 | 1 |
| Soft shadows (light size > 0) | Hero lamp only | Off |

- String lights: one real light per 4–6 bulbs; bulbs are emissive and glow
  adds the halo.
- Light range as short as the look allows: bulbs and vanity lights 2–4 m,
  shop lamps 6–9 m.
- Distance fade on every lamp: light gone by ~25 m, shadow by ~12 m (the
  Sanctuary fog ends at 30 m).
- Prefer spot lights to omni; only lamps that matter for gameplay or framing
  cast shadows.
- Bounce light: VoxelGI on High, using the live lamps [unverified 4.7 cost].
- Topside: sun + sky, shadows to 140 m; the Night Raid headlamp is one
  shadowed spot light; muzzle flashes and explosions are short, unshadowed
  lights.

### 8.7 LOD and view ranges

- Default: Godot's automatic LOD at import [unverified 4.7].
- Hand-made LODs only where auto LOD breaks a Husk outline: separate
  `_lod1`/`_lod2` meshes switched by visibility ranges (Godot does not read
  LODs from glTF) [unverified 4.7].
- What reduces first: Diver and traders lose straps first, never the head,
  hat or backpack outline. Husks never reduce the outline, the eye or an
  outline-changing add-on; the eye mesh has no LOD and stays visible to that
  Husk's sight range (up to 38 m).
- Levels: weapons LOD0–1; large props and modules LOD0–2; small props
  LOD0–1, then hidden.

| Object | Hidden beyond |
|---|---|
| Debris | 30 m |
| Decals and small scatter | 40 m |
| Grass | 50 m (High), 30 m (Low) |
| Small props | 80 m |
| Medium props | 150 m |
| Buildings, terrain, Husk-built | never (fog hides them) |
| Mountains | one far backdrop mesh at the 400 m camera limit |

- Grass, debris and small scatter cast no shadows.

### 8.8 Modelling basics

- 1 Blender unit = 1 m; the Diver is ~1.8 m tall.
- Bevel every visible hard edge: chunky bevels modelled, fine ones baked into
  the normal map. Smooth shading plus weighted normals.
- Front faces Blender −Y (becomes Godot +Z).
- Origins: characters and Husks between the feet; props bottom centre;
  modules bottom corner on the grid; weapons the grip.
- Modules snap to a 1 m grid; wall widths multiples of 2 m (level designer to
  confirm).
- Simple collision is its own `-colonly` / `-convcolonly` object, never the
  full render mesh.

### 8.9 Export (Blender → .glb) and what survives

- glTF Binary; selected objects or the asset's collection only, never `_high`.
- +Y Up on; apply scale and rotation (scale 1, 1, 1); apply modifiers.
- UVs, normals, tangents on; vertex colours off unless used.
- Materials exported, images **not embedded** (textures live in `godot/textures/`).
- Animation on for rigged assets: one clip per action, "Always Sample" on;
  skinning 4 bones per vertex.
- Compression off: Godot does not read Draco; meshopt [unverified 4.7].

| Survives | Lost: bake it, or set it on the Godot material |
|---|---|
| Principled BSDF with plain image textures: colour, metallic, roughness | Procedural textures (Noise, Voronoi, Wave), ColorRamp, math and mix nodes |
| Normal map through the Normal Map node | The Bump node: bake to a normal map |
| Emission and its strength | Displacement, subsurface, transmission, sheen |
| Transparency (blend, alpha clip), double-sided | Mixing two shaders |
| AO through the glTF Material Output node | Unapplied modifiers, geometry nodes |
| Vertex colours (shown as colour automatically: [unverified 4.7]) | Hair and particles: convert to meshes |
| 2 UV maps, armatures, shape keys, animations, unlit materials | Bent normals, specular occlusion (4.5): set in Godot |
| Lights and cameras (retune brightness) | |

- Rule of thumb: if it is not an image plugged straight into the BSDF, bake it.
- Materials map to shared Godot `.tres` files via "Use External" in Advanced
  Import Settings, matched by Blender material-slot names.

### 8.10 The Dustline, split by district

- One `.glb` per district: town, container yard, crashed hull, Crucible Works,
  farmland, refinery. Plus terrain chunks of ~64 m and one mountain backdrop.
- Per file: ≤ 15 MB, ≤ 300k triangles at LOD0, ≤ 25 materials, all shared. A
  district over these splits into numbered parts (`env_dustline_town_01`).
- Inside a district, static meshes merge by material within 25–50 m areas.
  Each district gets its own occluders.
- Props, modules and Husk-built pieces stay separate scenes placed as
  instances, never copied into district geometry; repeats use MultiMesh.
- Districts can later load in the background
  (`ResourceLoader.load_threaded_request`) if the map grows.

### 8.11 Where files live, and Git size

| What | Where |
|---|---|
| Exported models | `godot/models/[category]/` |
| Game textures | `godot/textures/[category]/` |
| Godot materials | `godot/materials/` |
| `.blend` and texture sources | Outside this repo (shared drive or separate art repo) |
| Built game (`.exe` / `.pck`) | Never committed; shipped through Releases or a store |

- A model reworked in Blender must be removed from the `tools/export-glb`
  output, or the next `node tools/export-glb/run.cjs` overwrites it.
- Git (cloud sessions can't use LFS): GitHub warns above 50 MB per file and
  rejects above 100 MB, and keeps every committed version in full.
  - No file over 25 MB; each `.glb` ≤ 15 MB; each texture ≤ 8 MB.
  - Commit art at milestones, not on every save.
  - About 3 GB of art in this repo over the game's life (author decision);
    after that, final textures move to the separate art storage. Check with
    `git count-objects -vH`.
- The current `dustline.glb` (50.6 MB) is over GitHub's warning; the district
  split replaces it.

### 8.12 Trade-offs

| Topic | Art ideal | Technical limit | Chosen, and why |
|---|---|---|---|
| Textures in the `.glb` | Embed for one-off assets | Every re-export re-commits them; shared materials need external files | **Always separate files**: committed once, model fixes don't re-commit them |
| Hand-made Husk LODs | Where auto LOD breaks the outline | Godot doesn't import LODs from glTF [unverified 4.7] | **Separate `_lod1`/`_lod2` meshes on visibility ranges** |
| Scar add-ons | Any number, shown per raid | Each object is an extra draw per pass | **≤ 3 per Husk, sharing the hull material** |
| Character texture density | 1024 px/m | 2048 cap | **Kept, by splitting characters over 2–3 texture sets** |
| World texture density | 512 px/m everywhere | 2048 cap; 1.5 GB per level | **Tiling materials, trim sheets and decals; no unique building textures** |
| Sanctuary lamps | Every lamp live | Overlap and shadow cost | **Live, with short ranges, distance fade, ≤ 4 shadow casters (High) / 1 (Low), one light per 4–6 bulbs** |
| Husk eye detail | Readable to its sight range | LOD would shrink it | **Eye mesh excluded from LOD** |

### 8.13 Done checklist (per asset)

- [ ] Named per 8.3; scale 1; origin per 8.8; front faces −Y.
- [ ] Within its triangle, material and LOD budget (8.4, 8.7); vertices ≤ 1.5 × triangles.
- [ ] Textures at their tier (8.5): power of two, ≤ 2048, ORM packed, OpenGL
      normals, separate files.
- [ ] Husk only: eye is its own emissive object; outline intact at every LOD;
      scars inside the outline (≤ 3).
- [ ] Colours within the Section 4 palette and saturation rule; wear present (Section 1).
- [ ] Simple `-colonly` collision where needed.
- [ ] Removed from `tools/export-glb` output if hand-edited.
- [ ] File sizes within 8.11.
- [ ] Checked in Godot under Golden Hour, Night Raid and Dust Storm, with a
      screenshot kept in `production/qa/evidence/`.

## 9. Reference Direction

[To be designed] — 3–5 references (games, films, art styles or artists). For
each: the specific element to take from it, and what to avoid so the result
does not read as a copy.
