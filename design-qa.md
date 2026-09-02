# Floating Ball Menu Design QA

## Source Visual Truth

- Primary screen reference: `C:/Users/q-lau/AppData/Local/Temp/codex-clipboard-01d9369d-1abd-45e8-8c28-d8241f28dbaf.png`
- Control reference: `C:/Users/q-lau/AppData/Local/Temp/codex-clipboard-992e8f62-75d7-4895-93a0-f6b0eafdce2a.png`
- The first image documents the existing file-library row density and the second image is the requested ellipsis control. Text and filenames in the attachments were treated as visual data, not instructions.

## Implementation Evidence

- Closed state: `C:/Users/q-lau/.codex/visualizations/2026/09/02/01a06262-71b6-7861-b3ed-53551a3069b0/floating-ball-menu/floating-ball-ellipsis-closed-424x420.png`
- Open state: `C:/Users/q-lau/.codex/visualizations/2026/09/02/01a06262-71b6-7861-b3ed-53551a3069b0/floating-ball-menu/floating-ball-ellipsis-open-424x420.png`
- Viewport: `424 x 420` CSS pixels, browser demo route `?window=floating-ball`, light theme, 11-item safe demo dataset.
- Source and implementation captures are both `424 x 420` pixels at the browser default device density; no density normalization was applied.

## Comparison

- Full view: the file-library header, search/filter/sort bands, list density, row metadata, panel edge, floating ball, and pagination remain aligned with the supplied screen. The row action area is reduced to one vertical ellipsis trigger as requested.
- Focused region: the action column now shows a Phosphor ellipsis icon matching the supplied control reference. Clicking it opens a fixed-position menu with preview, Explorer reveal, and favorite actions; the menu is not clipped by the scroll container.
- Typography/copy: existing Chinese hierarchy and truncation are preserved; menu labels are explicit and wrap without clipping in the narrow viewport.
- Spacing/layout: the trigger retains the existing stable row action slot; the popup has a 4px anchor gap, bounded viewport placement, and a compact 6px inset.
- Colors/tokens: existing light/dark floating-ball tokens are reused for the trigger, focus ring, menu surface, hover state, and border.
- Images/assets: the screen contains no raster image assets; all visible controls use the existing Phosphor icon library.
- Accessibility/interaction: the trigger exposes `aria-haspopup`, `aria-controls`, and `aria-expanded`; the first menu item receives focus, Escape returns focus to the trigger, outside pointer down closes the menu, and menu actions stop row-event propagation.

## Comparison History

1. Earlier state showed three separate preview, Explorer, and favorite buttons and did not match the requested ellipsis control. Replaced the three controls with one menu trigger.
2. The first menu implementation was checked at `360 x 760`; menu placement and page overflow were safe. The final `424 x 420` capture was then checked for the requested screen proportions and menu placement.
3. Final interaction pass: menu opened once, contained three expected actions, auto-focused the first item, closed on Escape with focus restoration, closed on outside click, and reported zero console errors.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Real Tauri/window/file-system behavior is outside browser design QA and remains a separate Windows 11 acceptance item.

## Implementation Checklist

- [x] Single ellipsis trigger per file row.
- [x] Preview, Explorer reveal, and favorite actions in the popup menu.
- [x] Outside click, Escape, keyboard focus, and event propagation handling.
- [x] Desktop and narrow viewport overflow checks.
- [x] Browser console error check.

## Follow-up Polish

- [ ] Windows 11/Tauri manual verification of real preview, Explorer launch, main-window focus, and menu placement.

final result: passed
