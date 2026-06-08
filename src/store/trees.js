/**
 * OpenMemory - tree_nodes 表 CRUD
 * 摘要树的节点，对应 OpenHuman 的 tree nodes
 */

import crypto from 'crypto';

/**
 * 生成节点 id
 */
export function generateNodeId() {
  return 'n_' + crypto.randomBytes(8).toString('hex');
}

/**
 * 插入一个树节点
 */
export function insertTreeNode(db, {
  id,
  treeKind,
  level,
  parentId = null,
  chunkId = null,
  content = null,
  summaryMd = null,
  score = 0.0,
  timeFrom = null,
  timeTo = null,
  tokenCount = 0,
}) {
  const nodeId = id || generateNodeId();

  db.prepare(`
    INSERT OR IGNORE INTO tree_nodes (id, tree_kind, level, parent_id, chunk_id, content, summary_md, score, time_from, time_to, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nodeId, treeKind, level, parentId, chunkId, content, summaryMd, score, timeFrom, timeTo, tokenCount);

  return { id: nodeId, treeKind, level, parentId, chunkId, content, summaryMd, score, timeFrom, timeTo, tokenCount };
}

/**
 * 批量插入树节点
 */
export function insertTreeNodes(db, nodes) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tree_nodes (id, tree_kind, level, parent_id, chunk_id, content, summary_md, score, time_from, time_to, token_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      const nodeId = item.id || generateNodeId();
      insert.run(
        nodeId, item.treeKind, item.level, item.parentId || null,
        item.chunkId || null, item.content || null, item.summaryMd || null,
        item.score || 0.0, item.timeFrom || null, item.timeTo || null,
        item.tokenCount || 0
      );
    }
  });

  insertMany(nodes);
}

/**
 * 根据 id 获取节点
 */
export function getTreeNode(db, id) {
  return db.prepare('SELECT * FROM tree_nodes WHERE id = ?').get(id);
}

/**
 * 获取指定树类型和层级的节点
 */
export function getTreeNodesByLevel(db, treeKind, level) {
  return db.prepare('SELECT * FROM tree_nodes WHERE tree_kind = ? AND level = ? ORDER BY score DESC')
    .all(treeKind, level);
}

/**
 * 获取节点的子节点
 */
export function getChildNodes(db, parentId) {
  return db.prepare('SELECT * FROM tree_nodes WHERE parent_id = ? ORDER BY score DESC')
    .all(parentId);
}

/**
 * 获取节点的父节点
 */
export function getParentNode(db, nodeId) {
  const node = getTreeNode(db, nodeId);
  if (!node || !node.parent_id) return null;
  return getTreeNode(db, node.parent_id);
}

/**
 * 获取根节点（没有 parent_id 的节点）
 */
export function getRootNodes(db, treeKind = 'global') {
  return db.prepare('SELECT * FROM tree_nodes WHERE tree_kind = ? AND parent_id IS NULL ORDER BY level DESC')
    .all(treeKind);
}

/**
 * 设置节点的父节点
 */
export function setParentNode(db, nodeId, parentId) {
  return db.prepare('UPDATE tree_nodes SET parent_id = ? WHERE id = ?')
    .run(parentId, nodeId);
}

/**
 * 批量设置父子关系
 */
export function linkChildren(db, parentId, childIds) {
  const update = db.prepare('UPDATE tree_nodes SET parent_id = ? WHERE id = ?');

  const updateMany = db.transaction((ids) => {
    for (const childId of ids) {
      update.run(parentId, childId);
    }
  });

  updateMany(childIds);
}

/**
 * 更新节点摘要内容
 */
export function updateNodeContent(db, nodeId, content, summaryMd = null) {
  return db.prepare('UPDATE tree_nodes SET content = ?, summary_md = COALESCE(?, summary_md) WHERE id = ?')
    .run(content, summaryMd, nodeId);
}

/**
 * 更新节点分数
 */
export function updateNodeScore(db, nodeId, score) {
  return db.prepare('UPDATE tree_nodes SET score = ? WHERE id = ?')
    .run(score, nodeId);
}

/**
 * 删除节点（及其所有子节点）
 */
export function deleteTreeNode(db, nodeId) {
  // 先递归删除子节点
  const children = getChildNodes(db, nodeId);
  for (const child of children) {
    deleteTreeNode(db, child.id);
  }
  return db.prepare('DELETE FROM tree_nodes WHERE id = ?').run(nodeId);
}

/**
 * 获取树的统计信息
 */
export function getTreeStats(db) {
  const total = db.prepare('SELECT COUNT(*) as count FROM tree_nodes').get();
  const byKind = db.prepare('SELECT tree_kind, COUNT(*) as count FROM tree_nodes GROUP BY tree_kind').all();
  const byLevel = db.prepare('SELECT level, COUNT(*) as count FROM tree_nodes GROUP BY level ORDER BY level').all();

  return {
    total: total.count,
    byKind: Object.fromEntries(byKind.map(r => [r.tree_kind, r.count])),
    byLevel: Object.fromEntries(byLevel.map(r => [r.level, r.count])),
  };
}

/**
 * 获取完整树结构（递归）
 */
export function getTreeStructure(db, nodeId, maxDepth = 10) {
  const node = getTreeNode(db, nodeId);
  if (!node || maxDepth <= 0) return node;

  const children = getChildNodes(db, nodeId);
  if (children.length > 0) {
    node.children = children.map(child => getTreeStructure(db, child.id, maxDepth - 1));
  }

  return node;
}
