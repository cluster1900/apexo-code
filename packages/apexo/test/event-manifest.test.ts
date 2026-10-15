import { describe, expect, test } from "bun:test"
import { SessionEvent } from "@apexo/core/session/event"
import { EventManifest } from "@apexo/schema/event-manifest"
import { Todo } from "@/session/todo"
import { Definitions, Durable, Latest } from "@/event-manifest"
import { MemoryCaptureEvent } from "@apexo/schema/memory-capture-event"
import { McpEvent } from "@apexo/schema/mcp-event"
import { LspEvent } from "@apexo/schema/lsp-event"

describe("public event manifest", () => {
  test("contains every latest public wire type once", () => {
    expect(Definitions).toBe(EventManifest.Definitions)
    expect(Latest).toBe(EventManifest.Latest)
    expect(Durable).toBe(EventManifest.Durable)
    expect(EventManifest.Latest.size).toBe(93)
    expect(EventManifest.Latest.get("session.next.prompt.withdrawn")).toBe(SessionEvent.PromptWithdrawn)
    expect(EventManifest.ServerDefinitions).toContain(SessionEvent.PromptWithdrawn)
    expect(EventManifest.Latest.get("session.next.input.execution.settled")).toBe(SessionEvent.InputExecutionSettled)
    expect(EventManifest.ServerDefinitions).toContain(SessionEvent.InputExecutionSettled)
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(Todo.Event.Updated)
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(EventManifest.Latest.has("server.connected")).toBe(true)
    expect(EventManifest.Latest.has("global.disposed")).toBe(true)
  })

  test("native integration status events share canonical identities without exposing compatibility OAuth", () => {
    expect(EventManifest.Latest.get("mcp.status.changed")).toBe(McpEvent.StatusChanged)
    expect(EventManifest.ServerDefinitions).toContain(McpEvent.StatusChanged)
    expect(EventManifest.ServerDefinitions).toContain(LspEvent.Updated)
    expect(EventManifest.ServerDefinitions).not.toContain(McpEvent.BrowserOpenFailed)
    expect(EventManifest.ServerDefinitions).not.toContain(McpEvent.ToolsChanged)
    expect(McpEvent.StatusChanged.durable).toBeUndefined()
    expect(LspEvent.Updated.durable).toBeUndefined()
  })

  test("contains only the current step settlement versions", () => {
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })

  test("history copies retain their canonical durable and public identities", () => {
    for (const event of [
      SessionEvent.HistoryCopy.Started,
      SessionEvent.HistoryCopy.Message,
      SessionEvent.HistoryCopy.Completed,
    ]) {
      expect(EventManifest.Latest.get(event.type)).toBe(event)
      expect(EventManifest.Durable.get(`${event.type}.1`)).toBe(event)
      expect(EventManifest.ServerDefinitions.filter((definition) => definition.type === event.type)).toEqual([
        event,
      ])
    }
  })

  test("capture diagnostics stay transient and outside the current protocol manifest", () => {
    expect(EventManifest.Latest.get("memory.capture.activity")).toBe(MemoryCaptureEvent.Activity)
    expect(MemoryCaptureEvent.Activity.durable).toBeUndefined()
    expect(
      new Set<string>([...EventManifest.Durable.values()].map((event) => event.type)).has("memory.capture.activity"),
    ).toBe(false)
    expect(
      new Set<string>(EventManifest.ServerDefinitions.map((event) => event.type)).has("memory.capture.activity"),
    ).toBe(false)
  })
})
