import { loopPrompt } from "@apexo/sdk/v2/command-prompt"
import type { ApexoClient, SessionScheduleRestoration } from "@apexo/sdk/v2"
import { nativeSessionView } from "./native-session-view"

type Native = ApexoClient["v2"]["session"]

// The SDK remains available separately for manager panels. This facade never
// falls back to a compatibility request after native protocol selection.
export function nativeSessionTransport(client: ApexoClient, directory?: string, owner?: AbortSignal) {
  return {
    kind: "native" as const,
    async catalog(signal?: AbortSignal) {
      const options = requestOptions(signal, owner)
      const location = { location: { directory } }
      const [agents, models, providers, project, commands] = await Promise.all([
        client.v2.agent.list(location, options),
        client.v2.model.list(location, options),
        client.v2.provider.list(location, options),
        client.v2.project.current(location, options),
        client.v2.command.list(location, options),
      ])
      return {
        commands: commands.data.data.filter((command) => command.name === "loop"),
        agents: agents.data.data,
        models: models.data.data,
        providers: providers.data.data,
        project: project.data,
        location: agents.data.location,
      }
    },
    async list(input?: Parameters<Native["list"]>[0], signal?: AbortSignal) {
      return (await client.v2.session.list({ directory, order: "desc", ...input }, requestOptions(signal, owner))).data
    },
    async get(sessionID: string, signal?: AbortSignal) {
      return (await client.v2.session.get({ sessionID }, requestOptions(signal, owner))).data.data
    },
    async restore(sessionID: string, signal?: AbortSignal) {
      return (await client.v2.session.restore({ sessionID }, requestOptions(signal, owner))).data
    },
    async create(input?: Parameters<Native["create"]>[0], signal?: AbortSignal) {
      const location = input?.location ?? (directory === undefined ? undefined : { directory })
      if (!location) throw new Error("A directory is required to create a native terminal Session")
      return (await client.v2.session.create({ ...input, location }, requestOptions(signal, owner))).data.data
    },
    async switchAgent(input: Parameters<Native["switchAgent"]>[0], signal?: AbortSignal) {
      return client.v2.session.switchAgent(input, requestOptions(signal, owner))
    },
    async switchModel(input: Parameters<Native["switchModel"]>[0], signal?: AbortSignal) {
      return client.v2.session.switchModel(input, requestOptions(signal, owner))
    },
    async admit(input: Parameters<Native["prompt"]>[0], signal?: AbortSignal) {
      const match = /^\/loop(?:[ \t]+|\r?\n|$)([\s\S]*)/u.exec(input.prompt?.text ?? "")
      const prompt = match
        ? {
            ...input.prompt,
            text: await loopPrompt(client, {
              arguments: match[1],
              directory,
              signal: requestOptions(signal, owner).signal,
            }),
          }
        : input.prompt
      return (await client.v2.session.prompt({ ...input, prompt }, requestOptions(signal, owner))).data.data
    },
    async active(signal?: AbortSignal) {
      return (await client.v2.session.active(requestOptions(signal, owner))).data.data
    },
    async interrupt(sessionID: string, signal?: AbortSignal) {
      return client.v2.session.interrupt({ sessionID }, requestOptions(signal, owner))
    },
    async questions(sessionID: string, signal?: AbortSignal) {
      return (await client.v2.session.question.list({ sessionID }, requestOptions(signal, owner))).data.data
    },
    async replyQuestion(input: Parameters<Native["question"]["reply"]>[0], signal?: AbortSignal) {
      return client.v2.session.question.reply(input, requestOptions(signal, owner))
    },
    async rejectQuestion(input: Parameters<Native["question"]["reject"]>[0], signal?: AbortSignal) {
      return client.v2.session.question.reject(input, requestOptions(signal, owner))
    },
    async permissions(sessionID: string, signal?: AbortSignal) {
      return (await client.v2.session.permission.list({ sessionID }, requestOptions(signal, owner))).data.data
    },
    async replyPermission(input: Parameters<Native["permission"]["reply"]>[0], signal?: AbortSignal) {
      return client.v2.session.permission.reply(input, requestOptions(signal, owner))
    },
    subscribe(signal: AbortSignal) {
      return client.v2.event.subscribe({
        signal: owner ? AbortSignal.any([owner, signal]) : signal,
        sseMaxRetryAttempts: 0,
      })
    },
    async history(sessionID: string, signal?: AbortSignal) {
      const view = nativeSessionView(sessionID, directory ?? "")
      while (true) {
        const previous = view.sequence
        const page = (
          await client.v2.session.history({ sessionID, after: previous, limit: 100 }, requestOptions(signal, owner))
        ).data
        page.data.forEach((event) => view.apply(event))
        if (!page.hasMore) return view
        if (view.sequence <= previous) throw new Error("Native Session history did not advance")
      }
    },
  }
}

export type NativeSessionTransport = ReturnType<typeof nativeSessionTransport>

// An omitted per-call signal must not erase the SDK client's owner signal.
function requestOptions(signal?: AbortSignal, owner?: AbortSignal) {
  const combined = owner && signal ? AbortSignal.any([owner, signal]) : (owner ?? signal)
  return { throwOnError: true as const, ...(combined ? { signal: combined } : {}) }
}

// Terminal interfaces retain their existing English presentation convention.
export function restorationNotice(result: SessionScheduleRestoration | undefined) {
  if (!result) return
  for (const outcome of result.schedules) {
    switch (outcome.reason) {
      case "permission_required":
        return "Some schedules need permission. Use Resume schedule to review each request."
      case "unfinished_owner":
        return "Previous occurrence ownership is unconfirmed. Its schedule remains paused."
      case "headless_input":
        return "Headless work is pending or active. Schedules remain paused."
      case "changed":
        return "The session or schedule changed. Review its status before restoring again."
      case "goal_active":
        return "Schedules remain paused while this Session has an active Goal."
      case "plan_pending":
        return "Schedules remain paused while Plan approval is pending."
      case "denied":
        return "The current permission policy denied schedule restoration."
      case "unavailable":
        return "A schedule is unavailable. Review the Session before resuming it."
    }
  }
}
