import { describe, expect, test } from "bun:test"
import { RGBA, type TerminalColors } from "@opentui/core"
import {
  DEFAULT_THEMES,
  contrastRatio,
  generateSystem,
  relativeLuminance,
  resolveTheme,
  selectedForeground,
  tint,
} from "../../../tui/src/theme"

function compositeSurface(fg: RGBA, bg: RGBA): RGBA {
  if (fg.a >= 1) return fg
  if (fg.a <= 0) return bg
  return tint(bg, fg, fg.a)
}

function effectiveSurfaces(theme: ReturnType<typeof resolveTheme>, mode: "dark" | "light") {
  const fallbackBg = mode === "dark" ? RGBA.fromHex("#0a0a0a") : RGBA.fromHex("#ffffff")
  const rawBg = theme.background
  const canvasBg =
    rawBg.a > 0
      ? compositeSurface(rawBg, fallbackBg)
      : rawBg.r !== 0 || rawBg.g !== 0 || rawBg.b !== 0
        ? RGBA.fromValues(rawBg.r, rawBg.g, rawBg.b, 1)
        : fallbackBg
  const panelBg = compositeSurface(theme.backgroundPanel, canvasBg)
  const elementBg = compositeSurface(theme.backgroundElement, panelBg)
  return [canvasBg, panelBg, elementBg]
}

describe("TUI built-in themes contrast", () => {
  for (const [name, themeJson] of Object.entries(DEFAULT_THEMES)) {
    for (const mode of ["dark", "light"] as const) {
      test(`${name} (${mode}) maintains readable contrast across all surfaces and selection states`, () => {
        const theme = resolveTheme(themeJson, mode)
        const surfaces = effectiveSurfaces(theme, mode)

        for (const surface of surfaces) {
          expect(contrastRatio(theme.text, surface)).toBeGreaterThanOrEqual(4.45)
          expect(contrastRatio(theme.markdownText, surface)).toBeGreaterThanOrEqual(4.45)
          expect(contrastRatio(theme.markdownHeading, surface)).toBeGreaterThanOrEqual(4.45)
          expect(contrastRatio(theme.markdownCodeBlock, surface)).toBeGreaterThanOrEqual(4.45)
          expect(contrastRatio(theme.syntaxPunctuation, surface)).toBeGreaterThanOrEqual(4.45)

          expect(contrastRatio(theme.primary, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.secondary, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.accent, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.error, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.warning, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.success, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.info, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.syntaxKeyword, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.syntaxFunction, surface)).toBeGreaterThanOrEqual(3.15)
          expect(contrastRatio(theme.syntaxString, surface)).toBeGreaterThanOrEqual(3.15)

          expect(contrastRatio(theme.textMuted, surface)).toBeGreaterThanOrEqual(2.75)
          expect(contrastRatio(theme.syntaxComment, surface)).toBeGreaterThanOrEqual(2.75)
          expect(contrastRatio(theme.diffContext, surface)).toBeGreaterThanOrEqual(2.75)
        }

        expect(theme.selectedListItemText.a).toBeGreaterThan(0)
        expect(contrastRatio(theme.selectedListItemText, theme.primary)).toBeGreaterThanOrEqual(4.45)

        for (const badgeBg of [theme.primary, theme.secondary, theme.accent, theme.warning, theme.error]) {
          const fg = selectedForeground(theme, badgeBg)
          expect(fg.a).toBeGreaterThan(0)
          expect(contrastRatio(fg, badgeBg)).toBeGreaterThanOrEqual(4.45)
        }
      })
    }
  }

  test("system theme adapts cleanly to dark and light modes even when terminal defaultBackground mismatches", () => {
    const darkTerminalColors: TerminalColors = {
      palette: [
        "#15161e",
        "#f7768e",
        "#9ece6a",
        "#e0af68",
        "#7aa2f7",
        "#bb9af7",
        "#7dcfff",
        "#c0caf5",
        "#414868",
        "#f7768e",
        "#9ece6a",
        "#e0af68",
        "#7aa2f7",
        "#bb9af7",
        "#7dcfff",
        "#c0caf5",
      ],
      defaultBackground: "#1a1b26",
      defaultForeground: "#c0caf5",
      cursorColor: "#c0caf5",
      mouseForeground: null,
      mouseBackground: null,
      tekForeground: null,
      tekBackground: null,
      highlightBackground: null,
      highlightForeground: null,
    }

    for (const mode of ["dark", "light"] as const) {
      const sysJson = generateSystem(darkTerminalColors, mode)
      const resolved = resolveTheme(sysJson, mode)
      const surfaces = effectiveSurfaces(resolved, mode)
      for (const surface of surfaces) {
        expect(contrastRatio(resolved.text, surface)).toBeGreaterThanOrEqual(4.45)
        expect(contrastRatio(resolved.textMuted, surface)).toBeGreaterThanOrEqual(2.75)
      }
      expect(contrastRatio(selectedForeground(resolved, resolved.primary), resolved.primary)).toBeGreaterThanOrEqual(
        4.45,
      )
    }

    const lightResolved = resolveTheme(generateSystem(darkTerminalColors, "light"), "light")
    expect(lightResolved.background.a).toBe(1)
    expect(relativeLuminance(lightResolved.background)).toBeGreaterThan(0.5)
  })
})
