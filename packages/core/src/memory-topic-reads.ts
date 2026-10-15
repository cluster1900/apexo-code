export * as MemoryTopicReads from "./memory-topic-reads"

import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { layer } from "#sqlite"
import type { MemoryCatalog } from "./memory-catalog"
import { MemoryV2 } from "./memory-v2"
import { MemoryFilesystem } from "./memory-filesystem"

// Advisory counters must not initialize storage or wait behind capture/Dream's
// filesystem lock. A busy or old database must never turn a successful read into
// a tool failure. Only ordinary model reads call this; previews do not.
export const record = Effect.fn("MemoryTopicReads.record")(
  function* (input: MemoryCatalog.Location, file: string) {
    const home = yield* Effect.tryPromise(() => realpath(input.home))
    const target = path.resolve(file)
    for (const scope of ["global", "workspace"] as const) {
      const root = {
        home,
        scope,
        path: MemoryV2.directory({ ...input, home, scope }),
        locks: path.join(home, ".grok", "memory-v2", "apexo", ".locks"),
      }
      const alias = MemoryV2.directory({ ...input, scope })
      const relative = [root.path, alias]
        .map((directory) => path.relative(directory, target).split(path.sep).join("/"))
        .find((relative) => /^topics\/(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\]+\.md$/.test(relative))
      if (!relative) continue
      const paths = (relative: string) => [path.join(root.path, relative), path.join(alias, relative)]
      if (!input.permitted(paths(relative), "read") || !input.permitted(paths("memory_state.sqlite"), "edit")) return
      const database = yield* Effect.tryPromise(async () => {
        for (const name of [relative, "memory_state.sqlite", "memory_state.sqlite-wal", "memory_state.sqlite-shm"])
          await MemoryV2.validate(root, name)
        await lstat(path.join(root.path, relative))
        await lstat(path.join(root.path, "memory_state.sqlite"))
        await MemoryFilesystem.requireLocal(root.path)
        return path.join(root.path, "memory_state.sqlite")
      })
      const services = yield* Layer.build(
        layer({ filename: database, create: false, readwrite: true, disableWAL: true }),
      )
      const sql = Context.get(services, SqlClient.SqlClient)
      yield* sql`PRAGMA busy_timeout = 100`
      yield* sql`INSERT INTO memory_v2_topic_reads (relative_path, read_count, last_read_at) VALUES (${relative}, 1, ${Math.floor(Date.now() / 1000)}) ON CONFLICT(relative_path) DO UPDATE SET read_count = read_count + 1, last_read_at = excluded.last_read_at`
      return
    }
  },
  Effect.scoped,
  Effect.catchCause(() => Effect.void),
)
