import { describe, expect, test } from "bun:test"
import { DEFAULT_THEMES } from "../../../ui/src/theme/default-themes"
import { contrastRatio } from "../../../ui/src/theme/color"
import { resolveThemeVariant } from "../../../ui/src/theme/resolve"
import { resolveThemeVariantV2 } from "../../../ui/src/theme/v2/resolve"
import type { HexColor } from "../../../ui/src/theme/types"

describe("Desktop built-in themes contrast", () => {
  for (const [id, theme] of Object.entries(DEFAULT_THEMES)) {
    for (const mode of ["dark", "light"] as const) {
      const isDark = mode === "dark"
      test(`${id} (${mode}) maintains readable V1 and V2 text contrast`, () => {
        const variant = isDark ? theme.dark : theme.light
        const v1 = resolveThemeVariant(variant, isDark)
        const bgBase = v1["background-base"] as HexColor
        const textBase = v1["text-base"] as HexColor
        const textWeak = v1["text-weak"] as HexColor

        expect(contrastRatio(textBase, bgBase)).toBeGreaterThanOrEqual(4.45)
        expect(contrastRatio(textWeak, bgBase)).toBeGreaterThanOrEqual(3.45)

        const v2 = resolveThemeVariantV2(variant, isDark)
        const resolveV2 = (token: string): HexColor => {
          const val = v2[token]
          const ref = typeof val === "string" ? val.match(/^var\(--(v2-[a-z0-9-]+)\)$/)?.[1] : undefined
          return (ref ? v2[ref] : val) as HexColor
        }
        const v2Bg = resolveV2("v2-background-bg-base")
        const v2Base = resolveV2("v2-text-text-base")
        const v2Muted = resolveV2("v2-text-text-muted")
        const v2Faint = resolveV2("v2-text-text-faint")

        expect(contrastRatio(v2Base, v2Bg)).toBeGreaterThanOrEqual(4.45)
        expect(contrastRatio(v2Muted, v2Bg)).toBeGreaterThanOrEqual(4.15)
        expect(contrastRatio(v2Faint, v2Bg)).toBeGreaterThanOrEqual(2.75)
      })
    }
  }
})
