# BUG-20261015-180: Native local terminal produced no startup output

- **Status:** Investigating; no verified root cause or repair.
- **Scope:** The first provider-only native-local mini acceptance run.
- **Observed:** The terminal readiness assertion exceeded 30 seconds. The captured terminal stream contained zero bytes, and the provider received no requests. The fixture then killed and reaped its owned terminal process and closed its provider.
- **Expected:** Explicit local native interactive startup renders the mini composer before admitting any prompt.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-native-local-terminal.mjs` in the native-local implementation snapshot. The failed run used provider-only setup and never reached the first prompt.
- **Root cause:** Unknown. This is not the compatibility setup-server readiness failure in [BUG163](native-terminal-backend-readiness.md), nor the mixed-server attach observation in BUG166. No evidence establishes host load as the cause.
- **Investigation:** Subsequent mini and fullscreen runs each passed five checks / three provider calls, including native Question interaction, a second prompt, joined shutdown and durable history inspection. The implementation moved native host loading behind validation during this investigation, but there is no evidence that import placement caused the original zero-byte symptom. Passing runs do not establish a fix.
- **Verification boundary:** Later graceful-shutdown checks exercise terminal cleanup explicitly; they do not resolve this original startup observation.
