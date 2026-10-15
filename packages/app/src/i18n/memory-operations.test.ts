import { expect, test } from "bun:test"
import { dict } from "./en"
const translations = await Promise.all([import("./zh"), import("./zht")])
const keys = Object.keys(dict).filter((key): key is keyof typeof dict => key.startsWith("memory.operations."))
for (const [locale, translated] of [
  ["zh", translations[0].dict],
  ["zht", translations[1].dict],
] as const) {
  test(`Memory operations ${locale} retain complete outcome and placeholder contracts`, () => {
    expect(keys.length).toBeGreaterThan(50)
    for (const key of keys) {
      const value = translated[key as keyof typeof translated]
      expect(value, key).toBeDefined()
      expect(value, key).not.toBe(dict[key])
      expect([...value.matchAll(/\{\{([^}]+)\}\}/gu)].map((item) => item[1]).sort(), key).toEqual(
        [...dict[key].matchAll(/\{\{([^}]+)\}\}/gu)].map((item) => item[1]).sort(),
      )
    }
  })
}
