export * as ConfigMemory from "./memory"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"

export const Rollout = Schema.Literals(["off", "record_only", "shadow", "active"])
export type Rollout = typeof Rollout.Type

export const V2 = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Use Memory V2 for new Grok Build sessions (default: false). Existing sessions retain their backend.",
  }),
  rollout: Schema.optional(Rollout).annotate({
    description: "Memory V2 rollout, pinned per session. Current configuration can restrict it (default: active).",
  }),
  capture_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Allow background observation extraction from completed user turns (default: true).",
  }),
  capture_status_enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "Show transient Memory V2 capture diagnostics, including generated observations and paths (default: false). Not saved in session replay.",
  }),
  compact_index_enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "Use a compact Memory V2 index ranked by model topic reads, without observation bodies (default: false).",
  }),
  capture_model: Schema.optional(Schema.String).annotate({
    description: "Optional provider/model for V2 observation extraction; defaults to the captured session model.",
  }),
  automatic_dream_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Allow automatic Memory V2 consolidation in active/shadow rollout (default: true).",
  }),
  manual_dream_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Allow manual Memory V2 consolidation in active/shadow rollout (default: true).",
  }),
  batch_dream_enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Use bounded multi-call V2 batch consolidation in active rollout (default: false).",
  }),
  batch_dream_max_run_secs: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(1800))).annotate({
    description: "Maximum seconds per batch Dream run (default: 1800).",
  }),
  batch_dream_max_calls_per_batch: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(32))).annotate({
    description: "Maximum model replies per batch (default: 6).",
  }),
  batch_dream_max_batch_note_bytes: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(262144))).annotate({
    description: "Maximum note bytes per batch; one whole note is always allowed (default: 98304).",
  }),
  dream_model: Schema.optional(Schema.String).annotate({
    description: "Optional provider/model for V2 consolidation; defaults to the session model.",
  }),
  archived_retention_days: Schema.optional(NonNegativeInt).annotate({
    description:
      "Retain archived Memory V2 observations for this many days (default: 30; 0 allows immediate collection).",
  }),
  job_retention_days: Schema.optional(NonNegativeInt).annotate({
    description:
      "Retain terminal Memory V2 capture jobs for this many days (default: 14; 0 allows immediate collection).",
  }),
  maintenance_interval_secs: Schema.optional(NonNegativeInt).annotate({
    description: "Memory V2 retention check interval (default: 3600 seconds; 0 disables periodic checks only).",
  }),
  file_writes_enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "Allow Memory V2 storage. False disables all V2 memory paths, including session toggles (default: true).",
  }),
})

export const Flush = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable automatic memory flush (default: true)" }),
  soft_threshold_tokens: Schema.optional(NonNegativeInt).annotate({
    description: "Token headroom before compaction for memory flush (default: 4000)",
  }),
  max_flush_write_chars: Schema.optional(PositiveInt).annotate({
    description: "Maximum Unicode characters saved by one flush (default: 8000)",
  }),
  flush_model: Schema.optional(Schema.String).annotate({
    description: "Optional provider/model for memory summaries; defaults to the session model",
  }),
  idle_timeout_secs: Schema.optional(NonNegativeInt).annotate({
    description: "Idle seconds before memory flush; 0 disables idle flush (default: 300)",
  }),
})

export const Search = Schema.Struct({
  max_results: Schema.optional(NonNegativeInt),
  min_score: Schema.optional(Schema.Finite),
  recency_decay: Schema.optional(Schema.Finite),
  temporal_decay: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      half_life_days: Schema.optional(Schema.Finite),
    }),
  ),
  mmr: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      lambda: Schema.optional(Schema.Finite),
    }),
  ),
  source_weights: Schema.optional(
    Schema.Struct({
      global: Schema.optional(Schema.Finite),
      workspace: Schema.optional(Schema.Finite),
      session: Schema.optional(Schema.Finite),
    }),
  ),
})
export type Search = typeof Search.Type

export const Info = Schema.Struct({
  search: Schema.optional(Search),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable cross-session memory in the Grok Build profile (default: false). A session can override this unless the process force-disables memory.",
  }),
  initial_injection: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description:
          "Search and inject relevant memory on the first session turn (default: true). Post-compaction recovery remains enabled.",
      }),
      min_score: Schema.optional(Schema.Finite).annotate({
        description: "Minimum relevance score for first-turn memory injection (default: 0.9)",
      }),
    }),
  ),
  dream: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Automatically consolidate session memories (default: true)",
      }),
      min_hours: Schema.optional(NonNegativeInt).annotate({
        description: "Minimum hours between automatic consolidations (default: 24)",
      }),
      min_sessions: Schema.optional(NonNegativeInt).annotate({
        description: "Minimum distinct sessions before automatic consolidation (default: 5)",
      }),
      stale_lock_secs: Schema.optional(NonNegativeInt).annotate({
        description: "Dream lease expiry; floored above the 30 minute model deadline (default: 3600)",
      }),
      check_interval_secs: Schema.optional(NonNegativeInt).annotate({
        description: "Periodic dream check interval; 0 disables periodic checks (default: 3600)",
      }),
    }),
  ),
  session: Schema.optional(
    Schema.Struct({
      save_on_end: Schema.optional(Schema.Boolean).annotate({
        description:
          "Save a metadata checkpoint when session activity ends, including interrupted runs (default: true). No additional model request is made.",
      }),
    }),
  ),
})
