export * as SessionChildPlacementRecord from "./child-placement-record"

import { Schema } from "effect"
import { AbsolutePath } from "../schema"
import { Project } from "../project"
import { optional } from "@apexo/schema/schema"

/** Private ownership metadata, committed with the child's Created event. */
export const Record = Schema.Struct({
  mode: Schema.Literals(["cwd", "worktree"]),
  directory: AbsolutePath,
  projectID: Project.ID,
  dev: Schema.String,
  ino: Schema.String,
  repository: optional(AbsolutePath),
  repositoryDev: optional(Schema.String),
  repositoryIno: optional(Schema.String),
  baseRevision: optional(Schema.String),
  changes: optional(Schema.String),
})
export type Record = typeof Record.Type
