/**
 * OpenMemory - entities + entity_index 表 CRUD
 * 实体：人名/地名/项目名/工具名等
 */

/**
 * 插入一个实体
 * @param {import('better-sqlite3').Database} db
 * @param {Object} entity - { name, type, sourceChunkId, canonicalId }
 * @returns {Object} 插入的实体
 */
export function insertEntity(db, { name, type, sourceChunkId = null, canonicalId = null }) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO entities (canonical_id, name, type, source_chunk_id)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(canonicalId, name, type, sourceChunkId);

  // 获取插入的实体
  if (canonicalId) {
    return db.prepare('SELECT * FROM entities WHERE canonical_id = ? AND (source_chunk_id = ? OR (? IS NULL AND source_chunk_id IS NULL))')
      .get(canonicalId, sourceChunkId, sourceChunkId);
  }
  return db.prepare('SELECT * FROM entities WHERE name = ? AND type = ? AND (source_chunk_id = ? OR (? IS NULL AND source_chunk_id IS NULL))')
    .get(name, type, sourceChunkId, sourceChunkId);
}

/**
 * 批量插入实体
 */
export function insertEntities(db, entities) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO entities (name, type, source_chunk_id)
    VALUES (?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insert.run(item.name, item.type, item.sourceChunkId || null);
    }
  });

  insertMany(entities);

  // 返回插入的实体
  return entities.map(e => getEntityByName(db, e.name, e.type, e.sourceChunkId)).filter(Boolean);
}

/**
 * 根据 name + type + sourceChunkId 获取实体
 */
export function getEntityByName(db, name, type, sourceChunkId = null) {
  if (sourceChunkId) {
    return db.prepare('SELECT * FROM entities WHERE name = ? AND type = ? AND source_chunk_id = ?')
      .get(name, type, sourceChunkId);
  }
  return db.prepare('SELECT * FROM entities WHERE name = ? AND type = ? AND source_chunk_id IS NULL')
    .get(name, type);
}

/**
 * 根据 id 获取实体
 */
export function getEntityById(db, id) {
  return db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
}

/**
 * 按类型获取实体
 */
export function getEntitiesByType(db, type, { limit = 100 } = {}) {
  return db.prepare('SELECT * FROM entities WHERE type = ? ORDER BY created_at DESC LIMIT ?')
    .all(type, limit);
}

/**
 * 搜索实体（模糊匹配 name）
 */
export function searchEntities(db, query, { limit = 20 } = {}) {
  return db.prepare('SELECT * FROM entities WHERE name LIKE ? ORDER BY created_at DESC LIMIT ?')
    .all(`%${query}%`, limit);
}

/**
 * 为实体添加到索引（关联实体和 chunk）
 */
export function indexEntityForChunk(db, entityId, chunkId) {
  db.prepare(`
    INSERT OR IGNORE INTO entity_index (entity_id, chunk_id)
    VALUES (?, ?)
  `).run(entityId, chunkId);
}

/**
 * 批量为实体添加索引
 */
export function indexEntitiesForChunk(db, entityId, chunkIds) {
  const insert = db.prepare('INSERT OR IGNORE INTO entity_index (entity_id, chunk_id) VALUES (?, ?)');

  const insertMany = db.transaction((ids) => {
    for (const chunkId of ids) {
      insert.run(entityId, chunkId);
    }
  });

  insertMany(chunkIds);
}

/**
 * 获取实体关联的所有 chunk id
 */
export function getChunksForEntity(db, entityId) {
  return db.prepare('SELECT chunk_id FROM entity_index WHERE entity_id = ?')
    .all(entityId)
    .map(r => r.chunk_id);
}

/**
 * 获取 chunk 关联的所有实体
 */
export function getEntitiesForChunk(db, chunkId) {
  return db.prepare(`
    SELECT e.* FROM entities e
    JOIN entity_index ei ON ei.entity_id = e.id
    WHERE ei.chunk_id = ?
  `).all(chunkId);
}

/**
 * 删除实体及其索引
 */
export function deleteEntity(db, entityId) {
  db.prepare('DELETE FROM entity_index WHERE entity_id = ?').run(entityId);
  return db.prepare('DELETE FROM entities WHERE id = ?').run(entityId);
}

/**
 * 删除 chunk 关联的所有实体索引
 */
export function removeEntityIndexForChunk(db, chunkId) {
  return db.prepare('DELETE FROM entity_index WHERE chunk_id = ?').run(chunkId);
}

/**
 * 获取实体统计信息
 */
export function getEntityStats(db) {
  const total = db.prepare('SELECT COUNT(*) as count FROM entities').get();
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM entities GROUP BY type ORDER BY count DESC').all();
  const indexCount = db.prepare('SELECT COUNT(*) as count FROM entity_index').get();

  return {
    total: total.count,
    byType: Object.fromEntries(byType.map(r => [r.type, r.count])),
    indexEntries: indexCount.count,
  };
}

/**
 * 获取最常出现的实体（热门实体）
 */
export function getTopEntities(db, { limit = 20, type = null } = {}) {
  if (type) {
    return db.prepare(`
      SELECT e.*, COUNT(ei.chunk_id) as chunk_count
      FROM entities e
      JOIN entity_index ei ON ei.entity_id = e.id
      WHERE e.type = ?
      GROUP BY e.id
      ORDER BY chunk_count DESC
      LIMIT ?
    `).all(type, limit);
  }

  return db.prepare(`
    SELECT e.*, COUNT(ei.chunk_id) as chunk_count
    FROM entities e
    JOIN entity_index ei ON ei.entity_id = e.id
    GROUP BY e.id
    ORDER BY chunk_count DESC
    LIMIT ?
  `).all(limit);
}
