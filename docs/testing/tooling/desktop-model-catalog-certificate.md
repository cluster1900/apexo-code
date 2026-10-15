# INVESTIGATION-20261014-004: Certificate Verification Error Downloading Model Catalog During Desktop Build

- **Status**: Investigating (environment issue); snapshot build succeeded without disabling TLS verification.
- **Scope**: Bun 1.3.14 during Desktop `prebuild` (`packages/apexo/script/generate.ts` fetching `https://models.dev/api.json`).
- **Observed**: `bun run build` in `packages/desktop` failed with `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` before Electron compilation started.
- **Expected**: Fetch and parse the model catalog after standard TLS verification.
- **Root Cause**: Unconfirmed (potential transient certificate chain, system trust store, or proxy issue under Bun's fetch client).
- **Mitigation & Verification**: Fetched `https://models.dev/api.json` with `curl --fail --location --silent --show-error` (which passed standard TLS verification) and passed the snapshot file via `MODELS_DEV_API_JSON` to `bun run build`, which exited 0.
