import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AbsolutePath } from "@apexo/schema/schema"
import { Sandbox } from "@apexo/schema/sandbox"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectSchema } from "@apexo/core/project/schema"
import { AgentV2 } from "@apexo/core/agent"
import { SessionProjector } from "@apexo/core/session/projector"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionV1 } from "@apexo/core/v1/session"
import { CommandSandbox } from "@apexo/core/command-sandbox"
import { BashTool } from "@apexo/core/tool/bash"
import { ReadTool } from "@apexo/core/tool/read"
import { WriteTool } from "@apexo/core/tool/write"
import { EditTool } from "@apexo/core/tool/edit"
import { ApplyPatchTool } from "@apexo/core/tool/apply-patch"
import { GlobTool } from "@apexo/core/tool/glob"
import { GrepTool } from "@apexo/core/tool/grep"
import { WebFetchTool } from "@apexo/core/tool/webfetch"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"

const makeLayer = (root: string, workspace: string, directories: string[]) => {
  const projectID = ProjectSchema.ID.make("global")
  return {
    projectID,
    layer: LayerNode.compile(
      LayerNode.group([
        Database.node,
        EventV2.node,
        SessionProjector.node,
        SessionLifecycle.node,
        SessionCommandSandbox.node,
        CommandSandbox.node,
        BashTool.node,
        ReadTool.node,
        WriteTool.node,
        EditTool.node,
        ApplyPatchTool.node,
        GlobTool.node,
        GrepTool.node,
        WebFetchTool.node,
        ToolRegistry.node,
        AgentV2.node,
        CrossSpawnSpawner.node,
      ]),
      [
        [Database.node, Database.layerFromPath(":memory:")],
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({
              home: root,
              data: directories[0],
              config: directories[1],
              cache: directories[2],
              state: directories[3],
              tmp: directories[4],
            }),
          ),
        ],
        [
          Location.node,
          Layer.succeed(Location.Service)({
            directory: AbsolutePath.make(workspace),
            project: { id: projectID, directory: AbsolutePath.make(workspace) },
          }),
        ],
      ],
    ),
  }
}

test.skipIf(process.platform !== "darwin")(
  "whole-agent sandbox confines read-only, workspace, strict, and custom sandbox.toml deny policies across bash and in-process tools",
  async () => {
    const root = await mkdtemp(path.join(homedir(), ".apexo-whole-sandbox-"))
    const workspace = path.join(root, "workspace")
    const extraWrite = path.join(root, "extra-write")
    const sibling = path.join(root, "sibling")
    const directories = ["data", "config", "cache", "state", "tmp"].map((name) => path.join(root, name))
    await Promise.all([workspace, extraWrite, sibling, ...directories].map((dir) => mkdir(dir, { recursive: true })))
    await mkdir(path.join(root, ".grok"), { recursive: true })
    await mkdir(path.join(root, ".ssh"), { recursive: true })
    await mkdir(path.join(workspace, ".grok"), { recursive: true })
    await mkdir(path.join(workspace, ".cursor"), { recursive: true })
    await mkdir(path.join(workspace, "nested"), { recursive: true })
    await mkdir(path.join(workspace, "secrets"), { recursive: true })

    await writeFile(
      path.join(workspace, "apexo.json"),
      JSON.stringify({ snapshots: false, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
    )
    await writeFile(path.join(workspace, "allowed.txt"), "INITIAL_ALLOWED\n")
    await writeFile(path.join(workspace, "secret.txt"), "TOP_SECRET_ROOT\n")
    await writeFile(path.join(workspace, "nested", "secret.txt"), "TOP_SECRET_NESTED\n")
    await writeFile(path.join(workspace, "secrets", "key.pem"), "PRIVATE_KEY_MATERIAL\n")
    await writeFile(path.join(root, ".ssh", "id_rsa"), "SSH_PRIVATE_KEY\n")
    await writeFile(path.join(sibling, "private.txt"), "SIBLING_PRIVATE\n")
    await symlink(path.join(workspace, "secret.txt"), path.join(workspace, "link-secret.txt"))
    await symlink(root, path.join(workspace, "escape"))

    const externalHookConfig = path.join(root, "external-cursor-hooks.json")
    await writeFile(externalHookConfig, JSON.stringify({ hooks: {} }))
    await symlink(externalHookConfig, path.join(workspace, ".cursor", "hooks.json"))
    await mkdir(path.join(workspace, ".claude"), { recursive: true })
    const externalClaudeSettings = path.join(root, "external-claude-settings.json")
    await writeFile(externalClaudeSettings, JSON.stringify({ hooks: {} }))
    await symlink(externalClaudeSettings, path.join(workspace, ".claude", "settings.json"))
    await symlink(path.join(root, "dangling-pwned.txt"), path.join(workspace, "dangling-escape"))

    // User sandbox.toml wins over project .grok/sandbox.toml when both define audit-deny
    await writeFile(
      path.join(root, ".grok", "sandbox.toml"),
      [
        "[profiles.audit-deny]",
        'extends = "workspace"',
        `read_write = [${JSON.stringify(extraWrite)}]`,
        'deny = ["**/secret.txt", "secrets/**", "~/.ssh"]',
      ].join("\n"),
    )
    await writeFile(
      path.join(workspace, ".grok", "sandbox.toml"),
      ['[profiles.audit-deny]', 'extends = "read-only"', 'deny = ["allowed.txt"]'].join("\n"),
    )

    const { projectID, layer } = makeLayer(root, workspace, directories)
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* Database.Service
          const events = yield* EventV2.Service
          const policies = yield* SessionCommandSandbox.Service
          const sandbox = yield* CommandSandbox.Service
          const tools = yield* ToolRegistry.Service
          const agents = yield* AgentV2.Service

          yield* agents.transform((draft) =>
            draft.update(AgentV2.ID.make("build"), (agent) => {
              agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
            }),
          )
          yield* database.db
            .insert(ProjectTable)
            .values({ id: projectID, worktree: AbsolutePath.make(workspace), sandboxes: [] })
            .run()

          const createSession = (profileName: Sandbox.Profile) =>
            Effect.gen(function* () {
              const policy = yield* sandbox.preflight(profileName)
              const id = SessionSchema.ID.create()
              const creation = yield* policies.prepareRoot(id, policy)
              yield* events.publish(
                SessionV1.Event.Created,
                {
                  sessionID: id,
                  info: SessionV1.SessionInfo.make({
                    id,
                    slug: "sandbox",
                    projectID,
                    directory: workspace,
                    title: `Sandbox ${profileName}`,
                    version: "1",
                    time: { created: Date.now(), updated: Date.now() },
                  }),
                },
                { id: creation.eventID, commit: () => creation.commit.pipe(Effect.orDie) },
              )
              return id
            })

          const registry = yield* tools.materialize()
          const callTool = (sessionID: SessionSchema.ID, name: string, input: Record<string, unknown>) =>
            registry.settle({
              sessionID,
              agent: AgentV2.ID.make("build"),
              assistantMessageID: SessionMessage.ID.create(),
              call: { type: "tool-call", id: crypto.randomUUID(), name, input },
            })

          // 1. Read-only session blocks write, edit, apply_patch, and network tools while allowing read/glob/grep
          const readOnlyID = yield* createSession("read-only")
          const roWrite = yield* callTool(readOnlyID, "write", {
            filePath: path.join(workspace, "ro-created.txt"),
            content: "SHOULD_NOT_WRITE",
          })
          expect(roWrite.result.type).toBe("error")

          const roEdit = yield* callTool(readOnlyID, "edit", {
            filePath: path.join(workspace, "allowed.txt"),
            oldString: "INITIAL_ALLOWED",
            newString: "MUTATED_BY_EDIT",
          })
          expect(roEdit.result.type).toBe("error")

          const roPatch = yield* callTool(readOnlyID, "apply_patch", {
            patchText: `*** Begin Patch\n*** Update File: allowed.txt\n@@\n-INITIAL_ALLOWED\n+MUTATED_BY_PATCH\n*** End Patch`,
          })
          expect(roPatch.result.type).toBe("error")

          const roRead = yield* callTool(readOnlyID, "read", { filePath: path.join(workspace, "allowed.txt") })
          expect(roRead.result.type).not.toBe("error")

          const roFetch = yield* callTool(readOnlyID, "webfetch", { url: "https://example.com" })
          expect(roFetch.result.type).toBe("error")

          // 2. Workspace session blocks writing to protected files, symlinked hook targets, dangling symlinks, and external paths
          const workspaceID = yield* createSession("workspace")
          const wsProtectedWrite = yield* callTool(workspaceID, "write", {
            filePath: path.join(workspace, "apexo.json"),
            content: "{}",
          })
          expect(wsProtectedWrite.result.type).toBe("error")

          const wsHookTargetEdit = yield* callTool(workspaceID, "write", {
            filePath: externalHookConfig,
            content: '{"hooks":{"Stop":[]}}',
          })
          expect(wsHookTargetEdit.result.type).toBe("error")

          const wsClaudeTargetEdit = yield* callTool(workspaceID, "write", {
            filePath: externalClaudeSettings,
            content: '{"hooks":{"Stop":[]}}',
          })
          expect(wsClaudeTargetEdit.result.type).toBe("error")

          const wsOutsideWrite = yield* callTool(workspaceID, "write", {
            filePath: path.join(root, "outside-tool.txt"),
            content: "OUTSIDE",
          })
          expect(wsOutsideWrite.result.type).toBe("error")

          const wsSymlinkEscape = yield* callTool(workspaceID, "write", {
            filePath: path.join(workspace, "escape", "escaped-via-symlink.txt"),
            content: "ESCAPED",
          })
          expect(wsSymlinkEscape.result.type).toBe("error")

          const wsDanglingSymlinkEscape = yield* callTool(workspaceID, "write", {
            filePath: path.join(workspace, "dangling-escape"),
            content: "DANGLING_PWNED",
          })
          expect(wsDanglingSymlinkEscape.result.type).toBe("error")

          const wsAllowedEdit = yield* callTool(workspaceID, "edit", {
            filePath: path.join(workspace, "allowed.txt"),
            oldString: "INITIAL_ALLOWED",
            newString: "WORKSPACE_EDITED",
          })
          expect(wsAllowedEdit.result.type).not.toBe("error")

          // 3. Custom profile audit-deny from sandbox.toml enforces deny globs/literals and read_write grants across bash and all tools
          const customID = yield* createSession("audit-deny")
          expect((yield* sandbox.status(customID)).profile).toBe("audit-deny")

          // Read tool denied on secret.txt, nested/secret.txt, secrets/key.pem, ~/.ssh/id_rsa, and symlink to secret.txt
          for (const blockedPath of [
            path.join(workspace, "secret.txt"),
            path.join(workspace, "nested", "secret.txt"),
            path.join(workspace, "secrets", "key.pem"),
            path.join(root, ".ssh", "id_rsa"),
            path.join(workspace, "link-secret.txt"),
          ]) {
            const readRes = yield* callTool(customID, "read", { filePath: blockedPath })
            expect(readRes.result.type).toBe("error")
          }

          // Glob and Grep must filter out denied files and never leak secret filenames or contents
          const globRes = yield* callTool(customID, "glob", { pattern: "**/*" })
          expect(globRes.result.type).not.toBe("error")
          expect(JSON.stringify(globRes)).toContain("allowed.txt")
          expect(JSON.stringify(globRes)).not.toContain("secret.txt")
          expect(JSON.stringify(globRes)).not.toContain("key.pem")

          const grepRes = yield* callTool(customID, "grep", { pattern: "TOP_SECRET|PRIVATE_KEY|WORKSPACE_EDITED" })
          expect(grepRes.result.type).not.toBe("error")
          expect(JSON.stringify(grepRes)).toContain("WORKSPACE_EDITED")
          expect(JSON.stringify(grepRes)).not.toContain("TOP_SECRET")
          expect(JSON.stringify(grepRes)).not.toContain("PRIVATE_KEY")

          // Write/Edit/ApplyPatch denied on secret.txt, allowed on extraWrite grant
          const denyWrite = yield* callTool(customID, "write", {
            filePath: path.join(workspace, "nested", "secret.txt"),
            content: "OVERWRITE_SECRET",
          })
          expect(denyWrite.result.type).toBe("error")

          const grantWrite = yield* callTool(customID, "write", {
            filePath: path.join(extraWrite, "granted.txt"),
            content: "GRANTED_OK",
          })
          expect(grantWrite.result.type).not.toBe("error")

          // Bash under audit-deny also enforces the exact same deny globs and read_write grant in Seatbelt
          const bashRes = yield* callTool(customID, "bash", {
            command: [
              `cat ${JSON.stringify(path.join(workspace, "secret.txt"))} 2>/dev/null && echo SECRET_ROOT_LEAKED || echo SECRET_ROOT_DENIED`,
              `cat ${JSON.stringify(path.join(workspace, "nested", "secret.txt"))} 2>/dev/null && echo SECRET_NESTED_LEAKED || echo SECRET_NESTED_DENIED`,
              `cat ${JSON.stringify(path.join(root, ".ssh", "id_rsa"))} 2>/dev/null && echo SSH_LEAKED || echo SSH_DENIED`,
              `printf BASH_GRANT > ${JSON.stringify(path.join(extraWrite, "bash-grant.txt"))} && echo GRANT_WRITE_OK`,
            ].join("; "),
          })
          expect(bashRes.result.type).not.toBe("error")
          const bashText = JSON.stringify(bashRes)
          expect(bashText).toContain("SECRET_ROOT_DENIED")
          expect(bashText).toContain("SECRET_NESTED_DENIED")
          expect(bashText).toContain("SSH_DENIED")
          expect(bashText).toContain("GRANT_WRITE_OK")
          expect(bashText).not.toContain("TOP_SECRET")
          expect(bashText).not.toContain("SSH_PRIVATE_KEY")

          // 4. Strict profile denies reading sibling directories outside workspace
          const strictID = yield* createSession("strict")
          const strictSiblingRead = yield* callTool(strictID, "read", {
            filePath: path.join(sibling, "private.txt"),
          })
          expect(strictSiblingRead.result.type).toBe("error")
          const strictWorkspaceRead = yield* callTool(strictID, "read", {
            filePath: path.join(workspace, "allowed.txt"),
          })
          expect(strictWorkspaceRead.result.type).not.toBe("error")
        }).pipe(Effect.scoped, Effect.provide(layer)),
      )

      expect(await Bun.file(path.join(workspace, "ro-created.txt")).exists()).toBe(false)
      expect(await Bun.file(path.join(root, "outside-tool.txt")).exists()).toBe(false)
      expect(await Bun.file(path.join(root, "escaped-via-symlink.txt")).exists()).toBe(false)
      expect(await Bun.file(path.join(root, "dangling-pwned.txt")).exists()).toBe(false)
      expect(await readFile(path.join(workspace, "allowed.txt"), "utf8")).toBe("WORKSPACE_EDITED\n")
      expect(await readFile(path.join(workspace, "nested", "secret.txt"), "utf8")).toBe("TOP_SECRET_NESTED\n")
      expect(await readFile(path.join(extraWrite, "granted.txt"), "utf8")).toBe("GRANTED_OK")
      expect(await readFile(path.join(extraWrite, "bash-grant.txt"), "utf8")).toBe("BASH_GRANT")
      expect(await readFile(externalHookConfig, "utf8")).toBe(JSON.stringify({ hooks: {} }))
      expect(await readFile(externalClaudeSettings, "utf8")).toBe(JSON.stringify({ hooks: {} }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  20000,
)
