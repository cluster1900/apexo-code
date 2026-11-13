import { expect, test } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { AppProcess } from "@apexo/core/process"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { FSUtil } from "@apexo/core/fs-util"
import { PermissionReviewContext } from "@apexo/core/permission/review-context"
import { SessionSchema } from "@apexo/core/session/schema"
import { ShellEnvironment } from "@apexo/core/shell-environment"
import { ChildProcess } from "effect/unstable/process"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node, AppProcess.node, FSUtil.node])))
const setup = Effect.gen(function* () {
  const cwd = yield* tmpdirScoped()
  const proc = yield* AppProcess.Service
  const fs = yield* FSUtil.Service
  const git = (args: string[]) =>
    proc
      .run(ChildProcess.make("git", ["-c", "commit.gpgsign=false", ...args], { cwd, stdin: "ignore" }))
      .pipe(Effect.flatMap(AppProcess.requireSuccess))
  yield* git(["init", "--initial-branch=work"])
  yield* git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ])
  yield* git(["remote", "add", "origin", "https://user:password@example.invalid/repo.git"])
  yield* git(["config", "branch.work.remote", "origin"])
  yield* git(["config", "branch.work.merge", "refs/heads/work"])
  const action = (command: string, env = ShellEnvironment.subprocessEnv({}), profile = "off") =>
    PermissionReviewContext.bash({
      sessionID: SessionSchema.ID.make("ses_scope"),
      callID: "scope",
      cwd,
      shell: "/bin/sh",
      command,
      env: Effect.succeed(env),
      background: false,
      policy: Effect.succeed({ profile, network: "unrestricted" }),
      proc,
      fs,
    })
  return { cwd, git, action }
})

it.live(
  "Git push scope resolves implicit defaults, explicit refs, force/deletion and redacts URL credentials",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      for (const command of [
        "git push",
        "git push origin HEAD",
        "git push origin work:release",
        "git push -f origin +HEAD:release",
        "git push --delete origin refs/heads/release",
        "git push origin :refs/heads/release",
      ]) {
        const captured = yield* f.action(command).capture
        expect(JSON.stringify(captured.facts)).not.toContain("password")
        expect(captured.facts).toMatchObject({
          cwd: f.cwd,
          command,
          git: { repository: f.cwd, branch: "work", remote: "origin", urls: ["https://example.invalid/repo.git"] },
        })
        expect(JSON.stringify(captured.facts)).toContain(
          command.includes("release") ? "refs/heads/release" : "refs/heads/work",
        )
        if (command.includes("-f")) expect(JSON.stringify(captured.facts)).toContain('"force":true')
        if (
          command.includes("--delete") ||
          (command.includes(":release") && !command.includes("work:") && !command.includes("HEAD:"))
        )
          expect(JSON.stringify(captured.facts)).toContain('"delete":true')
      }
    }),
  30000,
)

it.live(
  "Revalidation detects changed source commit and effective push URL without publishing secrets",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      const action = f.action("git push origin HEAD")
      const before = yield* action.capture
      yield* f.git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "changed",
      ])
      const changed = yield* action.capture
      expect(changed.fingerprint).not.toBe(before.fingerprint)
      yield* f.git(["remote", "set-url", "--push", "origin", "https://other:secret@another.invalid/repo.git"])
      const remote = yield* action.capture
      expect(remote.fingerprint).not.toBe(changed.fingerprint)
      expect(JSON.stringify(remote.facts)).not.toContain("secret")
      expect(remote.facts).toMatchObject({ git: { urls: ["https://another.invalid/repo.git"] } })
    }),
  30000,
)

it.live(
  "Dynamic commands, prefixes, wrappers, overrides, aliases and ambiguous push configuration stay manual",
  () =>
    Effect.gen(function* () {
      const f = yield* setup
      for (const command of [
        "cd .. && git push",
        "env git push",
        "timeout 2 git push",
        "git -C .. push",
        "git -c remote.origin.url=bad push",
        "git push $(echo origin)",
        "git push --all origin",
        "git push --delete origin release",
        "git push origin :release",
        "git push origin HEAD:refs/tags/new-tag",
        "sh -c 'git push'",
        "python3 -c 'print(1)'",
        "node -e 'console.log(1)'",
        "bun -e 'console.log(1)'",
        "git push https://user:secret@other.invalid/repo.git HEAD",
      ]) {
        expect((yield* f.action(command).capture.pipe(Effect.result))._tag).toBe("Failure")
      }
      expect(
        (yield* f
          .action("git push origin HEAD", { ...ShellEnvironment.subprocessEnv({}), BASH_ENV: "/untrusted/startup.sh" })
          .capture.pipe(Effect.result))._tag,
      ).toBe("Failure")
      expect(
        (yield* f
          .action("git push origin HEAD", ShellEnvironment.subprocessEnv({}), "workspace")
          .capture.pipe(Effect.result))._tag,
      ).toBe("Failure")
      yield* f.git(["config", "push.default", "matching"])
      expect((yield* f.action("git push").capture.pipe(Effect.result))._tag).toBe("Failure")
      yield* f.git(["config", "remote.origin.push", "refs/heads/*:refs/heads/*"])
      expect((yield* f.action("git push").capture.pipe(Effect.result))._tag).toBe("Failure")
    }),
  30000,
)

// URL userinfo ends at the final @, including passwords containing an unescaped @.
test("URL credential redaction preserves targets without leaking userinfo or token values", () => {
  expect(PermissionReviewContext.redactURL("https://name:p@ss@example.invalid/repo")).toBe(
    "https://example.invalid/repo",
  )
  expect(PermissionReviewContext.redactURL("https://example.invalid/repo?token=secret&branch=work")).toBe(
    "https://example.invalid/repo?token=[redacted]&branch=work",
  )
})
