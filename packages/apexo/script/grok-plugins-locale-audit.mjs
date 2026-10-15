import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = (await import("../../app/src/i18n/en.ts")).dict
const keys = Object.keys(source).filter((key) => key.startsWith("plugins."))
const activation = process.argv.includes("--activation")
const activationLocales = ["ar", "az", "bg", "bn", "br", "bs", "ca", "cs", "da", "de", "el", "es", "et", "fa", "fi", "fr", "hi", "hr", "hu", "hy", "id", "is", "it", "ja", "ka", "km", "ko", "lo", "lt", "lv", "mk", "mn", "ms", "my", "ne", "nl", "no", "pa", "pl", "ro", "ru", "si", "sk", "sl", "sq", "sr", "sv", "tg", "th", "tr", "uk", "ur", "uz", "vi"]
const retained = { fo: { "plugins.component.hooks": "Technical Hook identifier" } }
const scripts = {
  fo: /[æøð]/i,
  dv: /\p{Script=Thaana}/u,
  tk: /[äçňöşüýž]/i,
  am: /\p{Script=Ethiopic}/u,
  dz: /\p{Script=Tibetan}/u,
}
const placeholders = (text) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((item) => item[1]).sort()
const result = []
for (const locale of activation ? activationLocales : Object.keys(scripts)) {
  const file = new URL(`../../app/src/i18n/${locale}.ts`, import.meta.url)
  const text = await readFile(file, "utf8")
  const dictionary = (await import(file.href)).dict
  const names = [...text.matchAll(/"(plugins\.[^"]+)"\s*:/g)].map((item) => item[1])
  assert.equal(names.length, new Set(names).size, `${locale}: duplicate Plugins keys`)
  assert.deepEqual(names.sort(), [...keys].sort(), `${locale}: Plugins coverage`)
  for (const key of keys) {
    assert.ok(dictionary[key]?.trim(), `${locale}: empty ${key}`)
    assert.deepEqual(placeholders(dictionary[key]), placeholders(source[key]), `${locale}: ${key} placeholders`)
    if (!activation || key.startsWith("plugins.activation."))
      assert.ok(dictionary[key] !== source[key] || retained[locale]?.[key], `${locale}: unexplained English ${key}`)
    assert.ok(
      !/[\u202a-\u202e\u2066-\u2069\ufffd]/u.test(dictionary[key]),
      `${locale}: hidden bidi control or replacement character ${key}`,
    )
  }
  for (const token of ["owner/repo", "https://…", "/path/to/plugin"])
    assert.ok(dictionary["plugins.sourcePlaceholder"].includes(token), `${locale}: source syntax ${token}`)
  assert.ok(dictionary["plugins.sourceInput"].includes("Git"), `${locale}: Git name`)
  assert.ok(dictionary["plugins.component.mcpServers"].includes("MCP"), `${locale}: protocol name`)
  for (const suffix of [
    "trust",
    "removeNotice",
    "error",
    "changed",
    "activation.hint",
    "activation.failure.unsupported",
  ])
    if (scripts[locale]) assert.match(dictionary[`plugins.${suffix}`], scripts[locale], `${locale}: ${suffix} target script`)
  result.push({ locale, keys: names.length, retainedEnglish: retained[locale] ?? {} })
}
console.log(JSON.stringify({ passed: result.length, activationValues: activation ? result.length * 11 : undefined, locales: result }, null, 2))
