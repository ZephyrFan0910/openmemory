/**
 * OpenMemory - SQLite 数据库 Schema
 * 对齐 OpenHuman 记忆树数据模型
 */

export const SCHEMA_SQL = `
-- 数据块：记忆的最小单位
CREATE TABLE IF NOT EXISTS chunks (
    id              TEXT PRIMARY KEY,        -- 内容哈希（去重用）
    source          TEXT NOT NULL,           -- 来源类型: 'wechat' / 'browser' / 'video' / 'session' / 'file'
    source_id       TEXT,                    -- 来源标识：文件路径 / URL / 聊天对象
    title           TEXT,                    -- 标题
    content         TEXT NOT NULL,           -- 原始 Markdown 内容
    token_count     INTEGER,                 -- token 数量
    score           REAL DEFAULT 0.0,        -- 评分 0.0-1.0
    lifecycle       TEXT DEFAULT 'pending',  -- pending → scored → built → sealed → dropped
    interaction_tags TEXT,                   -- 交互标签: sent/reply/dm/mention/priority
    embedding       BLOB,                   -- 向量嵌入 (Float32 little-endian)
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- 全文搜索索引
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    title, content,
    content='chunks',
    content_rowid='rowid'
);

-- 树注册表：记录每棵树的元信息
CREATE TABLE IF NOT EXISTS trees (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,           -- 'source' / 'global' / 'topic'
    scope           TEXT,                    -- 树的作用域，如 'browser' 或 'global'
    root_id         TEXT,                    -- 根节点 ID
    max_level       INTEGER DEFAULT 0,       -- 最高层级
    status          TEXT DEFAULT 'active',   -- 'active' / 'archived'
    last_sealed_at  TEXT,                    -- 最后一次密封时间
    created_at      TEXT DEFAULT (datetime('now'))
);

-- 缓冲区：驱动 seal 级联的核心数据结构
CREATE TABLE IF NOT EXISTS buffers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tree_id         TEXT NOT NULL,            -- 关联 trees.id
    level           INTEGER NOT NULL DEFAULT 0,
    item_ids        TEXT NOT NULL DEFAULT '[]', -- JSON 数组: chunk IDs (L0) 或 summary IDs (L1+)
    token_sum       INTEGER NOT NULL DEFAULT 0,
    oldest_at       TEXT,                     -- buffer 中最早的条目时间
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(tree_id, level)
);

-- 树节点：摘要树的每个节点
CREATE TABLE IF NOT EXISTS tree_nodes (
    id          TEXT PRIMARY KEY,
    tree_id     TEXT,                        -- 关联 trees.id
    tree_kind   TEXT NOT NULL,               -- 'source' / 'global' / 'topic'
    level       INTEGER NOT NULL,            -- 层级：0=叶子, 1+=摘要
    parent_id   TEXT,                        -- 父节点
    chunk_id    TEXT,                        -- 叶子节点关联的 chunk id（level=0 时有值）
    content     TEXT,                        -- 摘要文本（叶子节点为 NULL）
    summary_md  TEXT,                        -- 摘要的 .md 文件路径
    score       REAL,                        -- 该节点的最大分数
    time_from   TEXT,                        -- 子节点的最早时间
    time_to     TEXT,                        -- 子节点的最晚时间
    token_count INTEGER,
    embedding   BLOB,                        -- 向量嵌入 (Float32 little-endian)
    created_at  TEXT DEFAULT (datetime('now'))
);

-- 实体：抽取出来的人名/地名/项目名等
CREATE TABLE IF NOT EXISTS entities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_id TEXT,                        -- 规范化 ID: 'kind:surface' (如 'person:alice')
    name        TEXT NOT NULL,                -- 原始表面形式
    type        TEXT,                         -- 'person' / 'organization' / 'topic' / ...
    source_chunk_id TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(canonical_id, source_chunk_id)
);

-- 实体倒排索引：实体 → 出现在哪些 chunk/tree_node 中
CREATE TABLE IF NOT EXISTS entity_index (
    entity_id   INTEGER NOT NULL,
    chunk_id    TEXT NOT NULL,                -- 可以是 chunk ID 或 tree_node ID
    canonical_id TEXT,                        -- 规范化 ID，用于快速查找
    surface     TEXT,                         -- 原始表面形式
    PRIMARY KEY (entity_id, chunk_id),
    FOREIGN KEY (entity_id) REFERENCES entities(id)
);

-- 评分详情（对应 OpenHuman 的 score rationale）
CREATE TABLE IF NOT EXISTS scores (
    chunk_id        TEXT PRIMARY KEY,
    token_signal    REAL,
    unique_words    REAL,
    metadata_weight REAL,
    source_weight   REAL,
    interaction     REAL,                     -- 交互信号
    entity_density  REAL,
    llm_importance  REAL,                     -- LLM 重要性评分
    total           REAL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- FTS 同步触发器：chunks 插入/更新/删除时同步到 FTS 索引
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
    INSERT INTO chunks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;
`;

/**
 * 初始化数据库 schema（CREATE TABLE IF NOT EXISTS，幂等）
 */
export function initSchema(db) {
  db.exec(SCHEMA_SQL);
}

/**
 * 数据库迁移：为已有数据库添加新列
 * ALTER TABLE ADD COLUMN 在列已存在时会报错，需要 try/catch
 */
export function migrateSchema(db) {
  const addColumn = (table, column, type) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch {
      // 列已存在，忽略
    }
  };

  // chunks 新列
  addColumn('chunks', 'interaction_tags', 'TEXT');
  addColumn('chunks', 'embedding', 'BLOB');

  // tree_nodes 新列
  addColumn('tree_nodes', 'tree_id', 'TEXT');
  addColumn('tree_nodes', 'embedding', 'BLOB');

  // entities 新列
  addColumn('entities', 'canonical_id', 'TEXT');

  // entity_index 新列
  addColumn('entity_index', 'canonical_id', 'TEXT');
  addColumn('entity_index', 'surface', 'TEXT');

  // scores 新列
  addColumn('scores', 'interaction', 'REAL');
  addColumn('scores', 'llm_importance', 'REAL');

  // 重建 entity_index（移除 chunk_id 的外键约束）
  // SQLite 不支持 ALTER TABLE DROP CONSTRAINT，需要重建表
  try {
    const fkList = db.prepare('PRAGMA foreign_key_list(entity_index)').all();
    const hasChunkFk = fkList.some(fk => fk.from === 'chunk_id' && fk.table === 'chunks');
    if (hasChunkFk) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entity_index_new (
          entity_id   INTEGER NOT NULL,
          chunk_id    TEXT NOT NULL,
          canonical_id TEXT,
          surface     TEXT,
          PRIMARY KEY (entity_id, chunk_id),
          FOREIGN KEY (entity_id) REFERENCES entities(id)
        );
        INSERT OR IGNORE INTO entity_index_new (entity_id, chunk_id, canonical_id, surface)
          SELECT entity_id, chunk_id, canonical_id, surface FROM entity_index;
        DROP TABLE entity_index;
        ALTER TABLE entity_index_new RENAME TO entity_index;
      `);
    }
  } catch {
    // 忽略
  }
}
