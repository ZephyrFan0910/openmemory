/**
 * OpenMemory - 流式树构建（Buffer + Seal 机制）
 * 移植自 OpenHuman 的 bucket_seal.rs
 *
 * 替代原来的批量构建，支持增量式流式密封
 */

import { getChunksByScoreRange, getChunk } from '../store/chunks.js';
import { ensureTree, getTreeById, updateTreeLastSealedAt } from '../store/trees.js';
import { appendToBuffer, getBuffer, clearBuffer, getStaleBuffers, deleteBuffersForTree } from '../store/buffers.js';
import { shouldSeal, getDefaultTreeId, FLUSH_AGE_DAYS } from './buffer.js';
import { sealBuffer, sealAllPending } from './seal.js';
import { DROP_THRESHOLD } from './score.js';

/**
 * 将一个 chunk 推入树的缓冲区
 * 如果缓冲区达到密封阈值，自动触发密封级联
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} chunkId - chunk ID
 * @param {Object} options
 * @returns {Promise<string|null>} 如果触发了密封，返回新摘要节点 ID
 */
export async function ingestIntoTree(db, chunkId, options = {}) {
  const { treeKind = 'global' } = options;

  // 确保树存在
  const treeId = getDefaultTreeId(treeKind);
  ensureTree(db, treeKind);

  // 获取 chunk 信息
  const chunk = getChunk(db, chunkId);
  if (!chunk) return null;

  // 推入 L0 缓冲区
  const buf = appendToBuffer(db, treeId, 0, chunkId, chunk.token_count || 0, chunk.created_at);

  // 检查是否需要密封
  if (shouldSeal(buf, 0)) {
    const nodeId = await sealBuffer(db, treeId, 0, treeKind);
    updateTreeLastSealedAt(db, treeId);
    return nodeId;
  }

  return null;
}

/**
 * 批量构建树（兼容旧接口）
 * 获取所有已评分的 chunks，逐个推入缓冲区
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} options
 * @returns {Promise<Object>} 构建结果
 */
export async function buildTree(db, options = {}) {
  const { treeKind = 'global', minScore = DROP_THRESHOLD, forceRebuild = false } = options;

  const treeId = getDefaultTreeId(treeKind);

  // 如果需要重建，清空旧数据
  if (forceRebuild) {
    db.prepare('DELETE FROM tree_nodes').run();
    deleteBuffersForTree(db, treeId);
    // 重置 chunks lifecycle，让它们可以被重新处理
    db.prepare("UPDATE chunks SET lifecycle = 'scored' WHERE lifecycle IN ('built','sealed')").run();
  }

  // 确保树存在
  ensureTree(db, treeKind);

  // 获取所有达到门槛的 chunks
  const chunks = getChunksByScoreRange(db, minScore);
  if (chunks.length === 0) {
    return { totalChunks: 0, nodesCreated: 0, levels: 0 };
  }

  console.log(`[buildTree] 开始构建，${chunks.length} 个 chunks`);

  let sealedCount = 0;

  // 逐个推入缓冲区
  for (const chunk of chunks) {
    const buf = appendToBuffer(db, treeId, 0, chunk.id, chunk.token_count || 0, chunk.created_at);

    if (shouldSeal(buf, 0)) {
      await sealBuffer(db, treeId, 0, treeKind);
      sealedCount++;
    }
  }

  // 处理剩余的缓冲区（如果还有未密封的）
  const remainingBuf = getBuffer(db, treeId, 0);
  if (remainingBuf && remainingBuf.item_ids.length > 0) {
    // 如果有剩余，也密封
    await sealBuffer(db, treeId, 0, treeKind);
    sealedCount++;
  }

  // 处理所有层级的剩余缓冲区
  await sealAllPending(db, treeId, treeKind);

  updateTreeLastSealedAt(db, treeId);

  // 统计结果
  const { getTreeStats } = await import('../store/trees.js');
  const stats = getTreeStats(db);

  console.log(`[buildTree] 构建完成，${sealedCount} 次密封，${stats.total} 个节点`);

  return {
    totalChunks: chunks.length,
    nodesCreated: stats.total,
    levels: Object.keys(stats.byLevel).length,
    sealedCount,
  };
}

/**
 * 时间冲洗：强制密封过期的 L0 缓冲区
 * 用于处理低流量源（7 天未满的缓冲区也要密封）
 */
export async function flushStaleBuffers(db, maxAgeDays = FLUSH_AGE_DAYS) {
  const stale = getStaleBuffers(db, maxAgeDays);

  for (const buf of stale) {
    console.log(`[flush] 冲洗过期缓冲区: ${buf.tree_id} L${buf.level} (${buf.item_ids.length} 条, 最老: ${buf.oldest_at})`);
    await sealBuffer(db, buf.tree_id, buf.level, 'global');
  }

  return stale.length;
}
