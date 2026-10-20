import { expect, test } from "bun:test"
import { minimalSlash } from "@/cli/cmd/run/footer.slash"

test("minimal mode runs /copy, /model, /effort and /clear locally", () => {
  expect(minimalSlash("/copy 2 out.md")).toEqual({ type: "copy", args: "2 out.md" })
  expect(minimalSlash("/copy ")).toEqual({ type: "copy", args: "" })
  expect(minimalSlash("/model gpt-5 high")).toEqual({ type: "model", args: "gpt-5 high" })
  expect(minimalSlash("/models")).toEqual({ type: "model", args: "" })
  expect(minimalSlash("/effort xhigh")).toEqual({ type: "effort", args: "xhigh" })
  expect(minimalSlash("/clear")).toEqual({ type: "new" })
})

test("fullscreen-only built-ins get a notice instead of reaching the model", () => {
  for (const text of [
    "/resume login fix",
    "/compact",
    "/fork",
    "/rewind",
    "/export out.md",
    "/rename Better title",
    "/delete",
    "/context-window 500k",
    "/always-approve",
    "/auto",
    "/usage",
    "/plan add tests",
    "/history",
    "/session-info",
    "/context",
  ])
    expect(minimalSlash(text)).toEqual({
      type: "notice",
      text: `/${text.slice(1).split(" ")[0]} isn't available in minimal mode. Run /fullscreen to switch this session.`,
    })
})

test("unknown slash text and plain prompts keep their route", () => {
  expect(minimalSlash("/review main")).toBeUndefined()
  expect(minimalSlash("explain /compact")).toBeUndefined()
  expect(minimalSlash("/new")).toBeUndefined()
  expect(minimalSlash("/exit")).toBeUndefined()
  expect(minimalSlash("/fullscreen")).toBeUndefined()
})
