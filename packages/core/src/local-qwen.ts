export * as LocalQwen from "./local-qwen"

import path from "node:path"
import fs from "node:fs/promises"
import { createWriteStream, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import net from "node:net"
import launch from "cross-spawn"
import { Option, Schema } from "effect"
import { Global } from "./global"
import { Flock } from "./util/flock"
import { which } from "./util/which"

export const LOCAL_QWEN_PROVIDER_ID = "local-qwen"
export const LOCAL_QWEN_MODEL_ID = "qwen-0.8b-local"
export const DEFAULT_QWEN_FILENAME = "qwen3-0.6b-q8_0.gguf"
export const DEFAULT_QWEN_MODEL_URL =
  "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf"

const DEFAULT_TIMEOUT_MS = 2_500
const SIDECAR_BOOT_TIMEOUT_MS = 10_000
const SIDECAR_POLL_INTERVAL_MS = 150
const REAL_MODEL_MIN_BYTES = 1_000_000

const FeaturesSchema = Schema.Struct({
  smallModel: Schema.optional(Schema.Boolean),
  logCompress: Schema.optional(Schema.Boolean),
  schemaHeal: Schema.optional(Schema.Boolean),
  effortTriage: Schema.optional(Schema.Boolean),
  permissionAssist: Schema.optional(Schema.Boolean),
  autoAllowReadonly: Schema.optional(Schema.Boolean),
})

const StateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  modelPath: Schema.optional(Schema.String),
  modelUrl: Schema.optional(Schema.String),
  endpoint: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Number),
  installedAt: Schema.optional(Schema.Number),
  features: Schema.optional(FeaturesSchema),
})

const StateJsonSchema = Schema.fromJsonString(StateSchema)

const ChatCompletionResponseSchema = Schema.fromJsonString(
  Schema.Struct({
    choices: Schema.Array(
      Schema.Struct({
        message: Schema.optional(
          Schema.Struct({
            content: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      }),
    ),
  }),
)

export type LocalQwenFeatures = Schema.Schema.Type<typeof FeaturesSchema>
export type LocalQwenState = Schema.Schema.Type<typeof StateSchema>

export type DownloadProgress = {
  loadedBytes: number
  totalBytes?: number
  percent?: number
}

export interface LocalQwenOptions {
  cacheDir?: string
  stateDir?: string
  tmpDir?: string
  binDir?: string
  modelUrl?: string
  modelFilename?: string
  endpoint?: string
  timeoutMs?: number
  logCompressThreshold?: number
  fetch?: typeof fetch
  onProgress?: (progress: DownloadProgress) => void
}

let activeDownloadProgress: DownloadProgress | undefined

// Use node:fs/promises and node:crypto rather than Bun.* globals because Desktop's sidecar
// bundles packages/apexo/src/node.ts with target: "node" and runs inside Electron's Node runtime.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fileSizeIfExists(filePath: string): Promise<number | undefined> {
  const stat = await fs.stat(filePath).catch(() => undefined)
  if (!stat?.isFile()) return undefined
  return stat.size
}

export function resolvePaths(options?: LocalQwenOptions) {
  const cacheDir = options?.cacheDir ?? path.join(Global.Path.cache, "models")
  // Desktop's Electron sidecar overrides XDG_STATE_HOME to userDataPath while keeping XDG_CACHE_HOME
  // shared with CLI and TUI. Storing local-qwen.json in Global.Path.cache keeps CLI, TUI, and Desktop
  // viewing and controlling the exact same state.
  const stateDir = options?.stateDir ?? Global.Path.cache
  const tmpDir = options?.tmpDir ?? path.join(Global.Path.tmp, "local-qwen-logs")
  const binDir = options?.binDir ?? Global.Path.bin
  const filename = options?.modelFilename ?? DEFAULT_QWEN_FILENAME
  return {
    cacheDir,
    stateDir,
    tmpDir,
    binDir,
    stateFile: path.join(stateDir, "local-qwen.json"),
    defaultModelPath: path.join(cacheDir, filename),
    stashModelPath: path.join(cacheDir, `.${filename}.stash`),
  }
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatProgressBar(progress: DownloadProgress, width = 20): string {
  if (progress.percent !== undefined) {
    const clamped = Math.max(0, Math.min(100, progress.percent))
    const filled = Math.round((clamped / 100) * width)
    const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`
    const sizeText = progress.totalBytes
      ? ` (${formatMegabytes(progress.loadedBytes)} / ${formatMegabytes(progress.totalBytes)})`
      : ` (${formatMegabytes(progress.loadedBytes)})`
    return `[${bar}] ${clamped}%${sizeText}`
  }
  return `Downloaded ${formatMegabytes(progress.loadedBytes)}...`
}

function isPidAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killPidSafely(pid: number | undefined): Promise<void> {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return
  }
  const deadline = Date.now() + 600
  while (Date.now() < deadline && isPidAlive(pid)) {
    await sleep(40)
  }
}

export async function readLocalQwenState(options?: LocalQwenOptions): Promise<LocalQwenState> {
  if (
    !options?.stateDir &&
    !options?.endpoint &&
    (process.env.NODE_ENV === "test" || Boolean(process.env.APEXO_TEST_HOME))
  ) {
    return { enabled: false }
  }
  const paths = resolvePaths(options)
  if (!existsSync(paths.stateFile)) {
    if (options?.endpoint) {
      return {
        enabled: true,
        endpoint: options.endpoint,
      }
    }
    return { enabled: false }
  }
  const raw = await fs.readFile(paths.stateFile, "utf8").catch(() => "")
  const decoded = Schema.decodeUnknownOption(StateJsonSchema)(raw)
  if (Option.isNone(decoded)) return { enabled: false }
  return {
    ...decoded.value,
    ...(options?.endpoint ? { endpoint: options.endpoint } : {}),
  }
}

export async function writeLocalQwenState(state: LocalQwenState, options?: LocalQwenOptions): Promise<void> {
  const paths = resolvePaths(options)
  await fs.mkdir(paths.stateDir, { recursive: true })
  await fs.writeFile(paths.stateFile, JSON.stringify(state, null, 2), "utf8")
}

export async function isLocalQwenModelDownloaded(options?: LocalQwenOptions): Promise<boolean> {
  const state = await readLocalQwenState(options)
  const paths = resolvePaths(options)
  const target = state.modelPath ?? paths.defaultModelPath
  const size = await fileSizeIfExists(target)
  return size !== undefined && size > 0
}

export async function stopLocalQwenSidecar(options?: LocalQwenOptions): Promise<LocalQwenState> {
  const current = await readLocalQwenState(options)
  await killPidSafely(current.pid)
  const next: LocalQwenState = {
    ...current,
    pid: undefined,
    endpoint: current.pid ? undefined : current.endpoint,
  }
  await writeLocalQwenState(next, options)
  return next
}

async function streamResponseToFile(
  response: Response,
  partFile: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    onChunk(bytes)
    await fs.writeFile(partFile, bytes)
    return
  }
  const stream = createWriteStream(partFile)
  const reader = response.body.getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    if (chunk.value && chunk.value.byteLength > 0) {
      await new Promise<void>((resolve, reject) => {
        stream.write(chunk.value, (err) => (err ? reject(err) : resolve()))
      })
      onChunk(chunk.value)
    }
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
  })
}

export async function installLocalQwen(
  options?: LocalQwenOptions & {
    url?: string
    expectedSha256?: string
    force?: boolean
  },
): Promise<LocalQwenState> {
  const paths = resolvePaths(options)
  const url =
    options?.url ??
    options?.modelUrl ??
    process.env.APEXO_LOCAL_QWEN_MODEL_URL ??
    DEFAULT_QWEN_MODEL_URL
  const transport = options?.fetch ?? fetch

  await fs.mkdir(paths.cacheDir, { recursive: true })

  // Fast path: if weights are already present or stashed locally (and no custom URL / sha256 / --force
  // was requested), restore and activate immediately instead of re-downloading ~610 MB over the network.
  if (!options?.force && !options?.url && !options?.expectedSha256) {
    const existingSize = await fileSizeIfExists(paths.defaultModelPath)
    if (existingSize !== undefined && existingSize >= REAL_MODEL_MIN_BYTES) {
      options?.onProgress?.({ loadedBytes: existingSize, totalBytes: existingSize, percent: 100 })
      return finalizeInstalledState(paths.defaultModelPath, url, options)
    }
    const stashedSize = await fileSizeIfExists(paths.stashModelPath)
    if (stashedSize !== undefined && stashedSize >= REAL_MODEL_MIN_BYTES) {
      await fs.rename(paths.stashModelPath, paths.defaultModelPath)
      options?.onProgress?.({ loadedBytes: stashedSize, totalBytes: stashedSize, percent: 100 })
      return finalizeInstalledState(paths.defaultModelPath, url, options)
    }
  }

  const response = await transport(url)
  if (!response.ok) {
    throw new Error(`Failed to download local Qwen model (${response.status} ${response.statusText})`)
  }

  const contentLengthHeader = response.headers.get("content-length")
  const totalBytes =
    contentLengthHeader && Number.isFinite(Number(contentLengthHeader)) && Number(contentLengthHeader) > 0
      ? Number(contentLengthHeader)
      : undefined

  const partFile = `${paths.defaultModelPath}.part-${process.pid}-${Date.now()}`
  const hasher = createHash("sha256")
  let loadedBytes = 0
  let lastReportedPercent = -1
  let lastReportedTime = 0

  const reportProgress = (force = false) => {
    const now = Date.now()
    const percent = totalBytes ? Math.min(100, Math.floor((loadedBytes / totalBytes) * 100)) : undefined
    const shouldReport =
      force ||
      (percent !== undefined && percent - lastReportedPercent >= 5) ||
      now - lastReportedTime >= 500
    if (!shouldReport) return
    if (percent !== undefined) lastReportedPercent = percent
    lastReportedTime = now
    const progress: DownloadProgress = { loadedBytes, totalBytes, percent }
    activeDownloadProgress = progress
    options?.onProgress?.(progress)
  }

  reportProgress(true)

  try {
    await streamResponseToFile(response, partFile, (chunk) => {
      hasher.update(chunk)
      loadedBytes += chunk.byteLength
      reportProgress(false)
    })

    if (loadedBytes === 0) {
      throw new Error("Downloaded local Qwen model is empty")
    }

    reportProgress(true)

    if (options?.expectedSha256) {
      const digest = hasher.digest("hex")
      if (digest !== options.expectedSha256.toLowerCase()) {
        throw new Error(`Local Qwen model SHA256 mismatch: expected ${options.expectedSha256}, got ${digest}`)
      }
    }

    await fs.rename(partFile, paths.defaultModelPath)
  } catch (err) {
    await fs.rm(partFile, { force: true }).catch(() => {})
    throw err
  } finally {
    activeDownloadProgress = undefined
  }

  return finalizeInstalledState(paths.defaultModelPath, url, options)
}

async function finalizeInstalledState(
  modelPath: string,
  modelUrl: string,
  options?: LocalQwenOptions,
): Promise<LocalQwenState> {
  const current = await readLocalQwenState(options)
  const next: LocalQwenState = {
    ...current,
    enabled: true,
    modelPath,
    modelUrl,
    installedAt: Date.now(),
    features: {
      smallModel: true,
      logCompress: true,
      schemaHeal: true,
      effortTriage: true,
      permissionAssist: true,
      ...current.features,
    },
  }
  await writeLocalQwenState(next, options)
  await ensureLocalQwenEndpoint(options).catch(() => undefined)
  return readLocalQwenState(options)
}

export async function removeLocalQwen(options?: LocalQwenOptions & { purge?: boolean }): Promise<LocalQwenState> {
  const current = await stopLocalQwenSidecar(options)
  const paths = resolvePaths(options)
  const target = current.modelPath ?? paths.defaultModelPath
  const size = await fileSizeIfExists(target)
  const shouldStash = size !== undefined && !options?.purge && size >= REAL_MODEL_MIN_BYTES
  if (shouldStash) {
    await fs.rename(target, paths.stashModelPath).catch(async () => {
      await fs.rm(target, { force: true }).catch(() => {})
    })
  }
  if (size !== undefined && !shouldStash) {
    await fs.rm(target, { force: true }).catch(() => {})
  }
  if (options?.purge) {
    await fs.rm(paths.stashModelPath, { force: true }).catch(() => {})
  }
  const next: LocalQwenState = {
    enabled: false,
    features: current.features,
  }
  await writeLocalQwenState(next, options)
  return next
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((err) => {
        if (err || !port) {
          reject(err ?? new Error("Failed to allocate loopback port"))
          return
        }
        resolve(port)
      })
    })
  })
}

export async function isEndpointHealthy(endpoint: string, transport: typeof fetch = fetch, timeoutMs = 400): Promise<boolean> {
  const base = endpoint.replace(/\/v1\/?$/, "").replace(/\/+$/, "")
  const health = await transport(`${base}/health`, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined)
  if (health?.ok) return true

  const models = await transport(`${base}/v1/models`, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined)
  return Boolean(models?.ok)
}

export function resolveLlamaServerBinary(binDir: string): string | undefined {
  return (
    which("llama-server", {
      PATH: `${binDir}${path.delimiter}/opt/homebrew/bin${path.delimiter}/usr/local/bin${path.delimiter}${process.env.PATH ?? ""}`,
    }) ?? undefined
  )
}

let inFlightSidecar: Promise<string | undefined> | undefined

export async function ensureLocalQwenEndpoint(options?: LocalQwenOptions): Promise<string | undefined> {
  const state = await readLocalQwenState(options)
  if (!state.enabled) return undefined

  const transport = options?.fetch ?? fetch
  const explicitEndpoint = options?.endpoint ?? process.env.APEXO_LOCAL_QWEN_ENDPOINT
  if (explicitEndpoint) {
    return explicitEndpoint.replace(/\/+$/, "")
  }

  if (state.endpoint) {
    if (!state.pid) {
      return state.endpoint.replace(/\/+$/, "")
    }
    if (await isEndpointHealthy(state.endpoint, transport, 500)) {
      return state.endpoint.replace(/\/+$/, "")
    }
  }

  if (inFlightSidecar) return inFlightSidecar

  const paths = resolvePaths(options)
  const task = Flock.withLock(
    "local-qwen-sidecar",
    async () => {
      const freshState = await readLocalQwenState(options)
      if (!freshState.enabled) return undefined
      if (freshState.endpoint && freshState.pid && (await isEndpointHealthy(freshState.endpoint, transport, 500))) {
        return freshState.endpoint.replace(/\/+$/, "")
      }
      if (freshState.pid) {
        await killPidSafely(freshState.pid)
      }

      const modelPath = freshState.modelPath ?? paths.defaultModelPath
      const modelSize = await fileSizeIfExists(modelPath)
      if (modelSize === undefined || modelSize === 0) return undefined

      const binary = resolveLlamaServerBinary(paths.binDir)
      if (!binary) return undefined

      const port = await allocateLoopbackPort().catch(() => 0)
      if (!port) return undefined

      let exited = false
      const proc = launch(
        binary,
        [
          "-m",
          modelPath,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--ctx-size",
          "4096",
          "--reasoning",
          "off",
          "--reasoning-budget",
          "0",
        ],
        {
          stdio: "ignore",
          detached: true,
        },
      )
      proc.once("exit", () => {
        exited = true
      })
      proc.once("error", () => {
        exited = true
      })
      proc.unref()

      const endpoint = `http://127.0.0.1:${port}/v1`
      const deadline = Date.now() + SIDECAR_BOOT_TIMEOUT_MS
      let ready = false
      while (Date.now() < deadline && !exited) {
        if (await isEndpointHealthy(endpoint, transport, 400)) {
          ready = true
          break
        }
        await sleep(SIDECAR_POLL_INTERVAL_MS)
      }

      if (!ready) {
        await killPidSafely(proc.pid)
        return undefined
      }

      await writeLocalQwenState(
        {
          ...freshState,
          endpoint,
          ...(proc.pid ? { pid: proc.pid } : {}),
        },
        options,
      )
      return endpoint
    },
    { dir: paths.stateDir },
  ).finally(() => {
    inFlightSidecar = undefined
  })

  inFlightSidecar = task
  return task
}

function stripThinkingTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim()
}

export function extractJsonPayload(raw: string): string {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  const firstBrace = stripped.indexOf("{")
  const lastBrace = stripped.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1)
  }
  const firstBracket = stripped.indexOf("[")
  const lastBracket = stripped.lastIndexOf("]")
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return stripped.slice(firstBracket, lastBracket + 1)
  }
  return stripped
}

export async function completeLocalQwen(
  input: {
    system: string
    prompt: string
    maxTokens?: number
    jsonMode?: boolean
  },
  options?: LocalQwenOptions,
): Promise<string | undefined> {
  const endpoint = await ensureLocalQwenEndpoint(options)
  if (!endpoint) return undefined

  const transport = options?.fetch ?? fetch
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = endpoint.endsWith("/v1") ? endpoint : `${endpoint.replace(/\/+$/, "")}/v1`

  const response = await transport(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-qwen",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: LOCAL_QWEN_MODEL_ID,
      temperature: 0,
      max_tokens: input.maxTokens ?? 128,
      chat_template_kwargs: { enable_thinking: false },
      ...(input.jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: `/no_think\n${input.system}` },
        { role: "user", content: `${input.prompt}\n/no_think` },
      ],
    }),
  }).catch(() => undefined)

  if (!response?.ok) return undefined
  const raw = await response.text().catch(() => "")
  const decoded = Schema.decodeUnknownOption(ChatCompletionResponseSchema)(raw)
  if (Option.isNone(decoded)) return undefined
  const content = decoded.value.choices[0]?.message?.content
  if (typeof content !== "string") return undefined
  const cleaned = stripThinkingTags(content)
  return cleaned.length > 0 ? cleaned : undefined
}

export async function inspectLocalQwenStatus(
  options?: LocalQwenOptions & { ensureSidecar?: boolean },
) {
  const state = await readLocalQwenState(options)
  const paths = resolvePaths(options)
  const modelPath = state.modelPath ?? paths.defaultModelPath
  const sizeBytes = (await fileSizeIfExists(modelPath)) ?? 0
  const downloaded = sizeBytes > 0
  const binary = resolveLlamaServerBinary(paths.binDir)
  const shouldEnsure = options?.ensureSidecar !== false
  const endpoint = state.enabled && shouldEnsure ? await ensureLocalQwenEndpoint(options) : state.endpoint
  const healthy = endpoint ? await isEndpointHealthy(endpoint, options?.fetch ?? fetch, 500) : false
  return {
    enabled: state.enabled,
    downloaded,
    modelPath,
    sizeBytes,
    binary,
    endpoint,
    healthy,
    pid: state.pid,
    features: state.features,
    installing: Boolean(activeDownloadProgress),
    progress: activeDownloadProgress,
    progressText: activeDownloadProgress ? formatProgressBar(activeDownloadProgress) : undefined,
  }
}

export async function runLocalQwenCommand(
  rawArgs: string,
  options?: LocalQwenOptions,
): Promise<string> {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean)
  const subcommand = (tokens[0] ?? "status").toLowerCase()
  const rest = tokens.slice(1)

  if (subcommand === "install" || subcommand === "download" || subcommand === "reinstall") {
    const force = subcommand === "reinstall" || rest.includes("--force") || rest.includes("force")
    const customUrl = rest.find((token) => !token.startsWith("-") && token !== "force")
    await installLocalQwen({
      ...options,
      force,
      ...(customUrl ? { url: customUrl } : {}),
    })
    const status = await inspectLocalQwenStatus(options)
    return [
      "### Local Qwen 0.8B Installed & Enabled",
      `- **Model Path**: \`${status.modelPath}\` (${formatMegabytes(status.sizeBytes)})`,
      `- **Runtime Binary**: \`${status.binary ?? "not found (install llama.cpp or set /local-qwen endpoint <url>)"}\``,
      `- **Active Endpoint**: \`${status.endpoint ?? "none"}\`${status.healthy ? " (healthy)" : ""}`,
      `- **Auto-Takeover Tasks**: \`small_model\`, \`tool.execute.before\` (Schema Heal), \`tool.execute.after\` (Log Sieve), \`chat.params\` (Effort Triage), \`permission.ask\` (Risk Assist)`,
    ].join("\n")
  }

  if (subcommand === "endpoint") {
    const endpoint = rest[0]
    if (!endpoint) {
      return "Usage: `/local-qwen endpoint <http://127.0.0.1:8080/v1>`"
    }
    const current = await readLocalQwenState(options)
    const next: LocalQwenState = {
      ...current,
      enabled: true,
      pid: undefined,
      endpoint: endpoint.replace(/\/+$/, ""),
      features: {
        smallModel: true,
        logCompress: true,
        schemaHeal: true,
        effortTriage: true,
        permissionAssist: true,
        ...current.features,
      },
    }
    await writeLocalQwenState(next, options)
    return [
      "### Local Qwen 0.8B Endpoint Configured",
      `- **Endpoint**: \`${next.endpoint}\``,
      `- **Status**: Enabled (Auto-takeover active)`,
    ].join("\n")
  }

  if (subcommand === "enable") {
    const current = await readLocalQwenState(options)
    const next: LocalQwenState = { ...current, enabled: true }
    await writeLocalQwenState(next, options)
    const endpoint = await ensureLocalQwenEndpoint(options)
    return `Local Qwen 0.8B edge accelerator **enabled**${endpoint ? ` (active endpoint: \`${endpoint}\`)` : ""}.`
  }

  if (subcommand === "disable") {
    const stopped = await stopLocalQwenSidecar(options)
    const next: LocalQwenState = { ...stopped, enabled: false }
    await writeLocalQwenState(next, options)
    return "Local Qwen 0.8B edge accelerator **disabled** (cached weights preserved)."
  }

  if (subcommand === "remove" || subcommand === "uninstall") {
    const purge = rest.includes("--purge") || rest.includes("purge")
    await removeLocalQwen({ ...options, purge })
    return "Local Qwen 0.8B model weights removed and auto-takeover disabled."
  }

  const status = await inspectLocalQwenStatus(options)
  return [
    "### Local Qwen 0.8B Edge Accelerator Status",
    `- **Enabled**: \`${status.enabled}\``,
    `- **Weights Downloaded**: \`${status.downloaded}\` (\`${status.modelPath}\`${status.downloaded ? `, ${formatMegabytes(status.sizeBytes)}` : ""})`,
    `- **Runtime Binary**: \`${status.binary ?? "not found"}\``,
    `- **Active Endpoint**: \`${status.endpoint ?? "none"}\`${status.endpoint ? (status.healthy ? " (healthy)" : " (unreachable)") : ""}`,
    `- **Usage**: \`/local-qwen install [url]\` | \`/local-qwen endpoint <url>\` | \`/local-qwen enable\` | \`/local-qwen disable\` | \`/local-qwen remove\``,
  ].join("\n")
}
