export * as BuiltInTools from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { Layer } from "effect"
import { SchedulerTools } from "./scheduler"
import { MonitorTool } from "./monitor"
import { ProcessTool } from "./process"
import { BashTool } from "./bash"
import { BrowserTool } from "./browser"
import { ApplyPatchTool } from "./apply-patch"
import { EditTool } from "./edit"
import { FeedbackTool } from "./feedback"
import { GoalTool } from "./goal"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { MemoryTools } from "./memory"
import { MediaTools } from "./media"
import { McpResourceTools } from "./mcp-resources"
import { LspTool } from "./lsp"
import { PlanTools } from "./plan"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { SkillTool } from "./skill"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todowrite"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"
import { WorkflowTool } from "./workflow"

/**
 * Composes only the shipped Location-scoped built-in tool transforms.
 * Each tool retains its implementation and focused tests independently. Dynamic
 * MCP and plugin tools later use separate scoped canonical registrations, while
 * provider/model filtering belongs to a future materialization phase rather
 * than this static list. The caller intentionally supplies shared Location
 * services once to this merged set.
 *
 * TODO: Port the remaining launch-follow-up leaves deliberately: repo_clone, repo_overview, and Rune/code mode. Keep MCP and plugin
 * transforms separate from this static built-in list.
 */
export const node = makeLocationNode({
  name: "built-in-tools",
  layer: Layer.empty,
  deps: [
    ApplyPatchTool.node,
    BashTool.node,
    BrowserTool.node,
    ProcessTool.node,
    MonitorTool.node,
    SchedulerTools.node,
    EditTool.node,
    FeedbackTool.node,
    GlobTool.node,
    GoalTool.node,
    GrepTool.node,
    LspTool.node,
    McpResourceTools.node,
    MediaTools.node,
    MemoryTools.node,
    QuestionTool.node,
    PlanTools.node,
    ReadTool.node,
    SkillTool.node,
    TodoWriteTool.node,
    TaskTool.node,
    WebFetchTool.node,
    WebSearchTool.node,
    WriteTool.node,
    WorkflowTool.node,
  ],
})
