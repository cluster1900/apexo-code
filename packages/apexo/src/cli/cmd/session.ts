import type { Argv } from "yargs"
import { DateTime, Effect, Schema } from "effect"
import { cmd } from "./cmd"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionV2 } from "@apexo/core/session"
import { SessionMessage } from "@apexo/schema/session-message"
import { MessageID, SessionID } from "../../session/schema"
import { InstanceStore } from "@/project/instance-store"
import { InstanceRef } from "@/effect/instance-ref"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@apexo/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { NotFoundError } from "@/storage/storage"
import { EOL } from "os"
import path from "path"
import { which } from "@apexo/core/util/which"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.APEXO_GIT_BASH_PATH) {
    const less = path.join(Flag.APEXO_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    yargs.command(SessionListCommand).command(SessionForkCommand).command(SessionDeleteCommand).demandCommand(),
  async handler() {},
})

export const SessionForkCommand = effectCmd({
  command: "fork <sessionID>",
  describe: "fork a session into a new top-level session",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "source session ID to fork",
        type: "string",
        demandOption: true,
      })
      .option("message", {
        alias: "m",
        describe: "fork strictly before this message ID",
        type: "string",
      })
      .option("title", {
        alias: "t",
        describe: "custom title for the forked session",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["text", "json"] as const,
        default: "text" as const,
      }),
  handler: Effect.fn("Cli.session.fork")(function* (args) {
    if (!Schema.is(SessionID)(args.sessionID)) {
      return yield* fail(`Session '${args.sessionID}' not found.`)
    }
    const messageID =
      args.message === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(SessionMessage.ID)(args.message).pipe(
            Effect.mapError(() => new CliError({ message: `Invalid message ID '${args.message}'.`, exitCode: 1 })),
          )
    const session = yield* SessionV2.Service
    const forkLegacySession = Effect.fn("Cli.session.forkLegacy")(function* () {
      const source = yield* session
        .get(args.sessionID)
        .pipe(Effect.catchTag("Session.NotFoundError", () => fail(`Session '${args.sessionID}' not found.`)))
      const store = yield* InstanceStore.Service
      const legacySession = yield* Session.Service
      const ctx = yield* store.load({ directory: source.location.directory })
      const created = yield* Effect.gen(function* () {
        if (messageID) {
          const msgs = yield* legacySession
            .messages({ sessionID: args.sessionID })
            .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session '${args.sessionID}' not found.`)))
          if (!msgs.some((msg) => String(msg.info.id) === String(messageID))) {
            return yield* fail(`Message '${messageID}' not found in session '${args.sessionID}'.`)
          }
        }
        const cutoff = messageID
          ? MessageID.make(String(messageID))
          : source.revert?.messageID
            ? MessageID.make(String(source.revert.messageID))
            : undefined
        return yield* legacySession
          .fork({
            sessionID: args.sessionID,
            messageID: cutoff,
            title: args.title,
          })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session '${args.sessionID}' not found.`)))
      }).pipe(Effect.provideService(InstanceRef, ctx), Effect.ensuring(store.dispose(ctx)))
      return {
        id: created.id,
        title: created.title,
        directory: created.directory,
        agent: created.agent,
        model: created.model,
        created: created.time.created,
        updated: created.time.updated,
      }
    })
    const forked = yield* session
      .fork({
        sessionID: args.sessionID,
        messageID,
        title: args.title,
      })
      .pipe(
        Effect.map((created) => ({
          id: created.id,
          title: created.title,
          directory: created.location.directory,
          agent: created.agent,
          model: created.model,
          created: DateTime.toEpochMillis(created.time.created),
          updated: DateTime.toEpochMillis(created.time.updated),
        })),
        Effect.catchTag("Session.NotFoundError", () => fail(`Session '${args.sessionID}' not found.`)),
        Effect.catchTag("Session.MessageNotFoundError", (error) =>
          fail(`Message '${error.messageID}' not found in session '${error.sessionID}'.`),
        ),
        Effect.catchTag("Session.ManagedInputError", () =>
          fail(`Managed child session '${args.sessionID}' cannot be forked directly.`),
        ),
        Effect.catchTag("SessionHistoryCopy.Conflict", (error) => {
          if (error.message !== "History source uses legacy transcript storage") {
            return fail(error.message)
          }
          return forkLegacySession()
        }),
        Effect.catchTag("CommandSandbox.Failure", (error) => fail(error.message)),
      )
    if (args.format === "json") {
      console.log(
        JSON.stringify(
          {
            id: forked.id,
            sourceSessionID: args.sessionID,
            ...(messageID ? { beforeMessageID: messageID } : {}),
            title: forked.title,
            directory: forked.directory,
            agent: forked.agent,
            model: forked.model,
            created: forked.created,
            updated: forked.updated,
          },
          null,
          2,
        ),
      )
      return
    }
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD + `Session ${forked.id} forked from ${args.sessionID}` + UI.Style.TEXT_NORMAL,
    )
    UI.println(`Title: ${forked.title}`)
  }),
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    if (!Schema.is(SessionID)(args.sessionID)) {
      return yield* fail(`Session '${args.sessionID}' not found.`)
    }
    const svc = yield* Session.Service
    const sessionID = args.sessionID
    yield* svc.get(sessionID).pipe(Effect.catchCause(() => fail(`Session '${args.sessionID}' not found.`)))
    yield* svc
      .remove(sessionID)
      .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session '${args.sessionID}' not found.`)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionListCommand = effectCmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.session.list")(function* (args) {
    const sessions = yield* Session.Service.use((svc) => svc.list({ roots: true, limit: args.maxCount }))

    if (sessions.length === 0) {
      if (args.format === "json") console.log("[]")
      return
    }

    const output = args.format === "json" ? formatSessionJSON(sessions) : formatSessionTable(sessions)

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      yield* Effect.promise(async () => {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      })
    } else {
      console.log(output)
    }
  }),
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
