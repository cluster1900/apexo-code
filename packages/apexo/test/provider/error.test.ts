import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderV2 } from "@apexo/core/provider"
import { ProviderError } from "@/provider/error"

describe("provider stream errors", () => {
  test("retries provider stream errors without a code", () => {
    const messages = [
      "The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing: https://docs.x.ai/developers/advanced-api-usage/priority-processing",
      "The model is temporarily unavailable.",
    ]

    for (const message of messages)
      expect(
        ProviderError.parseStreamError({
          type: "error",
          error: { message },
        }),
      ).toEqual({
        type: "api_error",
        message,
        isRetryable: true,
        responseBody: JSON.stringify({ type: "error", error: { message } }),
      })
  })
})

describe("provider API call errors", () => {
  const providerID = ProviderV2.ID.make("anthropic")

  test.each([
    ["nested error.message", JSON.stringify({ error: { message: "Upstream gateway timeout" } })],
    ["string error", JSON.stringify({ error: "Upstream gateway timeout" })],
    ["top-level message", JSON.stringify({ message: "Upstream gateway timeout" })],
  ])("extracts %s when message matches HTTP status text", (_label, responseBody) => {
    const error = new APICallError({
      message: "Bad Gateway",
      url: "https://example.com/v1/messages",
      requestBodyValues: {},
      statusCode: 502,
      responseHeaders: { "content-type": "application/json" },
      responseBody,
      isRetryable: true,
    })

    expect(
      ProviderError.parseAPICallError({
        providerID,
        error,
      }),
    ).toEqual({
      type: "api_error",
      message: "Bad Gateway: Upstream gateway timeout",
      statusCode: 502,
      isRetryable: true,
      responseHeaders: { "content-type": "application/json" },
      responseBody,
      metadata: { url: "https://example.com/v1/messages" },
    })
  })

  test("preserves context-overflow classification for nested error.message", () => {
    const responseBody = JSON.stringify({
      error: {
        message: "This model's maximum context length is 8192 tokens.",
      },
    })
    const error = new APICallError({
      message: "Bad Request",
      url: "https://example.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: { "content-type": "application/json" },
      responseBody,
      isRetryable: false,
    })

    expect(
      ProviderError.parseAPICallError({
        providerID,
        error,
      }),
    ).toEqual({
      type: "context_overflow",
      message: "Bad Request: This model's maximum context length is 8192 tokens.",
      responseBody,
    })
  })
})
