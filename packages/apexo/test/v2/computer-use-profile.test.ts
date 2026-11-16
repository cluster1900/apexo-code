import { expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { ConfigMigrateV1 } from "@apexo/core/v1/config/migrate"
import { Config } from "@apexo/core/config"
import { PermissionV2 } from "@apexo/core/permission"
import {
  legacyPermissionProfile,
  permissionProfile,
  toolName,
  tools,
} from "../../../../plugins/computer-use/script/build.mjs"

test("Computer Use V1 and V2 profiles preserve the same native approval boundary", () => {
  const v1 = ConfigMigrateV1.migrate(Schema.decodeUnknownSync(ConfigV1.Info)(legacyPermissionProfile()))
  const v2 = Schema.decodeUnknownSync(Config.Info)(permissionProfile())
  for (const profile of [v1, v2]) {
    for (const tool of [...tools, "desktop_launch", "desktop_batch", "desktop_press"]) {
      expect(
        PermissionV2.evaluate(toolName(tool), "*", profile.permissions ?? [], profile.agents?.build?.permissions ?? [])
          .effect,
      ).toBe(tools.includes(tool) ? "ask" : "deny")
      expect(PermissionV2.evaluate(toolName(tool), "*", profile.permissions ?? []).effect).toBe("deny")
    }
  }
})
