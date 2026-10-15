export * as ConfigToolset from "./toolset"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export const Bash = Schema.Struct({
  cmd_prefix: Schema.optional(Schema.String).annotate({
    description:
      "Shell setup command chained before the requested command. The complete command is subject to permission and sandbox checks.",
  }),
  output_byte_limit: Schema.optional(
    NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  ).annotate({
    description:
      "Maximum Shell output Unicode code points retained in the model preview, despite the historical byte name. Zero hides command output. Full captured output is retained; global output limits still apply.",
  }),
  default_block_until_ms: Schema.optional(NonNegativeInt).annotate({
    description:
      "Grok Shell foreground wait when block_until_ms is omitted. Defaults to 30000ms, capped by the effective maximum; 0 starts in the background immediately.",
  }),
  max_block_until_ms: Schema.optional(NonNegativeInt).annotate({
    description:
      "Grok Shell foreground wait ceiling in milliseconds. Omitted or 0 adds no limit beyond max_timeout_secs and the 10-hour absolute ceiling. Reaching the wait limit backgrounds the command; it does not kill it.",
  }),
  max_timeout_secs: Schema.optional(Schema.Finite).annotate({
    description:
      "Additional Grok Shell foreground wait ceiling in seconds. Positive values round to milliseconds with a 1ms minimum and 10-hour maximum; non-positive or omitted values add no limit. Does not shorten background execution.",
  }),
})

export type Bash = Schema.Schema.Type<typeof Bash>

export const Info = Schema.Struct({
  bash: Schema.optional(Bash),
})
