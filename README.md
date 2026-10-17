# Scrapfall

A standalone third-person **extraction shooter** in the spirit of *Arc Raiders*.
Drop topside into the ruined Dustline, scavenge, fight Husks and get
to a lift before the raid clock runs out. Die and you lose everything you
carried except your safe pocket.

It runs in any modern browser on PC or phone. Everything is built from code: the
map, models, UI and sounds (synthesized with WebAudio), so there are no asset
files.

## Play it (PC and phone)

Every push to the `3d-shooter` branch builds the game and publishes it to the
`gh-pages` branch. Turn on GitHub Pages once:

1. On GitHub, open the repo's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   pick **gh-pages** and **/ (root)**, and save.
3. After a minute the game is live at **https://justpoqui.github.io/projects/**.

Open that link on your PC or your phone.

**On a phone:** play in landscape. For true fullscreen, add it to your home
screen (Safari: Share → *Add to Home Screen*; Chrome on Android: ⋮ → *Add to
Home screen* / *Install app*). It then opens like an app, without the
browser bars. Your progress is stored on each device separately.

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

## The loop

1. **The Burrow (hub)**: manage your **loadout** and **stash**, buy from
   **Tobias** (guns, ammo, grenades) and **Nia** (meds, shields), sell loot,
   and craft at the **Workbench**. If you're broke, take the free kit.
2. **Deploy topside**: everything in your loadout comes with you.
3. **Loot**: hold **E** to search supply crates, lockers, med cabinets, weapon
   cases, car trunks and Husk pods. Items are revealed one at a time. Destroyed
   Husks leave wrecks you can loot too.
4. **Extract**: find one of the four lifts (cyan ▲ on the compass, **M** for
   the map). Hold **E** at the call panel. The lift takes 20 seconds to arrive
   and the noise draws Husks in. Once the doors open, step inside and hold **E**.
5. **Die, or still be topside when the 20-minute clock ends**, and your
   loadout is gone. Closing the game mid-raid counts as dying.

## Husks

| Husk | Behaviour | Tip |
| --- | --- | --- |
| **Skitter** | Small crawler, leaps at you | Strafe or dodge-roll the leap |
| **Buzzer** | Armed drone that circles and fires bursts | Its eye is a weak spot |
| **Watcher** | Scout drone; if it watches you for a few seconds it calls in Buzzers | Kill it fast or break line of sight |
| **Pouncer** | Armored jumper that slams down with a shockwave | Glowing core on top takes extra damage |
| **Warden** | Walking fortress with twin miniguns, guards the plaza | Core on its back takes triple damage; bring heavy ammo |

## Phone controls

| Control | Action |
| --- | --- |
| Left thumb, anywhere on the lower left | Move (push the stick to the edge to sprint) |
| Right thumb, anywhere else | Look |
| FIRE | Shoot. Keep your thumb down and drag to aim while firing |
| AIM | Toggle aim down sights |
| RELOAD / JUMP / CROUCH / ROLL | As on PC |
| USE | Appears near something you can search or a lift; hold it |
| SWAP / HEAL / SHIELD / NADE | Left column |
| ❚❚ / MAP / BAG | Top left |
| Tap an item | Its main action (use, equip, take, load…) |
| Hold an item | Details, plus every other action (safe pocket, drop, sell) |

Bullets get a small aim assist on touch screens. Phones default to **Low**
graphics; change it under **Settings** in the hub or in the pause menu.

## PC controls

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
    config.js      every item, weapon, shield, Husk type, loot table, trader and recipe (balance here)
    main.js        boot
    game.js        renderer, lighting, raid lifecycle, damage, explosions, interaction, lifts, camera
    world.js       procedural Dustline map (ruined town, container yard, Husk hull, pylons, lifts…)
    collision.js   heightfield terrain + AABB grid: movement, line of sight, bullet raycasts
    player.js      raider model, movement, stamina, dodge roll, weapon models
    weapons.js     firing, spread/bloom, recoil, reloads, hit resolution
    enemies.js     Husk models and AI
    inventory.js   slot inventory helpers and the saved profile
    ui.js          HUD, backpack/loot/map/pause menus, hub tabs, results screen
    effects.js     tracers, sparks, explosions, damage numbers
    audio.js       synthesized sound effects
    input.js       keyboard / mouse / pointer lock
    touch.js       on-screen controls for phones and tablets
    settings.js    device detection and Low / Medium / High graphics presets
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
- `admin/*` (Field Bulletin posts, suspended usernames) can only be written by
  the page's owner.
- **Poqui** is the only admin account: the name is reserved for the page's
  owner, and the Admin tab only appears when Poqui is signed in on the owner's
  Claude login.
- Five wrong passwords lock sign-in for a minute (doubling each time), wrong
  usernames and wrong passwords give the same message, saves are clamped to
  values the game can produce when loaded, and release builds don't expose the
  game object to the browser console.

The game runs in the browser, so a player can still change their *own* game
in their own browser. What the server guarantees is that nobody can reach
anyone else's account or save, or the admin data.

Off the Claude page there is no server: accounts are kept in that browser
only, and there is no admin.
