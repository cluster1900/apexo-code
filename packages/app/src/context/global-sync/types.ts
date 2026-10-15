import type {
  Agent,
  Config,
  LspStatus,
  Message,
  Part,
  Path,
  PermissionRequest,
  QuestionRequest,
  ReferenceInfo,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "@apexo/sdk/v2/client"
import type { FileDiffInfo } from "@apexo/client/promise"
import { NormalizedProviderListResponse } from "@apexo/session-ui/context"
import type { CommandInfo, McpResource, SessionMessageInfo } from "@apexo/client/promise"
import type { Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"

import type { Lsp } from "@apexo/schema/lsp"

export type LspConnectionStatus = LspStatus | Lsp.Status

import type { McpConnectionStatus } from "./mcp"

export type ProjectMeta = {
  name?: string
  icon?: {
    override?: string
    color?: string
  }
  commands?: {
    start?: string
  }
}

export type State = {
  status: "loading" | "partial" | "complete"
  agent: Agent[]
  command: CommandInfo[]
  reference: ReferenceInfo[]
  project: string
  projectMeta: ProjectMeta | undefined
  icon: string | undefined
  provider_ready: boolean
  provider: NormalizedProviderListResponse
  config: Config
  path: Path
  session: Session[]
  sessionTotal: number
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_working(id: string): boolean
  session_diff: {
    [sessionID: string]: FileDiffInfo[]
  }
  todo: {
    [sessionID: string]: Todo[]
  }
  permission: {
    [sessionID: string]: PermissionRequest[]
  }
  question: {
    [sessionID: string]: QuestionRequest[]
  }
  mcp_ready: boolean
  mcp_error?: boolean
  mcp: {
    [name: string]: McpConnectionStatus
  }
  mcp_resource: {
    [key: string]: McpResource
  }
  lsp_ready: boolean
  lsp: LspConnectionStatus[]
  vcs: VcsInfo | undefined
  limit: number
  message: {
    [sessionID: string]: Message[]
  }
  session_message: {
    [sessionID: string]: SessionMessageInfo[]
  }
  part: {
    [messageID: string]: Part[]
  }
  part_text_accum_delta: {
    [partID: string]: string
  }
}

export type VcsCache = {
  store: Store<{ value: VcsInfo | undefined }>
  setStore: SetStoreFunction<{ value: VcsInfo | undefined }>
  ready: Accessor<boolean>
}

export type MetaCache = {
  store: Store<{ value: ProjectMeta | undefined }>
  setStore: SetStoreFunction<{ value: ProjectMeta | undefined }>
  ready: Accessor<boolean>
}

export type IconCache = {
  store: Store<{ value: string | undefined }>
  setStore: SetStoreFunction<{ value: string | undefined }>
  ready: Accessor<boolean>
}

export type ChildOptions = {
  bootstrap?: boolean
  mcp?: boolean
}

export type DirState = {
  lastAccessAt: number
}

export type EvictPlan = {
  stores: string[]
  state: Map<string, DirState>
  pins: Set<string>
  max: number
  ttl: number
  now: number
}

export type DisposeCheck = {
  directory: string
  hasStore: boolean
  pinned: boolean
  booting: boolean
  loadingSessions: boolean
}

export const MAX_DIR_STORES = 30
export const DIR_IDLE_TTL_MS = 20 * 60 * 1000
export const SESSION_RECENT_WINDOW = 4 * 60 * 60 * 1000
export const SESSION_RECENT_LIMIT = 50
