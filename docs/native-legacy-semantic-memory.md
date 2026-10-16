# Native legacy semantic retrieval and flush deduplication

Updated 2026-10-16. This document defines Apexo's native and compatibility implementation contract for optional legacy semantic Memory retrieval and semantic flush deduplication (`R03` / `G05`). Fixed reference commit: `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`.

## Scope and backend boundary

Semantic vector retrieval and semantic flush deduplication apply exclusively to the **legacy** Memory backend (`memory.enabled = true`, `memory_v2.enabled = false`). Memory V2 uses curated topic files, immutable inbox observations, and bounded manifests without a vector index.

When `memory.embedding.model` is unset or empty, legacy search and flush remain lexical-only (`mode: "fts"`).

## Configuration

- `ConfigMemory.Embedding`:
  - `provider`: `"api" | "local" | "auto"` (default `"api"`). Only `"api"` is supported; `"local"` and `"auto"` are rejected with reason `"unsupported_provider"` rather than implying a local embedding runtime.
  - `model`: optional `"provider/model"` or unqualified `"model"` string.
  - `dimensions`: positive integer up to `4096` (default `1024`).
- `ConfigMemory.Search`:
  - `vector_weight`: finite `[0, 1]` weight (default `0.7`).
  - `text_weight`: finite `[0, 1]` weight (default `0.3`).
- `ConfigMemory.Flush`:
  - `semantic_dedup_threshold`: finite `[0, 1]` similarity threshold (default `0.92`).

## Provider resolution and endpoint isolation

`MemoryEmbedding.Service` is Location-scoped and resolves embedding providers through `Catalog.Service` and `Integration.Service`:

1. Explicit `"provider/model"` references resolve against that provider's configured catalog entry and active integration connection or API key.
2. Unqualified `"model"` references fall back to the captured Session provider (or default catalog provider) only when that model does not belong exclusively to a different configured provider.
3. Endpoint URLs must use HTTPS or loopback HTTP (`127.0.0.1`, `localhost`, `[::1]`) and must not embed URL credentials. A catalog model cannot override the provider's endpoint origin (`invalid_endpoint`), preventing Session or provider credentials from crossing to an unrelated endpoint.
4. Requests batch up to `32` inputs per `POST /embeddings` call, bound request bodies to `512 KiB` and response bodies to `8 MiB`, retry transient HTTP/transport failures up to `3` attempts, and require one finite exact-dimensional vector per input index. Malformed, partial, out-of-bounds, or duplicate-index responses fail with `malformed_response` and are never cached.

## Generation-fenced vector cache and hybrid search

1. Cached vectors are stored in `memory_vectors` inside the generation-specific legacy `search.sqlite` (`search-${generation}.sqlite`), keyed by `(path, start_line)` with `content_hash`, `embedding_identity`, `dimensions`, and JSON `vector`.
2. SQL transactions in `MemorySearch.refresh` replace or delete `memory_chunks` and invalid `memory_vectors` rows atomically while preserving valid vectors for unchanged chunks and preserving `memory_ranking` metadata across model/dimension/endpoint changes.
3. Sync-on-search embedding revalidates scope maintenance generations, file signatures, and Session/source read authority before and after network awaits. If authority, Agent, mode, or maintenance generation changes during an embedding call, no vectors are committed and no unauthorized results are returned.
4. Vector similarity uses `clamp(1 - L2 / 2, 0, 1)`. Hybrid ranking merges BM25 and paged KNN candidates by chunk identity `(path, start_line)`:
   - Shared lexical + vector hit: `Math.max(ftsScore, textWeight * ftsScore + vectorWeight * vecSim)`
   - Lexical-only hit: `ftsScore`
   - Vector-only hit: `vectorWeight * vecSim`
   Existing temporal decay, source weights, access-count boost, `min_score` filtering, and token-overlap MMR apply unchanged after relevance merging.
5. `MemorySearch.search` and the `memory_search` tool expose truthful `mode: "fts" | "hybrid"` and optional `fallback` reason (`unsupported_provider`, `invalid_model`, `unavailable_provider`, `unauthorized`, `invalid_endpoint`, `transport`, `malformed_response`).

## Semantic flush deduplication and durable recovery

1. After validating flush Markdown output (`parsed.status === "accepted"`) and before acquiring publication locks, `MemoryLegacyNative.execute` (and compatibility `SessionMemoryFlush`) runs `MemorySearch.semanticDuplicate` when embedding is configured.
2. `semanticDuplicate` inspects the top-3 vector neighbors. A flush candidate is treated as a duplicate only when `best.similarity > semantic_dedup_threshold` (strictly greater than `0.92` by default). Embedding unavailability or failure falls back to the normal validated Markdown write, never false suppression.
3. A positive duplicate match records a content-free `DuplicateProof` (`embeddingIdentity`, `threshold`, `similarity`, `neighborPath`, `neighborStartLine`, `neighborFileHash`, `neighborChunkHash`, `candidateHash`) inside the durable `MemoryLegacyNative.Publication` receipt (`legacyFlush` on `SessionMemoryOperation`).
4. At final fenced commit, `MemoryLegacyNative.execute` re-verifies read permission on `neighborPath` and confirms the on-disk neighbor file hash and chunk hash still match `DuplicateProof`. It then publishes `<!-- apexo-native-flush:...:duplicate -->` without writing the duplicate Markdown body and settles the operation with `{ status: "no_work", processed: 0, committed: true }`.
5. Explicit retry after a crash following durable `legacyFlush` persistence replays the recorded `Publication` directly without issuing another language-model or embedding request.
