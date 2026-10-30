# This repository

**Scrapfall**: a standalone extraction shooter, live as a **Three.js r180 + Vite**
web game (plain JavaScript) and being ported to **Godot 4.7** (GDScript) in
`godot/` (see `godot/README.md`). Web game code is in `src/`, the game's
overview in `README.md`. `npm run build` makes the release build in `dist/`;
a test build (`npx vite build --mode test --outDir dist-test`) exposes
`window.game` for Playwright checks. Pushing to `main` publishes the game to
GitHub Pages.

The Claude Code Game Studios framework below runs this project. Its engine is
not configured yet (`/start`, `/setup-engine`): Scrapfall is a web game rather
than Godot, Unity or Unreal, so treat the engine-specific agents and
references as not applying until that is set.

---

# Claude Code Game Studios -- Game Studio Agent Architecture

Indie game development managed through 49 coordinated Claude Code subagents.
Each agent owns a specific domain, enforcing separation of concerns and quality.

## Technology Stack

- **Engine**: Godot 4.7 (port in progress in `godot/`); the live web game is Three.js r180
- **Language**: GDScript (Godot); JavaScript ES modules (web game)
- **Version Control**: Git with trunk-based development; `.glb`/`.blend` in Git LFS
- **Build System**: Godot export presets (none yet); web game: Vite 7 (`npm run build` → `dist/`)
- **Asset Pipeline**: Blender → `.glb` → `godot/models/`. The current models were exported from the web game with `node tools/export-glb/run.cjs`

> **Note**: The Godot project is in `godot/`, not `src/`: read the framework's
> "code root `src/`" for Godot as `godot/` in this repo. `src/` is the web game.

## Project Structure

@.claude/docs/directory-structure.md

## Engine Version Reference

<!-- ENGINE-REFERENCE-IMPORT: the line below is engine-specific. /setup-engine
     rewrites it to @docs/engine-reference/<engine>/VERSION.md for the chosen
     engine, so a Unity or Unreal project stops loading the Godot reference every
     session. It defaults to Godot (the template's example engine); skills that
     need the pinned version read docs/engine-reference/<engine>/VERSION.md on
     demand regardless of this import. -->
@docs/engine-reference/godot/VERSION.md


## Technical Preferences

`project.yaml` at the repo root is the primary config store — engine, specialists,
naming, platform, performance, modes. Skills resolve it via `resolve_config`
(see `.claude/docs/config-resolution.md`).

`.claude/docs/technical-preferences.md` is the **legacy fallback**, read on demand
when a key is absent from `project.yaml`. It is not imported here: before
`/setup-engine` runs it is almost entirely `[TO BE CONFIGURED]` placeholders, and
after it runs `project.yaml` holds the real values.

## Coordination Rules

@.claude/docs/coordination-rules.md

## Collaboration Protocol

**User-driven collaboration, not autonomous execution.**
Every task follows: **Question -> Options -> Decision -> Draft -> Approval**

- Agents MUST ask "May I write this to [filepath]?" before using Write/Edit tools
  (exempt: `active.md` appends, agent memory, a subagent's new file at the path
  its orchestrating skill named; see `.claude/rules/agent-memory.md`)
- Agents MUST show drafts or summaries before requesting approval
- Multi-file changes require explicit approval for the full changeset
- No commits without user instruction
- A skipped or dismissed question is not an answer: act on nothing, re-ask in
  plain text and wait
- Started outside this file's folder? Warn first: hooks, deny rules and the
  ask-first mode load only when Claude Code starts here

See `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` for full protocol and examples.

> **First session?** If the project has no engine configured and no game concept,
> run `/start` to begin the guided onboarding flow.

## Coding Standards

@.claude/docs/coding-standards.md

## Context Management

Read `.claude/docs/context-management.md` on demand — it is a reference, not
session context. Two of its conventions are load-bearing and cited by name
elsewhere in the repo, so they are restated here rather than lost:

- **`production/session-state/active.md` is the session checkpoint.** The file is
  the memory, not the conversation. Read it first after any compaction, crash, or
  `/clear`.
- **Helpers in `.claude/scripts/` emit observations, never verdicts.** A script
  that scores or judges will eventually contradict a mode or override it cannot
  see. (Cited by `artifact-check.sh` and `adr-dep-graph.sh`.)
