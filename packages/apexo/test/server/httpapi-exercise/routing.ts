import { Duration } from "effect"
import { OpenApiMethods, type OpenApiSpec, type Options, type Result, type Scenario } from "./types"

type ScenarioTimeout = `${number} ${Duration.Unit}`

const durationUnits = new Set<string>([
  "nano",
  "nanos",
  "micro",
  "micros",
  "milli",
  "millis",
  "second",
  "seconds",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
])

export function routeKeys(spec: OpenApiSpec) {
  return Object.entries(spec.paths ?? {})
    .flatMap(([path, item]) =>
      OpenApiMethods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

export function routeKey(scenario: Scenario) {
  return `${scenario.method} ${scenario.path}`
}

export function coverageResult(scenario: Scenario): Result {
  if (scenario.kind === "todo") return { status: "skip", scenario }
  return { status: "pass", scenario }
}

export function parseOptions(args: string[]): Options {
  const mode = option(args, "--mode") ?? "effect"
  if (mode !== "effect" && mode !== "coverage" && mode !== "auth") throw new Error(`invalid --mode ${mode}`)
  return {
    mode,
    include: option(args, "--include"),
    startAt: option(args, "--start-at"),
    stopAt: option(args, "--stop-at"),
    failOnMissing: args.includes("--fail-on-missing"),
    failOnSkip: args.includes("--fail-on-skip"),
    scenarioTimeout: parseScenarioTimeout(option(args, "--scenario-timeout") ?? "30 seconds"),
    progress: args.includes("--progress"),
    shard: parseShard(option(args, "--shard")),
    trace: args.includes("--trace"),
  }
}

export function matches(options: Options, scenario: Scenario) {
  if (!options.include) return true
  return (
    scenario.name.includes(options.include) ||
    scenario.path.includes(options.include) ||
    scenario.method.includes(options.include.toUpperCase())
  )
}

export function selectedScenarios(options: Options, scenarios: Scenario[]) {
  const included = scenarios.filter((scenario) => matches(options, scenario))
  const start = options.startAt ? included.findIndex((scenario) => matchesName(options.startAt!, scenario)) : 0
  const end = options.stopAt
    ? included.findIndex((scenario) => matchesName(options.stopAt!, scenario))
    : included.length - 1
  if (start === -1) throw new Error(`--start-at matched no scenario: ${options.startAt}`)
  if (end === -1) throw new Error(`--stop-at matched no scenario: ${options.stopAt}`)
  const ranged = included.slice(start, end + 1)
  if (!options.shard) return ranged
  const { index, total } = options.shard
  return ranged.filter((_, position) => position % total === index)
}

function parseShard(input: string | undefined) {
  if (input === undefined) return undefined
  const match = input.match(/^(\d+)\/(\d+)$/)
  const index = Number(match?.[1]) - 1
  const total = Number(match?.[2])
  if (!match || total < 1 || index < 0 || index >= total) throw new Error(`invalid --shard ${input} (expected i/n)`)
  return { index, total }
}

function matchesName(value: string, scenario: Scenario) {
  return scenario.name.includes(value) || scenario.path.includes(value) || scenario.method.includes(value.toUpperCase())
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseScenarioTimeout(input: string) {
  if (!isScenarioTimeout(input)) throw new Error(`invalid --scenario-timeout ${input}`)
  return Duration.fromInputUnsafe(input)
}

function isScenarioTimeout(input: string): input is ScenarioTimeout {
  const [amount, unit, extra] = input.trim().split(/\s+/)
  return extra === undefined && amount !== undefined && Number.isFinite(Number(amount)) && durationUnits.has(unit ?? "")
}
