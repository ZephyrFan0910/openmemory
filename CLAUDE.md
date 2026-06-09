# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                          # install dependencies
node src/cli.js import browser       # import browser history (Chrome/Edge)
node src/cli.js import files ~/docs  # import local .md/.txt files
node src/cli.js search "keyword"     # full-text search
node src/cli.js tree                 # view memory tree
node src/cli.js tree --build         # rebuild tree from scratch
node src/cli.js stats                # database statistics
node src/cli.js serve                # start MCP server (stdio)
node src/cli.js reset -y             # wipe all data
node --test src/**/*.test.js         # run tests (no test files exist yet)
```

## Architecture

Data flow: `Collectors → Ingest → Score → Buffer+Seal → Tree`

**Collectors** (`src/collectors/`) — 5 types (files, browser, wechat, video, session). Each extends `Collector` with `scan()` and `normalize()`. Collectors register via side-effect imports in `cli.js` — add new collectors there.

**Ingest** (`src/memory/ingest.js`) — Chunks text (max 3000 tokens), runs entity extraction + scoring on each chunk, persists keep/borderline chunks, writes vault `.md` files.

**Scoring** (`src/tree/score.js`) — 7-signal weighted system with 3-tier admission gate. `interaction` (weight 3.0) is the strongest signal. Gate: keep (≥0.85), drop (≤0.15), borderline (kept but flagged).

**Buffer+Seal** (`src/tree/buffer.js`, `src/tree/seal.js`, `src/tree/build.js`) — Streaming incremental tree construction. Chunks go into L0 buffer; when `token_sum ≥ 50,000` or `item_ids ≥ 10`, seal creates a summary node and cascades upward. `sealAllPending()` loops until no more seals needed. `MAX_CASCADE_DEPTH = 32`.

**Tree** (`src/tree/`) — Multi-level summary tree. L0 = leaf nodes (chunks), L1+ = summary nodes. Obsidian-compatible `.md` output with YAML frontmatter in `data/vault/`.

**Entity extraction** (`src/extract/composite.js`) — Async chain: regex → keywords → LLM (optional). All entities get `canonical_id` (`kind:surface`). LLM failure silently degrades.

**Embeddings** (`src/embed/`) — Provider detection: Ollama (local) → OpenAI-compatible → null. Graceful degradation when no provider configured. Stored as Float32 BLOB. `cosineSimilarity()` for semantic reranking.

**MCP Server** (`src/server.js`) — 6 tools: search_memory, get_memory_tree, drill_down, add_memory, query_source, search_entities. Uses stdio transport.

## Key Patterns

- **ESM throughout** — `"type": "module"`, all files use `import`/`export`
- **better-sqlite3** — synchronous, WAL mode, single file at `data/memory.db`
- **Chunk ID = content hash** — SHA-256 of `source + sourceId + content`, first 16 hex chars. `INSERT OR IGNORE` for dedup.
- **Token estimation** — rough: CJK chars = 1 token, English words = 1 token. Not a real tokenizer.
- **FTS5 Chinese fallback** — `searchChunks()` detects Chinese via `/[一-鿿]/` and uses `LIKE` instead of FTS5 `MATCH`
- **Schema migration** — `migrateSchema()` in `db.js` runs on every startup; adds columns via `ALTER TABLE` and rebuilds `entity_index` to remove chunk_id foreign key

## Configuration

LLM: `OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`
Embeddings: `OLLAMA_URL`, `OLLAMA_EMBED_MODEL` or `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`
Database: `OPENMEMORY_DB` env var, or default `data/memory.db` relative to cwd

## Gotchas

- `entity_index.chunk_id` references both `chunks.id` and `tree_nodes.id` — foreign key was removed via table rebuild
- Module-level `_db` singleton in `db.js` — shared across all imports, fine for CLI but not multi-process
- `borderline` gate (0.15-0.85) chunks are kept like `keep` — LLM adjudication not yet implemented
- New collectors must be imported in `cli.js` to trigger `registerCollector()`
