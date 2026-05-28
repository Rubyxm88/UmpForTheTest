# Theming Guide (Theme Packs & Components)

Pitch Ump 3D uses a **theme pack** system so UI chrome can be swapped without touching game logic. The default pack is **retro baseball** (cabinet aesthetic: gold stitch, grass borders, square corners, Press Start 2P + VT323).

## Architecture

```
src/themes/
  tokens.css              # Semantic tokens (--ump-color-*, --ump-panel-*)
  components.css          # Component classes (.ump-panel, .ump-btn, …)
  packs/
    retro-baseball.css    # Pack palette + geometry + fonts
```

Import order in `src/style.css`:

1. `packs/retro-baseball.css` — raw palette
2. `tokens.css` — semantic aliases
3. `components.css` — UI building blocks

Legacy gameplay styles (`ab-summary`, pitch chart, HUD overrides) remain in `src/style.css`.

## Switching theme packs

Set one attribute on the document root:

```html
<html data-theme="retro-baseball">
```

Default pack values also apply on `:root`, so the app works without the attribute. To add a pack:

1. Create `src/themes/packs/your-pack.css` with palette + `--ump-radius-*` + font families.
2. Map semantics in `tokens.css` (or override `--ump-color-*` inside `[data-theme="your-pack"]`).
3. Import the pack in `src/style.css` before `tokens.css`.
4. Set `data-theme="your-pack"` on `<html>` (or toggle via JS).

## Design rules

- **Tokens, not hex** — use `--ump-color-*` / `--retro-*` in components; packs own the literal values.
- **Square by default** — `--ump-radius-2` (6px). Pills use `--ump-radius-pill` only.
- **Typography**
  - Labels / kickers: `--ump-font-pixel` (Press Start 2P)
  - Body / stats / inputs: `--ump-font-body` (VT323)
- **Mobile-first** — min tap target 44px (`.ump-btn`, `.ump-input`, `.ump-tab`); respect safe areas via `.ump-screen` and `--ump-safe-*`.
- **Layout vs chrome** — keep Tailwind for flex/grid/spacing; use `.ump-*` for borders, fills, type, and shadows.
- **Avoid** — `text-purple-*`, `glass-panel` + purple gradients on new UI (legacy `glass-panel` still exists for unmigrated screens).

## Semantic tokens (reference)

| Token | Role |
|-------|------|
| `--ump-color-text` | Primary copy |
| `--ump-color-text-dim` | Secondary copy |
| `--ump-color-accent` | Gold emphasis |
| `--ump-color-primary` | Stitch red (primary actions) |
| `--ump-color-border` | Panel border |
| `--ump-color-border-grass` | Subtle / inner borders |
| `--ump-panel-bg` | Panel gradient |
| `--ump-screen-bg` | Full-screen backdrop |
| `--ump-progress-fill` | Progress / XP bar |
| `--ump-radius-0` … `--ump-radius-pill` | Geometry |

Pack-specific aliases (`--retro-chalk`, `--retro-stitch`, …) remain for gameplay CSS (`ab-summary`, etc.).

## Component classes (reference)

| Class | Use |
|-------|-----|
| `.ump-screen` | Full-screen menu backdrop + safe-area padding |
| `.ump-panel` | Primary card / modal shell |
| `.ump-panel--subtle` | Inner sections, stat groups |
| `.ump-panel--flush` | Flush dashboard shell (no outer radius) |
| `.ump-btn` + `--primary` / `--ghost` / `--warn` | Actions (`--block`, `--sm` modifiers) |
| `.ump-input` | Text, password, date fields |
| `.ump-label`, `.ump-kicker`, `.ump-title`, `.ump-subtitle` | Type scale |
| `.ump-tab-bar`, `.ump-tab`, `.ump-tab--active` | Dashboard tabs |
| `.ump-progress`, `.ump-progress__fill` | Challenge progress |
| `.ump-xp-bar-bg`, `.ump-xp-bar-fill` | XP (welcome, HUD, post-AB) |
| `.ump-stat-card` | Small stat tiles |
| `.ump-card` | Challenge / feature cards |
| `.ump-table-wrap`, `.ump-table` | Leaderboard tables |
| `.ump-hud-bar` | Profile HUD strip (when migrated) |
| `.ump-pill`, `.ump-badge` | Tags |
| `.ump-alert`, `.ump-error`, `.ump-link` | Inline messages / logout |
| `.menu-header` + `__*` | Main menu header block |

## Checklist for new UI

- [ ] Uses `.ump-*` components and/or `--ump-*` tokens
- [ ] No one-off purple/neon gradients or `rounded-xl` chrome
- [ ] Pixel font only for short labels; VT323 for readable values
- [ ] Mobile: ≥44px tap targets; test at 320px width
- [ ] Safe areas: parent is `.ump-screen` or manual `env(safe-area-inset-*)`
- [ ] One clear `.ump-btn--primary` per screen section
- [ ] If adding a color, add it to the **pack** first, then a **semantic token**

## Migrated screens (HTML)

- Welcome (`#welcome-screen`)
- Team select (`#team-select-screen`)
- Main menu shell + Play tab chrome (`#start-screen`)

## Recommended next migrations

1. **Leaderboard / Stats tabs** — replace `glass-panel-light`, purple filter pills, `.ump-table` on `#tab-content-leaderboard`
2. **Scoreboard & pause overlays** — move off `!important` glass-panel overrides
3. **Modals** — `#confirm-modal-overlay`, game preview, challenge detail → `.ump-modal.ump-panel`
4. **Persistent profile HUD** — `#persistent-profile-hud` → `.ump-hud-bar`
5. **Dynamic cards in `game.js`** — team tiles, recent games, leaderboard rows (still emit `glass-panel`)

## Reducing the unification layer

`src/style.css` still contains `!important` overrides for unmigrated screens. When a screen uses theme classes in HTML, remove its entries from the unification block (welcome / team-select / start-screen entries were trimmed).
