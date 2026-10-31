# Scrapfall — Godot 4.7 port

The Godot version of Scrapfall, a downloaded desktop game (no web build). It is
being ported from the old web game at the repo root, which stays until this
version has raids working and is then removed.

## Open it

1. Install **Godot 4.7** (standard build, not .NET).
2. In the Project Manager, **Import** → pick `godot/project.godot`.
3. The first open imports the models (the Dustline takes a minute).
4. Press **F5**. You start in the Sanctuary.

| Key | Action |
| --- | --- |
| WASD / Shift / Space / C | Move / sprint / jump / crouch |
| Mouse | Look (click to capture, Esc to release) |
| F2 | Switch between the Sanctuary and the Dustline |

## What's here (milestone 1: the look)

| Path | What it is |
| --- | --- |
| `models/*.glb` | Every model from the web game, exported as-is: `dustline.glb`, `sanctuary.glb`, `raider.glb`, `husks/`, `weapons/`. Open them in Blender to rework the art. |
| `models/*_instances.json` + `*_instances/` | Instanced meshes (bushes, rail sleepers, bulbs): one mesh plus a list of transforms, drawn with MultiMeshes. |
| `scenes/sanctuary.tscn`, `scenes/dustline.tscn` | The two levels with the web game's lighting, fog and sky (Golden Hour). |
| `scenes/raider.tscn`, `scripts/raider.gd` | Walkable raider with the over-the-shoulder camera. |
| `scripts/level.gd` | Adds collision to level meshes, builds the MultiMeshes, places the raider. |

The renderer is **Forward+** (desktop only).

## Re-exporting the models

The models are generated from the web game's code. After changing the code,
run from the repo root:

```bash
node tools/export-glb/run.cjs
```

That overwrites `godot/models/`. Once the team starts editing models in
Blender, stop re-exporting those files, or the export will overwrite the edits.

## Rebuilt in Blender

| Room | Built by | Output |
| --- | --- | --- |
| The Diver's quarters | `tools/blender/build_quarters.py` (shared textures from `tools/blender/make_textures.py`) | `models/sanctuary/env_sanctuary_quarters.gltf` + `.bin`, textures in `textures/sanctuary/` |

The web-game export leaves the quarters out of `sanctuary.glb`, so the two
never overlap. The quarters' lamps, reflection probe and glow are set up in
`scenes/sanctuary.tscn` (`QuartersLights`, `QuartersProbe`), not in Blender.

Run the Blender scripts with Blender's Python module (`pip install bpy`):

```bash
python tools/blender/make_textures.py 1024
python tools/blender/build_quarters.py <work dir> --render --export
```

The `.blend` file and preview renders go to `<work dir>`, outside the repo
(art bible 8.11).

## Not ported yet

Gameplay (raids, Husk AI and the Husk Network, weapons, inventory, UI,
traders), the grass and ferns, wind sway, containers and lifts, Night Raid and
Dust Storm lighting, and the raider's animation (`src/rig.js`). Light
brightness and fog density are first matches and still need tuning by eye
against the web game.
