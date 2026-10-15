import assert from "node:assert/strict"
import { dict } from "../../app/src/i18n/en.ts"

const dictionaries = await Promise.all([import("../../app/src/i18n/zh.ts"), import("../../app/src/i18n/zht.ts")])

const keys = Object.keys(dict).filter((key) => key.startsWith("tasks."))
const placeholders = (value) => [...value.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]).sort()
for (const [locale, dictionary] of [
  ["zh", dictionaries[0].dict],
  ["zht", dictionaries[1].dict],
]) {
  for (const key of keys) {
    assert.equal(typeof dictionary[key], "string", `${locale}: missing ${key}`)
    assert.ok(dictionary[key].trim(), `${locale}: blank ${key}`)
    assert.deepEqual(placeholders(dictionary[key]), placeholders(dict[key]), `${locale}: placeholders ${key}`)
    assert.ok(dictionary[key] !== dict[key] || key === "tasks.shell", `${locale}: unexplained English ${key}`)
  }
}
console.log(
  JSON.stringify({
    locales: ["en", "zh", "zht"],
    keys: keys.length,
    retainedEnglish: { "tasks.shell": "Established Shell borrowing" },
    nativeSpeakerReview: false,
  }),
)
