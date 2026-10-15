import { describe, expect, test } from "bun:test"
import {
  buildCompatibilitySessionUsageReport,
  buildNativeSessionUsageReport,
  fetchNativeHistoryPages,
  loadSessionUsage,
  parseTurnSelector,
  readNativeUsageFromClient,
} from "../../src/cli/cmd/usage"
import type { SessionV1 } from "@apexo/core/v1/session"

const SESSION_ID = "ses_01a13291000000000000000001"
const T0 = 1_760_500_000_000

function durable(seq: number, version = 1) {
  return {
    aggregateID: SESSION_ID,
    seq,
    version,
  }
}

describe("apexo usage", () => {
  test("groups two inputs with multiple provider steps and model switch across turns and steps", () => {
    const events = [
      {
        id: "evt_0001",
        type: "session.next.prompted",
        durable: durable(1),
        data: {
          timestamp: T0 + 1000,
          sessionID: SESSION_ID,
          messageID: "msg_user_0001",
          prompt: { text: "First question" },
          delivery: "steer",
        },
      },
      {
        id: "evt_0002",
        type: "session.next.step.started",
        durable: durable(2),
        data: {
          timestamp: T0 + 2000,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_asst_0001",
          agent: "build",
          model: { providerID: "xai", id: "grok-4-fast", variant: "fast" },
        },
      },
      {
        id: "evt_0003",
        type: "session.next.step.ended",
        durable: durable(3, 2),
        data: {
          timestamp: T0 + 3000,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_asst_0001",
          finish: "tool-calls",
          cost: 0,
          tokens: {
            input: 120,
            output: 30,
            reasoning: 10,
            cache: { read: 40, write: 15 },
          },
        },
      },
      {
        id: "evt_0004",
        type: "session.next.model.switched",
        durable: durable(4),
        data: {
          timestamp: T0 + 3500,
          sessionID: SESSION_ID,
          messageID: "msg_switch_0001",
          model: { providerID: "xai", id: "grok-4" },
        },
      },
      {
        id: "evt_0005",
        type: "session.next.step.started",
        durable: durable(5),
        data: {
          timestamp: T0 + 4000,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_asst_0002",
          agent: "build",
          model: { providerID: "xai", id: "grok-4" },
        },
      },
      {
        id: "evt_0006",
        type: "session.next.step.ended",
        durable: durable(6, 2),
        data: {
          timestamp: T0 + 5000,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_asst_0002",
          finish: "stop",
          cost: 0,
          tokens: {
            input: 200,
            output: 50,
            reasoning: 25,
            cache: { read: 100, write: 0 },
          },
        },
      },
      {
        id: "evt_0007",
        type: "session.next.input.execution.settled",
        durable: durable(7),
        data: {
          timestamp: T0 + 5100,
          sessionID: SESSION_ID,
          messageID: "msg_user_0001",
          status: "completed",
          reason: "completed",
          finish: "stop",
          usageIncomplete: false,
        },
      },
      {
        id: "evt_0008",
        type: "session.next.prompted",
        durable: durable(8),
        data: {
          timestamp: T0 + 6000,
          sessionID: SESSION_ID,
          messageID: "msg_user_0002",
          prompt: { text: "Second question" },
          delivery: "steer",
        },
      },
      {
        id: "evt_0009",
        type: "session.next.step.started",
        durable: durable(9),
        data: {
          timestamp: T0 + 7000,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_asst_0003",
          agent: "build",
          model: { providerID: "xai", id: "grok-4" },
        },
      },
      {
        id: "evt_0010",
        type: "session.next.step.ended",
        durable: durable(10, 2),
        data: {
          timestamp: T0 + 8000,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_asst_0003",
          finish: "stop",
          cost: 0,
          tokens: {
            input: 300,
            output: 60,
            reasoning: 20,
            cache: { read: 180, write: 5 },
          },
        },
      },
    ]

    const full = buildNativeSessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 8000 } },
      events,
    })

    expect(full.sessionId).toBe(SESSION_ID)
    expect(full.backend).toBe("native")
    expect(full.accountingScope).toBe("durable-event-ledger")
    expect(full.costStatus).toBe("unavailable")
    expect(full.observedSeq).toBe(10)
    expect(full.session.turnCount).toBe(2)
    expect(full.session.modelCalls).toBe(3)
    expect(full.session.inputTokens).toBe(620)
    expect(full.session.outputTokens).toBe(140)
    expect(full.session.totalTokens).toBe(760)
    expect(full.session.reasoningTokens).toBe(55)
    expect(full.session.cachedReadTokens).toBe(320)
    expect(full.session.cacheCreationTokens).toBe(20)
    expect(full.session.costUsd).toBeNull()
    expect(full.session.costIsPartial).toBe(true)
    expect(full.session.usageIsIncomplete).toBe(false)
    expect(full.session.primaryModelId).toBe("grok-4")
    expect(full.session.modelUsage["grok-4-fast"]?.modelCalls).toBe(1)
    expect(full.session.modelUsage["grok-4-fast"]?.totalTokens).toBe(150)
    expect(full.session.modelUsage["grok-4-fast"]?.turnCount).toBe(1)
    expect(full.session.modelUsage["grok-4"]?.modelCalls).toBe(2)
    expect(full.session.modelUsage["grok-4"]?.totalTokens).toBe(610)
    expect(full.session.modelUsage["grok-4"]?.turnCount).toBe(2)
    expect(full.turns).toHaveLength(2)
    expect(full.turns[0]?.turnNumber).toBe(1)
    expect(full.turns[0]?.userMessageId).toBe("msg_user_0001")
    expect(full.turns[0]?.modelCalls).toBe(2)
    expect(full.turns[0]?.steps).toHaveLength(2)
    expect(full.turns[0]?.steps[0]?.modelId).toBe("grok-4-fast")
    expect(full.turns[0]?.steps[1]?.modelId).toBe("grok-4")
    expect(full.turns[1]?.turnNumber).toBe(2)
    expect(full.turns[1]?.userMessageId).toBe("msg_user_0002")
    expect(full.turns[1]?.modelCalls).toBe(1)

    const turn2 = buildNativeSessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 8000 } },
      events,
      turn: 2,
    })
    expect(turn2.session.totalTokens).toBe(760)
    expect(turn2.turns).toHaveLength(1)
    expect(turn2.turns[0]?.turnNumber).toBe(2)
    expect(turn2.turns[0]?.totalTokens).toBe(360)
  })

  test("excludes HistoryCopy.Message imported context from fresh billing", () => {
    const importedEvents = [
      {
        id: "evt_copy_1",
        type: "session.next.history.copy.started",
        durable: durable(1),
        data: {
          timestamp: T0 + 100,
          sessionID: SESSION_ID,
          source: { sessionID: "ses_parent0000000000000000", created: "evt_0000", revision: 1 },
          count: 2,
        },
      },
      {
        id: "evt_copy_2",
        type: "session.next.history.copy.message",
        durable: durable(2),
        data: {
          timestamp: T0 + 200,
          sessionID: SESSION_ID,
          source: { sessionID: "ses_parent0000000000000000", created: "evt_0000", revision: 1 },
          sourceMessageID: "msg_old_user",
          message: {
            id: "msg_copied_user",
            type: "user",
            text: "Old question",
            time: { created: T0 },
          },
        },
      },
      {
        id: "evt_copy_3",
        type: "session.next.history.copy.message",
        durable: durable(3),
        data: {
          timestamp: T0 + 300,
          sessionID: SESSION_ID,
          source: { sessionID: "ses_parent0000000000000000", created: "evt_0000", revision: 1 },
          sourceMessageID: "msg_old_asst",
          message: {
            id: "msg_copied_asst",
            type: "assistant",
            agent: "build",
            model: { providerID: "xai", id: "grok-4-fast" },
            content: [],
            finish: "stop",
            cost: 0,
            tokens: {
              input: 999,
              output: 888,
              reasoning: 77,
              cache: { read: 111, write: 22 },
            },
            time: { created: T0 + 50, completed: T0 + 90 },
          },
        },
      },
      {
        id: "evt_copy_4",
        type: "session.next.history.copy.completed",
        durable: durable(4),
        data: {
          timestamp: T0 + 400,
          sessionID: SESSION_ID,
          source: { sessionID: "ses_parent0000000000000000", created: "evt_0000", revision: 1 },
          count: 2,
          todos: [],
        },
      },
    ]

    expect(() =>
      buildNativeSessionUsageReport({
        session: { id: SESSION_ID, time: { created: T0, updated: T0 + 400 } },
        events: importedEvents,
      }),
    ).toThrow(`No usage recorded for session '${SESSION_ID}'.`)

    const withFreshTurn = [
      ...importedEvents,
      {
        id: "evt_fresh_1",
        type: "session.next.prompted",
        durable: durable(5),
        data: {
          timestamp: T0 + 1000,
          sessionID: SESSION_ID,
          messageID: "msg_fresh_user",
          prompt: { text: "Fresh follow-up" },
          delivery: "steer",
        },
      },
      {
        id: "evt_fresh_2",
        type: "session.next.step.started",
        durable: durable(6),
        data: {
          timestamp: T0 + 1100,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_fresh_asst",
          agent: "build",
          model: { providerID: "xai", id: "grok-4-fast" },
        },
      },
      {
        id: "evt_fresh_3",
        type: "session.next.step.ended",
        durable: durable(7, 2),
        data: {
          timestamp: T0 + 1200,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_fresh_asst",
          finish: "stop",
          cost: 0,
          tokens: {
            input: 40,
            output: 10,
            reasoning: 0,
            cache: { read: 20, write: 0 },
          },
        },
      },
    ]

    const report = buildNativeSessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 1200 } },
      events: withFreshTurn,
    })

    expect(report.importedContextSteps).toBe(1)
    expect(report.session.turnCount).toBe(1)
    expect(report.session.modelCalls).toBe(1)
    expect(report.session.inputTokens).toBe(40)
    expect(report.session.outputTokens).toBe(10)
    expect(report.session.totalTokens).toBe(50)
  })

  test("retains pre-compaction and post-compaction turns across manual compaction boundaries", () => {
    const events = [
      {
        id: "evt_c1",
        type: "session.next.prompted",
        durable: durable(1),
        data: {
          timestamp: T0 + 1000,
          sessionID: SESSION_ID,
          messageID: "msg_u1",
          prompt: { text: "Before compaction" },
          delivery: "steer",
        },
      },
      {
        id: "evt_c2",
        type: "session.next.step.started",
        durable: durable(2),
        data: {
          timestamp: T0 + 1100,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a1",
          agent: "build",
          model: { providerID: "xai", id: "grok-4-fast" },
        },
      },
      {
        id: "evt_c3",
        type: "session.next.step.ended",
        durable: durable(3, 2),
        data: {
          timestamp: T0 + 1200,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a1",
          finish: "stop",
          cost: 0,
          tokens: { input: 80, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      },
      {
        id: "evt_c4",
        type: "session.next.compaction.started",
        durable: durable(4),
        data: {
          timestamp: T0 + 2000,
          sessionID: SESSION_ID,
          messageID: "msg_compact_1",
          reason: "manual",
        },
      },
      {
        id: "evt_c5",
        type: "session.next.compaction.ended",
        durable: durable(5),
        data: {
          timestamp: T0 + 2500,
          sessionID: SESSION_ID,
          messageID: "msg_compact_1",
          reason: "manual",
          text: "Compacted summary",
          recent: "msg_u1",
        },
      },
      {
        id: "evt_c6",
        type: "session.next.prompted",
        durable: durable(6),
        data: {
          timestamp: T0 + 3000,
          sessionID: SESSION_ID,
          messageID: "msg_u2",
          prompt: { text: "After compaction" },
          delivery: "steer",
        },
      },
      {
        id: "evt_c7",
        type: "session.next.step.started",
        durable: durable(7),
        data: {
          timestamp: T0 + 3100,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a2",
          agent: "build",
          model: { providerID: "xai", id: "grok-4-fast" },
        },
      },
      {
        id: "evt_c8",
        type: "session.next.step.ended",
        durable: durable(8, 2),
        data: {
          timestamp: T0 + 3200,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a2",
          finish: "stop",
          cost: 0,
          tokens: { input: 50, output: 15, reasoning: 0, cache: { read: 30, write: 0 } },
        },
      },
    ]

    const report = buildNativeSessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 3200 } },
      events,
    })

    expect(report.compactionCount).toBe(1)
    expect(report.turns).toHaveLength(2)
    expect(report.session.turnCount).toBe(2)
    expect(report.session.totalTokens).toBe(165)
  })

  test("marks failed and unfinished provider steps as incomplete without inventing completed model calls", () => {
    const events = [
      {
        id: "evt_f1",
        type: "session.next.prompted",
        durable: durable(1),
        data: {
          timestamp: T0 + 1000,
          sessionID: SESSION_ID,
          messageID: "msg_u_fail",
          prompt: { text: "Will fail" },
          delivery: "steer",
        },
      },
      {
        id: "evt_f2",
        type: "session.next.step.started",
        durable: durable(2),
        data: {
          timestamp: T0 + 1100,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a_ok",
          agent: "build",
          model: { providerID: "xai", id: "grok-4-fast" },
        },
      },
      {
        id: "evt_f3",
        type: "session.next.step.ended",
        durable: durable(3, 2),
        data: {
          timestamp: T0 + 1200,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a_ok",
          finish: "tool-calls",
          cost: 0,
          tokens: { input: 60, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      },
      {
        id: "evt_f4",
        type: "session.next.step.started",
        durable: durable(4),
        data: {
          timestamp: T0 + 1300,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a_failed",
          agent: "build",
          model: { providerID: "xai", id: "grok-4-fast" },
        },
      },
      {
        id: "evt_f5",
        type: "session.next.step.failed",
        durable: durable(5, 2),
        data: {
          timestamp: T0 + 1400,
          sessionID: SESSION_ID,
          assistantMessageID: "msg_a_failed",
          error: { type: "unknown", message: "Provider stream interrupted" },
        },
      },
      {
        id: "evt_f6",
        type: "session.next.input.execution.settled",
        durable: durable(6),
        data: {
          timestamp: T0 + 1500,
          sessionID: SESSION_ID,
          messageID: "msg_u_fail",
          status: "failed",
          reason: "provider_error",
          usageIncomplete: true,
        },
      },
    ]

    const report = buildNativeSessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 1500 } },
      events,
    })

    expect(report.session.modelCalls).toBe(1)
    expect(report.session.totalTokens).toBe(70)
    expect(report.session.usageIsIncomplete).toBe(true)
    expect(report.turns[0]?.usageIsIncomplete).toBe(true)
    expect(report.turns[0]?.steps).toHaveLength(2)
    expect(report.turns[0]?.steps[1]?.modelCalls).toBe(0)
    expect(report.turns[0]?.steps[1]?.usageIsIncomplete).toBe(true)
    expect(report.turns[0]?.steps[1]?.error).toBe("Provider stream interrupted")
  })

  test("deduplicates duplicate history events and rejects non-advancing pagination cursors", async () => {
    const stepStarted = {
      id: "evt_d2",
      type: "session.next.step.started",
      durable: durable(2),
      data: {
        timestamp: T0 + 1100,
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a_dup",
        agent: "build",
        model: { providerID: "xai", id: "grok-4-fast" },
      },
    }
    const stepEnded = {
      id: "evt_d3",
      type: "session.next.step.ended",
      durable: durable(3, 2),
      data: {
        timestamp: T0 + 1200,
        sessionID: SESSION_ID,
        assistantMessageID: "msg_a_dup",
        finish: "stop",
        cost: 0,
        tokens: { input: 30, output: 12, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    }
    const duplicateSettlementDifferentSeq = {
      ...stepEnded,
      id: "evt_d4",
      durable: durable(4, 2),
    }

    const report = buildNativeSessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 1200 } },
      events: [
        {
          id: "evt_d1",
          type: "session.next.prompted",
          durable: durable(1),
          data: {
            timestamp: T0 + 1000,
            sessionID: SESSION_ID,
            messageID: "msg_u_dup",
            prompt: { text: "Duplicate test" },
            delivery: "steer",
          },
        },
        stepStarted,
        stepStarted,
        stepEnded,
        stepEnded,
        duplicateSettlementDifferentSeq,
      ],
    })

    expect(report.session.modelCalls).toBe(1)
    expect(report.session.totalTokens).toBe(42)

    await expect(
      fetchNativeHistoryPages(
        async (after) => ({
          data: [
            {
              id: "evt_stuck",
              type: "session.next.prompted",
              durable: durable(after === 0 ? 1 : 1),
              data: {
                timestamp: T0 + 1000,
                sessionID: SESSION_ID,
                messageID: "msg_u_dup",
                prompt: { text: "Stuck cursor" },
                delivery: "steer",
              },
            },
          ],
          hasMore: true,
        }),
        SESSION_ID,
      ),
    ).rejects.toThrow(`Native session '${SESSION_ID}' history pagination cursor did not advance past seq 1.`)
  })

  test("returns distinct errors for missing session, no recorded usage, missing turn, and invalid turn", async () => {
    expect(() => parseTurnSelector("0")).toThrow("Turn must be a positive integer, got '0'.")
    expect(() => parseTurnSelector("-2")).toThrow("Turn must be a positive integer, got '-2'.")
    expect(() => parseTurnSelector("abc")).toThrow("Turn must be a positive integer, got 'abc'.")
    expect(parseTurnSelector("2")).toBe(2)

    const { createApexoClient } = await import("@apexo/sdk/v2/client")
    const { createNativeLocalHost } = await import("../../src/cli/native-local-host")
    const host = createNativeLocalHost(undefined, true)
    try {
      const client = createApexoClient({
        baseUrl: "http://apexo.local",
        fetch: host.fetch,
        directory: process.cwd(),
      })

      await expect(readNativeUsageFromClient(client, "ses_missing0000000000000000")).rejects.toThrow(
        "Session 'ses_missing0000000000000000' not found.",
      )

      const created = (
        await client.v2.session.create(
          { location: { directory: process.cwd() } },
          { throwOnError: true },
        )
      ).data.data
      try {
        await expect(readNativeUsageFromClient(client, created.id)).rejects.toThrow(
          `No usage recorded for session '${created.id}'.`,
        )
      } finally {
        await client.v2.session.remove({ sessionID: created.id }, { throwOnError: false })
      }
    } finally {
      await host.close()
    }

    expect(() =>
      buildNativeSessionUsageReport({
        session: { id: SESSION_ID, time: { created: T0, updated: T0 + 2000 } },
        events: [
          {
            id: "evt_t1",
            type: "session.next.prompted",
            durable: durable(1),
            data: {
              timestamp: T0 + 1000,
              sessionID: SESSION_ID,
              messageID: "msg_u1",
              prompt: { text: "Turn 1" },
              delivery: "steer",
            },
          },
          {
            id: "evt_t2",
            type: "session.next.step.started",
            durable: durable(2),
            data: {
              timestamp: T0 + 1100,
              sessionID: SESSION_ID,
              assistantMessageID: "msg_a1",
              agent: "build",
              model: { providerID: "xai", id: "grok-4-fast" },
            },
          },
          {
            id: "evt_t3",
            type: "session.next.step.ended",
            durable: durable(3, 2),
            data: {
              timestamp: T0 + 1200,
              sessionID: SESSION_ID,
              assistantMessageID: "msg_a1",
              finish: "stop",
              cost: 0,
              tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          },
        ],
        turn: 9,
      }),
    ).toThrow(`Turn 9 not found in session '${SESSION_ID}'.`)
  })

  test("reports compatibility persisted token and cost values without recomputing pricing", () => {
    const messages = [
      {
        info: {
          id: "msg_compat_u1",
          sessionID: SESSION_ID,
          role: "user",
          time: { created: T0 + 1000 },
          agent: "build",
          model: { providerID: "xai", modelID: "grok-4-fast" },
        },
        parts: [],
      },
      {
        info: {
          id: "msg_compat_a1",
          sessionID: SESSION_ID,
          role: "assistant",
          parentID: "msg_compat_u1",
          time: { created: T0 + 1100, completed: T0 + 1500 },
          modelID: "grok-4-fast",
          providerID: "xai",
          mode: "build",
          agent: "build",
          path: { cwd: "/repo", root: "/repo" },
          cost: 0.0042,
          tokens: {
            input: 250,
            output: 50,
            reasoning: 15,
            cache: { read: 100, write: 25 },
          },
          finish: "stop",
        },
        parts: [],
      },
    ] as unknown as readonly SessionV1.WithParts[]

    const report = buildCompatibilitySessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 1500 } },
      messages,
    })

    expect(report.backend).toBe("compatibility")
    expect(report.accountingScope).toBe("projected-message-history")
    expect(report.costStatus).toBe("recorded")
    expect(report.session.costUsd).toBe(0.0042)
    expect(report.session.costIsPartial).toBe(false)
    expect(report.session.usageIsIncomplete).toBe(false)
    expect(report.session.totalTokens).toBe(300)
    expect(report.session.modelCalls).toBe(1)
    expect(report.session.modelUsage["grok-4-fast"]?.costUsd).toBe(0.0042)
    expect(report.turns[0]?.costUsd).toBe(0.0042)
  })

  test("loadSessionUsage respects selected transport on attached server without cross-backend fallback", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/global/health") {
          return new Response("Not found", { status: 404 })
        }
        if (url.pathname === "/api/health") {
          return Response.json({ healthy: true })
        }
        if (url.pathname === `/api/session/${SESSION_ID}`) {
          return Response.json({
            data: {
              id: SESSION_ID,
              projectID: "proj_test",
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: T0, updated: T0 + 2000 },
              title: "Attached Native Session",
              location: { directory: "/repo" },
            },
          })
        }
        if (url.pathname === `/api/session/${SESSION_ID}/history`) {
          return Response.json({
            data: [
              {
                id: "evt_att_1",
                type: "session.next.prompted",
                durable: durable(1),
                data: {
                  timestamp: T0 + 1000,
                  sessionID: SESSION_ID,
                  messageID: "msg_att_u1",
                  prompt: { text: "Hello attached" },
                  delivery: "steer",
                },
              },
              {
                id: "evt_att_2",
                type: "session.next.step.started",
                durable: durable(2),
                data: {
                  timestamp: T0 + 1100,
                  sessionID: SESSION_ID,
                  assistantMessageID: "msg_att_a1",
                  agent: "build",
                  model: { providerID: "xai", id: "grok-4-fast" },
                },
              },
              {
                id: "evt_att_3",
                type: "session.next.step.ended",
                durable: durable(3, 2),
                data: {
                  timestamp: T0 + 1200,
                  sessionID: SESSION_ID,
                  assistantMessageID: "msg_att_a1",
                  finish: "stop",
                  cost: 0,
                  tokens: { input: 15, output: 5, reasoning: 2, cache: { read: 0, write: 0 } },
                },
              },
            ],
            hasMore: false,
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    try {
      const report = await loadSessionUsage({
        sessionID: SESSION_ID,
        attach: server.url.origin,
        sessionProtocol: "auto",
      })
      expect(report.backend).toBe("native")
      expect(report.observedSeq).toBe(3)
      expect(report.session.totalTokens).toBe(20)
      expect(report.session.modelCalls).toBe(1)

      const turn1 = await loadSessionUsage({
        sessionID: SESSION_ID,
        turn: 1,
        attach: server.url.origin,
        sessionProtocol: "native",
      })
      expect(turn1.turns).toHaveLength(1)
      expect(turn1.turns[0]?.turnNumber).toBe(1)

      await expect(
        loadSessionUsage({
          sessionID: SESSION_ID,
          attach: server.url.origin,
          sessionProtocol: "compatibility",
        }),
      ).rejects.toThrow(`Session '${SESSION_ID}' not found.`)
    } finally {
      await server.stop(true)
    }
  })

  test("handles out-of-order durable events, foreign session injection, steered mid-turn prompts, and zero-step failed settlements", () => {
    const FOREIGN_SESSION = "ses_99999999999999999999999999"
    const report = buildNativeSessionUsageReport({
      session: { id: SESSION_ID, time: { created: T0, updated: T0 + 9000 } },
      events: [
        // Foreign session event with colliding seq=1 and assistant ID must be ignored completely
        {
          id: "evt_foreign_1",
          type: "session.next.step.ended",
          durable: { aggregateID: FOREIGN_SESSION, seq: 1, version: 2 },
          data: {
            timestamp: T0 + 9999,
            sessionID: FOREIGN_SESSION,
            assistantMessageID: "msg_adv_a1",
            finish: "stop",
            cost: 0,
            tokens: { input: 9999, output: 9999, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
        // Out-of-order delivery: seq 4 (Step.Ended for a1) delivered BEFORE seq 1, 2, 3!
        {
          id: "evt_adv_4",
          type: "session.next.step.ended",
          durable: durable(4, 2),
          data: {
            timestamp: T0 + 4000,
            sessionID: SESSION_ID,
            assistantMessageID: "msg_adv_a1",
            finish: "tool-calls",
            cost: 0,
            tokens: { input: 100, output: 40, reasoning: 5, cache: { read: 20, write: 0 } },
          },
        },
        // seq 3: Steered prompt u2 arrives BEFORE a1 finishes (seq 4)
        {
          id: "evt_adv_3",
          type: "session.next.prompted",
          durable: durable(3),
          data: {
            timestamp: T0 + 3000,
            sessionID: SESSION_ID,
            messageID: "msg_adv_u2",
            prompt: { text: "Steered second prompt" },
            delivery: "steer",
          },
        },
        // seq 2: Step.Started for a1 (under u1)
        {
          id: "evt_adv_2",
          type: "session.next.step.started",
          durable: durable(2),
          data: {
            timestamp: T0 + 2000,
            sessionID: SESSION_ID,
            assistantMessageID: "msg_adv_a1",
            agent: "build",
            model: { providerID: "xai", id: "grok-4.7" },
          },
        },
        // seq 1: Prompted u1
        {
          id: "evt_adv_1",
          type: "session.next.prompted",
          durable: durable(1),
          data: {
            timestamp: T0 + 1000,
            sessionID: SESSION_ID,
            messageID: "msg_adv_u1",
            prompt: { text: "First prompt" },
            delivery: "steer",
          },
        },
        // seq 5: Step.Started for a2 (under steered u2)
        {
          id: "evt_adv_5",
          type: "session.next.step.started",
          durable: durable(5),
          data: {
            timestamp: T0 + 5000,
            sessionID: SESSION_ID,
            assistantMessageID: "msg_adv_a2",
            agent: "build",
            model: { providerID: "xai", id: "grok-4.7" },
          },
        },
        // seq 6: Step.Ended for a2
        {
          id: "evt_adv_6",
          type: "session.next.step.ended",
          durable: durable(6, 2),
          data: {
            timestamp: T0 + 6000,
            sessionID: SESSION_ID,
            assistantMessageID: "msg_adv_a2",
            finish: "stop",
            cost: 0,
            tokens: { input: 160, output: 60, reasoning: 10, cache: { read: 80, write: 0 } },
          },
        },
        // seq 7 & 8: Prompt u3 fails before any Step.Started is emitted, with usageIncomplete: false
        {
          id: "evt_adv_7",
          type: "session.next.prompted",
          durable: durable(7),
          data: {
            timestamp: T0 + 7000,
            sessionID: SESSION_ID,
            messageID: "msg_adv_u3",
            prompt: { text: "Third prompt fails pre-provider" },
            delivery: "steer",
          },
        },
        {
          id: "evt_adv_8",
          type: "session.next.input.execution.settled",
          durable: durable(8),
          data: {
            timestamp: T0 + 8000,
            sessionID: SESSION_ID,
            messageID: "msg_adv_u3",
            status: "failed",
            reason: "provider_error",
            usageIncomplete: false,
          },
        },
      ],
    })

    expect(report.observedSeq).toBe(8)
    expect(report.session.turnCount).toBe(3)
    expect(report.session.totalTokens).toBe(360)
    expect(report.session.modelCalls).toBe(2)
    expect(report.session.usageIsIncomplete).toBe(true)

    // Turn 1 (u1) owns a1 even though steered u2 arrived before a1's Step.Ended
    expect(report.turns[0]?.userMessageId).toBe("msg_adv_u1")
    expect(report.turns[0]?.totalTokens).toBe(140)
    expect(report.turns[0]?.modelCalls).toBe(1)
    expect(report.turns[0]?.usageIsIncomplete).toBe(false)

    // Turn 2 (u2) owns a2
    expect(report.turns[1]?.userMessageId).toBe("msg_adv_u2")
    expect(report.turns[1]?.totalTokens).toBe(220)
    expect(report.turns[1]?.modelCalls).toBe(1)
    expect(report.turns[1]?.usageIsIncomplete).toBe(false)

    // Turn 3 (u3) failed with 0 steps and usageIncomplete: false -> still retained as incomplete turn
    expect(report.turns[2]?.userMessageId).toBe("msg_adv_u3")
    expect(report.turns[2]?.totalTokens).toBe(0)
    expect(report.turns[2]?.modelCalls).toBe(0)
    expect(report.turns[2]?.usageIsIncomplete).toBe(true)
  })

  test("reads compatibility usage over attached HTTP and preserves earliest user timestamp on out-of-order messages", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/global/health") {
          return Response.json({ healthy: true, version: "1.0.0" })
        }
        if (url.pathname === `/session/${SESSION_ID}`) {
          return Response.json({
            id: SESSION_ID,
            slug: "compat-slug",
            projectID: "proj_compat",
            directory: "/repo",
            title: "Compat Session",
            version: "1.0.0",
            time: { created: T0, updated: T0 + 2000 },
          })
        }
        if (url.pathname === `/session/${SESSION_ID}/message`) {
          // Deliver assistant message BEFORE its parent user message to test timestamp ordering
          return Response.json([
            {
              info: {
                id: "msg_c_a1",
                sessionID: SESSION_ID,
                role: "assistant",
                parentID: "msg_c_u1",
                time: { created: T0 + 1500, completed: T0 + 2000 },
                modelID: "grok-4.7",
                providerID: "xai",
                mode: "build",
                agent: "build",
                path: { cwd: "/repo", root: "/repo" },
                cost: 0.0125,
                tokens: {
                  input: 400,
                  output: 100,
                  reasoning: 20,
                  cache: { read: 50, write: 10 },
                },
                finish: "stop",
              },
              parts: [],
            },
            {
              info: {
                id: "msg_c_u1",
                sessionID: SESSION_ID,
                role: "user",
                time: { created: T0 + 1000 },
                agent: "build",
                model: { providerID: "xai", modelID: "grok-4.7" },
              },
              parts: [],
            },
          ])
        }
        return new Response("Not found", { status: 404 })
      },
    })
    try {
      const report = await loadSessionUsage({
        sessionID: SESSION_ID,
        attach: server.url.origin,
        sessionProtocol: "auto",
      })
      expect(report.backend).toBe("compatibility")
      expect(report.accountingScope).toBe("projected-message-history")
      expect(report.costStatus).toBe("recorded")
      expect(report.session.totalTokens).toBe(500)
      expect(report.session.costUsd).toBe(0.0125)
      expect(report.turns).toHaveLength(1)
      expect(report.turns[0]?.startedAt).toBe(new Date(T0 + 1000).toISOString())
      expect(report.turns[0]?.endedAt).toBe(new Date(T0 + 2000).toISOString())

      // Explicit native protocol against compatibility-only server must fail closed without fallback
      await expect(
        loadSessionUsage({
          sessionID: SESSION_ID,
          attach: server.url.origin,
          sessionProtocol: "native",
        }),
      ).rejects.toThrow(`Session '${SESSION_ID}' not found.`)
    } finally {
      await server.stop(true)
    }
  })
})
