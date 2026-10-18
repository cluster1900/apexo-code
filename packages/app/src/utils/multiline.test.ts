import { describe, expect, test } from "bun:test"
import { enterAction, multiline, setMultiline } from "@apexo/session-ui/v2/prompt-input/multiline"

describe("enterAction (/multiline)", () => {
  test("leaves the default behavior when off", () => {
    expect(enterAction({ multiline: false, shift: false, alt: false, empty: false })).toBe("default")
    expect(enterAction({ multiline: false, shift: true, alt: false, empty: false })).toBe("default")
  })
  test("swaps Enter and Shift/Alt+Enter when on", () => {
    expect(enterAction({ multiline: true, shift: false, alt: false, empty: false })).toBe("newline")
    expect(enterAction({ multiline: true, shift: true, alt: false, empty: false })).toBe("send")
    expect(enterAction({ multiline: true, shift: false, alt: true, empty: false })).toBe("send")
  })
  test("an empty composer still sends on Enter", () => {
    expect(enterAction({ multiline: true, shift: false, alt: false, empty: true })).toBe("send")
  })
  test("persists the toggle", () => {
    setMultiline(true)
    expect(multiline()).toBe(true)
    expect(localStorage.getItem("apexo.multiline")).toBe("on")
    setMultiline(false)
    expect(localStorage.getItem("apexo.multiline")).toBe("off")
  })
})
