import { SyntaxStyle, RGBA, type TerminalColors } from "@opentui/core"
import aura from "./assets/aura.json" with { type: "json" }
import ayu from "./assets/ayu.json" with { type: "json" }
import carbonfox from "./assets/carbonfox.json" with { type: "json" }
import catppuccinFrappe from "./assets/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./assets/catppuccin-macchiato.json" with { type: "json" }
import catppuccin from "./assets/catppuccin.json" with { type: "json" }
import cobalt2 from "./assets/cobalt2.json" with { type: "json" }
import cursor from "./assets/cursor.json" with { type: "json" }
import dracula from "./assets/dracula.json" with { type: "json" }
import everforest from "./assets/everforest.json" with { type: "json" }
import flexoki from "./assets/flexoki.json" with { type: "json" }
import github from "./assets/github.json" with { type: "json" }
import gruvbox from "./assets/gruvbox.json" with { type: "json" }
import kanagawa from "./assets/kanagawa.json" with { type: "json" }
import lucentOrng from "./assets/lucent-orng.json" with { type: "json" }
import material from "./assets/material.json" with { type: "json" }
import matrix from "./assets/matrix.json" with { type: "json" }
import mercury from "./assets/mercury.json" with { type: "json" }
import monokai from "./assets/monokai.json" with { type: "json" }
import nightowl from "./assets/nightowl.json" with { type: "json" }
import nord from "./assets/nord.json" with { type: "json" }
import onedark from "./assets/one-dark.json" with { type: "json" }
import classic from "./assets/classic.json" with { type: "json" }
import grove from "./assets/grove.json" with { type: "json" }
import orng from "./assets/orng.json" with { type: "json" }
import osakaJade from "./assets/osaka-jade.json" with { type: "json" }
import palenight from "./assets/palenight.json" with { type: "json" }
import rosepine from "./assets/rosepine.json" with { type: "json" }
import solarized from "./assets/solarized.json" with { type: "json" }
import synthwave84 from "./assets/synthwave84.json" with { type: "json" }
import tokyonight from "./assets/tokyonight.json" with { type: "json" }
import vercel from "./assets/vercel.json" with { type: "json" }
import vesper from "./assets/vesper.json" with { type: "json" }
import zenburn from "./assets/zenburn.json" with { type: "json" }

export type Theme = {
  readonly primary: RGBA
  readonly secondary: RGBA
  readonly accent: RGBA
  readonly error: RGBA
  readonly warning: RGBA
  readonly success: RGBA
  readonly info: RGBA
  readonly text: RGBA
  readonly textMuted: RGBA
  readonly selectedListItemText: RGBA
  readonly background: RGBA
  readonly backgroundPanel: RGBA
  readonly backgroundElement: RGBA
  readonly backgroundMenu: RGBA
  readonly border: RGBA
  readonly borderActive: RGBA
  readonly borderSubtle: RGBA
  readonly diffAdded: RGBA
  readonly diffRemoved: RGBA
  readonly diffContext: RGBA
  readonly diffHunkHeader: RGBA
  readonly diffHighlightAdded: RGBA
  readonly diffHighlightRemoved: RGBA
  readonly diffAddedBg: RGBA
  readonly diffRemovedBg: RGBA
  readonly diffContextBg: RGBA
  readonly diffLineNumber: RGBA
  readonly diffAddedLineNumberBg: RGBA
  readonly diffRemovedLineNumberBg: RGBA
  readonly markdownText: RGBA
  readonly markdownHeading: RGBA
  readonly markdownLink: RGBA
  readonly markdownLinkText: RGBA
  readonly markdownCode: RGBA
  readonly markdownBlockQuote: RGBA
  readonly markdownEmph: RGBA
  readonly markdownStrong: RGBA
  readonly markdownHorizontalRule: RGBA
  readonly markdownListItem: RGBA
  readonly markdownListEnumeration: RGBA
  readonly markdownImage: RGBA
  readonly markdownImageText: RGBA
  readonly markdownCodeBlock: RGBA
  readonly syntaxComment: RGBA
  readonly syntaxKeyword: RGBA
  readonly syntaxFunction: RGBA
  readonly syntaxVariable: RGBA
  readonly syntaxString: RGBA
  readonly syntaxNumber: RGBA
  readonly syntaxType: RGBA
  readonly syntaxOperator: RGBA
  readonly syntaxPunctuation: RGBA
  readonly thinkingOpacity: number
  _hasSelectedListItemText: boolean
}
type ThemeColor = Exclude<keyof Theme, "thinkingOpacity" | "_hasSelectedListItemText">
export type SyntaxStyleOverrides = Record<string, { italic?: boolean }>

function channelLuminance(value: number): number {
  if (value <= 0.03928) return value / 12.92
  return ((value + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: RGBA): number {
  return 0.2126 * channelLuminance(color.r) + 0.7152 * channelLuminance(color.g) + 0.0722 * channelLuminance(color.b)
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const lumA = relativeLuminance(a)
  const lumB = relativeLuminance(b)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  const target = bg && bg.a > 0 ? bg : theme.primary
  if (theme._hasSelectedListItemText && theme.selectedListItemText.a > 0) {
    if (contrastRatio(theme.selectedListItemText, target) >= 4.5) {
      return theme.selectedListItemText
    }
  }
  if (theme.background.a > 0 && contrastRatio(theme.background, target) >= 4.5) {
    return theme.background
  }
  return relativeLuminance(target) > 0.179 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA
export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<ThemeColor, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  grove,
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  classic,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
}

const pluginThemes: Record<string, ThemeJson> = {}
let customThemes: Record<string, ThemeJson> = {}
let systemTheme: ThemeJson | undefined
const listeners = new Set<(themes: Record<string, ThemeJson>) => void>()

function listThemes() {
  // Priority: defaults < plugin installs < custom files < generated system.
  const themes = {
    ...DEFAULT_THEMES,
    ...pluginThemes,
    ...customThemes,
  }
  if (!systemTheme) return themes
  return {
    ...themes,
    system: systemTheme,
  }
}

function syncThemes() {
  const themes = listThemes()
  for (const listener of listeners) listener(themes)
}

export function allThemes() {
  return listThemes()
}

export function isTheme(theme: unknown): theme is ThemeJson {
  if (typeof theme !== "object" || theme === null || Array.isArray(theme)) return false
  const value = Reflect.get(theme, "theme")
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function subscribeThemes(listener: (themes: Record<string, ThemeJson>) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCustomThemes(themes: Record<string, ThemeJson>) {
  customThemes = themes
  syncThemes()
}

export function setSystemTheme(theme: ThemeJson | undefined) {
  systemTheme = theme
  syncThemes()
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (hasTheme(name)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (customThemes[name] !== undefined) {
    customThemes[name] = theme
  } else {
    pluginThemes[name] = theme
  }
  syncThemes()
  return true
}

const BODY_TOKENS: readonly ThemeColor[] = [
  "text",
  "markdownText",
  "markdownHeading",
  "markdownStrong",
  "markdownCodeBlock",
  "syntaxVariable",
  "syntaxPunctuation",
]

const ACCENT_TOKENS: readonly ThemeColor[] = [
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "info",
  "diffAdded",
  "diffRemoved",
  "diffHighlightAdded",
  "diffHighlightRemoved",
  "markdownLink",
  "markdownLinkText",
  "markdownCode",
  "markdownBlockQuote",
  "markdownEmph",
  "markdownListItem",
  "markdownListEnumeration",
  "markdownImage",
  "markdownImageText",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
]

const MUTED_TOKENS: readonly ThemeColor[] = [
  "textMuted",
  "syntaxComment",
  "diffContext",
  "diffHunkHeader",
  "diffLineNumber",
]

function compositeOver(fg: RGBA, bg: RGBA): RGBA {
  if (fg.a >= 1) return fg
  if (fg.a <= 0) return bg
  return tint(bg, fg, fg.a)
}

function minContrastAgainst(fg: RGBA, surfaces: readonly RGBA[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(fg, surface)))
}

function adjustTowardTarget(fg: RGBA, lighten: boolean, amount: number): RGBA {
  if (lighten) {
    return tint(fg, RGBA.fromInts(255, 255, 255), amount)
  }
  if (fg.r > 0.92 && fg.g > 0.92 && fg.b > 0.92) {
    return tint(fg, RGBA.fromInts(20, 20, 20), amount)
  }
  const scale = 1 - amount
  return RGBA.fromInts(Math.round(fg.r * scale * 255), Math.round(fg.g * scale * 255), Math.round(fg.b * scale * 255))
}

function searchContrast(
  fg: RGBA,
  surfaces: readonly RGBA[],
  minRatio: number,
  lighten: boolean,
  low: number,
  high: number,
  depth: number,
): RGBA {
  const mid = (low + high) / 2
  const candidate = adjustTowardTarget(fg, lighten, mid)
  if (depth <= 0) return adjustTowardTarget(fg, lighten, high)
  if (minContrastAgainst(candidate, surfaces) >= minRatio) {
    return searchContrast(fg, surfaces, minRatio, lighten, low, mid, depth - 1)
  }
  return searchContrast(fg, surfaces, minRatio, lighten, mid, high, depth - 1)
}

function ensureReadableColor(fg: RGBA, surfaces: readonly RGBA[], minRatio: number, fallbackIsDark: boolean): RGBA {
  const opaque =
    fg.a === 0
      ? fallbackIsDark
        ? RGBA.fromInts(240, 240, 240)
        : RGBA.fromInts(20, 20, 20)
      : fg.a < 1
        ? RGBA.fromValues(fg.r, fg.g, fg.b, 1)
        : fg
  if (minContrastAgainst(opaque, surfaces) >= minRatio) return opaque
  const avgLum = surfaces.reduce((sum, s) => sum + relativeLuminance(s), 0) / surfaces.length
  const lighten = avgLum <= 0.5
  const extreme = adjustTowardTarget(opaque, lighten, 1)
  if (minContrastAgainst(extreme, surfaces) < minRatio) {
    const white = RGBA.fromInts(255, 255, 255)
    const black = RGBA.fromInts(10, 10, 10)
    return minContrastAgainst(white, surfaces) >= minContrastAgainst(black, surfaces) ? white : black
  }
  return searchContrast(opaque, surfaces, minRatio, lighten, 0, 1, 12)
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light") {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue, chain: string[] = []): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)

      if (c.startsWith("#")) return RGBA.fromHex(c)

      if (chain.includes(c)) {
        throw new Error(`Circular color reference: ${[...chain, c].join(" -> ")}`)
      }

      const next = defs[c] ?? theme.theme[c as ThemeColor]
      if (next === undefined) {
        throw new Error(`Color reference "${c}" not found in defs or theme`)
      }
      return resolveColor(next, [...chain, c])
    }
    if (typeof c === "number") {
      return ansiToRgba(c)
    }
    return resolveColor(c[mode], chain)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => {
        return [key, resolveColor(value as ColorValue)]
      }),
  ) as Record<ThemeColor, RGBA>

  const isDark = mode === "dark"
  const fallbackBg = isDark ? RGBA.fromHex("#0a0a0a") : RGBA.fromHex("#ffffff")
  const rawBg = resolved.background
  const canvasBg =
    rawBg.a > 0
      ? compositeOver(rawBg, fallbackBg)
      : rawBg.r !== 0 || rawBg.g !== 0 || rawBg.b !== 0
        ? RGBA.fromValues(rawBg.r, rawBg.g, rawBg.b, 1)
        : fallbackBg
  const surfaceIsDark = relativeLuminance(canvasBg) <= 0.5
  const panelBg = compositeOver(resolved.backgroundPanel, canvasBg)
  const elementBg = compositeOver(resolved.backgroundElement, panelBg)
  const surfaces = [canvasBg, panelBg, elementBg]

  for (const key of BODY_TOKENS) {
    resolved[key] = ensureReadableColor(resolved[key], surfaces, 4.5, surfaceIsDark)
  }
  for (const key of ACCENT_TOKENS) {
    resolved[key] = ensureReadableColor(resolved[key], surfaces, 3.2, surfaceIsDark)
  }
  for (const key of MUTED_TOKENS) {
    resolved[key] = ensureReadableColor(resolved[key], surfaces, 2.8, surfaceIsDark)
  }

  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  const rawSelected = hasSelectedListItemText
    ? resolveColor(theme.theme.selectedListItemText!)
    : resolved.background
  resolved.selectedListItemText =
    rawSelected.a > 0 && contrastRatio(rawSelected, resolved.primary) >= 4.5
      ? rawSelected
      : resolved.background.a > 0 && contrastRatio(resolved.background, resolved.primary) >= 4.5
        ? resolved.background
        : relativeLuminance(resolved.primary) > 0.179
          ? RGBA.fromInts(0, 0, 0)
          : RGBA.fromInts(255, 255, 255)

  resolved.backgroundMenu =
    theme.theme.backgroundMenu !== undefined
      ? resolveColor(theme.theme.backgroundMenu)
      : resolved.backgroundElement

  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
  } as Theme
}

function ansiToRgba(code: number): RGBA {
  // Standard ANSI colors (0-15)
  if (code < 16) {
    const ansiColors = [
      "#000000", // Black
      "#800000", // Red
      "#008000", // Green
      "#808000", // Yellow
      "#000080", // Blue
      "#800080", // Magenta
      "#008080", // Cyan
      "#c0c0c0", // White
      "#808080", // Bright Black
      "#ff0000", // Bright Red
      "#00ff00", // Bright Green
      "#ffff00", // Bright Yellow
      "#0000ff", // Bright Blue
      "#ff00ff", // Bright Magenta
      "#00ffff", // Bright Cyan
      "#ffffff", // Bright White
    ]
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }

  // 6x6x6 Color Cube (16-231)
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)

    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }

  // Grayscale Ramp (232-255)
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }

  // Fallback for invalid codes
  return RGBA.fromInts(0, 0, 0)
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

export function terminalMode(colors: TerminalColors): "dark" | "light" | undefined {
  const bg = colors.defaultBackground
  if (!bg) return
  const { r, g, b } = RGBA.fromHex(bg)
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5 ? "light" : "dark"
}

export function generateSystem(colors: TerminalColors, mode: "dark" | "light"): ThemeJson {
  const isDark = mode === "dark"
  const rawBg = colors.defaultBackground ? RGBA.fromHex(colors.defaultBackground) : undefined
  const rawFg = colors.defaultForeground ? RGBA.fromHex(colors.defaultForeground) : undefined
  const bgLum = rawBg ? 0.299 * rawBg.r + 0.587 * rawBg.g + 0.114 * rawBg.b : undefined
  const bgMatchesMode = bgLum !== undefined ? (isDark ? bgLum <= 0.5 : bgLum > 0.5) : false
  const bg =
    bgMatchesMode && rawBg
      ? rawBg
      : isDark
        ? RGBA.fromHex(colors.palette[0] ?? "#121212")
        : RGBA.fromHex("#fafafa")
  const fg =
    bgMatchesMode && rawFg
      ? rawFg
      : isDark
        ? RGBA.fromHex(colors.palette[7] ?? "#eeeeee")
        : RGBA.fromHex("#1a1a1a")
  const background = bgMatchesMode ? RGBA.fromValues(bg.r, bg.g, bg.b, 0) : bg

  const col = (i: number) => {
    const value = colors.palette[i]
    if (value) return RGBA.fromHex(value)
    return ansiToRgba(i)
  }

  // Generate gray scale based on terminal background
  const grays = generateGrayScale(bg, isDark)
  const textMuted = generateMutedTextColor(bg, isDark)

  // ANSI color references
  const ansiColors = {
    black: col(0),
    red: col(1),
    green: col(2),
    yellow: col(3),
    blue: col(4),
    magenta: col(5),
    cyan: col(6),
    white: col(7),
    redBright: col(9),
    greenBright: col(10),
  }

  const diffAlpha = isDark ? 0.22 : 0.14
  const diffAddedBg = tint(bg, ansiColors.green, diffAlpha)
  const diffRemovedBg = tint(bg, ansiColors.red, diffAlpha)
  const diffContextBg = grays[2]
  const diffAddedLineNumberBg = tint(diffContextBg, ansiColors.green, diffAlpha)
  const diffRemovedLineNumberBg = tint(diffContextBg, ansiColors.red, diffAlpha)
  const diffLineNumber = textMuted

  return {
    theme: {
      // Primary colors using ANSI
      primary: ansiColors.cyan,
      secondary: ansiColors.magenta,
      accent: ansiColors.cyan,

      // Status colors using ANSI
      error: ansiColors.red,
      warning: ansiColors.yellow,
      success: ansiColors.green,
      info: ansiColors.cyan,

      // Text colors
      text: fg,
      textMuted,
      selectedListItemText: bg,

      // Background colors - use transparent to respect terminal transparency when mode matches
      background,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],

      // Border colors
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],

      // Diff colors
      diffAdded: ansiColors.green,
      diffRemoved: ansiColors.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansiColors.greenBright,
      diffHighlightRemoved: ansiColors.redBright,
      diffAddedBg,
      diffRemovedBg,
      diffContextBg,
      diffLineNumber,
      diffAddedLineNumberBg,
      diffRemovedLineNumberBg,

      // Markdown colors
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansiColors.blue,
      markdownLinkText: ansiColors.cyan,
      markdownCode: ansiColors.green,
      markdownBlockQuote: ansiColors.yellow,
      markdownEmph: ansiColors.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansiColors.blue,
      markdownListEnumeration: ansiColors.cyan,
      markdownImage: ansiColors.blue,
      markdownImageText: ansiColors.cyan,
      markdownCodeBlock: fg,

      // Syntax colors
      syntaxComment: textMuted,
      syntaxKeyword: ansiColors.magenta,
      syntaxFunction: ansiColors.blue,
      syntaxVariable: fg,
      syntaxString: ansiColors.green,
      syntaxNumber: ansiColors.yellow,
      syntaxType: ansiColors.cyan,
      syntaxOperator: ansiColors.cyan,
      syntaxPunctuation: fg,
    },
  }
}

function colorChroma(color: RGBA): number {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const r = bg.r * 255
  const g = bg.g * 255
  const b = bg.b * 255
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  const cast = 0.25 * (1 - colorChroma(bg)) ** 2

  const gray = (level: number) => {
    const factor = level / 12
    if (isDark && lum < 10) {
      const value = Math.floor(factor * 0.4 * 255)
      return RGBA.fromInts(value, value, value)
    }
    if (!isDark && lum > 245) {
      const value = Math.floor(255 - factor * 0.4 * 255)
      return RGBA.fromInts(value, value, value)
    }
    const value = isDark ? lum + (255 - lum) * factor * 0.4 : lum * (1 - factor * 0.4)
    const tone = RGBA.fromInts(Math.floor(value), Math.floor(value), Math.floor(value))
    if (cast === 0) return tone
    const ratio = lum === 0 ? 0 : value / lum
    return tint(
      tone,
      RGBA.fromInts(
        Math.floor(Math.max(0, Math.min(r * ratio, 255))),
        Math.floor(Math.max(0, Math.min(g * ratio, 255))),
        Math.floor(Math.max(0, Math.min(b * ratio, 255))),
      ),
      cast,
    )
  }

  return Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, gray(index + 1)]))
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  const bgLum = 0.299 * bg.r * 255 + 0.587 * bg.g * 255 + 0.114 * bg.b * 255
  const grayValue = isDark
    ? bgLum < 10
      ? 180
      : Math.min(Math.floor(160 + bgLum * 0.3), 200)
    : bgLum > 245
      ? 75
      : Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60)

  return RGBA.fromInts(grayValue, grayValue, grayValue)
}

export function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme(getSyntaxRules(theme))
}

export function generateSubtleSyntax(theme: Theme, overrides?: SyntaxStyleOverrides) {
  const rules = getSyntaxRules(theme)
  return SyntaxStyle.fromTheme(
    rules.map((rule) => {
      const override = rule.scope.reduce((acc, scope) => ({ ...acc, ...overrides?.[scope] }), {})
      if (rule.style.foreground) {
        const fg = rule.style.foreground
        return {
          ...rule,
          style: {
            ...rule.style,
            ...override,
            foreground: RGBA.fromInts(
              Math.round(fg.r * 255),
              Math.round(fg.g * 255),
              Math.round(fg.b * 255),
              Math.round(theme.thinkingOpacity * 255),
            ),
          },
        }
      }
      return rule
    }),
  )
}

function getSyntaxRules(theme: Theme) {
  return [
    {
      scope: ["default"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["prompt"],
      style: {
        foreground: theme.accent,
      },
    },
    {
      scope: ["extmark.file"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["extmark.agent"],
      style: {
        foreground: theme.secondary,
        bold: true,
      },
    },
    {
      scope: ["extmark.paste"],
      style: {
        foreground: selectedForeground(theme, theme.warning),
        background: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["comment"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["comment.documentation"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["string", "symbol"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["number", "boolean"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["character.special"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.type"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
        italic: true,
      },
    },
    {
      scope: ["keyword.function", "function.method"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["keyword"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.import"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["operator", "keyword.operator", "punctuation.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.conditional.ternary"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["variable.member", "function", "constructor"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["type", "module"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["constant"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["property"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["class"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["parameter"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["punctuation", "punctuation.bracket"],
      style: {
        foreground: theme.syntaxPunctuation,
      },
    },
    {
      scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["variable.super"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["string.escape", "string.regexp"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["keyword.directive"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["punctuation.special"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.modifier"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.exception"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    // Markdown specific styles
    {
      scope: ["markup.heading"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.1"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
        underline: true,
      },
    },
    {
      scope: ["markup.heading.2"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.3"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.4"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.5"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.6"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.bold", "markup.strong"],
      style: {
        foreground: theme.markdownStrong,
        bold: true,
      },
    },
    {
      scope: ["markup.italic"],
      style: {
        foreground: theme.markdownEmph,
        italic: true,
      },
    },
    {
      scope: ["markup.list"],
      style: {
        foreground: theme.markdownListItem,
      },
    },
    {
      scope: ["markup.quote"],
      style: {
        foreground: theme.markdownBlockQuote,
        italic: true,
      },
    },
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: theme.markdownCode,
      },
    },
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: theme.markdownCode,
        background: theme.backgroundElement.a > 0 ? theme.backgroundElement : undefined,
      },
    },
    {
      scope: ["markup.link"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["markup.link.label"],
      style: {
        foreground: theme.markdownLinkText,
        underline: true,
      },
    },
    {
      scope: ["markup.link.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["label"],
      style: {
        foreground: theme.markdownLinkText,
      },
    },
    {
      scope: ["spell", "nospell"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["conceal"],
      style: {
        foreground: theme.textMuted,
      },
    },
    // Additional common highlight groups
    {
      scope: ["string.special", "string.special.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["character"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["float"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["comment.error"],
      style: {
        foreground: theme.error,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.warning"],
      style: {
        foreground: theme.warning,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.todo", "comment.note"],
      style: {
        foreground: theme.info,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["namespace"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["field"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["type.definition"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
      },
    },
    {
      scope: ["keyword.export"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["attribute", "annotation"],
      style: {
        foreground: theme.warning,
      },
    },
    {
      scope: ["tag"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["tag.attribute"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["tag.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["markup.strikethrough"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["markup.underline"],
      style: {
        foreground: theme.text,
        underline: true,
      },
    },
    {
      scope: ["markup.list.checked"],
      style: {
        foreground: theme.success,
      },
    },
    {
      scope: ["markup.list.unchecked"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["diff.plus"],
      style: {
        foreground: theme.diffAdded,
        background: theme.diffAddedBg,
      },
    },
    {
      scope: ["diff.minus"],
      style: {
        foreground: theme.diffRemoved,
        background: theme.diffRemovedBg,
      },
    },
    {
      scope: ["diff.delta"],
      style: {
        foreground: theme.diffContext,
        background: theme.diffContextBg,
      },
    },
    {
      scope: ["error"],
      style: {
        foreground: theme.error,
        bold: true,
      },
    },
    {
      scope: ["warning"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["info"],
      style: {
        foreground: theme.info,
      },
    },
    {
      scope: ["debug"],
      style: {
        foreground: theme.textMuted,
      },
    },
  ]
}
