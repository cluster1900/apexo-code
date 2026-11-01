import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createServer, type ServerResponse } from "node:http"
import path from "node:path"
import { Effect } from "effect"
import { Bwrap } from "@apexo/core/command-sandbox/linux"
import {
  CommandSandboxNetworkProxy,
  LINUX_TCP_TO_UNIX_BRIDGE_SCRIPT,
} from "@apexo/core/command-sandbox/network-proxy"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { FSUtil } from "@apexo/core/fs-util"
import type { SandboxExecReport } from "../../src/cli/cmd/sandbox"
import type { ParallelAttemptsReport } from "../../src/cli/run-attempts"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))
const apexoRoot = path.resolve(import.meta.dir, "../..")

async function spawnCli(args: ReadonlyArray<string>, env: Record<string, string | undefined>) {
  const proc = Bun.spawn(["bun", "src/index.ts", ...args], {
    cwd: apexoRoot,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

function writeSse(res: ServerResponse, events: ReadonlyArray<Record<string, unknown>>) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.write("data: [DONE]\n\n")
  res.end()
}

function responsesTextEvents(text: string) {
  return [
    {
      type: "response.created",
      sequence_number: 1,
      response: { id: "resp_txt", object: "response", status: "in_progress", model: "fixture", output: [] },
    },
    {
      type: "response.output_item.added",
      sequence_number: 2,
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    },
    {
      type: "response.output_text.delta",
      sequence_number: 3,
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta: text,
      logprobs: [],
    },
    {
      type: "response.output_item.done",
      sequence_number: 4,
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "completed" },
    },
    {
      type: "response.completed",
      sequence_number: 5,
      response: {
        id: "resp_txt",
        object: "response",
        status: "completed",
        output: [],
        usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 },
      },
    },
  ]
}

function responsesSingleToolEvents(callId: string, name: string, input: Record<string, unknown>) {
  const args = JSON.stringify(input)
  return [
    {
      type: "response.created",
      sequence_number: 1,
      response: { id: "resp_tool", object: "response", status: "in_progress", model: "fixture", output: [] },
    },
    {
      type: "response.output_item.added",
      sequence_number: 2,
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: callId, name, arguments: "", status: "in_progress" },
    },
    {
      type: "response.function_call_arguments.delta",
      sequence_number: 3,
      output_index: 0,
      item_id: "fc_1",
      delta: args,
    },
    {
      type: "response.function_call_arguments.done",
      sequence_number: 4,
      output_index: 0,
      item_id: "fc_1",
      arguments: args,
    },
    {
      type: "response.output_item.done",
      sequence_number: 5,
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: callId, name, arguments: args, status: "completed" },
    },
    {
      type: "response.completed",
      sequence_number: 6,
      response: {
        id: "resp_tool",
        object: "response",
        status: "completed",
        output: [],
        usage: { input_tokens: 12, output_tokens: 10, total_tokens: 22 },
      },
    },
  ]
}

it.live(
  "CommandSandbox domain-allowlist proxy, Unix-socket bridge, sandbox.toml allow_domains, and `apexo sandbox` CLI enforce network and filesystem confinement",
  () =>
    Effect.gen(function* () {
      // 1. Domain pattern normalization and wildcard matching
      const normalized = CommandSandboxNetworkProxy.normalizeDomainPatterns([
        "  *.Example.COM. ",
        "LocalHost",
        "127.0.0.1",
        "*.example.com",
      ])
      expect(normalized).toEqual(["*.example.com", "127.0.0.1", "localhost"])
      expect(CommandSandboxNetworkProxy.isDomainAllowed("api.example.com", normalized)).toBe(true)
      expect(CommandSandboxNetworkProxy.isDomainAllowed("sub.api.example.com", normalized)).toBe(true)
      expect(CommandSandboxNetworkProxy.isDomainAllowed("example.com", normalized)).toBe(false)
      expect(CommandSandboxNetworkProxy.isDomainAllowed("evil-example.com", normalized)).toBe(false)
      expect(() => CommandSandboxNetworkProxy.normalizeDomainPatterns(["https://example.com/path"])).toThrow()
      expect(() => CommandSandboxNetworkProxy.normalizeDomainPatterns(["*.*.example.com"])).toThrow()

      // Verify Linux Bwrap.prepare keeps --unshare-net, bind-mounts bridge binary, and scopes BUN_BE_BUN=1 to bridge launch
      const bwrapWithProxy = Bwrap.prepare({
        workspace: "/workspace/project",
        temporary: "/tmp/apexo-sandbox-tmp",
        home: "/tmp/apexo-sandbox-tmp",
        profile: "workspace",
        network: "off",
        proxyUnixSocket: "/tmp/apexo-sandbox-tmp/proxy.sock",
        proxyBridgeBinary: "/usr/local/bin/apexo",
        protected: ["/workspace/project/.git"],
        ancestors: ["/", "/workspace"],
        shell: "/bin/sh",
        command: "curl -fsS https://example.com",
        cwd: "/workspace/project",
      })
      expect(bwrapWithProxy.args).toContain("--unshare-net")
      expect(bwrapWithProxy.args).toContain("/tmp/apexo-sandbox-tmp/.apexo-proxy-bridge")
      expect(bwrapWithProxy.args).toContain("/tmp/apexo-sandbox-tmp/proxy.sock")
      const proxyLauncherArg = bwrapWithProxy.args.find((arg) => arg.includes('BUN_BE_BUN=1 "$4" -e "$5" "$6"'))
      expect(proxyLauncherArg).toBeDefined()
      expect(proxyLauncherArg!).toContain("case \"$PROXY_PORT\" in ''|*[!0-9]*) exit 126 ;; esac")
      expect(proxyLauncherArg!.indexOf("exit 126")).toBeLessThan(proxyLauncherArg!.indexOf('printf "%s" "$1"'))

      const bwrapWithoutProxy = Bwrap.prepare({
        workspace: "/workspace/project",
        temporary: "/tmp/apexo-sandbox-tmp",
        home: "/tmp/apexo-sandbox-tmp",
        profile: "workspace",
        network: "off",
        protected: ["/workspace/project/.git"],
        ancestors: ["/", "/workspace"],
        shell: "/bin/sh",
        command: "ls",
        cwd: "/workspace/project",
      })
      expect(bwrapWithoutProxy.args).toContain("--unshare-net")
      expect(bwrapWithoutProxy.args).not.toContain("/tmp/apexo-sandbox-tmp/.apexo-proxy-bridge")

      const root = yield* tmpdirScoped()
      const workspace = path.join(root, "workspace")
      yield* Effect.promise(async () => {
        await mkdir(path.join(workspace, ".apexo"), { recursive: true })
        await Bun.write(path.join(workspace, "apexo.json"), '{"protected":true}\n')
        await Bun.write(
          path.join(workspace, ".apexo", "sandbox.toml"),
          ['[profiles.local-api]', 'extends = "workspace"', 'allow_domains = ["localhost"]', ""].join("\n"),
        )
      })

      // 2. Local target HTTP server
      const target = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
              const httpServer = createServer((req, res) => {
                if (req.url === "/ok") {
                  res.writeHead(200, { "content-type": "text/plain" })
                  res.end("ALLOWLIST_HTTP_OK")
                  return
                }
                if (req.url === "/tunnel") {
                  res.writeHead(200, { "content-type": "text/plain" })
                  res.end("ALLOWLIST_CONNECT_OK")
                  return
                }
                res.writeHead(200, { "content-type": "text/plain" })
                res.end("DIRECT_SECRET_LEAK")
              })
              httpServer.listen(0, "127.0.0.1", () => {
                const addr = httpServer.address()
                const port = typeof addr === "object" && addr ? addr.port : 0
                resolve({
                  port,
                  close: () => new Promise<void>((done) => httpServer.close(() => done())),
                })
              })
            }),
        ),
        (handle) => Effect.promise(() => handle.close()),
      )

      // 3. Verify Unix-socket proxy + Linux FD-3 TCP->Unix bridge script end-to-end
      const socketPath = path.join(root, "proxy.sock")
      const unixProxy = yield* CommandSandboxNetworkProxy.start({
        allowDomains: ["localhost"],
        listen: { kind: "unix", socketPath },
      })
      expect(unixProxy.socketPath).toBe(socketPath)

      const bridgePidFile = path.join(root, "bridge.pid")
      const bridgeProbe = yield* Effect.promise(async () => {
        const script = [
          'PROXY_PORT=$("$1" -e "$2" "$3" 3>&1 </dev/null >/dev/null 2>&1 & echo $! > "$4")',
          'trap \'kill $(cat "$4") 2>/dev/null || true\' EXIT',
          'PROXY_URL="http://127.0.0.1:$PROXY_PORT"',
          'export HTTP_PROXY="$PROXY_URL" HTTPS_PROXY="$PROXY_URL" ALL_PROXY="$PROXY_URL"',
          'export http_proxy="$PROXY_URL" https_proxy="$PROXY_URL" all_proxy="$PROXY_URL" NO_PROXY="" no_proxy=""',
          `OUT_OK=$(curl -fsS "http://localhost:${target.port}/ok")`,
          `OUT_TUNNEL=$(curl -fsS -p "http://localhost:${target.port}/tunnel")`,
          `CODE_BLOCKED=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${target.port}/secret")`,
          `CODE_CONNECT_BLOCKED=$(curl -sS -p -o /dev/null -w "%{http_connect}" "http://127.0.0.1:${target.port}/secret" || true)`,
          'printf "%s|%s|%s|%s" "$OUT_OK" "$OUT_TUNNEL" "$CODE_BLOCKED" "$CODE_CONNECT_BLOCKED"',
        ].join("; ")
        const proc = Bun.spawn(
          [
            "/bin/sh",
            "-c",
            script,
            "bridge-test",
            process.execPath,
            LINUX_TCP_TO_UNIX_BRIDGE_SCRIPT,
            socketPath,
            bridgePidFile,
          ],
          {
            cwd: root,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          },
        )
        const [exitCode, stdout, stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        return { exitCode, stdout, stderr }
      })
      if (bridgeProbe.exitCode !== 0) {
        throw new Error(`Unix bridge probe failed (${bridgeProbe.exitCode}): ${bridgeProbe.stderr}`)
      }
      expect(bridgeProbe.stdout).toBe("ALLOWLIST_HTTP_OK|ALLOWLIST_CONNECT_OK|403|403")

      // 4. Real OS kernel sandbox via `apexo sandbox` CLI
      if (process.platform === "darwin" || process.platform === "linux") {
        const cliEnv = {
          ...process.env,
          APEXO_PURE: "1",
          APEXO_TEST_HOME: root,
          XDG_DATA_HOME: path.join(root, "xdg-data"),
          XDG_CONFIG_HOME: path.join(root, "xdg-config"),
          XDG_STATE_HOME: path.join(root, "xdg-state"),
          XDG_CACHE_HOME: path.join(root, "xdg-cache"),
        }

        // 4a. Direct connection bypassing proxy (`--noproxy '*'`) is blocked by the OS kernel sandbox
        const directBypass = yield* Effect.promise(() =>
          spawnCli(
            [
              "sandbox",
              "--dir",
              workspace,
              "--profile",
              "workspace",
              "--allow-domain",
              "localhost",
              "--json",
              "-c",
              `curl -sS --max-time 3 --noproxy '*' http://127.0.0.1:${target.port}/secret`,
            ],
            cliEnv,
          ),
        )
        // If Linux host lacks unprivileged userns for bwrap, skip kernel assertions gracefully
        const sandboxUnavailable =
          process.platform === "linux" &&
          directBypass.exitCode !== 0 &&
          !directBypass.stdout.trim().startsWith("{") &&
          directBypass.stderr.includes("command sandbox")
        if (!sandboxUnavailable) {
          expect(directBypass.exitCode).not.toBe(0)
          const bypassReport = JSON.parse(directBypass.stdout) as SandboxExecReport
          expect(bypassReport.exitCode).not.toBe(0)
          expect(bypassReport.allowDomains).toEqual(["localhost"])
          expect(bypassReport.stdout).not.toContain("DIRECT_SECRET_LEAK")

          // 4b. Allowlisted HTTP + HTTP CONNECT tunnel succeed through the sandbox proxy
          const allowedRun = yield* Effect.promise(() =>
            spawnCli(
              [
                "sandbox",
                "--dir",
                workspace,
                "--profile",
                "workspace",
                "--allow-domain",
                "localhost",
                "--json",
                "-c",
                `curl -fsS http://localhost:${target.port}/ok && printf '|' && curl -fsS -p http://localhost:${target.port}/tunnel`,
              ],
              cliEnv,
            ),
          )
          expect(allowedRun.exitCode).toBe(0)
          const allowedReport = JSON.parse(allowedRun.stdout) as SandboxExecReport
          expect(allowedReport.exitCode).toBe(0)
          expect(allowedReport.stdout).toBe("ALLOWLIST_HTTP_OK|ALLOWLIST_CONNECT_OK")

          // 4c. Custom `.apexo/sandbox.toml` profile (`local-api`) blocks non-allowlisted `127.0.0.1` with 403 and protects `apexo.json`
          const customBlocked = yield* Effect.promise(() =>
            spawnCli(
              [
                "sandbox",
                "--dir",
                workspace,
                "--profile",
                "local-api",
                "--json",
                "-c",
                `curl -sS -i http://127.0.0.1:${target.port}/secret`,
              ],
              cliEnv,
            ),
          )
          expect(customBlocked.exitCode).toBe(0)
          const customReport = JSON.parse(customBlocked.stdout) as SandboxExecReport
          expect(customReport.profile).toBe("local-api")
          expect(customReport.allowDomains).toEqual(["localhost"])
          expect(customReport.stdout).toContain("403 Forbidden")
          expect(customReport.stdout).toContain('Domain "127.0.0.1" is blocked by Apexo sandbox allowlist.')
          expect(customReport.stdout).not.toContain("DIRECT_SECRET_LEAK")

          // 4d. Protected config writes and read-only workspace writes remain kernel-blocked
          const protectCheck = yield* Effect.promise(() =>
            spawnCli(
              [
                "sandbox",
                "--dir",
                workspace,
                "--profile",
                "local-api",
                "--json",
                "-c",
                "printf 'ok' > allowed.txt && printf 'tamper' > apexo.json",
              ],
              cliEnv,
            ),
          )
          expect(protectCheck.exitCode).not.toBe(0)
          expect(yield* Effect.promise(() => Bun.file(path.join(workspace, "allowed.txt")).text())).toBe("ok")
          expect(yield* Effect.promise(() => Bun.file(path.join(workspace, "apexo.json")).text())).toBe(
            '{"protected":true}\n',
          )

          const readOnlyNet = yield* Effect.promise(() =>
            spawnCli(
              [
                "sandbox",
                "--dir",
                workspace,
                "--profile",
                "read-only",
                "--allow-domain",
                "localhost",
                "--json",
                "-c",
                `curl -fsS http://localhost:${target.port}/ok && printf 'nope' > ro-blocked.txt`,
              ],
              cliEnv,
            ),
          )
          expect(readOnlyNet.exitCode).not.toBe(0)
          expect(existsSync(path.join(workspace, "ro-blocked.txt"))).toBe(false)
        }
      }
    }),
  45000,
)

it.live(
  "`apexo run --attempts <n>` executes parallel isolated Git worktrees, preserves main working tree, supports `--output-schema` / `-o` / `--ephemeral`",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const repoDir = path.join(root, "repo")
      const nonGitDir = path.join(root, "plain-dir")
      const schemaPath = path.join(root, "candidate-schema.json")
      const lastMsgPath = path.join(root, "winner.json")

      let callSeq = 0
      const llmServer = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
              const httpServer = createServer((req, res) => {
                const chunks: Buffer[] = []
                req.on("data", (chunk: Buffer) => chunks.push(chunk))
                req.on("end", () => {
                  const raw = Buffer.concat(chunks).toString("utf8")
                  if (raw.includes("Generate a title for this conversation")) {
                    writeSse(res, responsesTextEvents("Attempt Title"))
                    return
                  }
                  const tagMatch = /ATTEMPT_TAG=(attempt-\d+)/.exec(raw)
                  if (tagMatch) {
                    const tag = tagMatch[1]!
                    writeSse(res, responsesTextEvents(JSON.stringify({ candidate: tag, ready: true })))
                    return
                  }
                  callSeq += 1
                  writeSse(
                    res,
                    responsesSingleToolEvents(`call_wt_${callSeq}`, "bash", {
                      command:
                        'tag=$(basename "$PWD"); printf "candidate-%s\\n" "$tag" > app.txt; printf "extra-%s\\n" "$tag" > "created-$tag.txt"; printf "ATTEMPT_TAG=%s\\n" "$tag"',
                      description: "write candidate changes in isolated worktree",
                    }),
                  )
                })
              })
              httpServer.listen(0, "127.0.0.1", () => {
                const addr = httpServer.address()
                const port = typeof addr === "object" && addr ? addr.port : 0
                resolve({
                  url: `http://127.0.0.1:${port}/v1`,
                  close: () => new Promise<void>((done) => httpServer.close(() => done())),
                })
              })
            }),
        ),
        (handle) => Effect.promise(() => handle.close()),
      )

      yield* Effect.promise(async () => {
        await mkdir(repoDir, { recursive: true })
        await mkdir(nonGitDir, { recursive: true })
        await Bun.write(
          schemaPath,
          JSON.stringify({
            type: "object",
            properties: {
              candidate: { type: "string" },
              ready: { type: "boolean" },
            },
            required: ["candidate", "ready"],
            additionalProperties: false,
          }),
        )
        Bun.spawnSync(["git", "init"], { cwd: repoDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
        await Bun.write(path.join(repoDir, "app.txt"), "original\n")
        Bun.spawnSync(["git", "add", "app.txt"], { cwd: repoDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
        Bun.spawnSync(
          [
            "git",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "initial",
          ],
          { cwd: repoDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
        )
        // Leave `apexo.json` uncommitted/untracked to verify baseline dirty-state capture & exclusion from changedFiles!
        await Bun.write(
          path.join(repoDir, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            compaction: { auto: false },
            model: "test/fixture",
            providers: {
              test: {
                name: "AttemptsFixture",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai",
                  url: llmServer.url,
                  settings: { apiKey: "fixture-key" },
                },
                models: {
                  fixture: {
                    name: "FixtureResponses",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        )
      })

      const cliEnv = {
        ...process.env,
        APEXO_PURE: "1",
        APEXO_TEST_HOME: root,
        XDG_DATA_HOME: path.join(root, "xdg-data"),
        XDG_CONFIG_HOME: path.join(root, "xdg-config"),
        XDG_STATE_HOME: path.join(root, "xdg-state"),
        XDG_CACHE_HOME: path.join(root, "xdg-cache"),
      }

      // 1. Persistent 2-attempt parallel run with --output-schema and -o
      const runRes = yield* Effect.promise(() =>
        spawnCli(
          [
            "run",
            "--dir",
            repoDir,
            "--attempts",
            "2",
            "--auto",
            "--format",
            "json",
            "--output-schema",
            schemaPath,
            "-o",
            lastMsgPath,
            "implement candidate changes",
          ],
          cliEnv,
        ),
      )
      if (runRes.exitCode !== 0) {
        throw new Error(`apexo run --attempts 2 failed (${runRes.exitCode}):\nSTDOUT: ${runRes.stdout}\nSTDERR: ${runRes.stderr}`)
      }
      expect(runRes.exitCode).toBe(0)
      const report = JSON.parse(runRes.stdout) as ParallelAttemptsReport
      expect(report.type).toBe("attempts.result")
      expect(report.total).toBe(2)
      expect(report.succeeded).toBe(2)
      expect(report.failed).toBe(0)
      expect(report.attempts.length).toBe(2)

      const first = report.attempts[0]!
      const second = report.attempts[1]!
      expect(first.attempt).toBe(1)
      expect(first.status).toBe("completed")
      expect(first.worktreeReplacedOnExit).toBe(false)
      expect(first.changedFiles).toEqual(["app.txt", "created-attempt-1.txt"])
      expect(first.diffStat).toContain("app.txt")
      expect(first.diffStat).toContain("created-attempt-1.txt (new untracked file)")
      expect(JSON.parse(first.message)).toEqual({ candidate: "attempt-1", ready: true })

      expect(second.attempt).toBe(2)
      expect(second.status).toBe("completed")
      expect(second.directory).not.toBe(first.directory)
      expect(second.changedFiles).toEqual(["app.txt", "created-attempt-2.txt"])
      expect(JSON.parse(second.message)).toEqual({ candidate: "attempt-2", ready: true })

      // Verify isolated files in both retained worktrees, untouched main working tree, and `-o` output
      expect(yield* Effect.promise(() => Bun.file(path.join(first.directory, "app.txt")).text())).toBe(
        "candidate-attempt-1\n",
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(second.directory, "app.txt")).text())).toBe(
        "candidate-attempt-2\n",
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "app.txt")).text())).toBe("original\n")
      expect(JSON.parse(yield* Effect.promise(() => Bun.file(lastMsgPath).text()))).toEqual({
        candidate: "attempt-1",
        ready: true,
      })

      // 2. Ephemeral 2-attempt parallel run cleans up worktree directories on exit
      const ephemeralRes = yield* Effect.promise(() =>
        spawnCli(
          [
            "run",
            "--dir",
            repoDir,
            "--attempts",
            "2",
            "--ephemeral",
            "--auto",
            "--format",
            "json",
            "ephemeral candidate changes",
          ],
          cliEnv,
        ),
      )
      if (ephemeralRes.exitCode !== 0) {
        throw new Error(`ephemeral --attempts 2 failed (${ephemeralRes.exitCode}): ${ephemeralRes.stderr}`)
      }
      const ephemeralReport = JSON.parse(ephemeralRes.stdout) as ParallelAttemptsReport
      expect(ephemeralReport.succeeded).toBe(2)
      for (const item of ephemeralReport.attempts) {
        expect(item.worktreeReplacedOnExit).toBe(true)
        expect(item.changedFiles).toContain("app.txt")
        expect(existsSync(item.directory)).toBe(false)
      }

      // 3. `--attempts 1` also executes inside an isolated worktree, emits `attempts.result`, and validates mutually exclusive flags
      const singleAttemptRes = yield* Effect.promise(() =>
        spawnCli(
          [
            "run",
            "--dir",
            repoDir,
            "--attempts",
            "1",
            "--ephemeral",
            "--auto",
            "--format",
            "json",
            "single isolated worktree attempt",
          ],
          cliEnv,
        ),
      )
      expect(singleAttemptRes.exitCode).toBe(0)
      const singleReport = JSON.parse(singleAttemptRes.stdout) as ParallelAttemptsReport
      expect(singleReport.type).toBe("attempts.result")
      expect(singleReport.total).toBe(1)
      expect(singleReport.succeeded).toBe(1)
      expect(singleReport.attempts[0]?.changedFiles).toEqual(["app.txt", "created-attempt-1.txt"])
      expect(existsSync(singleReport.attempts[0]!.directory)).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(repoDir, "app.txt")).text())).toBe("original\n")

      const incompatibleSingle = yield* Effect.promise(() =>
        spawnCli(["run", "--dir", repoDir, "--attempts", "1", "--continue", "hello"], cliEnv),
      )
      expect(incompatibleSingle.exitCode).not.toBe(0)
      expect(incompatibleSingle.stderr).toContain("--attempts cannot be combined with --continue")

      // 4. Validation errors: out-of-range --attempts and non-git directory
      const invalidCount = yield* Effect.promise(() =>
        spawnCli(["run", "--dir", repoDir, "--attempts", "0", "hello"], cliEnv),
      )
      expect(invalidCount.exitCode).not.toBe(0)
      expect(invalidCount.stderr).toContain("--attempts must be an integer between 1 and 16")

      const nonGitRes = yield* Effect.promise(() =>
        spawnCli(["run", "--dir", nonGitDir, "--attempts", "2", "hello"], cliEnv),
      )
      expect(nonGitRes.exitCode).not.toBe(0)
      expect(nonGitRes.stderr).toContain("--attempts requires a Git repository")
    }),
  60000,
)
