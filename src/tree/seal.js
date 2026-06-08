/**
 * OpenMemory - 密封逻辑
 * 移植自 OpenHuman 的 bucket_seal.rs
 *
 * sealBuffer(): 密封一个层级的缓冲区，创建摘要节点，级联到上层
 */

import { getBuffer, clearBuffer, appendToBuffer } from '../store/buffers.js';
import { insertTreeNode, linkChildren, generateNodeId, updateTreeMaxLevel } from '../store/trees.js';
import { getChunk } from '../store/chunks.js';
import { getTreeNode } from '../store/trees.js';
import { summarise } from './summarise.js';
import { extractEntities } from '../extract/composite.js';
import { insertEntity, indexEntityForChunk } from '../store/entities.js';
import { embedText } from '../embed/index.js';
import { writeTreeNodeToVault } from '../store/content.js';
import { shouldSeal, SUMMARY_FANOUT, MAX_CASCADE_DEPTH } from './buffer.js';

/**
 * 密封一个层级的缓冲区
 *
 * 流程：
 * 1. 收集缓冲区中的所有条目
 * 2. 生成摘要
 * 3. 抽取实体
 * 4. 计算嵌入
 * 5. 创建父节点
 * 6. 关联子节点
 * 7. 清空当前缓冲区
 * 8. 将父节点推入上层缓冲区
 * 9. 级联：检查上层是否也需要密封
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} treeId
 * @param {number} level - 要密封的层级
 * @param {string} treeKind - 树类型
 * @returns {Promise<string|null>} 新创建的摘要节点 ID，或 null
 */
export async function sealBuffer(db, treeId, level, treeKind = 'global') {
  const buf = getBuffer(db, treeId, level);
  if (!buf || buf.item_ids.length === 0) return null;

  // 1. 收集条目信息
  const children = [];
  const childNodeIds = []; // 用于 linkChildren 的 tree_node ID

  for (const itemId of buf.item_ids) {
    if (level === 0) {
      // L0: 条目是 chunk ID → 创建叶子节点
      const chunk = getChunk(db, itemId);
      if (chunk) {
        const leafNodeId = generateNodeId();
        insertTreeNode(db, {
          id: leafNodeId,
          treeId,
          treeKind,
          level: 0,
          chunkId: itemId,
          score: chunk.score,
          timeFrom: chunk.created_at,
          timeTo: chunk.created_at,
          tokenCount: chunk.token_count,
        });
        childNodeIds.push(leafNodeId);
        children.push({
          id: leafNodeId,
          content: chunk.content,
          title: chunk.title,
          source: chunk.source,
          score: chunk.score,
          time_from: chunk.created_at,
          time_to: chunk.created_at,
          token_count: chunk.token_count,
        });
      }
    } else {
      // L1+: 条目是 tree_node ID
      const node = getTreeNode(db, itemId);
      if (node) {
        childNodeIds.push(itemId);
        children.push({
          id: itemId,
          content: node.content,
          title: null,
          source: treeKind,
          score: node.score,
          time_from: node.time_from,
          time_to: node.time_to,
          token_count: node.token_count,
        });
      }
    }
  }

  if (children.length === 0) {
    clearBuffer(db, treeId, level);
    return null;
  }

  // 2. 生成摘要
  const summaryContent = await summarise(children);

  // 3. 抽取实体
  const { entities, topics } = await extractEntities(summaryContent, { useLlm: false });

  // 4. 计算嵌入
  const embedding = await embedText(summaryContent);

  // 5. 计算时间和分数
  const timeFrom = children.reduce((min, c) => c.time_from && c.time_from < min ? c.time_from : min, '9999-12-31');
  const timeTo = children.reduce((max, c) => c.time_to && c.time_to > max ? c.time_to : max, '0000-01-01');
  const maxScore = Math.max(...children.map(c => c.score || 0));

  // 6. 创建摘要节点
  const nodeId = generateNodeId();
  insertTreeNode(db, {
    id: nodeId,
    treeId,
    treeKind,
    level: level + 1,
    content: summaryContent,
    score: maxScore,
    timeFrom: timeFrom === '9999-12-31' ? null : timeFrom,
    timeTo: timeTo === '0000-01-01' ? null : timeTo,
    tokenCount: summaryContent.length,
    embedding,
  });

  // 7. 关联子节点
  linkChildren(db, nodeId, childNodeIds);

  // 8. 索引实体
  for (const entity of entities) {
    const dbEntity = insertEntity(db, {
      name: entity.name,
      type: entity.type,
      canonicalId: entity.canonical_id,
    });
    if (dbEntity) {
      indexEntityForChunk(db, dbEntity.id, nodeId);
    }
  }

  // 9. 写入 vault
  writeTreeNodeToVault({ id: nodeId, level: level + 1, content: summaryContent, score: maxScore, timeFrom, timeTo, treeKind });

  // 10. 清空当前缓冲区
  clearBuffer(db, treeId, level);

  // 11. 更新树的最大层级
  updateTreeMaxLevel(db, treeId, level + 1);

  console.log(`[seal] L${level} 密封完成 → L${level + 1} 节点 ${nodeId.slice(0, 8)} (${children.length} 个子节点)`);

  // 12. 级联：将新节点推入上层缓冲区
  const nextLevel = level + 1;
  if (nextLevel < MAX_CASCADE_DEPTH) {
    appendToBuffer(db, treeId, nextLevel, nodeId, summaryContent.length, new Date().toISOString());

    // 检查上层是否需要密封
    const parentBuf = getBuffer(db, treeId, nextLevel);
    if (shouldSeal(parentBuf, nextLevel)) {
      await sealBuffer(db, treeId, nextLevel, treeKind);
    }
  }

  return nodeId;
}

/**
 * 批量密封：处理所有需要密封的缓冲区
 * 用于初始化或重建时
 */
export async function sealAllPending(db, treeId, treeKind = 'global') {
  let sealed = 0;

  for (let level = 0; level < MAX_CASCADE_DEPTH; level++) {
    const buf = getBuffer(db, treeId, level);
    if (!buf || buf.item_ids.length === 0) break;

    if (shouldSeal(buf, level)) {
      await sealBuffer(db, treeId, level, treeKind);
      sealed++;
    } else {
      break; // 如果当前层不需要密封，上层也不会
    }
  }

  return sealed;
}
