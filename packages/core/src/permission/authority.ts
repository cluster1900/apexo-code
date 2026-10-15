export * as PermissionAuthority from "./authority"

import { Schema } from "effect"
import { Permission } from "@apexo/schema/permission"

/** Private durable policy snapshot; restoration requires an owning live capability. */
export const Snapshot = Schema.Struct({ rules: Permission.Ruleset, all: Permission.Ruleset })
export type Snapshot = typeof Snapshot.Type
