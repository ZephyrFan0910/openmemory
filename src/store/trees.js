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
  treeId = null,
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
  embedding = null,
}) {
  const nodeId = id || generateNodeId();

  db.prepare(`
    INSERT OR IGNORE INTO tree_nodes (id, tree_id, tree_kind, level, parent_id, chunk_id, content, summary_md, score, time_from, time_to, token_count, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nodeId, treeId, treeKind, level, parentId, chunkId, content, summaryMd, score, timeFrom, timeTo, tokenCount, embedding);

  return { id: nodeId, treeId, treeKind, level, parentId, chunkId, content, summaryMd, score, timeFrom, timeTo, tokenCount };
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

// ==================== Tree 管理函数 ====================

/**
 * 创建一棵树
 */
export function createTree(db, { id, kind, scope = null }) {
  db.prepare(`
    INSERT OR IGNORE INTO trees (id, kind, scope, status)
    VALUES (?, ?, ?, 'active')
  `).run(id, kind, scope);
  return getTreeById(db, id);
}

/**
 * 获取树信息
 */
export function getTreeById(db, id) {
  return db.prepare('SELECT * FROM trees WHERE id = ?').get(id);
}

/**
 * 按类型获取所有活跃的树
 */
export function getTreesByKind(db, kind) {
  return db.prepare("SELECT * FROM trees WHERE kind = ? AND status = 'active'").all(kind);
}

/**
 * 更新树的最大层级
 */
export function updateTreeMaxLevel(db, treeId, level) {
  db.prepare('UPDATE trees SET max_level = MAX(max_level, ?) WHERE id = ?')
    .run(level, treeId);
}

/**
 * 更新树的最后密封时间
 */
export function updateTreeLastSealedAt(db, treeId) {
  db.prepare("UPDATE trees SET last_sealed_at = datetime('now') WHERE id = ?")
    .run(treeId);
}

/**
 * 获取或创建默认树
 */
export function ensureTree(db, kind = 'global') {
  const id = `tree_${kind}_default`;
  const existing = getTreeById(db, id);
  if (existing) return existing;
  return createTree(db, { id, kind, scope: kind });
}
