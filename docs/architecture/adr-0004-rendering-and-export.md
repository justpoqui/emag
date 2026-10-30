# ADR-0004: Rendering and Export

## Status
Proposed

## Date
2026-10-30

## Last Verified
2026-10-30

## Decision Makers
Project owner (chose: Forward+ on PC with Compatibility on web, run a web spike, commit export presets, publish Godot web at a test path first); drafted by Claude.

## Summary
ADR-0001, 0002 and 0003 left open which renderer the PC and browser builds use, whether a Godot browser build can read our JSON data and keep `user://` saves on a static host, and whether export presets are committed. Decided: Forward+ on PC with the engine's built-in web override to Compatibility, single-threaded web exports, committed `export_presets.cfg`, and the Godot web build published at `/godot/` for testing while the Three.js game stays at the Pages root; a web spike on Godot 4.7.2 confirmed each web point.

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.7 (editor, CI and spike on 4.7.2) |
| **Domain** | Rendering |
| **Layer** | Foundation |
| **Knowledge Risk** | HIGH — 4.7 is post-cutoff |
| **References Consulted** | `docs/engine-reference/godot/VERSION.md`, `modules/rendering.md`, `breaking-changes.md` (4.6 and 4.7 rendering rows), `deprecated-apis.md`, `current-best-practices.md`; web export spike on the official 4.7.2 binary and export templates (both SHA-512 checked) |
| **Post-Cutoff APIs Used** | `rendering/renderer/rendering_method.web` (present in 4.7.2, default `gl_compatibility`, checked); 4.6 D3D12 default on Windows (`modules/rendering.md` "Rendering Backend Selection") affects PC builds; 4.6 glow-before-tonemapping (`breaking-changes.md:51`) and 4.7 `LinearToSRGB` no longer clamping under Forward+/Mobile (`breaking-changes.md:32`) affect how the two renderers differ |
| **Verification Required** | PC exports (Windows, Linux, macOS) not yet built; web tested only in headless Chromium (software WebGL, so nothing about performance), not Firefox or Safari; GitHub Pages compression of the 39.5 MB `.wasm` not checked; ADR-0003's full save path on web (`profiles/` folder, `.bak` swap, closing the tab right after a save) not tested; the list of Forward+ features that Compatibility lacks is not in the reference |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0001 (slice order, `web/` stays live), ADR-0002 (JSON data must be in exports), ADR-0003 (`user://` saves must persist in browsers). All must be Accepted first |
| **Enables** | The first Godot web build at `/godot/`; slice 6 (map and Blender art pass); PC builds |
| **Blocks** | Any story that exports a build or relies on a renderer-specific visual feature |
| **Ordering Note** | The `project.godot` renderer change and the committed presets land in slice 1, once this ADR is Accepted |

## Context

### Problem Statement
`project.godot` currently uses Compatibility for every platform, chosen to keep a browser build possible. That caps PC visuals just as Blender models are coming. Three earlier ADRs deferred web questions here: whether a Godot browser build runs on a static host without special headers, whether it includes the JSON data files, and whether `user://` saves survive a reload. `.gitignore` excludes `export_presets.cfg`, so CI cannot export the same way a developer does.

### Constraints
- The live game is the Three.js build on GitHub Pages (static hosting; no custom response headers).
- Target platforms: PC and web, mouse and keyboard (`technical-preferences.md`).
- Budget: 60 fps / 16.6 ms (`docs/registry/architecture.yaml`).
- `raid-loop.md` §3.2: three drop conditions differ by light, fog and headlamp.
- No design doc covers the graphics settings the web game has (`web/src/settings.js`: frame-rate cap, resolution scale, quality presets).

### Requirements
- The PC build can use the full renderer for the Blender art pass.
- A browser build keeps working from a static host.
- Exports are reproducible on any machine and in CI.
- The live web game is not replaced until the Godot version covers the whole loop.

## Decision

**Renderer.** `rendering/renderer/rendering_method` = `forward_plus` (PC). `rendering/renderer/rendering_method.web` stays at its engine default, `gl_compatibility`. Mobile is not a target. The web spike confirmed a Forward+ project exports a browser build that renders with `gl_compatibility` on WebGL 2.

**Art baseline.** Every scene must look acceptable on Compatibility. Forward+-only effects are PC enhancements with a Compatibility fallback, never something gameplay depends on (for example, a Husk must be visible in the dust storm on both). Each visual story keeps two screenshots in `production/qa/evidence/`: the normal desktop run, and a desktop run with `--rendering-method gl_compatibility` (the flag exists in 4.7.2's `--help`; desktop OpenGL is close to, not the same as, WebGL). The browser itself is checked at each `/godot/` publish.

**Amends ADR-0001.** ADR-0001 says the project targets 60 fps "on the Compatibility renderer" and lists Compatibility as the renderer. From this ADR on, PC uses Forward+ and only web uses Compatibility; the 60 fps / 16.6 ms budget applies to both until profiling says otherwise.

**Web builds.** Single-threaded (`variant/thread_support=false`), so no cross-origin isolation is needed. Browsers need a user gesture before audio plays and before the mouse can be captured, so the Godot web build opens on a click-to-start screen (the Three.js game already asks for a click to capture the mouse).

**Export presets.** `export_presets.cfg` is committed: the line is removed from `.gitignore`. The Web preset is created in the 4.7.2 editor in slice 1 (not hand-written like the spike's) and must have:
- `exclude_filter` = `tests/*, addons/gdUnit4/*`, so test suites, fixtures and the test addon never ship (checked on 4.7.2: an exclude filter of this form keeps those folders out while `assets/data/` still ships);
- no include filter for JSON: 4.7.2 exports `.json` files by default (checked with the output outside the project; the package held both data files and nothing else of ours), and a bare `*.json` include would also pull in test fixtures;
- an export path outside the Godot project's scanned files (`web/dist/godot/`, which `web/.gdignore` already hides from Godot), because an export into a scanned folder is packed into the next export (seen in the spike). PC presets (Windows, Linux) are added when PC builds start; any signing credentials must stay out of the committed file, and whether Godot keeps them out on its own is checked then.

**Publishing.** The GitHub Pages root keeps the Three.js game. Once slice 1 runs, the existing Pages workflow builds both sites in **one job** before its single force-push to `gh-pages` (`.github/workflows/pages.yml` re-creates the whole branch each run, so a second job or workflow would wipe the other site): it builds the Three.js game into `web/dist/`, then exports the Godot web build into `web/dist/godot/`. Its path filter grows from `web/**` to also cover `src/**`, `assets/**`, `project.godot` and `export_presets.cfg`. The job installs the 4.7.2 web export templates (checksum checked, cached between runs) and runs `godot --headless --path . --import` before exporting, since a fresh checkout has no `.godot/` cache. The root switches to the Godot build only when it covers the whole loop (ADR-0001's retirement condition).

**Graphics settings.** The web game's frame-rate cap, resolution scale and quality presets get a design doc (`/reverse-document design web/src/settings.js`) before slice 6, then a story to port them. Drop-condition lighting values stay data (`raid_conditions.json` `visuals`, ADR-0002), tuned per renderer if needed.

### Web spike results (2026-10-30, scratchpad project, not in the repo)

| Check | Result |
|---|---|
| Export a Forward+ project as a single-threaded web build | Exit 0, no errors; `index.wasm` 39.5 MB uncompressed, `index.pck` 2.9 KB |
| Serve with a plain static server (no COOP/COEP headers) and load in headless Chromium | Starts; `crossOriginIsolated` false; "single-threaded" build |
| Renderer used in the browser | `gl_compatibility` (WebGL 2), from the built-in `.web` override |
| Read `res://assets/data/*.json`, including a subfolder | Both read. A re-export with no include filter and the output outside the project still packed both files and nothing else of ours (an earlier re-export into `build/` inside the project also packed the previous build's files, which is why exports must go outside scanned folders) |
| Exclude filter `tests/*, addons/<name>/*` | Test files and the addon left out of the package; data still in |
| Write `user://` via tmp file and rename, reload the page, read it back | Rename returns OK; value persisted across reload (1, then 2) |
| Credentials file created for the web preset | None |

### Architecture Diagram
```
project.godot
  rendering_method     = forward_plus      -> Windows / Linux / macOS builds
  rendering_method.web = gl_compatibility  -> Web build (single-threaded, WebGL 2)

export_presets.cfg (committed): Web now; Windows, Linux later
GitHub Pages:  /         Three.js game (web/)        until the Godot port covers the loop
               /godot/   Godot web build (testing)   from slice 1
```

### Key Interfaces
None in code. The contracts are the two project settings above, the committed presets, and the Pages paths.

### Implementation Guidelines
- `project.godot` **must** set `rendering_method` to `forward_plus` and **must not** override `rendering_method.web` away from `gl_compatibility`.
- Gameplay **must never** depend on a Forward+-only effect; each visual feature **must** have a Compatibility look.
- Visual stories **must** keep screenshots from both renderers.
- Web exports **must** be single-threaded.
- `export_presets.cfg` **must** be committed, **must** be created in the editor, **must** exclude `tests/*` and `addons/gdUnit4/*`, and **must not** contain credentials.
- Exports **must** be written outside the folders Godot scans (`web/dist/godot/`, under `web/.gdignore`).
- Both Pages sites **must** be built in the one job that pushes `gh-pages`.
- The Pages root **must not** switch to the Godot build before it covers the whole loop.

## Alternatives Considered

### Alternative 1: Compatibility everywhere
- **Description**: Keep today's setting on all platforms.
- **Pros**: One look to test; widest hardware support.
- **Cons**: Caps PC visuals for the Blender art pass.
- **Rejection Reason**: The owner wants better visuals on PC, and the built-in web override makes the split cheap.

### Alternative 2: Forward+ only, no web build
- **Description**: PC only.
- **Pros**: One renderer; no web constraints.
- **Cons**: Drops the browser version that the game is known for.
- **Rejection Reason**: Keeping a browser build is a stated goal, and the spike shows it works.

## Consequences

### Positive
- Full renderer on PC; a working browser build from the same project.
- The web questions from ADR-0002 and ADR-0003 are answered by a test, not assumed.
- Exports are reproducible in CI.

### Negative
- Two looks to keep acceptable and to capture in QA.
- The web build is a large download (39.5 MB `.wasm` before compression).
- The Pages workflow grows a Godot export job.

## Risks
- **Compatibility lacks features the art pass wants.** The reference does not list them. Mitigation: art baseline rule; check each effect on the web build as it is added.
- **Large web download.** Mitigation: check Pages compression at the first `/godot/` publish; consider the release template's size options then.
- **Browsers other than Chromium.** Mitigation: test Firefox and Safari at the first `/godot/` publish.
- **Windows PC builds default to D3D12 since 4.6.** Mitigation: test on the developer's machine when PC presets are added; Vulkan remains selectable.
- **Renderer differences hide bugs** (glow order, `LinearToSRGB` clamping). Mitigation: the two screenshots per visual story.
- **Shader compilation stutter in the browser** the first time a material is drawn (general knowledge, unverified; the reference does not say whether the 4.5 Shader Baker covers Compatibility or web). Mitigation: warm up materials behind the click-to-start or a loading screen; measure at the first `/godot/` publish.
- **Saves lost if the tab closes right after a write** before the browser storage sync finishes (unverified). Mitigation: test it with ADR-0003's save path at the first `/godot/` publish.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| raid-loop.md | §3.2 drop conditions: Golden Hour, Night Raid (headlamp), Dust Storm (short sight) differ by light and fog | Both renderers must show each condition; lighting values stay in data; Husk and raider visibility must not depend on Forward+-only effects |

## Performance Implications
- **CPU**: No change to gameplay cost; Forward+ and Compatibility differ in GPU cost (not measured).
- **Memory**: Not measured.
- **Load Time**: Web: a 39.5 MB `.wasm` download before compression.
- **Network**: Web download only.

## Migration Plan
1. After acceptance, in slice 1: set `rendering_method` to `forward_plus` and `config/features` to `"4.7", "Forward Plus"` in `project.godot`; update `engine.rendering` in `project.yaml` and `technical-preferences.md` to "Forward+ (PC), Compatibility (web)"; remove `export_presets.cfg` from `.gitignore`; create the Web preset in the editor with the filters above and commit it; extend the Pages workflow as described.
2. Slice 1 end: CI publishes the Godot web build to `/godot/`; check compression and other browsers.
3. Before slice 6: design doc for graphics settings; PC presets.
4. When the port covers the loop: switch the Pages root (ADR-0001).

## Validation Criteria
- The slice 1 web build at `/godot/` starts in Chromium, Firefox and Safari and keeps a profile across reloads.
- The PC build reports Forward+ and the web build reports Compatibility.
- A CI export produces the same files as a local export.

## Related
- ADR-0001 (slice order, retirement condition), ADR-0002 (JSON data), ADR-0003 (`user://` saves) — depends on; amends ADR-0001's renderer statements
- Engine review by godot-specialist (2026-10-30): two blocking issues (Pages workflow would wipe one site; preset contents and export path), both resolved here and the filter behaviour checked on 4.7.2
- `docs/engine-reference/godot/modules/rendering.md`
- `design/gdd/raid-loop.md` §3.2
- `web/src/settings.js` (graphics settings to document)
