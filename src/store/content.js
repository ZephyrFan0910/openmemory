/**
 * OpenMemory - 磁盘 .md 文件读写
 * 输出 Obsidian 兼容的 Markdown 文件
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_VAULT_PATH = path.join(process.cwd(), 'data', 'vault');

/**
 * 获取 vault 路径
 */
export function getVaultPath() {
  return DEFAULT_VAULT_PATH;
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 写入 vault 文件
 */
export function writeVaultFile(relativePath, content) {
  const fullPath = path.join(DEFAULT_VAULT_PATH, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

/**
 * 读取 vault 文件
 */
export function readVaultFile(relativePath) {
  const fullPath = path.join(DEFAULT_VAULT_PATH, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * 删除 vault 文件
 */
export function deleteVaultFile(relativePath) {
  const fullPath = path.join(DEFAULT_VAULT_PATH, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    return true;
  }
  return false;
}

/**
 * 列出 vault 目录下的所有 .md 文件
 */
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

/**
 * 将 chunk 写入 vault（Obsidian 兼容格式）
 */
export function writeChunkToVault(chunk) {
  const fileName = `chunks/${chunk.id}.md`;
  const date = chunk.created_at?.slice(0, 10) || '';

  const lines = [
    '---',
    `id: ${chunk.id}`,
    `source: ${chunk.source}`,
    chunk.source_id ? `source_id: "${chunk.source_id}"` : null,
    `score: ${chunk.score?.toFixed(2) || '0.00'}`,
    date ? `date: ${date}` : null,
    `type: chunk`,
    '---',
    '',
    `# ${chunk.title || '未命名'}`,
    '',
    chunk.content || '',
  ].filter(Boolean);

  return writeVaultFile(fileName, lines.join('\n'));
}

/**
 * 将树节点写入 vault（Obsidian 兼容格式）
 */
export function writeTreeNodeToVault(node) {
  const fileName = node.level === 0
    ? `chunks/${node.chunkId || node.id}.md`
    : `summaries/L${node.level}/${node.id}.md`;

  const content = generateNodeMarkdown(node);
  return writeVaultFile(fileName, content);
}

/**
 * 生成节点的 Markdown 内容（Obsidian 兼容）
 */
function generateNodeMarkdown(node) {
  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`id: ${node.id}`);
  lines.push(`level: ${node.level}`);
  lines.push(`score: ${node.score?.toFixed(2) || 'N/A'}`);
  if (node.treeKind) lines.push(`tree: ${node.treeKind}`);
  if (node.timeFrom) lines.push(`from: ${node.timeFrom}`);
  if (node.timeTo) lines.push(`to: ${node.timeTo}`);
  lines.push(`type: ${node.level === 0 ? 'chunk' : 'summary'}`);
  lines.push('---');
  lines.push('');

  // 标题
  if (node.level === 0) {
    lines.push(`# ${node.title || '未命名 Chunk'}`);
  } else {
    lines.push(`# L${node.level} 摘要`);
  }
  lines.push('');

  // 元信息块
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
  }

  return lines.join('\n');
}
