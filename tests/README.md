# Test Infrastructure

**Engine**: Godot 4.7 (developer editor and CI: 4.7.2)
**Test Framework**: GdUnit4 6.2.2 (committed in `addons/gdUnit4/`, its own test suite left out)
**CI**: `.github/workflows/tests.yml`
**Setup date**: 2026-10-30

## Directory Layout

```
tests/
  unit/           # Isolated unit tests (formulas, state machines, logic)
  integration/    # Cross-system and save/load tests
  smoke/          # Critical path test list for /smoke-check gate
```

```
production/qa/
  evidence/       # Screenshot logs and manual test sign-off records
```

> **Manual evidence lives under `production/qa/evidence/`, not `tests/`** — that
> is where every consumer reads it.

The Three.js game in `web/` is not covered here; these tests are for the Godot port.

## Running Tests

From the repo root (use the full path to the Godot executable if `godot` is not
on your `PATH`):

```bash
godot --headless --path . --import
godot --headless -s -d --remote-debug tcp://127.0.0.1:0 res://addons/gdUnit4/bin/GdUnitCmdTool.gd -a res://tests --ignoreHeadlessMode
```

Run the import first: a fresh clone has no `.godot/` class cache, and the runner
then exits 1 without running anything.

Exit codes: **0** all passed · **100** a test failed · **101** all passed but nodes
leaked (warning) · **105** a test script does not parse · **103/104** gdUnit4 could
not run. `No test cases found` with exit 0 is **not** a pass. The two `ERROR:`
lines about the remote port `127.0.0.1:0` are expected.

In the editor: enable the plugin once (Project → Project Settings → Plugins →
GdUnit4 ✓, then restart the editor) to get the GdUnit panel.

## Test Naming

- File `[system]_[feature]_test.gd`, function `test_[scenario]_[expected]`
  — `combat_damage_test.gd` → `test_base_attack_returns_expected_damage()`

## Story Type → Test Evidence

| Story Type | Required Evidence | Location |
|---|---|---|
| Logic | Automated unit test — must pass | `tests/unit/[system]/` |
| Integration | Integration test OR playtest doc | `tests/integration/[system]/` |
| Visual/Feel | Screenshot + lead sign-off | `production/qa/evidence/` |
| UI | Retained screenshot of each screen touched | `production/qa/evidence/` |
| Config/Data | Smoke check pass | `production/qa/smoke-*.md` |

## CI

Tests run automatically on every push to `main` and on every pull request.
A failed test suite blocks merging.
