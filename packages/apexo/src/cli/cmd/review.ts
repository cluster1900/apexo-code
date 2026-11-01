import type { Argv } from "yargs"
import PROMPT_REVIEW from "../../command/template/review.txt"
import { hasRunGuardrailFlags } from "../run-output-options"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { runHeadless } from "./run"
import { readPipedStdin } from "./run/runtime.stdin"

export interface ReviewPromptInput {
  readonly uncommitted?: boolean
  readonly base?: string
  readonly commit?: string
  readonly pr?: string
  readonly title?: string
  readonly prompt?: string
}

function resolveReviewTarget(input: ReviewPromptInput) {
  if (input.base !== undefined && !input.base.trim()) throw new Error("--base requires a non-empty branch or ref")
  if (input.commit !== undefined && !input.commit.trim())
    throw new Error("--commit requires a non-empty commit SHA or ref")
  if (input.pr !== undefined && !input.pr.trim())
    throw new Error("--pr requires a non-empty pull request number or URL")

  const base = input.base?.trim()
  const commit = input.commit?.trim()
  const pr = input.pr?.trim()
  const prompt = input.prompt?.trim()
  const active = [input.uncommitted, Boolean(base), Boolean(commit), Boolean(pr)].filter(Boolean).length
  if (active > 1) throw new Error("Specify at most one review target among --uncommitted, --base, --commit, and --pr")

  if (base)
    return {
      summary: `Compare current HEAD against base ref ${base}`,
      directive: `Target: Review changes on HEAD relative to base ref ${JSON.stringify(base)}. Determine the merge base via \`git merge-base ${base} HEAD\` and inspect \`git diff ${base}...HEAD\` plus \`git log --oneline ${base}..HEAD\`.`,
    }
  if (commit)
    return {
      summary: `Commit ${commit}`,
      directive: `Target: Review commit ${JSON.stringify(commit)} specifically. Inspect \`git show --stat --patch ${commit}\` and read full modified files for surrounding context.`,
    }
  if (pr)
    return {
      summary: `Pull request ${pr}`,
      directive: `Target: Review pull request ${JSON.stringify(pr)}. Inspect \`gh pr view ${pr}\` and \`gh pr diff ${pr}\`, and read full modified files in the repository where available.`,
    }
  if (input.uncommitted || !prompt)
    return {
      summary: "Uncommitted working tree changes (staged, unstaged, and untracked files)",
      directive:
        "Target: Review all uncommitted changes in the working tree. Run `git status --short`, `git diff`, and `git diff --cached`, and read untracked as well as modified files in full.",
    }
  return {
    summary: prompt,
    directive:
      "Target: Follow the custom review instructions below. If no explicit git revision or file scope is named, default to reviewing uncommitted working tree changes (`git status --short`, `git diff`, `git diff --cached`).",
  }
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const target = resolveReviewTarget(input)
  const title = input.title?.trim()
  const prompt = input.prompt?.trim()
  return [
    PROMPT_REVIEW.replaceAll("$ARGUMENTS", target.summary).trim(),
    "---",
    "## Execution Scope & Guardrails",
    "- Perform a strictly read-only code review. Do NOT modify, create, delete, stage, or commit any files.",
    `- ${target.directive}`,
    ...(title ? [`- Change title / context: ${title}`] : []),
    ...(prompt ? ["", "## Additional Review Instructions", prompt] : []),
  ].join("\n")
}

export const ReviewCommand = cmd({
  command: "review [prompt..]",
  describe: "run a non-interactive code review",
  builder: (yargs: Argv) =>
    yargs
      .positional("prompt", {
        describe: "optional custom review focus or instructions",
        type: "string",
        array: true,
        default: [],
      })
      .option("uncommitted", {
        type: "boolean",
        default: false,
        describe: "review staged, unstaged, and untracked working tree changes",
      })
      .option("base", { type: "string", describe: "review changes against a base branch or git ref" })
      .option("commit", { type: "string", describe: "review the changes introduced by a commit" })
      .option("pr", { type: "string", describe: "review a pull request by number or URL" })
      .option("title", { type: "string", describe: "optional commit or PR title for review context" })
      .option("model", { alias: ["m"], type: "string", describe: "model to use in the format of provider/model" })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("agent", { type: "string", describe: "agent to use" })
      .option("dir", { type: "string", describe: "directory to run in, path on remote server if attaching" })
      .option("attach", { type: "string", describe: "attach to a running apexo server (e.g., http://localhost:4096)" })
      .option("session-protocol", {
        choices: ["auto", "native", "compatibility"] as const,
        default: "auto" as const,
        describe: "Session API transport (native also enables local execution)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to APEXO_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to APEXO_SERVER_USERNAME or 'apexo')",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json", "streaming-json"] as const,
        default: "default" as const,
        describe: "format: default (formatted), json (completed events), or streaming-json (streaming event JSONL)",
      })
      .option("output-schema", {
        type: "string",
        describe: "path to a JSON Schema file constraining the final review output",
      })
      .option("output-last-message", {
        alias: ["o"],
        type: "string",
        describe: "write the final review message to a file",
      })
      .option("ephemeral", {
        type: "boolean",
        default: false,
        describe: "run in a temporary session and delete it on exit without persisting session history",
      })
      .option("max-turns", {
        type: "number",
        describe: "maximum number of agent turns before stopping with exit code 1",
      })
      .option("max-tokens", {
        type: "number",
        describe: "maximum total tokens allowed for the review before stopping with exit code 1",
      })
      .option("max-budget-usd", {
        type: "number",
        describe: "maximum estimated USD spend allowed for the review before stopping with exit code 1",
      })
      .option("fallback-model", {
        type: "string",
        describe:
          "fallback model (provider/model) when the primary model is overloaded or rate-limited before emitting output",
      })
      .option("thinking", { type: "boolean", describe: "show thinking blocks" })
      .option("auto", {
        type: "boolean",
        default: false,
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
      })
      .option("wait-for-background", {
        type: "boolean",
        default: true,
        describe: "wait for background work started during the review",
      })
      .option("background-wait-timeout", {
        type: "number",
        default: 600,
        describe: "seconds to wait for background work after the latest turn ends before stopping it and exiting 1",
      }),
  async handler(args) {
    const positional = [...args.prompt, ...(args["--"] ?? [])].join(" ").trim()
    const piped = await readPipedStdin(true)
    const prompt = [positional, piped?.trim()].filter(Boolean).join("\n") || undefined
    const reviewPrompt = await Promise.try(() =>
      buildReviewPrompt({
        uncommitted: args.uncommitted,
        base: args.base,
        commit: args.commit,
        pr: args.pr,
        title: args.title,
        prompt,
      }),
    ).catch((error) => {
      UI.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })

    await runHeadless({
      ...args,
      _: ["review"],
      "--": [],
      message: [reviewPrompt],
      title:
        args["session-protocol"] === "native" || hasRunGuardrailFlags(args)
          ? undefined
          : args.title?.trim()
            ? `Review: ${args.title.trim()}`
            : undefined,
    })
  },
})
