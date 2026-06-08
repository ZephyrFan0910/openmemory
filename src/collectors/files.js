/**
 * OpenMemory - 本地文档采集器
 * 支持 .md / .txt 文件
 */

import fs from 'fs';
import path from 'path';
import { Collector, registerCollector } from './index.js';

class FilesCollector extends Collector {
  constructor() {
    super('files', 'file');
  }

  /**
   * 扫描指定目录下的文档文件
   * @param {Object} config - { paths: string[] }
   */
  async scan(config = {}) {
    const { paths = [] } = config;

    if (paths.length === 0) {
      throw new Error('请指定要扫描的目录路径，例如: openmemory import files ~/Documents');
    }

    const entries = [];

    for (const dirPath of paths) {
      const resolvedPath = path.resolve(dirPath);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[files] 目录不存在: ${resolvedPath}`);
        continue;
      }
      const files = this.scanDirectory(resolvedPath);
      entries.push(...files);
    }

    return entries;
  }

  /**
   * 递归扫描目录
   */
  scanDirectory(dirPath) {
    const entries = [];
    const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);

        if (item.isDirectory()) {
          // 跳过隐藏目录和 node_modules
          if (item.name.startsWith('.') || item.name === 'node_modules') continue;
          entries.push(...this.scanDirectory(fullPath));
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (!['.md', '.txt'].includes(ext)) continue;

          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE) {
            console.warn(`[files] 跳过过大文件 (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${fullPath}`);
            continue;
          }

          entries.push({
            filePath: fullPath,
            fileName: item.name,
            ext,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
        }
      }
    } catch (err) {
      console.warn(`[files] 扫描目录失败: ${dirPath}`, err.message);
    }

    return entries;
  }

  /**
   * 将文件规范化为 Markdown chunk
   */
  normalize(entry) {
    const { filePath, fileName, ext, mtime } = entry;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // 提取 Markdown 标题作为 tags
      const tags = this.extractTags(content);

      return {
        title: fileName,
        content: content.trim(),
        sourceId: `file:${filePath}`,
        createdAt: mtime,
        tags,
      };
    } catch (err) {
      console.warn(`[files] 读取文件失败: ${filePath}`, err.message);
      return {
        title: fileName,
        content: `[读取失败: ${err.message}]`,
        sourceId: `file:${filePath}`,
        createdAt: mtime,
      };
    }
  }

  /**
   * 提取 Markdown 标题作为 tags
   */
  extractTags(content) {
    const tags = [];
    const headingPattern = /^#{1,3}\s+(.+)$/gm;
    let match;

    while ((match = headingPattern.exec(content)) !== null) {
      tags.push(match[1].trim());
    }

    return tags;
  }
}

// 注册采集器
const filesCollector = new FilesCollector();
registerCollector(filesCollector);

export default filesCollector;
