import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { SessionProjector } from "@apexo/core/session/projector"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Session } from "@/session/session"
import { SessionMemoryBackend } from "@/session/memory-backend"
import { SessionMemoryMode } from "@/session/memory-mode"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const settings: { current: ConfigV1.Info } = { current: {} }
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([SessionMemoryBackend.node, SessionMemoryMode.node, Session.node, SessionProjector.node]),
    [
      [Config.node, TestConfig.layer({ get: () => Effect.sync(() => settings.current) })],
      [RuntimeFlags.node, RuntimeFlags.layer({ runtimeProfile: "grok-build" })],
      [InstanceBootstrap.node, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
    ],
  ),
)

it.instance("session backend stays pinned, with rollout and write kill switches restricting V2", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const backend = yield* SessionMemoryBackend.Service
    const mode = yield* SessionMemoryMode.Service
    settings.current = { memory: { enabled: true } }
    const legacy = yield* sessions.create()
    expect((yield* backend.get(legacy.id)).backend).toBe("legacy")
    settings.current = { memory_v2: { enabled: true, rollout: "active" } }
    expect((yield* backend.get(legacy.id)).backend).toBe("legacy")
    const v2 = yield* sessions.create()
    expect(yield* backend.get(v2.id)).toMatchObject({ backend: "v2", rollout: "active", capture: true, expose: true })
    expect((yield* mode.get(v2.id)).enabled).toBe(true)
    settings.current = { memory_v2: { enabled: true, rollout: "record_only" } }
    const recorded = yield* sessions.create()
    expect((yield* backend.get(recorded.id)).rollout).toBe("record_only")
    expect(yield* backend.get(v2.id)).toMatchObject({ rollout: "record_only", capture: true, expose: false })
    settings.current = { memory_v2: { enabled: true, rollout: "active", capture_enabled: false } }
    expect(yield* backend.get(recorded.id)).toMatchObject({ rollout: "record_only", capture: false, expose: false })
    settings.current = { memory_v2: { enabled: true, file_writes_enabled: false } }
    expect(yield* mode.get(v2.id)).toMatchObject({ enabled: false, canToggle: false })
    expect((yield* mode.set(v2.id, true).pipe(Effect.result))._tag).toBe("Failure")
    settings.current = { memory_v2: { enabled: true, rollout: "off" } }
    expect(yield* backend.get(v2.id)).toMatchObject({ capture: false, expose: false, restricted: true })
    settings.current = { memory_v2: { enabled: true } }
    yield* mode.set(v2.id, false)
    expect((yield* mode.get(v2.id)).enabled).toBe(false)
    yield* mode.set(v2.id, true)
    expect((yield* mode.get(v2.id)).enabled).toBe(true)
  }),
)
