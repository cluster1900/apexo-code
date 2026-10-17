import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  buildNativeSessionTraceBundle,
  buildCompatibilitySessionTraceBundle,
  exportSessionTraceArchive,
  loadSessionTraceBundle,
  readNativeTraceFromClient,
} from "../../src/cli/cmd/trace"
import type { SessionV1 } from "@apexo/core/v1/session"

const SESSION_ID = "ses_01a13291000000000000000099"
const T0 = 1_760_500_000_000

function durable(seq: number, version = 1) {
  return {
    aggregateID: SESSION_ID,
    seq,
    version,
  }
}

describe("apexo trace", () => {
  test("builds native trace bundle with summary, usage, events, chat history, trace_config, and export_metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "apexo-trace-unit-"))
    const events = [
      {
        id: "evt_0001",
        type: "session.next.prompted",
        durable: durable(1),
        data: {
          timestamp: T0 + 1000,
          sessionID: SESSION_ID,
          messageID: "msg_user_0001",
          prompt: { text: "Secret prompt token=sk-12345" },
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
          model: { providerID: "xai", id: "grok-4" },
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
          finish: "stop",
          cost: 0,
          tokens: {
            input: 40,
            output: 20,
            reasoning: 5,
            cache: { read: 10, write: 0 },
          },
        },
      },
    ]
    const messages = [
      {
        id: "msg_user_0001",
        type: "user",
        time: { created: T0 + 1000 },
        text: "Secret prompt token=sk-12345",
      },
      {
        id: "msg_asst_0001",
        type: "assistant",
        time: { created: T0 + 2000, completed: T0 + 3000 },
        content: [{ type: "text", text: "Assistant secret reply" }],
      },
    ]

    const bundle = buildNativeSessionTraceBundle({
      session: {
        id: SESSION_ID,
        title: "Trace test session",
        location: { directory: "/workspace/project" },
        agent: "build",
        model: { providerID: "xai", id: "grok-4" },
        time: { created: T0, updated: T0 + 3000 },
      },
      events,
      messages,
      sanitize: false,
    })

    expect(bundle.sessionId).toBe(SESSION_ID)
    expect(Object.keys(bundle.files).sort()).toEqual([
      "chat_history.jsonl",
      "events.jsonl",
      "export_metadata.json",
      "summary.json",
      "trace_config.json",
      "usage.json",
    ])
    const summary = JSON.parse(bundle.files["summary.json"]!)
    expect(summary.info.id).toBe(SESSION_ID)
    expect(summary.info.cwd).toBe("/workspace/project")
    expect(summary.current_model_id).toBe("grok-4")
    expect(summary.num_messages).toBe(2)

    const usage = JSON.parse(bundle.files["usage.json"]!)
    expect(usage.session.totalTokens).toBe(60)
    expect(usage.session.modelCalls).toBe(1)

    const outPath = path.join(dir, "custom-trace.tar.gz")
    const exported = await exportSessionTraceArchive({
      bundle,
      outputPath: outPath,
      explicitOutput: true,
    })
    expect(exported).toEqual({
      session_id: SESSION_ID,
      status: "exported",
      local_path: outPath,
    })
    expect(existsSync(outPath)).toBe(true)

    const listing = spawnSync("tar", ["-ztf", outPath], { encoding: "utf8" })
    expect(listing.status).toBe(0)
    const entries = listing.stdout.trim().split("\n").sort()
    expect(entries).toEqual([
      `${SESSION_ID}/chat_history.jsonl`,
      `${SESSION_ID}/events.jsonl`,
      `${SESSION_ID}/export_metadata.json`,
      `${SESSION_ID}/summary.json`,
      `${SESSION_ID}/trace_config.json`,
      `${SESSION_ID}/usage.json`,
    ])

    const extractedSummary = spawnSync("tar", ["-zxvf", outPath, "-O", `${SESSION_ID}/summary.json`], {
      encoding: "utf8",
    })
    expect(extractedSummary.status).toBe(0)
    expect(JSON.parse(extractedSummary.stdout).info.id).toBe(SESSION_ID)

    await expect(
      exportSessionTraceArchive({
        bundle,
        outputPath: outPath,
        explicitOutput: true,
      }),
    ).rejects.toThrow("already exists")
  })

  test("sanitize mode redacts sensitive prompt and assistant text in events.jsonl, chat_history.jsonl, and summary.json", () => {
    const events = [
      {
        id: "evt_0001",
        type: "session.next.prompted",
        durable: durable(1),
        data: {
          timestamp: T0 + 1000,
          sessionID: SESSION_ID,
          messageID: "msg_user_0001",
          prompt: { text: "TOP_SECRET_PROMPT_VALUE" },
          delivery: "steer",
        },
      },
    ]
    const messages = [
      {
        id: "msg_user_0001",
        type: "user",
        time: { created: T0 + 1000 },
        text: "TOP_SECRET_PROMPT_VALUE",
      },
    ]
    const bundle = buildNativeSessionTraceBundle({
      session: {
        id: SESSION_ID,
        title: "TOP_SECRET_TITLE",
        location: { directory: "/secret/workspace/path" },
        time: { created: T0, updated: T0 + 1000 },
      },
      events,
      messages,
      sanitize: true,
    })
    const serialized = JSON.stringify(bundle.files)
    expect(serialized).not.toContain("TOP_SECRET_PROMPT_VALUE")
    expect(serialized).not.toContain("TOP_SECRET_TITLE")
    expect(serialized).not.toContain("/secret/workspace/path")
    expect(serialized).toContain("[redacted:")
  })

  test("compatibility trace bundle exports zero-turn and multi-turn sessions and rejects existing -o target", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "apexo-trace-compat-"))
    const existingTarget = path.join(dir, "already-there.tar.gz")
    await writeFile(existingTarget, "do-not-overwrite")

    const messages: SessionV1.WithParts[] = []
    const bundle = buildCompatibilitySessionTraceBundle({
      session: {
        id: SESSION_ID,
        title: "Empty compatibility session",
        directory: "/workspace/compat",
        time: { created: T0, updated: T0 + 500 },
      },
      messages,
      sanitize: false,
    })
    expect(JSON.parse(bundle.files["usage.json"]!).session.totalTokens).toBe(0)

    await expect(
      exportSessionTraceArchive({
        bundle,
        outputPath: existingTarget,
        explicitOutput: true,
      }),
    ).rejects.toThrow("already exists")
    expect(await readFile(existingTarget, "utf8")).toBe("do-not-overwrite")
  })

  test("readNativeTraceFromClient and loadSessionTraceBundle export live native session and reject missing session", async () => {
    const { createApexoClient } = await import("@apexo/sdk/v2/client")
    const { createNativeLocalHost } = await import("../../src/cli/native-local-host")
    const host = createNativeLocalHost(undefined, true)
    try {
      const client = createApexoClient({
        baseUrl: "http://apexo.local",
        fetch: host.fetch,
        directory: process.cwd(),
      })

      await expect(readNativeTraceFromClient(client, "invalid-id")).rejects.toThrow(
        "Session 'invalid-id' not found.",
      )
      await expect(readNativeTraceFromClient(client, "ses_missing0000000000000000")).rejects.toThrow(
        "Session 'ses_missing0000000000000000' not found.",
      )

      const created = (
        await client.v2.session.create(
          { location: { directory: process.cwd() } },
          { throwOnError: true },
        )
      ).data.data
      try {
        const bundle = await readNativeTraceFromClient(client, created.id, false)
        expect(bundle.sessionId).toBe(created.id)
        const summary = JSON.parse(bundle.files["summary.json"]!)
        expect(summary.info.id).toBe(created.id)
        expect(summary.info.title).toBe(created.title)

        const sanitizedBundle = await readNativeTraceFromClient(client, created.id, true)
        expect(sanitizedBundle.files["summary.json"]).not.toContain(created.title)
        expect(sanitizedBundle.files["summary.json"]).toContain("[redacted:")
      } finally {
        await client.v2.session.remove({ sessionID: created.id }, { throwOnError: false })
      }
    } finally {
      await host.close()
    }

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
              title: "Attached Native Trace Title",
              location: { directory: "/repo/secret" },
            },
          })
        }
        if (url.pathname === `/api/session/${SESSION_ID}/history`) {
          return Response.json({
            data: [],
            hasMore: false,
          })
        }
        if (url.pathname === `/api/session/${SESSION_ID}/message`) {
          return Response.json({
            data: [],
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    try {
      const attached = await loadSessionTraceBundle({
        sessionID: SESSION_ID,
        attach: server.url.origin,
        sessionProtocol: "native",
        sanitize: true,
      })
      expect(attached.sessionId).toBe(SESSION_ID)
      expect(attached.files["summary.json"]).not.toContain("Attached Native Trace Title")
      expect(attached.files["summary.json"]).not.toContain("/repo/secret")
      expect(attached.files["summary.json"]).toContain("[redacted:")
    } finally {
      await server.stop(true)
    }
  })
})


