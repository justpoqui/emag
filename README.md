# Scrapfall

A standalone third-person **extraction shooter** in the spirit of *Arc Raiders*.
Drop topside into the ruined Dustline, scavenge, fight Husks and get
to a lift before the raid clock runs out. Die and you lose everything you
carried except your safe pocket.

It runs in any modern desktop browser, played with mouse and keyboard. Everything is built from code: the
map, models, UI and sounds (synthesized with WebAudio), so there are no asset
files.

## Play it

Every push to the `3d-shooter` branch builds the game and publishes it to the
`gh-pages` branch. Turn on GitHub Pages once:

1. On GitHub, open the repo's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   pick **gh-pages** and **/ (root)**, and save.
3. After a minute the game is live at **https://justpoqui.github.io/projects/**.

This link is lighter than the Claude page, which runs the game inside
claude.ai.

## Performance

If the game uses a lot of CPU:

1. **Check the browser is drawing on your graphics card.** Open
   `chrome://gpu` (Chrome or Edge). If WebGL says *Software only* or
   *SwiftShader*, turn on *Use graphics acceleration when available* in the
   browser's Settings → System and restart it.
2. **Settings → Frame-rate cap.** 60 by default; 30 halves the work again.
   *Off* draws as fast as your monitor refreshes (144 Hz = 144 frames a second).
3. **Settings → Resolution.** 75% or 60% draws far fewer pixels.
4. **Settings → Graphics.** Low turns off shadows and grass.

Menus and the pause screen always run at 30 fps. *Show FPS* puts a frame
counter in the corner.

## Running it locally

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

## The Sanctuary

Between raids you're in the **Patron's Sanctuary**. The hub screen shows your
stash and loadout on the left and your raider on the right. Press
**EXPLORE THE SANCTUARY** to walk around:

| Where | What's there |
| --- | --- |
| **Your quarters** | The stash locker (stash & loadout). Your second weapon hangs on the rack. |
| **Hallway** | Doors to every room, the lift at the east end. |
| **Trade Hall** | Tobias (gunsmith), Nia (medic) and Pell (buys your loot). Walk up and press E. |
| **Workshop** | One bench per craft: Weapons, Ammo, Shields, Medical, Explosives, Repair and **Salvage** (dismantle items into materials). |
| **Checkout** | Pick your drop, with a live view of it: the Dustline at **Golden Hour** (standard), on a **Night Raid** (more Husks, richer loot, headlamp, Husks see less) or in a **Dust Storm** (short sight for everyone, more loot). |
| **Lift** | Step in and hold E to deploy to the drop you signed out for. |

Tab opens your stash & loadout anywhere; Esc opens the Sanctuary menu.

**Shields** don't refill on their own. Use a Shield Cell: key 4 in a raid, or
right-click your shield (or a cell) in the stash or loadout and pick *Recharge*.

**Dismantling:** right-click an item for *Dismantle*, or use
the Salvage bench. Weapons, shields, consumables, valuables and the rarer
materials break down into basic materials (worn gear gives less).

## The loop

1. **The Burrow (hub)**: manage your **loadout** and **stash**, buy from
   **Tobias** (guns, ammo, grenades) and **Nia** (meds, shields), sell loot,
   and craft at the **Workbench**. If you're broke, take the free kit.
2. **Deploy topside**: everything in your loadout comes with you.
3. **Loot**: hold **E** to search supply crates, lockers, med cabinets, weapon
   cases, car trunks and Husk pods. Items are revealed one at a time. Destroyed
   Husks leave wrecks you can loot too. Each raid puts containers in a random
   set of spots (with a random container type), so caches move between raids.
4. **Extract**: find one of the four lifts (cyan ▲ on the compass, **M** for
   the map). Hold **E** at the call panel. The lift takes 20 seconds to arrive
   and the noise draws Husks in. Once the doors open, step inside and hold **E**.
5. **Die, or still be topside when the 20-minute clock ends**, and your
   loadout is gone. Closing the game mid-raid counts as dying.

## Weight

Every item has a weight (see its tooltip). Past 75% of the 35 kg carry limit
you slow down; over the limit you slow a lot and can't sprint. The bag and the
loadout screen show your total.

## Husks

Skitters, Buzzers and Watchers are **neutral but cautious**. They watch you,
keep their distance and warn you (a chirp and a flare of the eye) if you crowd
them or aim at them. Push it, or shoot one, and they fight, and word spreads
to the Husks nearby. Leave them be and they stand down. Pouncers and Wardens
attack on sight.

Every Husk has one critical spot, its eye. Hits anywhere else do 60% damage.

| Husk | HP | Behaviour | Tip |
| --- | --- | --- | --- |
| **Skitter** | 50 | Small crawler; backs off if you get close, leaps if provoked | The small eye at the front |
| **Buzzer** | 60 | Drone on vectoring thrusters; circles and fires bursts when hostile | The small eye on the nose |
| **Watcher** | 45 | Sweeps a searchlight. It only sees what the light falls on; when hostile it calls in Buzzers | Stay out of the light; the eye is underneath |
| **Pouncer** | 420 | Armored jumper that slams down with a shockwave | Glowing core on top takes extra damage |
| **Warden** | 1400 | Walking fortress with twin miniguns, guards the plaza | Core on its back takes triple damage; bring heavy ammo |

Destroyed Buzzers and Watchers break apart and their pieces fall to the ground.

## The Husk Network

The Husks learn. Every raid they remember what you did to them and where
(`src/network.js`, saved with your account), and it changes them:

- **Disposition:** start fights and they give you more room, lose patience
  faster and stay angry longer; strike first often enough and they shoot on
  sight. Leave them alone and they let you pass closer.
- **Counters:** go for the eye a lot and they fit eye shutters (smaller eye,
  softer crits). Fight up close or with the stick and they keep out of reach.
  Snipe and Buzzers jink. Strip their pods and Skitters guard them.
- **Infrastructure:** over time the network builds topside. **Bulwarks** (a
  sentinel spire inside curved barricades, with a Watcher) go up where you
  fight them; **Cradles** (pod nurseries tended by Skitters, with pods to loot)
  where you don't.

The Raider Log tab shows what the network has learned about you.

## Controls

| Key | Action |
| --- | --- |
| WASD / Shift / Space | Move / sprint / jump |
| C | Crouch (quieter, harder to see, tighter spread) |
| V or Left Alt | Dodge roll (costs stamina, halves damage taken) |
| Mouse / RMB | Shoot / aim down sights |
| R | Reload |
| F | Swing your stick (always carried, no slot, can't be dropped) |
| H or X | Holster / draw your gun (holstered: ~12% faster, and the trigger swings the stick) |
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
    config.js      every item, weapon, shield, Husk type, loot table, trader and recipe (balance here)
    main.js        boot
    game.js        renderer, lighting, raid lifecycle, damage, explosions, interaction, lifts, camera
    world.js       procedural Dustline map (ruined town, container yard, Husk hull, pylons, lifts…)
    collision.js   heightfield terrain + AABB grid: movement, line of sight, bullet raycasts
    player.js      movement, stamina, dodge roll, holstering, weapon models
    rig.js         the raider model (knees and elbows) and its animation
    sanctuary.js   the walkable Patron's Sanctuary (quarters, hallway, Trade Hall, Workshop, Checkout, Lift)
    weapons.js     firing, spread/bloom, recoil, reloads, hit resolution
    enemies.js     Husk models and AI (neutral / wary / hostile)
    network.js     the Husk Network: what they learn about the raider, and what they build
    infrastructure.js  Bulwarks and Cradles topside
    inventory.js   slot inventory helpers and the saved profile
    ui.js          HUD, backpack/loot/map/pause menus, hub tabs, results screen
    effects.js     tracers, sparks, explosions, damage numbers
    audio.js       synthesized sound effects
    input.js       keyboard / mouse / pointer lock
    settings.js    graphics presets, frame-rate cap, resolution scale
    rng.js         seeded RNG and loot rolls
```

## Ideas for next steps

- Squads / co-op and PvP raiders (needs a server).
- More maps and map conditions (night raids, storms).
- Weapon mods and attachments, weapon upgrade tiers.
- Quests from traders; a skill tree.
- Proper character animations and imported models.
- Downed state with self-revive.

## Accounts and security

Players sign in with a username and password. On the Claude page:

- Each player's account (a salted PBKDF2 password hash, never the password)
  and save live under `data/users/<their Claude id>/`. The page's access
  rules make that private to that Claude login: no other player, and not the
  page's owner, can read or change it.
- `registry/<Claude id>` lists the usernames each person has claimed, so names
  stay unique. Everyone can read it; each person can only write their own.
- `admin/*` (who the admin is, Field Bulletin posts, suspended usernames) can
  only be written by the page's owner.
- **Poqui is the admin.** `admin/meta` records which Claude login owns the
  Poqui account, and only the page's owner can write that record, so nobody
  else's Poqui can become admin. The Admin tab only appears for Poqui on that
  Claude login.
- An account made while the online save wasn't available (stored in the
  browser) moves online, with its save, the first time it signs in on the
  Claude page. Username and password stay the same.
- Five wrong passwords lock sign-in for a minute (doubling each time), wrong
  usernames and wrong passwords give the same message, saves are clamped to
  values the game can produce when loaded, and release builds don't expose the
  game object to the browser console.

The game runs in the browser, so a player can still change their *own* game
in their own browser. What the server guarantees is that nobody can reach
anyone else's account or save, or the admin data.

Off the Claude page there is no server: accounts are kept in that browser
only, and Poqui's admin tools only affect that browser.
