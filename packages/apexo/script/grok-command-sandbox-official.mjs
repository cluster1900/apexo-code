// Isolated installed-runtime comparison only; never used by Apexo feature execution.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, writeFile, rm, link } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
const root = await mkdtemp(join(homedir(), ".apexo-sandbox-audit-"))
const output = await mkdtemp(join(tmpdir(), "apexo-sandbox-reference-"))
const calls = []
const runs = []
let planned
const provider = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("content-type", "application/json")
    return res.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] }))
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = JSON.parse(Buffer.concat(chunks))
  if (req.url.endsWith("/responses")) {
    const item = {
      type: "function_call",
      id: "fc_sandbox_title",
      call_id: "call_sandbox_title",
      name: "session_title",
      arguments: JSON.stringify({ session_title: "Sandbox fixture" }),
      status: "completed",
    }
    const result = {
      id: "resp_sandbox_title",
      object: "response",
      created_at: 1,
      model: body.model,
      status: "completed",
      output: [item],
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: 1,
      text: { format: { type: "text" } },
      tool_choice: "auto",
      tools: body.tools ?? [],
      top_p: 1,
      truncation: "disabled",
      user: null,
      metadata: {},
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    res.writeHead(200, { "content-type": "text/event-stream" })
    return res.end(
      [
        { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, arguments: "", status: "in_progress" },
        },
        { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: item.arguments },
        { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: item.arguments },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result },
      ]
        .map((e, sequence_number) => "data: " + JSON.stringify({ ...e, sequence_number }) + "\n\n")
        .join(""),
    )
  }
  const tools = body.tools?.map((t) => t.function ?? t) ?? []
  const tool = !planned.sent && tools.find((t) => ["run_terminal_cmd", "run_terminal_command"].includes(t.name))
  calls.push({ profile: planned.profile, tools: tools.map((t) => t.name), body })
  if (tool) planned.sent = true
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_sandbox_" + calls.length,
            type: "function",
            function: {
              name: tool.name,
              arguments: JSON.stringify({
                command: planned.command,
                description: "Inspect isolated kernel filesystem enforcement",
                block_until_ms: 30000,
              }),
            },
          },
        ],
      }
    : { role: "assistant", content: "SANDBOX_AUDIT_DONE" }
  res.writeHead(200, { "content-type": "text/event-stream" })
  res.end(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    ]
      .map(
        (e) =>
          "data: " +
          JSON.stringify({
            id: "sandbox-audit",
            object: "chat.completion.chunk",
            model: body.model,
            created: 1,
            ...e,
          }) +
          "\n\n",
      )
      .join("") + "data: [DONE]\n\n",
  )
})
await new Promise((r) => provider.listen(0, "127.0.0.1", r))
const shellquote = (s) => "'" + s.replaceAll("'", "'\\''") + "'"
try {
  for (const profile of ["workspace", "read-only", "audit-deny"]) {
    const base = join(root, profile)
    const cwd = join(base, "workspace")
    const home = join(base, "grok-home")
    await mkdir(cwd, { recursive: true })
    await mkdir(home)
    await writeFile(join(cwd, "secret.txt"), "ISOLATED_SECRET")
    await writeFile(join(base, "original.txt"), "ORIGINAL")
    await link(join(base, "original.txt"), join(cwd, "existing-hardlink.txt"))
    await writeFile(
      join(home, "config.toml"),
      `[models]\ndefault="audit"\n[model.audit]\nmodel="fixture"\nname="Sandbox audit"\nbase_url="http://127.0.0.1:${provider.address().port}/v1"\napi_key="fixture-key"\napi_backend="chat_completions"\ncontext_window=100000\n`,
    )
    if (profile === "audit-deny")
      await writeFile(
        join(home, "sandbox.toml"),
        '[profiles.audit-deny]\nextends="workspace"\ndeny=["**/secret.txt"]\n',
      )
    const code = `import json, pathlib, subprocess\nresults={}\nfor key,target in ${JSON.stringify([
      ["workspace", join(cwd, "inside.txt")],
      ["outside", join(base, "outside.txt")],
      ["protected", join(home, "config.toml")],
      ["existingHardlink", join(cwd, "existing-hardlink.txt")],
    ])}:\n try:\n  with open(target,'a') as f:f.write('AUDIT')\n  results[key]='allowed'\n except OSError as e:results[key]='denied:'+str(e.errno)\ntry:results['secret']=pathlib.Path(${JSON.stringify(join(cwd, "secret.txt"))}).read_text()\nexcept OSError as e:results['secret']='denied:'+str(e.errno)\nprint('SANDBOX_RESULT='+json.dumps(results))\n`
    planned = { profile, sent: false, command: `python3 -c ${shellquote(code)}` }
    const child = spawn(
      process.env.GROK_BIN ?? "grok",
      [
        "--sandbox",
        profile,
        "--cwd",
        cwd,
        "--always-approve",
        "--max-turns",
        "3",
        "--output-format",
        "streaming-json",
        "-p",
        "Perform exactly the isolated filesystem audit command once, then finish.",
      ],
      {
        cwd,
        detached: true,
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, "xdg-config"),
          XDG_DATA_HOME: join(home, "xdg-data"),
          XDG_STATE_HOME: join(home, "xdg-state"),
          XDG_CACHE_HOME: join(home, "xdg-cache"),
          XDG_RUNTIME_DIR: join(home, "xdg-runtime"),
          GROK_HOME: home,
          GROK_CONFIG: "",
          GROK_CONFIG_PATH: "",
          GROK_LEADER: "0",
          XAI_API_KEY: "fixture-key",
          GROK_TITLE_REFRESH: "0",
          GROK_TURN_SUMMARY: "0",
          GROK_MANAGED_MCPS_ENABLED: "0",
          GROK_MODELS_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          GROK_MODELS_LIST_URL: `http://127.0.0.1:${provider.address().port}/v1/models`,
          ...Object.fromEntries(
            ["CLAUDE", "CURSOR", "CODEX"].flatMap((v) =>
              ["HOOKS", "MCPS", "RULES", "SKILLS", "AGENTS"].map((k) => [`GROK_${v}_${k}_ENABLED`, "0"]),
            ),
          ),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    const stdout = []
    const stderr = []
    child.stdout.on("data", (c) => stdout.push(c))
    child.stderr.on("data", (c) => stderr.push(c))
    const exited = new Promise((r) => child.once("exit", (code, signal) => r({ code, signal })))
    const timer = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 45000)
    const result = await exited
    clearTimeout(timer)
    await writeFile(join(output, profile + ".stdout"), Buffer.concat(stdout))
    await writeFile(join(output, profile + ".stderr"), Buffer.concat(stderr))
    if (profile === "read-only" && Buffer.concat(stderr).toString().includes("socket deny resolution failed")) {
      assert.notEqual(result.code, 0)
      assert.equal(planned.sent, false)
      assert.ok(Buffer.concat(stderr).toString().includes("Refusing to start with its protections missing"))
      runs.push({
        profile,
        result,
        called: false,
        observed: { startup: "refused", reason: "isolated HOME excludes host Docker socket symlink target" },
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      })
      continue
    }
    const text = Buffer.concat(stdout).toString()
    const events = text.split("\n").filter(Boolean).map(JSON.parse)
    const completed = events.find(
      (e) =>
        e.type === "tool_call_update" &&
        e.status === "completed" &&
        e.rawOutput?.output_for_prompt?.includes("SANDBOX_RESULT="),
    )
    assert.ok(completed, profile + " completed real tool")
    const observed = JSON.parse(completed.rawOutput.output_for_prompt.match(/SANDBOX_RESULT=(.*)/)[1])
    assert.deepEqual(observed, {
      workspace: profile === "read-only" ? "denied:1" : "allowed",
      outside: "denied:1",
      protected: "denied:1",
      existingHardlink: profile === "read-only" ? "denied:1" : "allowed",
      secret: profile === "audit-deny" ? "denied:1" : "ISOLATED_SECRET",
    })
    assert.equal(
      await readFile(join(base, "original.txt"), "utf8"),
      profile === "read-only" ? "ORIGINAL" : "ORIGINALAUDIT",
    )
    assert.equal(result.code, 0)
    assert.ok(!Buffer.concat(stderr).toString().includes("Failed to deserialize ResponseStreamEvent"))
    runs.push({
      profile,
      result,
      called: planned.sent,
      observed,
      stdout: text,
      stderr: Buffer.concat(stderr).toString(),
    })
  }
  await writeFile(join(output, "result.json"), JSON.stringify({ root, runs, calls }, null, 2))
  console.log(
    JSON.stringify(
      {
        output,
        runs: runs.map((r) => ({ profile: r.profile, result: r.result, called: r.called, observed: r.observed })),
        providerCalls: calls.length,
      },
      null,
      2,
    ),
  )
} finally {
  provider.closeAllConnections()
  await new Promise((r) => provider.close(r))
  await rm(root, { recursive: true, force: true })
}
