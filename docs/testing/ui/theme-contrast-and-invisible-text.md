# BUG-20261104-003: Invisible Text and Low Contrast Across TUI, CLI `--mini`, and Desktop Themes

## Affected Scope
- `packages/tui/src/theme/index.ts`
- `packages/tui/src/context/theme.tsx`
- `packages/tui/src/theme/assets/lucent-orng.json`
- `packages/tui/src/theme/assets/catppuccin-frappe.json`
- `packages/tui/src/theme/assets/catppuccin-macchiato.json`
- `packages/tui/src/theme/assets/vesper.json`
- `packages/tui/src/ui/dialog-select.tsx`
- `packages/tui/src/ui/dialog.tsx`
- `packages/tui/src/ui/toast.tsx`
- `packages/tui/src/ui/dialog-alert.tsx`
- `packages/tui/src/ui/dialog-confirm.tsx`
- `packages/tui/src/ui/dialog-help.tsx`
- `packages/tui/src/component/dialog-session-delete-failed.tsx`
- `packages/tui/src/component/dialog-workspace-file-changes.tsx`
- `packages/tui/src/component/dialog-workspace-unavailable.tsx`
- `packages/tui/src/component/prompt/index.tsx`
- `packages/tui/src/routes/session/index.tsx`
- `packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx`
- `packages/tui/src/component/logo.tsx`
- `packages/apexo/src/cli/cmd/run/theme.ts`
- `packages/ui/src/theme/color.ts`
- `packages/ui/src/theme/resolve.ts`
- `packages/ui/src/theme/v2/foreground.ts`
- `packages/ui/src/theme/themes/catppuccin-frappe.json`
- `packages/ui/src/theme/themes/catppuccin-macchiato.json`
- `packages/ui/src/theme/themes/matrix.json`
- `packages/ui/src/v2/styles/theme.css`
- `packages/ui/src/styles/theme.css`

## Observed Behavior
1. **TUI (`packages/tui`)**:
   - In `lucent-orng` (`background: "transparent"`), `selectedForeground()` checked `theme.background.luminance() === 0` (which is `0` for `RGBA.fromInts(0, 0, 0, 0)`) and returned `theme.background` (alpha `0`), making selected items, active dialog buttons, and badges render with transparent text or bleed through transparent panel backgrounds.
   - In `catppuccin-frappe` and `catppuccin-macchiato`, the `light` variant duplicated the dark palette, producing white text on light surfaces or dark surfaces in light mode.
   - In `vesper` (`light`), `primary`, `accent`, `textMuted`, and `markdownCode` had contrast ratios of `1.13:1`–`2.28:1` against `#FFF`, making headings, links, and code invisible.
   - Across 18 built-in TUI themes (`aura`, `cobalt2`, `dracula`, `everforest`, `github`, `gruvbox`, `kanagawa`, `material`, `matrix`, `monokai`, `nightowl`, `nord`, `one-dark`, `opencode`, `orng`, `palenight`, `solarized`, `synthwave84`), `syntaxComment` / `textMuted` had contrast ratios between `1.45:1` and `2.58:1`.
   - In `DialogSelect` (`/theme` live switcher), `Option` and `FooterAction` captured `const fg = selectedForeground(theme)` non-reactively at mount time and used `focusedTextColor={theme.textMuted}` on the search input.
2. **CLI `--mini` (`packages/apexo/src/cli/cmd/run/theme.ts`)**:
   - `footer.selected` was mapped to `footerTheme.backgroundElement` (`grays[3]`, dark gray in dark mode) while `footer.selectedText` was mapped to `footerTheme.selectedListItemText` (`bg`, dark background in dark mode), resulting in dark-on-dark (`~1.15:1` contrast) active menu items in `FooterMenu`.
   - In `system` theme mode when terminal `defaultBackground` was `null` in `light` mode, `generateSystem` fell back to `palette[0]` (`#000000`) and `palette[7]` (`#ffffff`), inverting the light theme into dark surfaces.
3. **Desktop / Web (`packages/ui`)**:
   - `contrastRatio()` in `packages/ui/src/theme/color.ts` used `0.587` instead of `0.7152` for the sRGB green channel weight, skewing luminance and contrast calculations.
   - `catppuccin-frappe.json` and `catppuccin-macchiato.json` in `packages/ui/src/theme/themes/` used dark palettes for their `light` variant.
   - `one-dark` (dark), `palenight` (dark), and `matrix` (light) had muted/weak text tokens falling below readable contrast thresholds.

## Expected Behavior
- All 34 TUI themes and 26 Desktop themes in both `dark` and `light` modes must maintain readable WCAG-aligned contrast across primary text (`>= 4.5:1`), muted/weak text (`>= 2.8:1` TUI / `>= 3.5:1`–`4.2:1` Desktop), semantic/syntax/markdown tokens (`>= 3.2:1`), and selected foregrounds (`>= 4.5:1` with `a === 1`).
- Floating TUI dialogs and toasts must use an opaque fallback surface when a theme defines translucent or transparent panels.
- CLI `--mini` footer menu selection must maintain `>= 4.5:1` contrast between `footer.selectedText` and `footer.selected` across dark, light, and system themes.

## Reproduction Steps
1. Open TUI and switch `/theme` to `lucent-orng`, `vesper` (in light mode), or `catppuccin-frappe` (in light mode); observe invisible or unreadable text and transparent dialog bleed-through.
2. Run `apexo run --mini` and open a footer selector menu; observe low-contrast selected row text.
3. Run contrast checks across all TUI and Desktop themes in `dark` and `light` modes.

## Root Cause
- `selectedForeground()` in `packages/tui/src/theme/index.ts` tested `theme.background.luminance() === 0` instead of checking `a === 0` and verifying contrast against the actual highlight surface (`bg ?? theme.primary`).
- `resolveTheme()` did not clamp low-contrast text, muted, syntax, or markdown tokens against effective canvas/panel/element backgrounds.
- `packages/apexo/src/cli/cmd/run/theme.ts` paired `footer.selected = footerTheme.backgroundElement` with `footer.selectedText = footerTheme.selectedListItemText` (which is `bg`, meant for `primary` backgrounds, not `backgroundElement`).
- `packages/ui/src/theme/color.ts` used the NTSC luma green weight (`0.587`) on linearized sRGB channels instead of the Rec. 709 / sRGB weight (`0.7152`), and `ensureTextContrast` stopped at `target` without falling back to pure black/white when `target` itself had insufficient contrast.

## Fix
1. Added `relativeLuminance` and `contrastRatio` helpers to `packages/tui/src/theme/index.ts`, updated `selectedForeground(theme, bg)` to ignore transparent backgrounds and enforce `>= 4.5:1` contrast against `bg ?? theme.primary`, and added contrast normalization in `resolveTheme()` across canvas, panel, and element surfaces.
2. Updated `lucent-orng.json`, `catppuccin-frappe.json`, `catppuccin-macchiato.json`, and `vesper.json` in `packages/tui/src/theme/assets/`, made `DialogSelect` foreground memos reactive, and added opaque surface fallbacks in `Dialog` and `Toast`.
3. Updated `packages/apexo/src/cli/cmd/run/theme.ts` so `footer.selectedText` uses high-contrast `footerTheme.text` against `footer.selected` (`backgroundElement`), and fixed `generateSystem` light-mode fallback when `defaultBackground` is `null`.
4. Fixed the sRGB green luminance weight (`0.7152`) in `packages/ui/src/theme/color.ts`, updated `catppuccin-frappe.json`, `catppuccin-macchiato.json`, and `matrix.json` in `packages/ui/src/theme/themes/`, enforced contrast minimums in `packages/ui/src/theme/resolve.ts` and `packages/ui/src/theme/v2/foreground.ts`, and added CJK + system UI font fallbacks in `packages/ui/src/v2/styles/theme.css` and `packages/ui/src/styles/theme.css`.

## Verification
- `cd packages/apexo && bun test test/cli/run/theme.test.ts test/cli/run/footer.view.test.tsx test/tui/theme-contrast.test.ts test/tui/desktop-theme-contrast.test.ts` — 184 pass, 0 fail (5,106 `expect()` calls).
