import { expect, test } from "bun:test"
import type { Message } from "@apexo/sdk/v2/client"
import { setContextWindowChoice } from "@/utils/context-window"
import { getSessionContext } from "./session-context-metrics"

test("getSessionContext uses the session's chosen /context-window when supported by the model", () => {
  const messages: Message[] = [
    {
      id: "msg_1",
      sessionID: "ses_cw",
      role: "assistant",
      parentID: "msg_0",
      modelID: "grok-4.7",
      providerID: "xai",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: {
        input: 20_000,
        output: 5_000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: 1, completed: 2 },
    },
  ]
  const providers = [
    {
      id: "xai",
      name: "xAI",
      models: {
        "grok-4.7": {
          name: "Grok 4.7",
          limit: {
            context: 100_000,
            context_options: [100_000, 50_000],
          },
        },
      },
    },
  ]

  expect(getSessionContext(messages, providers)).toMatchObject({
    limit: 100_000,
    total: 25_000,
    usage: 25,
  })

  setContextWindowChoice("ses_cw", 50_000)
  expect(getSessionContext(messages, providers)).toMatchObject({
    limit: 50_000,
    total: 25_000,
    usage: 50,
  })

  expect(
    getSessionContext(messages, [
      {
        id: "xai",
        name: "xAI",
        models: {
          "grok-4.7": {
            name: "Grok 4.7",
            limit: { context: 0 },
          },
        },
      },
    ]),
  ).toMatchObject({
    limit: undefined,
    total: 25_000,
    usage: null,
  })
})
