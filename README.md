# Scrapfall

A standalone third-person **extraction shooter** in the spirit of *Arc Raiders*.
Drop topside into the ruined Rust Belt, scavenge, fight ARC machines and get
to a lift before the raid clock runs out. Die and you lose everything you
carried except your safe pocket.

It runs in any modern desktop browser. Everything is built from code: the
map, models, UI and sounds (synthesized with WebAudio), so there are no asset
files.

## Running it

```bash
cd shooter
npm install
npm run dev        # http://localhost:5173
```

`npm run build` writes a static build to `dist/`. Serve that folder with any
static file server (`npm run preview`), or wrap it with Electron/Tauri later
for a desktop app.

Click into the game window to capture the mouse. Progress (stash, credits,
level) is saved in the browser's localStorage.

## The loop

1. **The Burrow (hub)**: manage your **loadout** and **stash**, buy from
   **Tobias** (guns, ammo, grenades) and **Nia** (meds, shields), sell loot,
   and craft at the **Workbench**. If you're broke, take the free kit.
2. **Deploy topside**: everything in your loadout comes with you.
3. **Loot**: hold **E** to search supply crates, lockers, med cabinets, weapon
   cases, car trunks and ARC probes. Items are revealed one at a time. Destroyed
   ARC leave wrecks you can loot too.
4. **Extract**: find one of the four lifts (cyan ▲ on the compass, **M** for
   the map). Hold **E** at the call panel. The lift takes 20 seconds to arrive
   and the noise draws ARC in. Once the doors open, step inside and hold **E**.
5. **Die, or still be topside when the 20-minute clock ends**, and your
   loadout is gone. Closing the game mid-raid counts as dying.

## ARC machines

| ARC | Behaviour | Tip |
| --- | --- | --- |
| **Tick** | Small crawler, leaps at you | Strafe or dodge-roll the leap |
| **Pop** | Rolling bomb that beeps then explodes | Shoot it early; it still pops |
| **Wasp** | Armed drone that circles and fires bursts | Its eye is a weak spot |
| **Snitch** | Scout drone; if it watches you for a few seconds it calls in Wasps | Kill it fast or break line of sight |
| **Leaper** | Armored jumper that slams down with a shockwave | Glowing core on top takes extra damage |
| **Bastion** | Walking fortress with twin miniguns, guards the plaza | Core on its back takes triple damage; bring heavy ammo |

## Controls

| Key | Action |
| --- | --- |
| WASD / Shift / Space | Move / sprint / jump |
| C | Crouch (quieter, harder to see, tighter spread) |
| V or Left Alt | Dodge roll (costs stamina, halves damage taken) |
| Mouse / RMB | Shoot / aim down sights |
| R | Reload |
| 1 / 2 / wheel | Switch weapon |
| 3 / 4 | Heal / recharge shield |
| G | Throw a frag grenade |
| E (hold) | Search, call a lift, extract |
| Tab | Backpack (click to use or equip, shift-click for safe pocket, right-click to drop) |
| F | Take everything in the open container |
| M | Map |
| Esc | Pause (sensitivity, volume, abandon raid) |

## Code layout

```
shooter/
  index.html, vite.config.js
  src/
    config.js      every item, weapon, shield, ARC type, loot table, trader and recipe (balance here)
    main.js        boot
    game.js        renderer, lighting, raid lifecycle, damage, explosions, interaction, lifts, camera
    world.js       procedural Rust Belt map (ruined town, container yard, ARC hull, pylons, lifts…)
    collision.js   heightfield terrain + AABB grid: movement, line of sight, bullet raycasts
    player.js      raider model, movement, stamina, dodge roll, weapon models
    weapons.js     firing, spread/bloom, recoil, reloads, hit resolution
    enemies.js     ARC models and AI
    inventory.js   slot inventory helpers and the saved profile
    ui.js          HUD, backpack/loot/map/pause menus, hub tabs, results screen
    effects.js     tracers, sparks, explosions, damage numbers
    audio.js       synthesized sound effects
    input.js       keyboard / mouse / pointer lock
    rng.js         seeded RNG and loot rolls
```

## Ideas for next steps

- Squads / co-op and PvP raiders (needs a server).
- More maps and map conditions (night raids, storms).
- Weapon mods and attachments, weapon upgrade tiers.
- Quests from traders; a skill tree.
- Proper character animations and imported models.
- Downed state with self-revive.
