import { Layer } from "effect"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { ScheduleHandler } from "./handlers/schedule"
import { ProcessHandler } from "./handlers/process"
import { TaskHandler } from "./handlers/task"
import { GoalHandler } from "./handlers/goal"
import { MemoryOperationHandler } from "./handlers/memory-operation"
import { MemoryHandler } from "./handlers/memory"
import { FeedbackHandler } from "./handlers/feedback"
import { HooksHandler } from "./handlers/hooks"
import { PluginsHandler } from "./handlers/plugins"
import { SessionMcpAttachmentHandler } from "./handlers/session-mcp-attachment"
import { McpHandler } from "./handlers/mcp"
import { LspHandler } from "./handlers/lsp"
import { WorkflowHandler } from "./handlers/workflow"
import { SideQuestionHandler } from "./handlers/side-question"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { FileSystemHandler } from "./handlers/fs"
import { CommandHandler } from "./handlers/command"
import { SkillHandler } from "./handlers/skill"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { HealthHandler } from "./handlers/health"
import { PtyHandler } from "./handlers/pty"
import { QuestionHandler } from "./handlers/question"
import { ReferenceHandler } from "./handlers/reference"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { CredentialHandler } from "./handlers/credential"
import { ProjectCopyHandler } from "./handlers/project-copy"
import { ProjectHandler } from "./handlers/project"
import { BrowserHandler } from "./handlers/browser"

export const handlers = Layer.mergeAll(
  HealthHandler,
  LocationHandler,
  AgentHandler,
  SessionHandler,
  GoalHandler,
  TaskHandler,
  ProcessHandler,
  ScheduleHandler,
  FeedbackHandler,
  MemoryHandler,
  MemoryOperationHandler,
  HooksHandler,
  PluginsHandler,
  McpHandler,
  SessionMcpAttachmentHandler,
  LspHandler,
  WorkflowHandler,
  SideQuestionHandler,
  MessageHandler,
  ModelHandler,
  ProviderHandler,
  IntegrationHandler,
  CredentialHandler,
  PermissionHandler,
  FileSystemHandler,
  CommandHandler,
  SkillHandler,
  EventHandler,
  PtyHandler,
  QuestionHandler,
  ReferenceHandler,
  ProjectCopyHandler,
  ProjectHandler,
  BrowserHandler,
)
