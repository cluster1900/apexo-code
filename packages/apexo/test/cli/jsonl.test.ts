import { describe, expect, test } from "bun:test"
import { parseJsonlRequest, sessionListUrl } from "@/cli/cmd/jsonl"

describe("jsonl session.list adapter", () => {
  test("decodes the existing operation shape and preserves query fields", () => {
    const request = parseJsonlRequest(
      JSON.stringify({ id: "request-1", method: "session.list", query: { limit: 5, order: "asc" } }),
    )
    expect(request.method).toBe("session.list")
    expect(sessionListUrl("http://localhost:4096", request.query).search).toBe("?limit=5&order=asc")
  })

  test("rejects a new or misspelled method instead of inventing an RPC contract", () => {
    expect(() => parseJsonlRequest('{"method":"session.fork"}')).toThrow()
  })

  test("uses the Protocol query constraints", () => {
    for (const limit of [0, -1, 1.5]) {
      expect(() => parseJsonlRequest(JSON.stringify({ method: "session.list", query: { limit } }))).toThrow()
    }
  })
})
