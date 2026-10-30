# Art Bible: Scrapfall

> **Status**: Draft
> **Owned By**: art-director
> **Last Updated**: 2026-10-30
> **Art Director Sign-Off (AD-ART-BIBLE)**: [Not yet reviewed]

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
- Technical ceiling: Godot 4.7 Compatibility renderer (web export), authored in
  Blender. Wear lives in textures and baked detail, not in expensive real-time
  effects.

## 2. Mood & Atmosphere

**Global rules**
- Compatibility-safe toolkit only: directional light, baked and emissive
  practicals, depth fog, fog colour, sky gradient, tonemap/exposure, particle
  cards, vignette. No volumetrics, SDFGI or heavy post.
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
| Extraction return | Warm 2700K lamplight spilling from the lift doors; 1–2 s overexposed-to-normal ease-in | Soft, high-key | Warm light over dust-caked gear (the raider keeps topside wear) | Low-medium, release |

## 3. Shape Language

**Core rules**
- **No blocky or low-poly geometry.** Models are realistic: bevelled edges, curves, real thickness and fine detail. The shape words in this section (low, tall, round, wide) describe how a thing reads from a distance, not how it is modelled.
- **Human-made looks built by hand:** slightly crooked, sagging, patched, mismatched materials.
- **Husk-made looks machined:** smooth flowing curves, symmetry, layered armour plates, precise seams.
- When a Husk adapts, its surface detail and add-ons change, never its outline (P1 visible adaptation + P2 stable silhouette).
- Test: every character can be told apart by type as a solid black shape 64 px tall. Every Husk can also be told apart in a Dust Storm at the far edge of its own sight range (16–38 m).
- Important things (heroes) have large, clear outlines and high contrast. Everything else is smaller, finer and lower in contrast (P2).

**Characters**
- Raider: realistic proportions, top-heavy outline (backpack, shield pack, weapon). Each hat and hair option changes the head outline. Never mistakable for a trader or a Husk.
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
| Warden | Towering walker with wide shoulders and twin miniguns | Several times raider height | Core on back |

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

[To be designed] — the player character's visual archetype, how players tell
enemies, NPCs and allies apart at a glance, expression and pose style, and how
much detail survives at game camera distance (LOD philosophy).

## 6. Environment Design Language

[To be designed] — architectural style and its tie to the world's culture,
texture philosophy (painted, PBR or stylised, and why), prop density rules per
area type, and environmental storytelling guidelines.

## 7. UI/HUD Visual Direction

[To be designed] — diegetic versus screen-space HUD, typography (personality,
weight, size hierarchy, minimum readable size), iconography style, UI animation
feel, and any art-direction versus readability conflict and how it was decided.

## 8. Asset Standards

[To be designed] — file formats, naming convention, texture resolution tiers,
LOD levels, export settings, and the engine's hard limits (poly budgets per
asset category, texture memory, material slots). Where an art preference and a
technical limit disagree, record both and the trade-off chosen.

## 9. Reference Direction

[To be designed] — 3–5 references (games, films, art styles or artists). For
each: the specific element to take from it, and what to avoid so the result
does not read as a copy.
