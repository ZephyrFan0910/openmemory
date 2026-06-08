/**
 * OpenMemory - SQLite 数据库 Schema
 * 对应 PRD 第四章数据模型
 */

export const SCHEMA_SQL = `
-- 数据块：记忆的最小单位
CREATE TABLE IF NOT EXISTS chunks (
    id          TEXT PRIMARY KEY,        -- 内容哈希（去重用）
    source      TEXT NOT NULL,           -- 来源类型: 'wechat' / 'browser' / 'video' / 'session' / 'file'
    source_id   TEXT,                    -- 来源标识：文件路径 / URL / 聊天对象
    title       TEXT,                    -- 标题
    content     TEXT NOT NULL,           -- 原始 Markdown 内容
    token_count INTEGER,                 -- token 数量
    score       REAL DEFAULT 0.0,        -- 评分 0.0-1.0
    lifecycle   TEXT DEFAULT 'pending',  -- pending → scored → built → sealed → dropped
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- 全文搜索索引
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    title, content,
    content='chunks',
    content_rowid='rowid'
);

-- 树节点：摘要树的每个节点
CREATE TABLE IF NOT EXISTS tree_nodes (
    id          TEXT PRIMARY KEY,
    tree_kind   TEXT NOT NULL,           -- 'source' / 'global' / 'topic'
    level       INTEGER NOT NULL,        -- 层级：0=叶子, 1+=摘要
    parent_id   TEXT,                    -- 父节点
    chunk_id    TEXT,                    -- 叶子节点关联的 chunk id（level=0 时有值）
    content     TEXT,                    -- 摘要文本（叶子节点为 NULL）
    summary_md  TEXT,                    -- 摘要的 .md 文件路径
    score       REAL,                    -- 该节点的最大分数
    time_from   TEXT,                    -- 子节点的最早时间
    time_to     TEXT,                    -- 子节点的最晚时间
    token_count INTEGER,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- 实体：抽取出来的人名/地名/项目名等
CREATE TABLE IF NOT EXISTS entities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    type        TEXT,                    -- 'person' / 'place' / 'project' / 'tool' / 'topic' / ...
    source_chunk_id TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(name, type, source_chunk_id)
);

-- 实体倒排索引：实体 → 出现在哪些 chunk 中
CREATE TABLE IF NOT EXISTS entity_index (
    entity_id   INTEGER NOT NULL,
    chunk_id    TEXT NOT NULL,
    PRIMARY KEY (entity_id, chunk_id),
    FOREIGN KEY (entity_id) REFERENCES entities(id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- 评分详情（对应 OpenHuman 的 score rationale）
CREATE TABLE IF NOT EXISTS scores (
    chunk_id        TEXT PRIMARY KEY,
    token_signal    REAL,
    unique_words    REAL,
    metadata_weight REAL,
    source_weight   REAL,
    entity_density  REAL,
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
 * 初始化数据库 schema
 * @param {import('better-sqlite3').Database} db
 */
export function initSchema(db) {
  db.exec(SCHEMA_SQL);
}
