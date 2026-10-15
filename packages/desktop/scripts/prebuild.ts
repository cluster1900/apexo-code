#!/usr/bin/env bun
import { $ } from "bun"

import { stageCliToResources, resolveChannel } from "./utils"
import { stageWorkflowInterpreter } from "../../workflow-script/script/artifact"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../apexo && bun script/build-node.ts`
await stageWorkflowInterpreter("resources", { os: process.platform, arch: process.arch })
if (channel === "dev") await stageCliToResources()
