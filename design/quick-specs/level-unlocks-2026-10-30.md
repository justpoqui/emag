# Quick Design Spec: Level Unlocks

**Type**: New Small System
**Scope**: Player level gates which trader stock you can buy, which Workbench recipes you can craft, which map conditions you can sign out for, and which wardrobe pieces you can wear. It does not gate looting, using, selling or salvaging items.
**Date**: 2026-10-30
**GDD Reference**: `design/game-brief.md` (Build order 1; MVP "Saved profile")
**Estimated Implementation**: 4–6 hours

## Overview

Right now XP adds up (`300 + 150 × level` per level, `game.js:610`) but a level unlocks nothing. This spec gives each level a purpose. Better guns and shields show up at the traders and the Workbench as you level, the harder map conditions open up, and a few wardrobe pieces become wearable. Anything you find topside is still yours to use, whatever your level: the gate only covers buying, crafting, signing out for a condition, and wearing a piece.

## Core Rules

1. Each gated entry has an `unlock` level. Anything without one is level 1 (always open).
2. **Trader stock:** a stock item whose unlock level is above the player's level still shows in the trader's list, greyed out, with "Unlocks at LVL N". It can't be bought.
3. **Recipes:** the same rule applies at the Workbench. A locked recipe shows greyed out with "Unlocks at LVL N" and can't be crafted. Pinning a locked recipe is allowed, so you can plan ahead.
4. **Map conditions:** a locked condition shows on the Checkout board with "Unlocks at LVL N" and can't be signed out for.
5. **Wardrobe:** a locked piece shows in the mirror with "Unlocks at LVL N" and can't be picked.
6. **Never gated:** looting, equipping, using, selling, salvaging and repairing. An item you can't buy yet works fully once you find it.
7. **Levelling up mid-raid:** XP is only given out at the end of the raid (`game.js:582–593`), so unlocks apply from the results screen on. The results screen lists everything this level-up opened ("Unlocked: Badger, Dust Storm").
8. **Existing saves:** nothing is taken away. If a save's current outfit includes a piece locked at its level, the piece stays worn until it's changed.

## Unlock table (proposed defaults)

Cumulative XP to reach a level: L3 = 1,050 · L5 = 2,700 · L8 = 6,300 · L12 = 13,200. An extracted raid pays about 150–400 XP (raid kill XP + 100), so L5 takes about 10 raids and L12 about 40.

| Level | Trader stock | Recipes | Map | Wardrobe |
|---|---|---|---|---|
| 1 | Mule, Sparrow, Light/Medium Ammo, Frag, Bandage, Shield Cell, Light Shield | Bandage, Shield Cell, Frag, Light/Medium Ammo, Light Shield, Sparrow | Golden Hour | Field Jacket, Cargo Pants, Work Cap, No hat, Short Crop |
| 3 | Badger, Med Kit | Badger, Med Kit | **Dust Storm** | Work Tee, Utility Shorts |
| 5 | Boar, Shotgun Shells, Medium Shield | Boar, Shotgun Shells, Medium Shield | — | Ponytail |
| 8 | Hammerhead, Heavy Ammo | Hammerhead, Heavy Ammo | **Night Raid** | Boonie Hat |
| 12 | Heron, Heavy Shield | Heron, Heavy Shield | — | — |

Reasoning: the order follows item rarity (common → epic) and trader value. Heavy ammo and the Night Raid arrive together because Night is denser with Husks and heavy rounds are what crack armoured Husks. The wardrobe only has four non-default pieces today, so the cosmetics track is thin until more are added.

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|------|---------|-------|----------|-----------|
| `unlock` per trader stock entry | table above | 1–20 | gate | follows rarity |
| `unlock` per recipe | same as the item's trader unlock | 1–20 | gate | crafting is never a way round a trader lock |
| `unlock` per map condition | Storm 3, Night 8 | 1–20 | gate | eases players into harder conditions |
| `unlock` per wardrobe piece | table above | 1–20 | gate | small reward between gear tiers |
| XP curve | `300 + 150 × level` | unchanged | curve | existing; already sets the pace above |

All values live in `src/config.js` (`TRADERS`, `RECIPES`, `MAPS`) and `src/outfit.js` (`WARDROBE`), next to the data they gate, not hardcoded in the UI.

## Acceptance Criteria

- [ ] A level-1 profile can't buy a Badger and sees "Unlocks at LVL 3"; at level 3 it can.
- [ ] A level-1 profile can't craft a Heron, but can pin it.
- [ ] A level-1 profile can't sign out for Night Raid or Dust Storm; Golden Hour is always available.
- [ ] A Heron looted by a level-1 player can be equipped, fired, sold and salvaged.
- [ ] Levelling up shows the newly unlocked entries on the results screen.
- [ ] An existing save above level 12 loses nothing; an existing save wearing a now-locked piece keeps wearing it.
- [ ] No regression: the free kit, selling, salvaging and repair behave as before at any level.

## Systems Index

There's no systems index (workflow is `minimal`); the game brief is the record. This spec is below that tracking threshold, so a quick spec is enough.
