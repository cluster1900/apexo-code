// Real isolated CLI/Electron backend and model tool calls; no feedback leaves the fixture.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { poll, startShellFixture } from "./grok-shell-fixture.mjs"
const native = process.argv.includes("--native")
const planned = { args: {} }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  next({ ancillary, finished }) {
    if (ancillary || finished) return { content: "Feedback saved locally." }
    return { tool: "send_feedback", args: planned.args }
  },
})
const results = []
try {
  if (native) await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const create = async (title) =>
    native
      ? (
          await runtime.api("/api/session", {
            location: { directory: runtime.directory },
            model: { providerID: "xai", id: "grok-4.7" },
            agent: "build",
            title,
          })
        ).data
      : runtime.api("/session", { title })
  const session = await create("Feedback fixture")
  const route = `${native ? "/api" : ""}/session/${session.id}`
  const root = `${route}/feedback`
  const prompt = async (args, marker) => {
    planned.args = args
    if (native) {
      const before = new Set((await runtime.api(`${route}/message`)).data.map((message) => message.id))
      await runtime.api(`${route}/prompt`, {
        id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        prompt: { text: marker },
      })
      await runtime.api(`${route}/wait`, undefined, "POST")
      return poll(
        async () =>
          (await runtime.api(`${route}/message`)).data
            .filter((message) => !before.has(message.id))
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .find((part) => part.type === "tool" && ["completed", "error"].includes(part.state.status)),
        marker,
      )
    }
    const before = (await runtime.api(`/session/${session.id}/message`)).length
    await runtime.api(`/session/${session.id}/prompt_async`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: marker }],
    })
    const tool = await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`))
          .slice(before)
          .flatMap((message) => message.parts)
          .find(
            (part) =>
              part.type === "tool" &&
              part.tool === "send_feedback" &&
              ["completed", "error"].includes(part.state.status),
          ),
      marker,
    )
    await poll(async () => {
      const messages = (await runtime.api(`/session/${session.id}/message`)).slice(before)
      const completed = messages.some(
        (message) =>
          message.info.role === "assistant" &&
          message.info.time.completed &&
          message.parts.some((part) => part.type === "text" && part.text === "Feedback saved locally."),
      )
      if (!completed) return false
      const status = (await runtime.api("/session/status"))[session.id]
      return !status || status.type === "idle"
    }, "completed feedback follow-up and idle Session")
    return tool
  }
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
  const source = join(runtime.directory, "selected.png")
  await writeFile(source, Buffer.from(data, "base64"))
  const draft = await runtime.api(root, {
    title: "Image report",
    details: "",
    type: "bug",
    images: [
      {
        data: Buffer.from(await Bun.file(source).arrayBuffer()).toString("base64"),
        mimeType: "image/png",
        fileName: "selected.png",
      },
    ],
  })
  const image = draft.images[0]
  assert.equal(draft.revision, 1)
  assert.ok(!JSON.stringify(await runtime.api(root)).includes(data))
  await writeFile(source, "Source changed after capture")
  assert.equal((await runtime.api(`${root}/${draft.id}/image/${image.id}`, { revision: 1 })).data, data)
  results.push("operator image-only draft snapshots bytes; listings contain metadata only")
  const turn = await prompt(
    {
      title: "Text update retains image",
      details: "Model adds details",
      type: "idea",
      draft_id: draft.id,
      revision: 1,
    },
    "Update that exact feedback draft",
  )
  assert.equal(turn.state.status, "completed", JSON.stringify(turn))
  const current = (await runtime.api(root))[0]
  assert.equal(current.revision, 2)
  assert.deepEqual(current.images, draft.images)
  results.push("real model text-only update preserves image snapshot")
  const reviewed = await runtime.api(`${root}/${draft.id}/review`, { revision: 2 })
  assert.ok(!reviewed.url.includes(data) && !reviewed.url.includes("selected.png") && !reviewed.url.includes(source))
  const maximum = Buffer.alloc(8 * 1024 * 1024)
  Buffer.from(data, "base64").copy(maximum)
  const bounded = await runtime.api(root, {
    title: "Exact HTTP image bounds",
    details: "",
    type: "bug",
    images: [0, 1].map((index) => ({
      data: maximum.toString("base64"),
      mimeType: "image/png",
      fileName: `maximum-${index}.png`,
    })),
  })
  assert.deepEqual(
    bounded.images.map((image) => image.size),
    [maximum.length, maximum.length],
  )
  assert.equal(
    (await runtime.api(`${root}/${bounded.id}/image/${bounded.images[0].id}`, { revision: 1 })).data,
    maximum.toString("base64"),
  )
  await runtime.api(`${root}/${bounded.id}`, { revision: 1 }, "DELETE")
  results.push("actual HTTP accepts exact 8 MiB images and 16 MiB aggregate")
  const before = runtime.calls.length
  const request = async (path, body) => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("directory", runtime.directory)
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  }
  assert.equal((await request(`${root}/${draft.id}/image/${image.id}`, { revision: 1 })).status, 409)
  const other = await create("Other image owner")
  assert.equal(
    (
      await request(`${native ? "/api" : ""}/session/${other.id}/feedback/${draft.id}/image/${image.id}`, {
        revision: 2,
      })
    ).status,
    404,
  )
  results.push("exact revision and Session ownership enforced; URL has no image or source path")
  await runtime.crash()
  await runtime.reopen()
  assert.equal((await runtime.api(`${root}/${draft.id}/image/${image.id}`, { revision: 2 })).data, data)
  results.push("real process death and reopening preserve exact original bytes")
  const removed = await runtime.api(root, {
    title: current.title,
    details: current.details,
    type: current.type,
    draft_id: draft.id,
    revision: 2,
    images: [],
  })
  assert.deepEqual(removed.images, [])
  assert.equal((await request(`${root}/${draft.id}/image/${image.id}`, { revision: 3 })).status, 404)
  await runtime.api(`${root}/${draft.id}`, { revision: 3 }, "DELETE")
  assert.equal(runtime.calls.length, before)
  results.push("explicit removal deletes image ownership without another provider turn")
  console.log(
    JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", native, results, output: runtime.output }),
  )
} finally {
  await runtime.close()
}
