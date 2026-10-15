export * as ProjectCatalog from "./catalog"

import { asc } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Project } from "@apexo/schema/project"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { ProjectTable } from "./sql"

export class Failure extends Schema.TaggedErrorClass<Failure>()("ProjectCatalog.Failure", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly list: Effect.Effect<ReadonlyArray<Project.Info>, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/ProjectCatalog") {}

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      return Service.of({
        list: Effect.gen(function* () {
          const rows = yield* database.db.select().from(ProjectTable).orderBy(asc(ProjectTable.id)).all()
          return yield* Schema.decodeUnknownEffect(Schema.Array(Project.Info))(
            rows.map((row) => ({
              id: row.id,
              worktree: row.worktree,
              ...(row.vcs === null ? {} : { vcs: row.vcs }),
              ...(row.name === null ? {} : { name: row.name }),
              ...(row.icon_url === null && row.icon_url_override === null && row.icon_color === null
                ? {}
                : {
                    icon: {
                      ...(row.icon_url === null ? {} : { url: row.icon_url }),
                      ...(row.icon_url_override === null ? {} : { override: row.icon_url_override }),
                      ...(row.icon_color === null ? {} : { color: row.icon_color }),
                    },
                  }),
              ...(row.commands === null ? {} : { commands: row.commands }),
              time: {
                created: row.time_created,
                updated: row.time_updated,
                ...(row.time_initialized === null ? {} : { initialized: row.time_initialized }),
              },
              sandboxes: row.sandboxes,
            })),
          )
        }).pipe(Effect.mapError(() => new Failure({ message: "Could not read the project catalog" }))),
      })
    }),
  ),
  deps: [Database.node],
})
