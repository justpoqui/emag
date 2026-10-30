# ADR-0003: Save Profiles (No Accounts)

## Status
Accepted

## Date
2026-10-30

## Last Verified
2026-10-30

## Decision Makers
Project owner (chose: no accounts, versioned JSON, keep the mid-raid quit rule, no carry-over); drafted by Claude.

## Summary
The web game saves through username-and-password accounts in browser or Claude-page storage, none of which a Godot build can reach or needs. Decided: no accounts; up to three named local raider profiles, each a versioned JSON file in `user://profiles/`, written safely, cleaned on load to values the game can produce, and owned by the root scene rather than an autoload; closing mid-raid still counts as a lost raid, and web saves do not carry over.

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.7 (editor and CI on 4.7.2) |
| **Domain** | Core |
| **Layer** | Core |
| **Knowledge Risk** | HIGH — 4.7 is post-cutoff |
| **References Consulted** | `docs/engine-reference/godot/VERSION.md`, `breaking-changes.md` (`FileAccess.store_*` return `bool`, line 91), `deprecated-apis.md`, `current-best-practices.md`; `docs/registry/architecture.yaml`; headless probe on the official Godot 4.7.2 binary |
| **Post-Cutoff APIs Used** | None known. `FileAccess.store_string` returning `bool` (4.4) is relied on to detect a failed write. Checked on 4.7.2 Linux (2026-10-30): `user://` maps to the per-app data folder, `store_string` returns `bool`, `DirAccess.rename_absolute` replaces an existing file; `int()` of a float truncates and of a numeric string parses, but `int()` of an Array is a script error that aborts the calling function |
| **Verification Required** | (1) `rename_absolute` over an existing file on **Windows** and **macOS**. (2) How `user://` persists in a **browser** export (not covered by the reference; part of the rendering/export ADR's web spike). (3) The mid-raid rule fires after a killed process, shown by an integration test that saves with `in_raid` set and reloads |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0001 (autoload rule, folder layout, `Events`); ADR-0002 (the root scene that creates `GameData` and calls `setup()`; definitions used to validate item ids and limits). Both must be Accepted first |
| **Enables** | Slice 4 (raid results), slice 5 (hub: stash, traders, wardrobe, pins), the Husk Network's memory between raids |
| **Blocks** | Stories that persist anything between sessions |
| **Ordering Note** | Not needed for slices 1-3; build it at the start of slice 4 |

## Context

### Problem Statement
Everything the player keeps (credits, stash, loadout, level, stats, the Husk Network's memory of them, pinned recipes, outfit) must survive between sessions. The web game does this through `web/src/accounts.js` (556 lines: PBKDF2 password hashes, per-player private storage on the Claude page, an admin account, a bulletin, bans, a login lockout) and `web/src/inventory.js` (profile template, id migration, `sanitize()` clamping). That design answers a shared web page with many players; a Godot build on one device has no server and one person at the keyboard.

### Constraints
- Registry: no autoload beyond `Events` without an ADR (`unregistered_autoload`); game definitions come from `GameData` passed by `setup()` (`game_data_access`); no gameplay literals (`hardcoded_gameplay_values`).
- `raid-loop.md` rule 7: closing the game mid-raid counts as death.
- `husk-network.md`: the network's memory is saved with the profile and clamped on load.
- `web/` is frozen for features, so it cannot gain an export button.
- The game is single-player and offline (`platform.online` not set).

### Requirements
- A crash or power loss mid-write never destroys the previous save.
- A hand-edited or corrupt save loads as the nearest valid profile, never crashes the game and never carries impossible items or numbers.
- Saves from older versions of the Godot build load.
- Profile logic is testable without touching the real `user://`.

## Decision

**No accounts.** There is no sign-in, password, admin role, bulletin or ban list in the Godot version. The player picks or creates one of **three named profiles** on the title screen. Online identity (Steam, cloud saves) gets its own ADR if it comes.

**Files.** Each profile is `user://profiles/slot_<n>.json` (`n` = 1, 2, 3). The store checks those three paths; it never lists the folder.

**Format.** UTF-8 JSON, `snake_case` keys, mirroring the web profile:
```json
{
  "version": 1,
  "name": "Raider",
  "created": "2026-10-30T12:00:00Z",
  "credits": 1200, "level": 1, "xp": 0,
  "stats": {"raids": 0, "extracts": 0, "deaths": 0, "kills": 0},
  "stash": [{"id": "ammo_light", "n": 40}, null, "...80 slots"],
  "loadout": {"weapons": [{"id": "mule", "n": 1, "mag": 18, "dur": 100}, null],
              "shield": {"id": "shield_light", "n": 1, "charge": 40, "dur": 100},
              "bag": ["...16 slots"], "safe": [null]},
  "in_raid": false,
  "network": {"raids": 0, "seen": 0, "...": "see husk-network.md §3.1", "zones": {}},
  "pins": [],
  "outfit": {"shirt": "field_jacket", "...": "..."}
}
```
Slot counts, stack sizes, magazine sizes, shield capacity and the new-profile contents come from `GameData` (`economy_inventory.json`, `economy_items.json`), not from this file or from code.

**Writing.** Serialise to `slot_<n>.json.tmp` (fail if `FileAccess.open` returns null); check every `store_*` result; `flush()` and check `get_error()`, since `close()` reports nothing; close; rename the current file to `slot_<n>.json.bak`; rename the temp file to `slot_<n>.json`. A failed step leaves the previous file or the backup intact and reports an error.

**Loading.** Parse `slot_<n>.json`, falling back to `.bak` if it is missing or unreadable, and to a fresh profile if both fail (the player is told). Then:
1. **Migrate** by `version`, one step per version, so any older Godot save upgrades in order.
2. **Clean** to values the game can produce, as `sanitize()` does today: credits 0-1e9, level 1-999, XP and stats clamped, `extracts ≤ raids`; each stack must name a known item, `n` within its stack size, `mag` within the gun's magazine, `charge` within the shield's capacity, `dur` 0-100; weapon slots hold only weapons and the shield slot only shields; slot arrays padded or trimmed to the configured sizes; pins limited to 6 known recipes; network memory clamped per `husk-network.md`; unknown keys dropped. The limits live in data, per ADR-0002.
Every field is type-checked before it is converted: a value of the wrong JSON type (an array where a number belongs) is replaced by its default, never passed to `int()`. Integer fields (`version`, `credits`, `level`, `xp`, stats, `n`, `mag`, network counters) are converted with `int()` after the check; `charge` and `dur` stay floats, clamped without rounding, as on the web.
3. **Mid-raid rule.** If `in_raid` is true, the raid is lost: the loadout is emptied except the safe slot, a death is counted, no raid XP is awarded (it was never saved), `in_raid` is cleared, the profile is saved, and the result screen says the game closed mid-raid.

**When it saves.** At deploy (after `begin_raid()`, which sets `in_raid` and adds 1 to `stats.raids`, as the web does at deploy), at raid end, after every hub change (buy, sell, craft, repair, salvage, move, wardrobe, pin), and on profile create or rename. Systems that make one of these changes emit `Events.save_requested`; the root scene, which listens, asks `ProfileStore` to save. Nothing during a raid (kills, pickups) requests a save. There is no separate save on quit: the hub has already saved after its last change, and closing mid-raid is meant to lose the raid.

**Ownership.** `Profile` (`src/core/save/profile.gd`, `RefCounted`) holds the live state and is the only writer of it. `ProfileStore` (`src/core/save/profile_store.gd`, `RefCounted`) does file I/O, migration and cleaning; it receives its root directory and `GameData` through `setup()` (the registry's `dependency_injection` stance forbids `_init()` arguments), so tests give it a temporary folder. The **root scene** creates both, alongside `GameData`, and passes them to systems through `setup()`. The root scene stays loaded for the whole session and swaps the title, hub and raid scenes as its children instead of calling `change_scene_to_*`, so no autoload is needed. (ADR-0001's Key Interfaces expected the save ADR might add one; this ADR does not.)

**Swapping scenes.** To change scene the root: (1) removes the current child with `remove_child()` and frees it with `queue_free()`, so the old scene stops processing and emitting `Events` before the new one starts; (2) instances the new scene; (3) adds it with `add_child()`, which runs its `_ready()` while it still has no data; (4) calls `setup(data, profile)` on it, and it passes them on to its systems. This keeps the `data_read_before_setup` stance for every scene, not only the first.

**Web saves.** Not carried over. The web game keeps its accounts and saves while it stays live.

### Architecture Diagram
```
root scene (lives all session)
  |-- GameData       (ADR-0002)
  |-- ProfileStore("user://profiles/") -- load/clean/migrate/save --> slot_<n>.json (+ .bak)
  |-- Profile        (live state; only writer)
  |-- current child scene: Title | Hub | Raid   (swapped by the root)
          systems get setup(data, profile); changes go through Profile methods;
          the root asks ProfileStore to save at the moments listed above
```

### Key Interfaces
```gdscript
class_name ProfileStore extends RefCounted
func setup(root_dir: String, data: GameData) -> void
func list_slots() -> Array[Dictionary]          # [{slot, exists, name, level}] for 3 slots
func load_slot(slot: int) -> Profile            # never null: falls back to .bak, then fresh
func save(profile: Profile) -> Error
func last_load_notes() -> PackedStringArray     # e.g. "restored from backup", "raid lost: closed mid-raid"

class_name Profile extends RefCounted
var slot: int
# state is read through getters; changed only through methods such as
func add_credits(amount: int) -> void
func begin_raid() -> void                       # sets in_raid, adds 1 to stats.raids; caller emits save_requested
func end_raid(extracted: bool, raid_xp: int) -> void
```
`Events` gains `profile_changed()` (no argument, so listeners read the profile they were given in `setup()` instead of receiving a writable one) for UI refresh, and `save_requested()`, which only the root scene handles.

### Implementation Guidelines
- Saves **must** be JSON read and written by `ProfileStore`; code **must never** save or load a profile with `ResourceSaver`/`ResourceLoader` or `store_var`/`get_var` with objects.
- Every write **must** go temp file, then backup, then rename, and **must** check each `store_*` and rename result.
- Every load **must** migrate then clean before any system sees the profile.
- Limits used in cleaning **must** come from `GameData`, never literals.
- Systems **must** change the profile only through `Profile` methods.
- `ProfileStore` **must** take its directory as a parameter; tests **must** use a temporary directory, never the real `user://profiles/`.
- The root scene **must** swap children rather than call `change_scene_to_file` / `change_scene_to_packed`, in the order remove and free the old child, instance, `add_child`, then `setup()`.
- Load cleaning **must** check each value's JSON type before converting it; `int()` **must never** be called on a value that might be an Array or Dictionary.
- Only the root scene **may** call `ProfileStore.save()`; other code emits `Events.save_requested`.

## Alternatives Considered

### Alternative 1: Port username and password accounts locally
- **Description**: Keep sign-in, storing PBKDF2 hashes in `user://`.
- **Pros**: Familiar flow for web players.
- **Cons**: On a single-user device the password protects nothing: anyone at the keyboard can open the files. Adds lockout and hashing code for no gain.
- **Rejection Reason**: Cost without benefit offline.

### Alternative 2: Online accounts and cloud saves now
- **Description**: A backend service holding accounts and saves.
- **Pros**: Cross-device saves; keeps admin and bulletin features.
- **Cons**: Hosting, security and privacy work far bigger than the port itself; the game is single-player.
- **Rejection Reason**: Out of scope until there is a reason (Steam or co-op), which would get its own ADR.

### Alternative 3: Godot Resource saves (`.tres`/`.res`)
- **Description**: Save a `Resource` subclass with `ResourceSaver`.
- **Pros**: Native and typed.
- **Cons**: Loading a resource file can instantiate scripts named in it, so an edited save could run code (general Godot knowledge, not covered by the engine reference). Harder to migrate.
- **Rejection Reason**: Security risk for a file players can edit.

## Consequences

### Positive
- No server, no passwords, no personal data held.
- A crash mid-write cannot wipe a save.
- Edited saves cannot carry impossible values into the game.
- Profiles are fully testable with temporary folders.

### Negative
- Web players start over in the Godot version.
- Admin, bulletin and ban features are gone until there is a server.
- Clamping limits cheating only to "possible" values; a player can still edit their own save, as on the web.
- Three cleaning rule sets (items, stats, network) must track the data files.

## Risks
- **Rename-over may behave differently on Windows or macOS.** Mitigation: verification item (1); if replace fails, delete-then-rename with the `.bak` still present.
- **Browser builds store `user://` differently.** Mitigation: the export ADR's web spike covers it before a Godot web build is published.
- **A crash still costs the raid** (rule 7). Accepted by the owner; `raid-loop.md` keeps crash recovery as an open question.
- **A malformed field crashes cleaning.** `int()` on an Array aborts the function (checked on 4.7.2). Mitigation: type check before every conversion; a fixture with wrong types in every field.
- **A migration bug loses data.** Mitigation: keep the `.bak` file; test each migration step with a saved fixture of the previous version.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| raid-loop.md | Rule 7: closing mid-raid counts as death; results keep only the safe slot | `in_raid` saved at deploy; load applies the loss and notes it |
| economy.md | Stash 80, bag 16, safe 1, credits, stacks, durability, free kit | Saved per profile; sizes and limits from `GameData`; clamped on load |
| husk-network.md | Memory saved with the raider and clamped on load (§3.1, Edge Cases) | `network` block saved and cleaned with the same limits |
| sanctuary-hub.md | Wardrobe outfit and pinned recipes persist | `outfit` and `pins` saved and cleaned |

## Performance Implications
- **CPU**: A save is one small JSON write (a few KB); not measured.
- **Memory**: Negligible.
- **Load Time**: One file parse at profile select.
- **Network**: None.

## Migration Plan
1. Slice 4: `ProfileStore`, `Profile`, cleaning, the mid-raid rule, and the root-scene swap; tests for write safety, `.bak` fallback, cleaning and rule 7.
2. Slice 5: hub changes call `Profile` methods and trigger saves; title screen profile picker.
3. Each future save-format change bumps `version` and adds one migration step plus a fixture test.

## Validation Criteria
- Killing the process between "rename to .bak" and "rename tmp" leaves a loadable profile.
- A save with `"credits": -5`, an unknown item, `"n": 999` of a 5-stack and an extra key loads clamped and clean.
- A save with `in_raid: true` reloads with only the safe slot kept and one more death.
- A save with an array or string in every numeric field loads as a clean profile without a script error.
- Tests never touch the real `user://profiles/`.

## Related
- ADR-0001 Godot port strategy — depends on (root scene, autoload rule)
- ADR-0002 game data format — depends on (definitions, limits, root scene)
- Engine review by godot-specialist (2026-10-30): two blocking issues (`_init` arguments against the registry; no `setup()` order for swapped scenes), both resolved here; `int()` behaviour checked on the 4.7.2 binary
- `web/src/accounts.js`, `web/src/inventory.js` (the behaviour replaced)
- `design/gdd/raid-loop.md`, `economy.md`, `husk-network.md`, `sanctuary-hub.md`
