import { expect, test } from "bun:test"
import { registeredSlash } from "./slash-route"

test("structured review routes locally even when a legacy server advertises the generic review command", () => {
  expect(registeredSlash("/review inspect API changes", ["review"])).toEqual({
    name: "review",
    args: "inspect API changes",
  })
  expect(registeredSlash("/reviews", ["review"])).toEqual({ name: "reviews", args: "" })
  expect(registeredSlash("/custom-review inspect API changes", ["custom-review"])).toBeUndefined()
})
