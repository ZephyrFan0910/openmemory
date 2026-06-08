/**
 * OpenMemory - 磁盘 .md 文件读写
 * 对齐 OpenHuman 的 Obsidian 输出策略：
 * - summary 之间通过 frontmatter children: [[wikilink]] 连接
 * - chunk 不加任何 wikilinks（不参与 Graph View）
 * - 实体通过 tags 字段嵌入（tags 在 Graph View 中隐藏）
 * - graph.json 配置颜色分组
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_VAULT_PATH = path.join(process.cwd(), 'data', 'vault');

// ==================== 基础文件操作 ====================

export function getVaultPath() { return DEFAULT_VAULT_PATH; }

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
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
  if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); return true; }
  return false;
}

export function listVaultFiles(dirPath = '') {
  const fullPath = path.join(DEFAULT_VAULT_PATH, dirPath);
  if (!fs.existsSync(fullPath)) return [];
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = path.join(dirPath, entry.name);
    if (entry.isDirectory()) files.push(...listVaultFiles(rel));
    else if (entry.name.endsWith('.md')) files.push(rel);
  }
  return files;
}

// ==================== Chunk 文件（无 wikilinks） ====================

/**
 * 将 chunk 写入 vault
 * chunk 是叶子文件，不加 wikilinks，不参与 Graph View
 */
export function writeChunkToVault(chunk, entities = []) {
  const fileName = `chunks/${chunk.source}/${chunk.id}.md`;
  const date = chunk.created_at?.slice(0, 10) || '';

  // 构建 tags（Obsidian 层级标签）
  const tags = [`source/${chunk.source}`];
  for (const e of (entities || [])) {
    if (e.type && e.name && e.type !== 'topic') {
      tags.push(`${e.type}/${sanitizeTag(e.name)}`);
    }
  }

  const lines = [
    '---',
    `id: ${chunk.id}`,
    `source: ${chunk.source}`,
    chunk.source_id ? `source_id: "${chunk.source_id}"` : null,
    `score: ${chunk.score?.toFixed(2) || '0.00'}`,
    date ? `date: ${date}` : null,
    `type: chunk`,
    'tags:',
    ...tags.map(t => `  - ${t}`),
    '---',
    '',
    `# ${chunk.title || '未命名'}`,
    '',
    chunk.content || '',
  ].filter(Boolean);

  return writeVaultFile(fileName, lines.join('\n'));
}

// ==================== Summary 文件（frontmatter children: wikilinks） ====================

/**
 * 将 summary 节点写入 vault
 * 对齐 OpenHuman：wikilinks 在 frontmatter children: 字段中
 *
 * @param {Object} node - { id, level, content, score, timeFrom, timeTo, treeKind }
 * @param {Object[]} children - 子节点 [{ id, level }]
 * @param {Object[]} entities - 关联实体
 */
export function writeTreeNodeToVault(node, children = [], entities = []) {
  const fileName = `summaries/L${node.level}/${node.id}.md`;

  // 构建 tags
  const tags = ['summary'];
  for (const e of (entities || [])) {
    if (e.type && e.name) {
      tags.push(`${e.type}/${sanitizeTag(e.name)}`);
    }
  }

  const lines = [];

  // YAML frontmatter（对齐 OpenHuman 格式）
  lines.push('---');
  lines.push(`id: ${node.id}`);
  lines.push(`level: ${node.level}`);
  lines.push(`type: summary`);
  if (node.treeKind) lines.push(`tree: ${node.treeKind}`);
  lines.push(`score: ${node.score?.toFixed(2) || 'N/A'}`);
  if (node.timeFrom) lines.push(`from: ${node.timeFrom}`);
  if (node.timeTo) lines.push(`to: ${node.timeTo}`);

  // children: wikilinks（核心：驱动 Graph View 的边）
  if (children.length > 0) {
    lines.push('children:');
    for (const child of children) {
      lines.push(`  - "[[${child.id}]]"`);
    }
  } else {
    lines.push('children: []');
  }

  // tags（Graph View 中隐藏，但 Obsidian 标签面板可见）
  if (tags.length > 0) {
    lines.push('tags:');
    for (const t of tags) lines.push(`  - ${t}`);
  }

  lines.push('---');
  lines.push('');

  // 标题
  lines.push(`# L${node.level} 摘要`);
  lines.push('');

  // 元信息
  const meta = [];
  if (node.timeFrom || node.timeTo) {
    const t = node.timeFrom && node.timeTo
      ? `${node.timeFrom.slice(0, 10)} ~ ${node.timeTo.slice(0, 10)}`
      : (node.timeFrom || node.timeTo || '').slice(0, 10);
    meta.push(`📅 ${t}`);
  }
  if (node.score != null) meta.push(`⭐ ${node.score.toFixed(2)}`);
  if (meta.length > 0) { lines.push(meta.join(' | ')); lines.push(''); }

  // 摘要内容
  if (node.content) { lines.push(node.content); lines.push(''); }

  return writeVaultFile(fileName, lines.join('\n'));
}

// ==================== 实体页面 ====================

/**
 * 写入实体页面
 * 只为有意义的实体创建页面（过滤掉噪声 topic）
 */
export function writeEntityToVault(entity, mentions = []) {
  const safeName = sanitizeFilename(entity.name);
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

  if (mentions.length > 0) {
    lines.push('## Mentions');
    for (const m of mentions.slice(0, 30)) {
      const label = m.level === 0 ? 'chunk' : `L${m.level}`;
      const date = m.date ? ` (${m.date.slice(0, 10)})` : '';
      lines.push(`- [[${m.id}]] -- ${label}${date}`);
    }
    if (mentions.length > 30) lines.push(`- ... 共 ${mentions.length} 条`);
    lines.push('');
  }

  return writeVaultFile(fileName, lines.join('\n'));
}

// ==================== Index MOC ====================

export function writeIndexMOC(db) {
  const chunkCount = db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
  const nodeCount = db.prepare('SELECT COUNT(*) as c FROM tree_nodes').get().c;
  const entityCount = db.prepare('SELECT COUNT(*) as c FROM entities').get().c;

  const lines = [
    '---',
    'type: moc',
    'tags:',
    '  - index',
    '---',
    '',
    '# 🧠 OpenMemory',
    '',
    `> ${chunkCount} chunks · ${nodeCount} nodes · ${entityCount} entities`,
    '',
  ];

  // 根节点
  const roots = db.prepare("SELECT * FROM tree_nodes WHERE parent_id IS NULL ORDER BY level DESC").all();
  if (roots.length > 0) {
    lines.push('## 根节点');
    for (const r of roots) lines.push(`- [[${r.id}]] -- L${r.level}`);
    lines.push('');
  }

  // 热门实体（过滤 topic 噪声）
  const topEntities = db.prepare(`
    SELECT canonical_id, name, type, COUNT(*) as cnt
    FROM entities WHERE canonical_id IS NOT NULL AND type != 'topic'
    GROUP BY canonical_id ORDER BY cnt DESC LIMIT 20
  `).all();

  if (topEntities.length > 0) {
    lines.push('## 热门实体');
    for (const e of topEntities) {
      lines.push(`- ${e.name} (${e.type}) ×${e.cnt}`);
    }
    lines.push('');
  }

  return writeVaultFile('Index.md', lines.join('\n'));
}

// ==================== Obsidian 配置 ====================

/**
 * 生成 .obsidian/graph.json（颜色分组 + 隐藏 tags）
 */
export function writeGraphConfig() {
  const config = {
    "collapse-filter": false,
    "search": "",
    "showTags": false,
    "showAttachments": false,
    "hideUnresolved": true,
    "showOrphans": true,
    "collapse-color-groups": false,
    "colorGroups": [
      { "query": "path:summaries/L1", "color": { "rgb": 14701138, "a": 1 } },
      { "query": "path:summaries/L2", "color": { "rgb": 14725458, "a": 1 } },
      { "query": "path:summaries/L3", "color": { "rgb": 11657298, "a": 1 } },
      { "query": "path:summaries/L4", "color": { "rgb": 5420768, "a": 1 } },
      { "query": "path:summaries/L5", "color": { "rgb": 5431504, "a": 1 } },
      { "query": "path:summaries/L6", "color": { "rgb": 14701261, "a": 1 } },
      { "query": "path:entities", "color": { "rgb": 8454167, "a": 1 } },
      { "query": "path:Index", "color": { "rgb": 16776960, "a": 1 } },
    ],
    "collapse-display": false,
    "showArrow": true,
    "textFadeMultiplier": -2,
    "nodeSizeMultiplier": 1.16,
    "lineSizeMultiplier": 1,
    "collapse-forces": false,
    "centerStrength": 0.5,
    "repelStrength": 10,
    "linkStrength": 1,
    "linkDistance": 250,
  };

  return writeVaultFile('.obsidian/graph.json', JSON.stringify(config, null, 2));
}

// ==================== 工具函数 ====================

function sanitizeTag(name) {
  return name.replace(/[\/\\:*?"<>|&=%#\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown';
}

function sanitizeFilename(name) {
  let safe = name.replace(/[\/\\:*?"<>|&=%#\s]+/g, '_').replace(/^_+|_+$/g, '');
  if (safe.length > 60) safe = safe.slice(0, 60);
  return safe || 'unknown';
}
