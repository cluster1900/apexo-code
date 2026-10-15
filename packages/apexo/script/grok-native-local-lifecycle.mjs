import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const mode = process.argv[2] ?? "question"
assert.ok(["question", "plan", "provider", "bash", "task", "process", "mcp"].includes(mode))
const held = Promise.withResolvers()
const state = { provider: false, stage: 0 }
const runtime = await startShellFixture("cli", {
  deferBackend: true,
  config: { agent: { helper: { mode: "subagent", permission: { "*": "allow" } } } },
  next: async ({ body, text, finished }) => {
    if (mode === "plan") {
      state.stage++
      if (state.stage === 1) return { tool: "plan_enter", args: {} }
      if (state.stage === 2) {
        const filename = JSON.stringify(body).match(/Draft the plan at ([^;]+);/)?.[1]
        assert.ok(filename)
        return { tool: "write", args: { path: filename, content: "Owned shutdown plan" } }
      }
      if (state.stage === 3) return { tool: "plan_exit", args: {} }
      return { content: "UNEXPECTED_PLAN_CONTINUATION" }
    }
    if (mode === "provider") {
      state.provider = true
      await held.promise
      return { content: "LATE_PROVIDER_ANSWER" }
    }
    if (finished) return { content: "NATIVE_LOCAL_PARENT_DONE" }
    if (mode === "question")
      return {
        tool: "question",
        args: {
          questions: [
            {
              header: "Wait",
              question: "LOCAL_PENDING_QUESTION",
              options: [{ label: "Continue", description: "Continue" }],
            },
          ],
        },
      }
    if (mode === "task" && !text.includes("OWNED_CHILD"))
      return {
        tool: "task",
        args: { description: "Owned child", prompt: "OWNED_CHILD", subagent_type: "helper", background: true },
      }
    if (mode === "mcp") {
      const name = body.tools
        .map((tool) => tool.function?.name ?? tool.name)
        .find((name) => name.startsWith("mcp_owned_echo_"))
      assert.ok(name, "owned MCP tool must be advertised")
      return { tool: name, args: { text: "held", wait: true } }
    }
    return {
      tool: "bash",
      args: {
        command: "echo $$ > owned-command.pid; while :; do sleep 1; done",
        timeout: 60000,
        ...(mode === "process" ? { background: true, description: "Owned process" } : {}),
      },
    }
  },
})
let child
const stdout = { text: "" }
const stderr = { text: "" }
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
try {
  const config = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT)
  const trace = join(runtime.output, "mcp.jsonl")
  if (mode === "mcp")
    config.mcp = {
      owned: {
        type: "local",
        command: [process.execPath, resolve("test/fixture/mcp-native-stdio.ts")],
        environment: { MCP_NATIVE_TRACE: trace },
      },
    }
  await Bun.write(join(runtime.directory, "apexo.json"), JSON.stringify(config))
  const filename = join(runtime.output, "native-host.mjs")
  await Bun.write(
    filename,
    `
    import { createNativeLocalHost } from ${JSON.stringify(resolve("src/cli/native-local-host.ts"))};
    const host = createNativeLocalHost();
    const request = async(path,body) => { const response = await host.fetch("http://apexo.local"+path,{method:body===undefined?"GET":"POST",...(body===undefined?{}:{headers:{"content-type":"application/json"},body:JSON.stringify(body)})}); if(!response.ok) throw new Error(await response.text()); return response.status===204?undefined:response.json() };
    process.once("SIGTERM",async()=>{await host.close();console.log("HOST_JOINED");process.exit(0)});
    const session=(await request("/api/session",{location:{directory:${JSON.stringify(runtime.directory)}},agent:"build",model:{providerID:"xai",id:"grok-4.7"}})).data;
    console.log("SESSION="+session.id);
    await request("/api/session/"+session.id+"/prompt",{prompt:{text:"NATIVE_LOCAL_LIFETIME"}});
    if(["question","plan"].includes(${JSON.stringify(mode)})) { while(!(await request("/api/session/"+session.id+"/question")).data.length) await new Promise(resolve=>setTimeout(resolve,25)); console.log("QUESTION_PENDING") }
    await new Promise(()=>{});
  `,
  )
  child = Bun.spawn([process.execPath, filename], {
    cwd: process.cwd(),
    env: runtime.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const read = async (stream, target) => {
    for await (const bytes of stream) target.text += new TextDecoder().decode(bytes)
  }
  const readers = Promise.all([read(child.stdout, stdout), read(child.stderr, stderr)])
  await poll(() => stdout.text.includes("SESSION="), "native local host creation", 30000)
  const pid =
    mode === "bash" || mode === "task" || mode === "process"
      ? await poll(
          async () => {
            const file = Bun.file(join(runtime.directory, "owned-command.pid"))
            return (await file.exists()) ? Number(await file.text()) : undefined
          },
          "owned native command",
          30000,
        )
      : mode === "mcp"
        ? await poll(
            async () => {
              const file = Bun.file(trace)
              if (!(await file.exists())) return
              const rows = (await file.text()).trim().split("\n").map(JSON.parse)
              return rows.some((row) => row.event === "call")
                ? rows.find((row) => row.event === "start").pid
                : undefined
            },
            "held native MCP call",
            30000,
          )
        : undefined
  if (mode === "provider") await poll(() => state.provider, "held native provider", 30000)
  if (mode === "question" || mode === "plan")
    await poll(() => stdout.text.includes("QUESTION_PENDING"), "pending native question", 30000)
  if (pid) assert.equal(alive(pid), true)
  child.kill("SIGTERM")
  assert.equal(await deadline(child.exited, 10000, "native host joined shutdown"), 0, stderr.text)
  await readers
  assert.ok(stdout.text.includes("HOST_JOINED"))
  if (pid) await poll(() => !alive(pid), "owned descendant reaped", 3000)
  held.resolve()
  if (mode === "provider") await poll(() => runtime.calls.length === 1, "released original provider reply", 3000)
  const calls = runtime.calls.length
  const sessionID = stdout.text.match(/SESSION=(\S+)/)?.[1]
  assert.ok(sessionID)
  const inspect = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    const { createNativeLocalHost } = await import(${JSON.stringify(resolve("src/cli/native-local-host.ts"))});
    const host = createNativeLocalHost();
    try {
      const request=async path=>{const response=await host.fetch("http://apexo.local"+path);if(!response.ok)throw new Error(await response.text());return response.json()};
      console.log(JSON.stringify({active:(await request("/api/session/active")).data,questions:(await request("/api/session/${sessionID}/question")).data,messages:(await request("/api/session/${sessionID}/message?order=asc")).data}));
    } finally { await host.close() }
  `,
    ],
    { cwd: process.cwd(), env: runtime.env, stdout: "pipe", stderr: "pipe" },
  )
  try {
    const [exit, out, error] = await deadline(
      Promise.all([inspect.exited, new Response(inspect.stdout).text(), new Response(inspect.stderr).text()]),
      30000,
      "passive native ownership reopen",
    )
    assert.equal(exit, 0, error)
    const data = JSON.parse(out.trim().split("\n").at(-1))
    assert.deepEqual(data.active, {})
    assert.deepEqual(data.questions, [])
    assert.ok(!JSON.stringify(data.messages).includes("LATE_PROVIDER_ANSWER"))
    assert.ok(!JSON.stringify(data.messages).includes("UNEXPECTED_PLAN_CONTINUATION"))
    assert.equal(runtime.calls.length, calls, "Reopening native history must not resume model work")
  } finally {
    if (inspect.exitCode === null) inspect.kill("SIGKILL")
    await inspect.exited
  }
  console.log(
    JSON.stringify({ mode, checks: pid ? 6 : 5, providerCalls: runtime.calls.length, output: runtime.output }),
  )
} finally {
  held.resolve()
  if (child?.exitCode === null) child.kill("SIGKILL")
  if (child) await child.exited
  await Bun.write(join(runtime.output, "lifecycle-stdout.txt"), stdout.text)
  await Bun.write(join(runtime.output, "lifecycle-stderr.txt"), stderr.text)
  await runtime.close()
}
