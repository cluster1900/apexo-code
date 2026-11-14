/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Effect } from "effect"
import { SessionID } from "@apexo/schema/session-id"
import { Event } from "@apexo/schema/event"
import { ArgsProvider } from "@apexo/tui/context/args"
import { RouteProvider } from "../../../../tui/src/context/route"
import { SDKProvider } from "@apexo/tui/context/sdk"
import { PermissionProvider, usePermission } from "../../../../tui/src/context/permission"
import { TuiStartupProvider } from "@apexo/tui/context/runtime"
import { pollWithTimeout } from "../../lib/effect"

test("fullscreen reconnect replaces old mode revisions and /auto can enable the new backend", async () => {
  const sessionID = SessionID.create()
  const state = {
    mode: "review",
    revision: 3,
    reads: 0,
    controller: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
    permission: undefined as ReturnType<typeof usePermission> | undefined,
  }
  const fetcher: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith("/permission-review")) {
        if (request.method === "PUT") {
          state.mode = (await request.json()).mode
          state.revision++
        }
        state.reads++
        return Response.json({ data: { mode: state.mode, revision: state.revision } })
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            state.controller = controller
          },
        }),
        {
          headers: { "content-type": "text/event-stream" },
        },
      )
    },
    { preconnect: fetch.preconnect },
  )
  function Probe() {
    const permission = usePermission()
    state.permission = permission
    return <text>{`mode:${permission.mode}`}</text>
  }
  const app = await testRender(
    () => (
      <TuiStartupProvider value={{ skipInitialLoading: true }}>
        <ArgsProvider>
          <RouteProvider initialRoute={{ type: "session", sessionID }}>
            <SDKProvider url="http://fixture.invalid" sessionProtocol="native" fetch={fetcher}>
              <PermissionProvider>
                <Probe />
              </PermissionProvider>
            </SDKProvider>
          </RouteProvider>
        </ArgsProvider>
      </TuiStartupProvider>
    ),
    { width: 80, height: 5 },
  )
  const frame = (mode: string) =>
    Effect.runPromise(
      pollWithTimeout(
        Effect.promise(async () => {
          await app.renderOnce()
          return app.captureCharFrame().includes(`mode:${mode}`) && state.controller ? true : undefined
        }),
        `permission mode ${mode}`,
      ),
    )
  try {
    await frame("review")
    state.mode = "manual"
    state.revision = 0
    state.controller!.enqueue(new TextEncoder().encode('data: {"type":"server.connected"}\n\n'))
    await frame("normal")
    expect(state.reads).toBeGreaterThanOrEqual(2)
    await state.permission!.toggleReview()
    await frame("review")
    expect(state.mode).toBe("review")
    expect(state.revision).toBe(1)
    state.controller!.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({
          id: Event.ID.create(),
          type: "permission.review.mode.changed",
          data: { sessionID, mode: "manual", revision: 0 },
        })}\n\n`,
      ),
    )
    await app.renderOnce()
    await state.permission!.toggleReview()
    await frame("normal")
    expect(state.mode).toBe("manual")
  } finally {
    state.controller?.close()
    app.renderer.destroy()
  }
}, 15000)
