import { describe, expect, test } from "bun:test"
import { AutoReview } from "../../src/permission/auto-review"

const bash = (command: string) => ({ sessionID: "ses_x", permission: "bash", patterns: [command], metadata: { command } })

describe("AutoReview.decide", () => {
  test("rule pre-filter approves routine calls without the model", async () => {
    let called = 0
    const verdict = await AutoReview.decide(bash("git status"), async () => (called++, '{"decision":"ask"}'))
    expect(verdict).toMatchObject({ allow: true, source: "rules" })
    expect(called).toBe(0)
  })
  test("known-dangerous patterns escalate without the model", async () => {
    let called = 0
    const verdict = await AutoReview.decide(bash("rm -rf build"), async () => (called++, '{"decision":"allow"}'))
    expect(verdict).toMatchObject({ allow: false, source: "rules" })
    expect(called).toBe(0)
  })
  test("the model classifies calls the rules do not know", async () => {
    const seen: string[] = []
    const allow = await AutoReview.decide(bash("terraform plan"), async (request) => {
      seen.push(AutoReview.prompt(request))
      return '<think>read-only</think>{"decision":"allow","reason":"plan is read-only"}'
    })
    expect(allow).toEqual({ allow: true, reason: "plan is read-only", source: "model" })
    expect(seen[0]).toContain("terraform plan")
    const ask = await AutoReview.decide(bash("terraform apply"), async () => '{"decision":"ask","reason":"changes infra"}')
    expect(ask).toEqual({ allow: false, reason: "changes infra", source: "model" })
  })
  test("falls back to the rules when no model answers clearly", async () => {
    expect(await AutoReview.decide(bash("terraform plan"))).toMatchObject({ allow: false, source: "rules" })
    expect(await AutoReview.decide(bash("terraform plan"), async () => "sure!")).toMatchObject({
      allow: false,
      source: "rules-fallback",
    })
    expect(
      await AutoReview.decide(bash("terraform plan"), async () => {
        throw new Error("provider down")
      }),
    ).toMatchObject({ allow: false, source: "rules-fallback" })
  })
})
