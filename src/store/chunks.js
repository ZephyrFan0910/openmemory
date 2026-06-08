/**
 * OpenMemory - chunks 表 CRUD
 * 记忆的最小单位，对应 OpenHuman 的 chunks
 */

import crypto from 'crypto';

/**
 * 生成 chunk id（内容哈希，用于去重）
 */
export function generateChunkId(content, source, sourceId) {
  const hash = crypto.createHash('sha256');
  hash.update(`${source}:${sourceId || ''}:${content}`);
  return hash.digest('hex').slice(0, 16);
}

/**
 * 估算 token 数量（简化版：中文按字，英文按空格分词）
 */
export function estimateTokenCount(text) {
  if (!text) return 0;
  // 中文字符数 + 英文单词数（粗略估算）
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const english = text.replace(/[一-鿿]/g, '').split(/\s+/).filter(Boolean).length;
  return cjk + english;
}

/**
 * 插入一个 chunk
 * @param {import('better-sqlite3').Database} db
 * @param {Object} chunk
 * @returns {Object} 插入的 chunk（含 id）
 */
export function insertChunk(db, { source, sourceId, title, content, score = 0.0, lifecycle = 'pending', interactionTags = null, embedding = null }) {
  const id = generateChunkId(content, source, sourceId);
  const tokenCount = estimateTokenCount(content);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO chunks (id, source, source_id, title, content, token_count, score, lifecycle, interaction_tags, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, source, sourceId || null, title || null, content, tokenCount, score, lifecycle, interactionTags, embedding);

  return { id, source, sourceId, title, content, tokenCount, score, lifecycle, interactionTags };
}

/**
 * 批量插入 chunks
 * @param {import('better-sqlite3').Database} db
 * @param {Object[]} chunks
 * @returns {Object[]} 插入的 chunks
 */
export function insertChunks(db, chunks) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO chunks (id, source, source_id, title, content, token_count, score, lifecycle, interaction_tags, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const results = [];

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      const id = generateChunkId(item.content, item.source, item.sourceId);
      const tokenCount = estimateTokenCount(item.content);
      insert.run(id, item.source, item.sourceId || null, item.title || null, item.content, tokenCount, item.score || 0.0, item.lifecycle || 'pending', item.interactionTags || null, item.embedding || null);
      results.push({ id, ...item, tokenCount });
    }
  });

  insertMany(chunks);
  return results;
}

/**
 * 根据 id 获取 chunk
 */
export function getChunk(db, id) {
  return db.prepare('SELECT * FROM chunks WHERE id = ?').get(id);
}

/**
 * 按来源获取 chunks
 */
export function getChunksBySource(db, source, { limit = 100, offset = 0 } = {}) {
  return db.prepare('SELECT * FROM chunks WHERE source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(source, limit, offset);
}

/**
 * 获取所有 chunks
 */
export function getAllChunks(db, { limit = 100, offset = 0 } = {}) {
  return db.prepare('SELECT * FROM chunks ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

/**
 * 更新 chunk 评分
 */
export function updateChunkScore(db, id, score, lifecycle = 'scored') {
  return db.prepare('UPDATE chunks SET score = ?, lifecycle = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(score, lifecycle, id);
}

/**
 * 更新 chunk 生命周期
 */
export function updateChunkLifecycle(db, id, lifecycle) {
  return db.prepare('UPDATE chunks SET lifecycle = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(lifecycle, id);
}

/**
 * 删除 chunk
 */
export function deleteChunk(db, id) {
  return db.prepare('DELETE FROM chunks WHERE id = ?').run(id);
}

/**
 * 全文搜索 chunks
 * FTS5 对中文支持不好，使用双策略：FTS + LIKE 兜底
 */
export function searchChunks(db, query, { limit = 10 } = {}) {
  if (!query) return [];

  // 检测是否包含中文
  const hasChinese = /[一-鿿]/.test(query);

  if (hasChinese) {
    // 中文查询：用 LIKE 搜索（更可靠）
    return db.prepare(`
      SELECT *, 0 as rank
      FROM chunks
      WHERE content LIKE ? OR title LIKE ?
      ORDER BY score DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit);
  }

  // 英文查询：用 FTS5
  try {
    return db.prepare(`
      SELECT c.*, rank
      FROM chunks_fts fts
      JOIN chunks c ON c.rowid = fts.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);
  } catch {
    // FTS 失败时降级到 LIKE
    return db.prepare(`
      SELECT *, 0 as rank
      FROM chunks
      WHERE content LIKE ? OR title LIKE ?
      ORDER BY score DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit);
  }
}

/**
 * 获取 chunks 统计信息
 */
export function getChunkStats(db) {
  const total = db.prepare('SELECT COUNT(*) as count FROM chunks').get();
  const bySource = db.prepare('SELECT source, COUNT(*) as count FROM chunks GROUP BY source').all();
  const byLifecycle = db.prepare('SELECT lifecycle, COUNT(*) as count FROM chunks GROUP BY lifecycle').all();
  const avgScore = db.prepare('SELECT AVG(score) as avg_score FROM chunks').get();

  return {
    total: total.count,
    bySource: Object.fromEntries(bySource.map(r => [r.source, r.count])),
    byLifecycle: Object.fromEntries(byLifecycle.map(r => [r.lifecycle, r.count])),
    avgScore: avgScore.avg_score || 0,
  };
}

/**
 * 获取指定分数范围的 chunks
 */
export function getChunksByScoreRange(db, minScore, maxScore = 1.0) {
  return db.prepare('SELECT * FROM chunks WHERE score >= ? AND score <= ? ORDER BY score DESC')
    .all(minScore, maxScore);
}
