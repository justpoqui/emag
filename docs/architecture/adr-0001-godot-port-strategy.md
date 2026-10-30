# ADR-0001: Godot Port Strategy and Project Structure

## Status
Proposed

## Date
2026-10-30

## Last Verified
2026-10-30

## Decision Makers
Project owner (design and technical authority delegated to Claude on 2026-10-30); drafted by Claude.

## Summary
Scrapfall exists as a 12k-line Three.js game in `web/`, and its behaviour is now written down in seven reverse-documented GDDs. We port it to Godot 4.7 incrementally, one design-doc system at a time, with `web/` kept live as the behavioural reference and `design/gdd/` as the spec, and with code laid out under `src/` in the framework's `core/gameplay/ai/ui` folders.

## Engine Compatibility

> **Amended by ADR-0004** (`docs/architecture/adr-0004-rendering-and-export.md`): PC uses Forward+ and only the web build uses Compatibility. Where this ADR says "Compatibility renderer", read it as the web build's renderer; the 60 fps / 16.6 ms budget applies to both.

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.7 (editor and CI on 4.7.2) |
| **Domain** | Core |
| **Layer** | Foundation |
| **Knowledge Risk** | HIGH — 4.7 is post-cutoff |
| **References Consulted** | `docs/engine-reference/godot/VERSION.md`, `breaking-changes.md`, `deprecated-apis.md`, `current-best-practices.md`, `modules/rendering.md`; engine review by godot-specialist (2026-10-30, no blocking issues) |
| **Post-Cutoff APIs Used** | None chosen by this ADR. It constrains GDScript style only (see Implementation Guidelines) |
| **Verification Required** | Slice 1 must open, run and import headless on 4.7.2 and pass its gdUnit4 suite. The empty project already imports cleanly and the test runner (gdUnit4 6.2.2, vendored in `addons/gdUnit4/`) returns 0 on a passing test and 100 on a failing one (verified 2026-10-30; matches `current-best-practices.md:199-201`). Web export is **not** verified |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | None |
| **Enables** | Future ADRs: game data format (`web/src/config.js` to data files), save profile and accounts, browser vs PC rendering |
| **Blocks** | All port epics and stories (`/create-epics`, `/create-stories`) until Accepted |
| **Ordering Note** | Accept this before writing the other foundation ADRs, since they refer to the folder layout and slice order set here |

## Context

### Problem Statement
The game is playable today only as Three.js code that is shaped by a browser: `game.js` (1.5k lines), `ui.js` (2.1k) and `world.js` (2.2k) each hold many responsibilities. We have chosen Godot 4.7 with GDScript for the editor, Blender imports and PC builds. We need a way to move across that keeps something playable at every step, does not drift from the intended behaviour, and does not disturb the game that is live on GitHub Pages.

### Constraints
- One developer working with Claude; no deadline, but no long periods without a runnable build.
- `web/` is published to GitHub Pages from `main` and must keep working until the port catches up.
- The design docs in `design/gdd/` were inferred from the code, not authored. They contain `INTENT UNKNOWN` items and a few flagged bugs and balance concerns.
- Framework conventions: code root is `src/` with `core/`, `gameplay/`, `ai/`, `ui/`; tests are gdUnit4 in `tests/`; JSON data in `assets/data/`; gameplay values are never hardcoded.
- Renderer is Compatibility for now (browser build stays possible); Blender models arrive later.
- There is no design doc yet for the Dustline map layout (`web/src/world.js`, 2.2k lines).

### Requirements
- Every ported system can be shown to match its design doc.
- A playable Godot build exists after every slice.
- Each system is tested before it is relied on by the next.
- The Three.js game is not broken by the port.

## Decision

We port by **vertical slices**, one design-doc system at a time, in an indicative order that `/create-epics` finalises:

1. **Movement and camera** in a grey-box test area (`player-movement.md`).
2. **Combat against one Skitter**: guns, spread, damage, shields (`combat.md`, part of `husk-ai.md`).
3. **Full Husk roster and the Husk Network** (`husk-ai.md`, `husk-network.md`).
4. **Raid loop**: containers, loot, extraction lifts, death and extract results (`raid-loop.md`, `economy.md`).
5. **Sanctuary hub**: stash, traders, workbench, wardrobe, drop select (`sanctuary-hub.md`, economy screens).
6. **The Dustline map and the Blender art pass**, after a map design doc exists.

`web/` is the reference, in this order of authority: the design doc first, then running behaviour in the web build. Where the two disagree, the design doc is corrected deliberately (with a note in the doc), never silently in the new code. `web/` receives no new features during the port; bug fixes are allowed.

A system counts as **ported** when:
- its GDD acceptance criteria pass as gdUnit4 tests where they are logic or formulas;
- anything the player sees or touches has a retained screenshot in `production/qa/evidence/`;
- its gameplay values come from data files, not code;
- the project imports without errors on Godot 4.7.2 headless **and** its scripts pass the framework parse check (`godot --headless --path . -s res://.claude/scripts/godot-parse-check.gd -- res://<file>.gd …`), because `--import` exits 0 on a parse error (`current-best-practices.md:220-224`).

### Architecture Diagram
```
repo root
 |-- web/                 Three.js game (live on Pages; reference, bug fixes only)
 |-- project.godot        Godot project (Compatibility renderer, Jolt)
 |-- src/
 |    |-- core/           game state, event/signal definitions, save plumbing
 |    |-- gameplay/       player/  combat/  raid/  economy/  sanctuary/
 |    |-- ai/             husks/  network/   (Husk AI and the Husk Network)
 |    |-- ui/             HUD, menus, hub screens
 |-- assets/data/         JSON game data (format decided in a later ADR)
 |-- tests/unit/<system>/ mirrors src/ one folder per system
 |-- design/gdd/          the spec each slice is checked against
```
Scenes (`.tscn`) sit next to the script that owns them (a feature-folder layout). The `core/gameplay/ai/ui` split is this framework's convention, which its path rules read; Godot itself places no constraint on `src/`. Scenes stay small: logic lives in scripts, and larger scenes are built from instanced sub-scenes, which keeps `.tscn` merge conflicts rare (general Godot practice; the engine reference is silent on it).

### Key Interfaces
Godot signals belong to an object, so cross-system signals live on **one autoload, `Events`** (`src/core/events.gd`), which declares typed signals only and holds no state. Systems connect with `signal.connect(callable)`; a node's own signals stay on that node ("call down, signal up"). Gameplay code never references UI nodes; the UI listens. Dependencies are passed in through `@export` properties or an explicit `setup()` call, not `_init` arguments, which editor-instanced scenes cannot receive. **`Events` is the only autoload**; adding another needs an ADR (the save ADR is expected to add one for the profile).

### Implementation Guidelines
- Code **must** use static typing, including typed `Array[Type]` and typed signals. It **must never** use string-based `connect()` or `$NodePath` lookups inside `_process()`; cache with `@onready`.
- Overrides of a method with a typed return **must** include an explicit `return` (Godot 4.7 inherits the return type).
- Mouse and keyboard input **must** be identified by event type or `InputEvent.DEVICE_ID_MOUSE` / `DEVICE_ID_KEYBOARD`, never by `device == 0` (4.7).
- Gameplay values **must** come from `assets/data/`, never from literals in scripts.
- A slice **must not** begin until the previous slice meets the "ported" definition above.
- Every `INTENT UNKNOWN` item in a GDD **must** be resolved by the owner before its slice starts.

## Alternatives Considered

### Alternative 1: Big-bang rewrite
- **Description**: Build the whole game in Godot, then switch over.
- **Pros**: No period of two codebases evolving together; freedom to restructure everything.
- **Cons**: Months without a playable build; nothing to compare against until the end; a bug in an early assumption is found late.
- **Rejection Reason**: Violates the requirement for a runnable build after each step.

### Alternative 2: File-by-file transliteration
- **Description**: Translate `game.js` to `game.gd`, `ui.js` to `ui.gd`, and so on.
- **Pros**: Fastest to a first running result; easy to diff against the original.
- **Cons**: Reproduces the Three.js shape (very large multi-purpose files) inside an engine built around scenes, nodes and signals; leaves the procedural world built in code instead of in the editor and Blender; makes tests hard to write.
- **Rejection Reason**: Gives up what moving to Godot is for.

## Consequences

### Positive
- A playable build after every slice, with tests and evidence.
- The design docs finally become checked against something.
- The live game is untouched.
- Each slice is small enough to review.

### Negative
- Two codebases exist for the duration; `web/` bug fixes may need a matching Godot fix.
- Early slices are grey-box and look worse than the web game.
- Resolving `INTENT UNKNOWN` items costs the owner decisions up front.

## Risks
- **Docs inferred from code may encode accidents as rules.** Mitigation: owner resolves unknown intent before each slice; deliberate departures are written into the GDD.
- **The map has no design doc.** Mitigation: write one with `/reverse-document` before slice 6.
- **The port stalls part-way.** Mitigation: every slice is playable and merged on its own; `web/` stays live.
- **Compatibility renderer limits visuals for the Blender art pass.** Mitigation: a separate rendering ADR before slice 6.
- **Godot 4.7 behaviour differs from training data.** Mitigation: engine reference first; verify new APIs on the pinned editor.
- **Web export is unverified.** The reference only says Compatibility is the OpenGL 3.3 / WebGL 2 path (`modules/rendering.md:61`); hosting, threading and size limits are not covered. Mitigation: a web export spike, or the rendering ADR, before the browser build is promised for the Godot version. No export preset exists yet, and `.gitignore` excludes `export_presets.cfg`.
- **Compatibility renderer feature gaps are not listed in the reference.** Mitigation: the rendering ADR checks what the Blender art pass needs before slice 6.
- **First headless import can crash on exit (139)** on 4.7.1/4.7.2 in 3 of 17 runs, then succeed on re-run (`current-best-practices.md:216-219`). Mitigation: CI and scripts retry the import once before failing.
- **Stretch defaults for UI scaling**: 4.7 changed `display/window/stretch` defaults for new projects (`breaking-changes.md:39`), and this `project.godot` was written by hand. Mitigation: slice 1 sets the stretch mode explicitly.
- **Shared nested resources**: if game data becomes `Resource` objects, per-instance copies need `duplicate_deep()` (4.5+, `deprecated-apis.md:33`). Mitigation: the data format ADR states it.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| player-movement.md | Walk 4.6, sprint 7.4, crouch 2.4 m/s; stamina 100, sprint drain 16/s, regen 22/s | Slice 1; acceptance criteria become gdUnit4 tests; values read from data files |
| combat.md | Six guns with the spread, falloff and damage formulas; shield absorb and wear | Slice 2; formulas tested as pure functions before any scene uses them |
| husk-ai.md | Idle, wary, alert states; sight, FOV and crouch rules; Skitter latch | Slices 2-3; state machine unit-tested, perception checked in a test arena |
| husk-network.md | Memory counters, the seven traits, structure planning | Slice 3; pure logic tested directly from the GDD's worked examples |
| raid-loop.md | 20-minute clock, lifts (20 s call, 25 s open), death loses all but the safe slot | Slice 4; clock and result rules unit-tested, lift flow shown by evidence |
| economy.md | Loot tables, prices (2.5x buy), repair, salvage, durability | Slice 4-5; tables in data files; price formulas tested |
| sanctuary-hub.md | Rooms, traders, workbench, wardrobe, drop select | Slice 5; screens shown by retained screenshots |

## Performance Implications
- **CPU**: Targets 60 fps / 16.6 ms on the Compatibility renderer; AI within the 2 ms per frame framework budget. No measured numbers yet.
- **Memory**: Not assessed; a budget is set after the first profile.
- **Load Time**: Not assessed.
- **Network**: Not applicable (single player).

## Migration Plan
1. Accept this ADR and run `/architecture-review` in a fresh session.
2. Write the remaining foundation ADRs (data format, save and accounts, rendering).
3. Run `/create-control-manifest`, `/create-epics` and `/create-stories` from the slices above.
4. Port slice 1; confirm it meets the "ported" definition; continue slice by slice.
5. Retire `web/` only when the Godot build covers the whole loop; until then both live.

## Validation Criteria
- After slice 1: the project opens and runs in the 4.7.2 editor, imports clean headless, and its gdUnit4 suite passes in CI.
- After each later slice: its GDD acceptance criteria pass; evidence is in `production/qa/evidence/`.
- If a slice takes more than three times its estimate, revisit the slice size, not the approach.

## Related
- ADR-0004 rendering and export (`docs/architecture/adr-0004-rendering-and-export.md`) — amends this ADR's renderer statements and answers its web export risk
- `design/gdd/` (all seven documents)
- `docs/engine-reference/godot/` (VERSION, breaking changes, deprecated APIs, current best practices, rendering module)
- `addons/gdUnit4/` (gdUnit4 6.2.2, MIT, vendored without its own tests)
- Planned ADRs: game data format, save profile and accounts, browser vs PC rendering
