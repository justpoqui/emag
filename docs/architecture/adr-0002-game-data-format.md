# ADR-0002: Game Data Format

## Status
Proposed

## Date
2026-10-30

## Last Verified
2026-10-30

## Decision Makers
Project owner (design and technical authority delegated to Claude on 2026-10-30); drafted by Claude.

## Summary
Every gameplay number in Scrapfall lives in `web/src/config.js` (items, guns, Husks, loot tables, traders, recipes, salvage, drop conditions, player stats), and the Godot port must read the same numbers from data files instead of code. Decided: JSON files in `assets/data/`, one per system table, exported once from `config.js` and then the source of truth, each with a JSON Schema, loaded at startup into typed read-only definitions by a `GameData` object that the root scene hands to each system through `setup()`, never a global.

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.7 (editor and CI on 4.7.2) |
| **Domain** | Core |
| **Layer** | Foundation |
| **Knowledge Risk** | HIGH — 4.7 is post-cutoff |
| **References Consulted** | `docs/engine-reference/godot/VERSION.md`, `breaking-changes.md`, `deprecated-apis.md`, `current-best-practices.md` (Resources section); `.claude/rules/data-files.md`; `docs/registry/architecture.yaml`; headless probe on the official Godot 4.7.2 binary |
| **Post-Cutoff APIs Used** | None known. The engine reference covers only one `FileAccess` change (`store_*` return `bool`, `breaking-changes.md:91`, writing only) and says nothing about reading files, `JSON` or export inclusion. Checked directly on the official 4.7.2 binary (headless, 2026-10-30): `JSON.parse_string` returns integers as `float`; a `StringName` finds a `String` dictionary key; `null` in arrays is kept; `@export` of a `RefCounted` class is a parse error; children's `_ready` runs before the parent's, and the parent's `_enter_tree` before both |
| **Verification Required** | (1) `.json` files under `res://assets/data/` and `res://assets/schema/` are in an exported build — not covered by the reference and not yet tested (no export templates or presets exist); check at the first export and add a non-resource export filter if needed. (2) The loader reads every file and rejects a broken one, shown by a gdUnit4 test that is seen to fail on a bad fixture |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0001 (Godot port strategy) — sets `assets/data/` and the ban on hardcoded gameplay values. Must be Accepted before this one |
| **Enables** | Slice 1 (movement values) and every later slice; the save ADR (saved item stacks refer to definition ids from these files) |
| **Blocks** | Any story that reads a gameplay value, until Accepted |
| **Ordering Note** | Slice 1 writes the export script, the loader and `player_stats.json` only; each later slice exports its own tables when the code that reads them lands (no orphaned entries) |

## Context

### Problem Statement
ADR-0001 forbids gameplay values in scripts and puts game data in `assets/data/`, but leaves the format open. Slice 1 needs player speeds and stamina, and every later slice needs more. The numbers must start out identical to the web game so the port can be checked against it, stay easy to edit and review, and reach code as typed values so mistakes show up at load, not mid-raid.

### Constraints
- Registry stances: `hardcoded_gameplay_values` and `unregistered_autoload` are forbidden; dependencies arrive by `@export` or `setup()` (`docs/architecture/adr-0001-godot-port-strategy.md`).
- Framework data rule: valid JSON, files named `[system]_[name].json`, `snake_case` keys, a documented schema per file, numbers explained in companion docs.
- `web/` is frozen for features, so `config.js` changes only for bug fixes.
- Some values are not in `config.js` but inside logic (`web/src/game.js`, `weapons.js`, `network.js`): container fill 0.6, reinforcement timers 45/50 s, lift-call wave, noise radii, falloff, XP curve, sell curve, Husk Network trait coefficients. The GDD Formulas sections list them.

### Requirements
- Values loaded in Godot equal the web game's at the moment of export.
- A wrong or missing field fails loudly at load and in CI.
- Systems can be tested with small fixture data instead of the real files.
- Definitions are never changed at runtime; per-instance state lives elsewhere.

## Decision

**Format.** Game data is JSON in `assets/data/`, one file per system table:

| File | Contents (from `web/src/config.js` unless noted) |
|---|---|
| `player_stats.json` | `PLAYER`, `CARRY_LIMIT`, `HOLSTER_SPEED_BONUS` |
| `combat_melee.json` | `STICK` |
| `economy_items.json` | `ITEMS` with weights, `RARITY`, `AMMO` |
| `economy_inventory.json` | `BAG_SLOTS`, `SAFE_SLOTS`, `STASH_SLOTS`, `START_CREDITS`, `FREE_KIT` |
| `economy_loot_tables.json` | `LOOT_TABLES`, plus container fill 0.6 (from `game.js`) |
| `economy_traders.json` | `TRADERS`, `BUY_MARKUP` |
| `economy_recipes.json` | `RECIPES`, `BENCH_SECTIONS` |
| `economy_salvage.json` | `SALVAGE` |
| `economy_repair.json` | `MAX_DURABILITY`, `SHIELD_WEAR`, `REPAIR` |
| `husk_types.json` | `ENEMIES`, `SENSE_RADIUS`, `SEARCH_SECONDS`, `LATCH` |
| `raid_rules.json` | `RAID_SECONDS`, `EXTRACT_CALL_SECONDS`, `EXTRACT_OPEN_SECONDS` |
| `raid_conditions.json` | `MAPS` |

Tables whose entries have an id (`ITEMS`, `ENEMIES`, `LOOT_TABLES`, `TRADERS`, `SALVAGE`) are objects keyed by that id. Ordered lists without one (`RECIPES`, `BENCH_SECTIONS`) and `MAPS` (which has ids but whose order is the menu order) stay arrays. The exporter reshapes positional tuples into named objects (a loot entry `[itemId, weight, min, max]` becomes `{"item", "weight", "min", "max"}`), renames `config.js`'s camelCase keys to `snake_case` (`walkSpeed` → `walk_speed`), writes defaults that `config.js` applies in code (`weight` 0.5, `stack` 1) explicitly into every entry, and turns hex colours into `"#rrggbb"` strings. `MAPS` keeps its lighting values under a `visuals` object, separate from the gameplay multipliers; the rendering ADR may move them. Values embedded in JS logic move into the matching file as named tuning values during the slice that ports that logic (for example `husk_network_tuning.json` in slice 3), each with a description pointing at its GDD formula.

**Source of truth.** A Node script, `tools/data-export/export_config.mjs`, imports `web/src/config.js` and writes the files named on its command line, so each slice exports only the tables it reads. From then on the JSON is the source of truth for Godot and is edited directly; the script stays in the repo for traceability and is not re-run unless a `web/` bug fix changes a value both games share.

**Schema.** Each file has `assets/schema/<file>.schema.json` (outside `assets/data/`, so schemas are not mistaken for data files under the framework's `[system]_[name].json` rule), using a subset of JSON Schema: `type` (including `integer` and `null`, alone or in a list such as `["object", "null"]`), `properties`, `required`, `additionalProperties` (for id-keyed maps), `items` (for arrays), `enum`, `minimum`, `maximum`, `description`. Every numeric field's `description` says what it means and names its GDD section, which satisfies the data rule's companion-doc requirement.

**Loading.** `GameData` (`src/core/data/game_data.gd`, `class_name GameData extends RefCounted`) loads a fixed list of file names (no folder listing, so a missing file is an error and nothing depends on listing a folder in an exported build), checks each against its schema, and builds typed definition objects (`ItemDef`, `WeaponDef`, `HuskDef`, `LootTableDef`, and so on, under `src/core/data/defs/`). It fails with a message naming the file, entry and field. Parsed `Dictionary`/`Array` values never leave the loader; definitions hold typed fields, with integer fields converted by `int()` (JSON numbers arrive as `float`) and ids converted to `StringName` once at load.

**Startup order.** The root scene creates and loads `GameData` in its `_enter_tree()`, then in its `_ready()` (which runs after every child's `_ready()`) calls `setup(data)` on each system. Systems do nothing that needs data before `setup()`. `GameData` is passed only through `setup()`: `@export` cannot hold a `RefCounted`. Tests build a `GameData` from fixture files in `tests/fixtures/data/` and call `setup()` themselves.

**Definitions versus state.** Definitions are read-only by convention and are never mutated after load. Per-instance state (stack count, durability, shield charge, magazine) lives in separate instance objects that hold a definition id, which is also what saves store.

### Architecture Diagram
```
web/src/config.js --(export_config.mjs, once)--> assets/data/*.json
                                                  assets/data/schema/*.schema.json
                                                        |
                              root scene: GameData.load_all("res://assets/data/")
                                       | validates against schema, builds typed defs
                                       v
              setup(data) --> player / combat / husks / economy / raid systems
              tests: GameData.load_all("res://tests/fixtures/data/")
```

### Key Interfaces
```gdscript
class_name GameData extends RefCounted
func load_all(data_dir: String, schema_dir: String) -> Error  # fixed file list; validates; FAILED lists errors
func errors() -> PackedStringArray
func item(id: StringName) -> ItemDef           # null-safe lookups; unknown id is an error
func weapon(id: StringName) -> WeaponDef
func husk(id: StringName) -> HuskDef
func loot_table(id: StringName) -> LootTableDef
func player() -> PlayerStatsDef
# ...one typed accessor per table
```

### Implementation Guidelines
- Gameplay code **must** read values only through `GameData` definitions; it **must never** open files in `assets/data/` itself.
- Code **must never** mutate a definition; copy into an instance object instead.
- Every data file **must** have a schema, and every numeric field **must** have a `description`.
- `GameData` **must not** be an autoload or a static global, and **must not** be an `@export`; it is created by the root scene and passed in by `setup()`.
- Systems **must never** read game data in `_ready()` or earlier; they read it in or after `setup()`.
- Untyped `Dictionary`/`Array` from the parser **must not** escape the loader; integer fields **must** be converted with `int()`.
- A data file **must not** be added before code that reads it exists (no orphaned entries).
- The exported build **must** include `assets/data/*.json` and `assets/schema/*.json`; the export filter that does this lives in `export_presets.cfg`, which is currently gitignored, so the rendering/export ADR decides whether presets are committed.
- A schema change that renames or removes a field **must** bump that file's top-level `"version"` and update the loader in the same commit.
- The gdUnit4 suite **must** include a test that loads the real `assets/data/` with no errors, and tests that broken fixtures (missing field, wrong type, unknown id) are rejected.

## Alternatives Considered

### Alternative 1: Godot Resources (`.tres`)
- **Description**: One custom `Resource` per item, gun, Husk and table, edited in the inspector.
- **Pros**: Native, typed, editable in the editor with drag-and-drop references.
- **Cons**: Hard to generate faithfully from `config.js`; editor-written files that should not be hand-edited; noisy diffs; shared nested resources need `duplicate_deep()` (`deprecated-apis.md:33`) to avoid accidental shared mutation.
- **Rejection Reason**: Parity with the web game and easy review matter more now than inspector editing. Typed defs give the type safety; an editor plugin can add inspector editing later.

### Alternative 2: GDScript constants
- **Description**: A `config.gd` with the same tables as constants.
- **Pros**: Simplest; compiled and typed.
- **Cons**: Gameplay values in scripts.
- **Rejection Reason**: Forbidden by the `hardcoded_gameplay_values` stance (ADR-0001).

### Alternative 3: One `game_data.json`
- **Description**: Everything in one file, as in `config.js`.
- **Pros**: One file to load.
- **Cons**: Every balance change touches the same file; no per-system ownership.
- **Rejection Reason**: Per-system files match the framework rule and give smaller diffs.

## Consequences

### Positive
- The port starts with exactly the web game's numbers.
- Bad data fails at load and in CI, not during play.
- Systems are testable with fixture data.
- Balance changes are small, reviewable JSON diffs.

### Negative
- Typed definition classes duplicate each schema's shape in GDScript; both must be kept in step.
- Passing `GameData` through `setup()` adds wiring to every system.
- No inspector editing for data at first.

## Risks
- **JSON files may not be exported by default.** Mitigation: verify at the first export (Verification Required); add a non-resource export filter. Because `export_presets.cfg` is gitignored, a CI export could silently drop the filter; the export ADR must settle where presets live.
- **Integers parse as floats** (checked on 4.7.2). Mitigation: schema `integer` type plus `int()` in the defs; a test asserts an integer field is a `TYPE_INT` after load.
- **The schema subset checker is ours to maintain.** Mitigation: keep it to the listed keywords; test it with broken fixtures.
- **Values hidden in JS logic are missed.** Mitigation: each slice checks its GDD Formulas section against the data files before it counts as ported (ADR-0001).
- **Schema and typed defs drift apart.** Mitigation: the load-everything test fails when a field the defs expect is missing.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| player-movement.md | Speeds, stamina, roll cost, carry limit 35 kg, holster ×1.12 | `player_stats.json`, read through `PlayerStatsDef` |
| combat.md | Six guns' stats, stick, shields, heals, frag | `economy_items.json` (type-specific blocks), `combat_melee.json` |
| husk-ai.md | Roster HP, armour, sight, FOV, attacks, latch | `husk_types.json` |
| economy.md | Loot tables, container fill, prices 2.5×, recipes, salvage, repair | `economy_*.json` |
| raid-loop.md | 20-minute clock, lift 20 s / 25 s, drop condition multipliers | `raid_rules.json`, `raid_conditions.json` |

## Performance Implications
- **CPU**: One-time parse at startup; config is ~40 items and a few tables, so expected to be negligible (not measured).
- **Memory**: Small (kilobytes).
- **Load Time**: Adds the parse and validation at boot; measure in slice 1.
- **Network**: Not applicable.

## Migration Plan
1. In slice 1: write `export_config.mjs`, export `player_stats.json` with its schema, write the `GameData` loader and `PlayerStatsDef`, and the load and broken-fixture tests.
2. Each later slice: export its tables, add their schemas and typed defs, and move its embedded JS constants into data with descriptions.
3. After the export, record the `web/` commit it was taken from in `assets/data/README.md`.

## Validation Criteria
- The load-everything test passes in CI; the broken-fixture tests are seen to fail before the loader handles them.
- A spot check of ten values per file against `web/src/config.js` matches exactly after export.
- No `.gd` file under `src/gameplay/` or `src/ai/` contains a gameplay literal flagged in review.

## Related
- ADR-0001 Godot port strategy (`docs/architecture/adr-0001-godot-port-strategy.md`) — depends on
- Engine review by godot-specialist (2026-10-30): three blocking issues (`@export` of `RefCounted`, startup order, schema subset too small for `config.js`), all resolved here; engine behaviour checked on the 4.7.2 binary
- `.claude/rules/data-files.md`
- `design/gdd/` Formulas sections (source of the embedded constants)
