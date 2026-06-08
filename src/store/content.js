/**
 * OpenMemory - 磁盘 .md 文件读写
 * 输出 Obsidian 兼容的 Markdown 文件，带 wikilinks 形成 Graph View
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_VAULT_PATH = path.join(process.cwd(), 'data', 'vault');

// ==================== 基础文件操作 ====================

export function getVaultPath() {
  return DEFAULT_VAULT_PATH;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeVaultFile(relativePath, content) {
  const fullPath = path.join(DEFAULT_VAULT_PATH, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

export function readVaultFile(relativePath) {
  const fullPath = path.join(DEFAULT_VAULT_PATH, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

export function deleteVaultFile(relativePath) {
  const fullPath = path.join(DEFAULT_VAULT_PATH, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    return true;
  }
  return false;
}

export function listVaultFiles(dirPath = '') {
  const fullPath = path.join(DEFAULT_VAULT_PATH, dirPath);
  if (!fs.existsSync(fullPath)) return [];

  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listVaultFiles(relativePath));
    } else if (entry.name.endsWith('.md')) {
      files.push(relativePath);
    }
  }

  return files;
}

// ==================== Chunk 文件 ====================

/**
 * 将 chunk 写入 vault（带实体 wikilinks）
 * @param {Object} chunk - chunk 数据
 * @param {Object[]} entities - 关联的实体列表 [{ name, type, canonical_id }]
 */
export function writeChunkToVault(chunk, entities = []) {
  const fileName = `chunks/${chunk.id}.md`;
  const date = chunk.created_at?.slice(0, 10) || '';
  const source = chunk.source || '';

  // 提取 tags（从实体和来源）
  const tags = buildTags(entities, source);

  const lines = [
    '---',
    `id: ${chunk.id}`,
    `level: 0`,
    `type: chunk`,
    `source: ${source}`,
    chunk.source_id ? `source_id: "${chunk.source_id}"` : null,
    `score: ${chunk.score?.toFixed(2) || '0.00'}`,
    date ? `date: ${date}` : null,
    tags.length > 0 ? 'tags:' : null,
    ...tags.map(t => `  - ${t}`),
    '---',
    '',
    `# ${chunk.title || '未命名'}`,
    '',
    chunk.content || '',
  ].filter(Boolean);

  // 实体链接
  if (entities.length > 0) {
    lines.push('', '## Entities');
    for (const entity of entities) {
      const link = entity.canonical_id || `${entity.type}:${entity.name}`;
      lines.push(`- [[${link}]]`);
    }
  }

  return writeVaultFile(fileName, lines.join('\n'));
}

// ==================== Summary 节点文件 ====================

/**
 * 将 summary 节点写入 vault（带父子 wikilinks + 实体链接）
 * @param {Object} node - { id, level, content, score, timeFrom, timeTo, treeKind }
 * @param {Object[]} children - 子节点列表 [{ id, level, title, chunkId }]
 * @param {string|null} parentId - 父节点 ID
 * @param {Object[]} entities - 关联实体
 */
export function writeTreeNodeToVault(node, children = [], parentId = null, entities = []) {
  const fileName = node.level === 0
    ? `chunks/${node.chunkId || node.id}.md`
    : `summaries/L${node.level}/${node.id}.md`;

  const content = generateNodeMarkdown(node, children, parentId, entities);
  return writeVaultFile(fileName, content);
}

/**
 * 生成节点的 Markdown 内容（带 wikilinks）
 */
function generateNodeMarkdown(node, children = [], parentId = null, entities = []) {
  const lines = [];

  // 提取 tags
  const tags = buildTags(entities, null, node.level);

  // YAML frontmatter
  lines.push('---');
  lines.push(`id: ${node.id}`);
  lines.push(`level: ${node.level}`);
  lines.push(`type: ${node.level === 0 ? 'chunk' : 'summary'}`);
  if (node.treeKind) lines.push(`tree: ${node.treeKind}`);
  lines.push(`score: ${node.score?.toFixed(2) || 'N/A'}`);
  if (node.timeFrom) lines.push(`from: ${node.timeFrom}`);
  if (node.timeTo) lines.push(`to: ${node.timeTo}`);
  if (parentId) lines.push(`parent: "[[${parentId}]]"`);
  if (tags.length > 0) {
    lines.push('tags:');
    for (const t of tags) lines.push(`  - ${t}`);
  }
  lines.push('---');
  lines.push('');

  // 标题
  if (node.level === 0) {
    lines.push(`# ${node.title || '未命名 Chunk'}`);
  } else {
    lines.push(`# L${node.level} 摘要`);
  }
  lines.push('');

  // 元信息
  const meta = [];
  if (node.timeFrom || node.timeTo) {
    const timeStr = node.timeFrom && node.timeTo
      ? `${node.timeFrom.slice(0, 10)} ~ ${node.timeTo.slice(0, 10)}`
      : (node.timeFrom || node.timeTo || '').slice(0, 10);
    meta.push(`📅 ${timeStr}`);
  }
  if (node.score != null) {
    meta.push(`⭐ ${node.score.toFixed(2)}`);
  }
  if (meta.length > 0) {
    lines.push(meta.join(' | '));
    lines.push('');
  }

  // 内容
  if (node.content) {
    lines.push(node.content);
    lines.push('');
  }

  // 子节点链接
  if (children.length > 0) {
    lines.push('## Children');
    for (const child of children) {
      const label = child.title || (child.level === 0 ? `chunk` : `L${child.level} 摘要`);
      lines.push(`- [[${child.id}]] -- ${label}`);
    }
    lines.push('');
  }

  // 父节点链接
  if (parentId) {
    lines.push('## Parent');
    lines.push(`[[${parentId}]]`);
    lines.push('');
  }

  // 实体链接
  if (entities.length > 0) {
    lines.push('## Entities');
    for (const entity of entities) {
      const link = entity.canonical_id || `${entity.type}:${entity.name}`;
      lines.push(`- [[${link}]]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ==================== 实体页面 ====================

/**
 * 写入实体页面（多个 chunk/summary 共享的实体枢纽）
 * @param {Object} entity - { canonical_id, name, type }
 * @param {Object[]} mentions - 引用该实体的节点 [{ id, level, title, date }]
 */
export function writeEntityToVault(entity, mentions = []) {
  // 清理文件名：替换非法字符，截断过长名称
  let safeName = entity.name.replace(/[\/\\:*?"<>|&=%#\s]+/g, '_').replace(/^_+|_+$/g, '');
  if (safeName.length > 60) {
    safeName = safeName.slice(0, 60);
  }
  if (!safeName) safeName = 'unknown';
  const fileName = `entities/${entity.type}/${safeName}.md`;

  const lines = [
    '---',
    `id: ${entity.canonical_id || `${entity.type}:${entity.name}`}`,
    `type: entity`,
    `entity_type: ${entity.type}`,
    `mentions: ${mentions.length}`,
    'tags:',
    `  - ${entity.type}`,
    '---',
    '',
    `# ${entity.name}`,
    '',
    `> ${entity.type} · ${mentions.length} 次引用`,
    '',
  ];

  // 按层级分组
  const byLevel = { chunks: [], summaries: [] };
  for (const m of mentions) {
    if (m.level === 0) {
      byLevel.chunks.push(m);
    } else {
      byLevel.summaries.push(m);
    }
  }

  if (byLevel.chunks.length > 0) {
    lines.push('## Chunks');
    for (const m of byLevel.chunks.slice(0, 50)) {
      const date = m.date ? ` (${m.date.slice(0, 10)})` : '';
      lines.push(`- [[${m.id}]]${date}`);
    }
    if (byLevel.chunks.length > 50) {
      lines.push(`- ... 共 ${byLevel.chunks.length} 条`);
    }
    lines.push('');
  }

  if (byLevel.summaries.length > 0) {
    lines.push('## Summaries');
    for (const m of byLevel.summaries.slice(0, 30)) {
      lines.push(`- [[${m.id}]] -- L${m.level}`);
    }
    if (byLevel.summaries.length > 30) {
      lines.push(`- ... 共 ${byLevel.summaries.length} 条`);
    }
    lines.push('');
  }

  return writeVaultFile(fileName, lines.join('\n'));
}

// ==================== Index MOC ====================

/**
 * 生成 Index MOC（Map of Content）总览页
 */
export function writeIndexMOC(db) {
  const lines = [
    '---',
    'type: moc',
    'tags:',
    '  - index',
    '---',
    '',
    '# 🧠 OpenMemory',
    '',
    '> 记忆树总览',
    '',
  ];

  // 统计
  const chunkCount = db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
  const nodeCount = db.prepare('SELECT COUNT(*) as c FROM tree_nodes').get().c;
  const entityCount = db.prepare('SELECT COUNT(*) as c FROM entities').get().c;

  lines.push(`- Chunks: ${chunkCount}`);
  lines.push(`- Tree Nodes: ${nodeCount}`);
  lines.push(`- Entities: ${entityCount}`);
  lines.push('');

  // 根节点
  const roots = db.prepare("SELECT * FROM tree_nodes WHERE parent_id IS NULL ORDER BY level DESC").all();
  if (roots.length > 0) {
    lines.push('## 根节点');
    for (const root of roots) {
      lines.push(`- [[${root.id}]] -- L${root.level}`);
    }
    lines.push('');
  }

  // 热门实体
  const topEntities = db.prepare(`
    SELECT canonical_id, name, type, COUNT(*) as cnt
    FROM entities
    WHERE canonical_id IS NOT NULL
    GROUP BY canonical_id
    ORDER BY cnt DESC
    LIMIT 20
  `).all();

  if (topEntities.length > 0) {
    lines.push('## 热门实体');
    for (const e of topEntities) {
      const safeName = e.name.replace(/[\/\\:*?"<>|]/g, '_');
      lines.push(`- [[${e.canonical_id}|${e.name}]] (${e.type}) ×${e.cnt}`);
    }
    lines.push('');
  }

  return writeVaultFile('Index.md', lines.join('\n'));
}

// ==================== 工具函数 ====================

/**
 * 构建 tags 列表
 */
function buildTags(entities = [], source = null, level = null) {
  const tags = new Set();

  if (level != null && level > 0) tags.add('summary');

  if (source) tags.add(`source/${source}`);

  for (const entity of (entities || [])) {
    if (entity.type && entity.name) {
      // 用 type/name 作为层级 tag
      tags.add(`${entity.type}/${entity.name}`);
    }
  }

  return [...tags];
}
