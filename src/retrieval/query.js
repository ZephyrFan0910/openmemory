/**
 * OpenMemory - 检索查询
 * 移植自 OpenHuman 的 retrieval 模块
 *
 * 提供 querySource, searchEntitiesFuzzy, drillDown, fetchLeaves
 */

import { searchChunks, getChunk } from '../store/chunks.js';
import { getTreeNode, getChildNodes } from '../store/trees.js';
import { getEntitiesForChunk } from '../store/entities.js';
import { rerankByEmbedding } from './rerank.js';

/**
 * 查询响应格式（对齐 OpenHuman）
 */
function queryResponse(hits, limit) {
  const truncated = hits.length > limit;
  return {
    hits: hits.slice(0, limit),
    total: hits.length,
    truncated,
  };
}

/**
 * 按来源查询
 * @param {import('better-sqlite3').Database} db
 * @param {Object} options
 * @returns {Promise<Object>} QueryResponse
 */
export async function querySource(db, { query, sourceKind, timeWindowDays, limit = 10, rerank = false }) {
  let hits = [];

  // 1. FTS 搜索
  if (query) {
    hits = searchChunks(db, query, { limit: limit * 3 });
  } else {
    // 无查询时返回最近的 chunks
    hits = db.prepare('SELECT * FROM chunks ORDER BY created_at DESC LIMIT ?').all(limit * 3);
  }

  // 2. 按来源过滤
  if (sourceKind && sourceKind !== 'all') {
    hits = hits.filter(h => h.source === sourceKind);
  }

  // 3. 按时间窗口过滤
  if (timeWindowDays) {
    const cutoff = new Date(Date.now() - timeWindowDays * 86400000).toISOString();
    hits = hits.filter(h => h.created_at >= cutoff);
  }

  // 4. 语义重排
  if (rerank && query) {
    hits = await rerankByEmbedding(hits, query);
  }

  return queryResponse(hits, limit);
}

/**
 * 模糊搜索实体
 * @param {import('better-sqlite3').Database} db
 * @param {Object} options
 * @returns {Object} 搜索结果
 */
export function searchEntitiesFuzzy(db, { query, kinds, limit = 10 }) {
  let sql = `
    SELECT canonical_id, name, type, COUNT(*) as mention_count, MAX(created_at) as last_seen
    FROM entities
    WHERE (LOWER(canonical_id) LIKE ? OR LOWER(name) LIKE ?)
  `;
  const params = [`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`];

  if (kinds && kinds.length > 0) {
    const placeholders = kinds.map(() => '?').join(',');
    sql += ` AND type IN (${placeholders})`;
    params.push(...kinds);
  }

  sql += ` GROUP BY canonical_id, type ORDER BY mention_count DESC, last_seen DESC LIMIT ?`;
  params.push(limit);

  const results = db.prepare(sql).all(...params);

  return {
    entities: results,
    total: results.length,
  };
}

/**
 * 深入查看节点（BFS 遍历）
 * @param {import('better-sqlite3').Database} db
 * @param {Object} options
 * @returns {Promise<Object>} QueryResponse
 */
export async function drillDown(db, { nodeId, query, maxDepth = 1, limit = 10, rerank = false }) {
  const hits = [];

  // BFS 遍历
  const queue = [{ id: nodeId, depth: 0 }];
  const visited = new Set();

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);

    const node = getTreeNode(db, id);
    if (!node) continue;

    // 获取实体
    const entities = getEntitiesForChunk(db, id);

    hits.push({
      node_id: node.id,
      level: node.level,
      content: node.content || '',
      score: node.score,
      time_from: node.time_from,
      time_to: node.time_to,
      entities: entities.map(e => e.name),
      child_ids: [],
      source_ref: node.chunk_id,
    });

    // 如果未达到最大深度，继续遍历子节点
    if (depth < maxDepth) {
      const children = getChildNodes(db, id);
      for (const child of children) {
        queue.push({ id: child.id, depth: depth + 1 });
        // 记录子节点 ID
        const parentHit = hits.find(h => h.node_id === id);
        if (parentHit) parentHit.child_ids.push(child.id);
      }
    }
  }

  // 语义重排
  let results = hits;
  if (rerank && query) {
    results = await rerankByEmbedding(hits, query);
  }

  return queryResponse(results, limit);
}

/**
 * 批量获取叶子节点内容
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} nodeIds
 * @returns {Object} 结果
 */
export function fetchLeaves(db, { nodeIds, limit = 20 }) {
  const ids = nodeIds.slice(0, limit);
  const results = [];

  for (const id of ids) {
    const node = getTreeNode(db, id);
    if (!node) continue;

    if (node.level === 0 && node.chunk_id) {
      // 叶子节点：返回 chunk 内容
      const chunk = getChunk(db, node.chunk_id);
      if (chunk) {
        results.push({
          node_id: id,
          content: chunk.content,
          title: chunk.title,
          source: chunk.source,
          score: chunk.score,
          created_at: chunk.created_at,
        });
      }
    } else {
      // 摘要节点：返回摘要内容
      results.push({
        node_id: id,
        content: node.content,
        level: node.level,
        score: node.score,
        time_from: node.time_from,
        time_to: node.time_to,
      });
    }
  }

  return {
    hits: results,
    total: results.length,
    truncated: nodeIds.length > limit,
  };
}
