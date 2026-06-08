/**
 * OpenMemory - 批量构建树
 * 替代 OpenHuman 的 Buffer + Seal 流式机制
 * 按 (source + 日期) 分组，一次性递归构建整棵树
 */

import { getChunk, getChunksByScoreRange } from '../store/chunks.js';
import { insertTreeNode, linkChildren, generateNodeId } from '../store/trees.js';
import { insertEntity, indexEntityForChunk } from '../store/entities.js';
import { summarise } from './summarise.js';
import { extractEntities } from '../extract/composite.js';
import { writeTreeNodeToVault } from '../store/content.js';
import { DROP_THRESHOLD } from './score.js';

/**
 * 树构建配置
 */
const BUILD_CONFIG = {
  summaryFanout: 10,   // 每层最多子节点数
  maxTreeDepth: 10,     // 最大树深度
};

/**
 * 批量构建记忆树
 * @param {import('better-sqlite3').Database} db
 * @param {Object} options
 * @returns {Promise<Object>} 构建结果
 */
export async function buildTree(db, options = {}) {
  const { treeKind = 'global', minScore = DROP_THRESHOLD } = options;

  // 获取所有达到门槛的 chunks
  const chunks = getChunksByScoreRange(db, minScore);

  if (chunks.length === 0) {
    return { totalChunks: 0, nodesCreated: 0, levels: 0 };
  }

  console.log(`[buildTree] 开始构建，${chunks.length} 个 chunks`);

  // 1. 所有 chunks 作为 Level 0 叶子节点
  const leaves = chunks.map(chunk => ({
    id: generateNodeId(),
    treeKind,
    level: 0,
    chunkId: chunk.id,
    content: null,  // 叶子节点内容在 chunks 表
    score: chunk.score,
    timeFrom: chunk.created_at,
    timeTo: chunk.created_at,
    tokenCount: chunk.token_count,
    // 附加信息用于分组
    _source: chunk.source,
    _sourceId: chunk.source_id,
    _date: chunk.created_at?.slice(0, 10),
    _title: chunk.title,
  }));

  // 批量插入叶子节点
  const insertLeaf = db.prepare(`
    INSERT INTO tree_nodes (id, tree_kind, level, chunk_id, score, time_from, time_to, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLeaves = db.transaction((nodes) => {
    for (const node of nodes) {
      insertLeaf.run(
        node.id, node.treeKind, node.level, node.chunkId,
        node.score, node.timeFrom, node.timeTo, node.tokenCount
      );
    }
  });

  insertLeaves(leaves);
  console.log(`[buildTree] 创建 ${leaves.length} 个叶子节点`);

  // 2. 按 (source + 日期) 分组
  const groups = groupBySourceAndDate(leaves);
  console.log(`[buildTree] 分为 ${Object.keys(groups).length} 组`);

  // 3. 每组生成 Level 1 摘要节点
  let totalNodes = leaves.length;
  const level1Nodes = [];

  for (const [groupKey, groupLeaves] of Object.entries(groups)) {
    const node = await createSummaryNode(db, groupLeaves, treeKind, 1);
    level1Nodes.push(node);
    totalNodes++;

    // 关联子节点
    linkChildren(db, node.id, groupLeaves.map(l => l.id));
  }

  console.log(`[buildTree] 创建 ${level1Nodes.length} 个 Level 1 节点`);

  // 4. Level 1 再分组 → 更高层级
  let currentLevel = 1;
  let currentNodes = level1Nodes;

  while (currentNodes.length > BUILD_CONFIG.summaryFanout && currentLevel < BUILD_CONFIG.maxTreeDepth) {
    currentLevel++;
    const nextGroups = chunkArray(currentNodes, BUILD_CONFIG.summaryFanout);
    const nextNodes = [];

    for (const group of nextGroups) {
      const node = await createSummaryNode(db, group, treeKind, currentLevel);
      nextNodes.push(node);
      totalNodes++;

      linkChildren(db, node.id, group.map(n => n.id));
    }

    console.log(`[buildTree] 创建 ${nextNodes.length} 个 Level ${currentLevel} 节点`);
    currentNodes = nextNodes;
  }

  // 如果只剩一个节点，它就是根
  if (currentNodes.length > 1) {
    // 创建根节点
    const rootNode = await createSummaryNode(db, currentNodes, treeKind, currentLevel + 1);
    totalNodes++;
    linkChildren(db, rootNode.id, currentNodes.map(n => n.id));
    console.log(`[buildTree] 创建根节点 Level ${currentLevel + 1}`);
  }

  return {
    totalChunks: chunks.length,
    nodesCreated: totalNodes,
    levels: currentLevel + 1,
  };
}

/**
 * 创建摘要节点
 */
async function createSummaryNode(db, children, treeKind, level) {
  // 准备子节点信息
  const childInfo = children.map(c => ({
    content: c.content || c._title || '',
    title: c._title || '',
    time_from: c.timeFrom || c.time_from,
    time_to: c.timeTo || c.time_to,
    source: c._source || c.tree_kind,
    score: c.score,
  }));

  // 生成摘要
  const summaryContent = await summarise(childInfo);

  // 抽取实体
  const { entities, topics } = extractEntities(summaryContent);

  // 计算时间和分数
  const timeFrom = children.reduce((min, c) => {
    const t = c.timeFrom || c.time_from;
    return t && t < min ? t : min;
  }, '9999-12-31');

  const timeTo = children.reduce((max, c) => {
    const t = c.timeTo || c.time_to;
    return t && t > max ? t : max;
  }, '0000-01-01');

  const maxScore = Math.max(...children.map(c => c.score || 0));

  // 插入节点
  const node = insertTreeNode(db, {
    treeKind,
    level,
    content: summaryContent,
    score: maxScore,
    timeFrom: timeFrom === '9999-12-31' ? null : timeFrom,
    timeTo: timeTo === '0000-01-01' ? null : timeTo,
    tokenCount: summaryContent.length,  // 粗略估算
  });

  // 索引实体（只对叶子节点索引，摘要节点不需要）
  // entity_index 的外键指向 chunks(id)，不能用 tree_node id
  if (level === 0) {
    for (const entity of entities) {
      const dbEntity = insertEntity(db, {
        name: entity.name,
        type: entity.type,
      });
      if (dbEntity && node.chunkId) {
        indexEntityForChunk(db, dbEntity.id, node.chunkId);
      }
    }
  }

  // 写入 vault
  writeTreeNodeToVault(node);

  return node;
}

/**
 * 按 source + 日期分组
 */
function groupBySourceAndDate(leaves) {
  const groups = {};

  for (const leaf of leaves) {
    const source = leaf._source || 'unknown';
    const date = leaf._date || 'unknown';
    const key = `${source}:${date}`;

    if (!groups[key]) groups[key] = [];
    groups[key].push(leaf);
  }

  return groups;
}

/**
 * 将数组按指定大小分块
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
