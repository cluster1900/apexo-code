import { expect, test } from "bun:test"
import { terminalTooltipKeybind } from "@/components/command-tooltip-keybind"
import { sessionPanelLayout } from "./session-panel-layout"

test("right terminal panel shows alone or stacks below review and files", () => {
  expect(
    sessionPanelLayout({
      review: false,
      terminal: true,
      files: false,
    }),
  ).toEqual({
    visible: true,
    stacked: false,
  })

  expect(
    sessionPanelLayout({
      review: true,
      terminal: true,
      files: false,
    }),
  ).toEqual({
    visible: true,
    stacked: true,
  })

  expect(
    sessionPanelLayout({
      review: false,
      terminal: true,
      files: true,
    }),
  ).toEqual({
    visible: true,
    stacked: true,
  })
})

test("terminalTooltipKeybind exposes terminal.toggle keybind parts", () => {
  const parts = terminalTooltipKeybind({
    keybindParts: (id) => (id === "terminal.toggle" ? ["Ctrl", "`"] : []),
  })
  expect(parts).toEqual(["Ctrl", "`"])
})
