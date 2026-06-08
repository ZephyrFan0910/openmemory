/**
 * OpenMemory - buffers 表 CRUD
 * 缓冲区是 seal 级联的核心数据结构
 */

/**
 * 获取指定树和层级的缓冲区
 * @param {import('better-sqlite3').Database} db
 * @param {string} treeId
 * @param {number} level
 * @returns {Object|null} { tree_id, level, item_ids: string[], token_sum, oldest_at }
 */
export function getBuffer(db, treeId, level) {
  const row = db.prepare('SELECT * FROM buffers WHERE tree_id = ? AND level = ?')
    .get(treeId, level);

  if (!row) return null;

  return {
    ...row,
    item_ids: JSON.parse(row.item_ids || '[]'),
  };
}

/**
 * 创建或获取缓冲区
 */
export function ensureBuffer(db, treeId, level) {
  const existing = getBuffer(db, treeId, level);
  if (existing) return existing;

  db.prepare(`
    INSERT OR IGNORE INTO buffers (tree_id, level, item_ids, token_sum)
    VALUES (?, ?, '[]', 0)
  `).run(treeId, level);

  return getBuffer(db, treeId, level);
}

/**
 * 向缓冲区追加一个条目
 * @param {import('better-sqlite3').Database} db
 * @param {string} treeId
 * @param {number} level
 * @param {string} itemId - chunk ID (L0) 或 summary ID (L1+)
 * @param {number} tokenCount - 该条目的 token 数
 * @param {string} createdAt - 条目创建时间
 * @returns {Object} 更新后的缓冲区
 */
export function appendToBuffer(db, treeId, level, itemId, tokenCount, createdAt) {
  ensureBuffer(db, treeId, level);

  // 获取当前状态
  const buf = getBuffer(db, treeId, level);
  const itemIds = buf.item_ids;

  // 幂等：如果已存在则跳过
  if (itemIds.includes(itemId)) return buf;

  // 追加
  itemIds.push(itemId);
  const newTokenSum = buf.token_sum + (tokenCount || 0);

  // 更新 oldest_at
  let oldestAt = buf.oldest_at;
  if (createdAt && (!oldestAt || createdAt < oldestAt)) {
    oldestAt = createdAt;
  }

  db.prepare(`
    UPDATE buffers SET item_ids = ?, token_sum = ?, oldest_at = ?
    WHERE tree_id = ? AND level = ?
  `).run(JSON.stringify(itemIds), newTokenSum, oldestAt, treeId, level);

  return { ...buf, item_ids: itemIds, token_sum: newTokenSum, oldest_at: oldestAt };
}

/**
 * 清空缓冲区
 */
export function clearBuffer(db, treeId, level) {
  db.prepare(`
    UPDATE buffers SET item_ids = '[]', token_sum = 0, oldest_at = NULL
    WHERE tree_id = ? AND level = ?
  `).run(treeId, level);
}

/**
 * 获取所有过期的 L0 缓冲区（用于时间冲洗）
 * @param {import('better-sqlite3').Database} db
 * @param {number} maxAgeDays - 最大天数
 * @returns {Object[]} 过期的缓冲区列表
 */
export function getStaleBuffers(db, maxAgeDays = 7) {
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM buffers
    WHERE level = 0 AND oldest_at IS NOT NULL AND oldest_at < ?
    AND item_ids != '[]'
  `).all(cutoff);

  return rows.map(row => ({
    ...row,
    item_ids: JSON.parse(row.item_ids || '[]'),
  }));
}

/**
 * 删除树的所有缓冲区
 */
export function deleteBuffersForTree(db, treeId) {
  db.prepare('DELETE FROM buffers WHERE tree_id = ?').run(treeId);
}
