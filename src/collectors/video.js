/**
 * OpenMemory - 视频平台观看历史采集器
 * 支持 B站/抖音等平台的 CSV/HTML 导出
 */

import fs from 'fs';
import path from 'path';
import { Collector, registerCollector } from './index.js';

class VideoCollector extends Collector {
  constructor() {
    super('video', 'video');
  }

  /**
   * 扫描视频观看历史文件
   * @param {Object} config - { paths: string[], platform: string }
   */
  async scan(config = {}) {
    const { paths = [], platform = 'auto' } = config;

    if (paths.length === 0) {
      throw new Error('请指定视频观看历史文件路径，例如: openmemory import video ~/exports/bilibili.csv');
    }

    const entries = [];

    for (const filePath of paths) {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[video] 文件不存在: ${resolvedPath}`);
        continue;
      }

      const ext = path.extname(resolvedPath).toLowerCase();

      try {
        let fileEntries;
        if (ext === '.csv') {
          fileEntries = this.parseCsvFile(resolvedPath, platform);
        } else if (ext === '.html' || ext === '.htm') {
          fileEntries = this.parseHtmlFile(resolvedPath, platform);
        } else if (ext === '.xlsx' || ext === '.xls') {
          console.warn(`[video] Excel 文件需要先转换为 CSV: ${resolvedPath}`);
          continue;
        } else {
          console.warn(`[video] 不支持的文件格式: ${ext}`);
          continue;
        }

        entries.push(...fileEntries);
      } catch (err) {
        console.warn(`[video] 解析失败: ${resolvedPath}`, err.message);
      }
    }

    return entries;
  }

  /**
   * 解析 CSV 文件
   * 支持 B站标准导出格式
   */
  parseCsvFile(filePath, platform) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length < 2) return [];

    // 解析表头
    const headers = this.parseCsvLine(lines[0]);
    const entries = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);
      if (values.length < 2) continue;

      const row = {};
      headers.forEach((header, idx) => {
        row[header.trim()] = values[idx]?.trim() || '';
      });

      // 根据平台解析字段
      const entry = this.parseVideoRow(row, platform, filePath);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * 解析 CSV 行（处理引号内的逗号）
   */
  parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }

  /**
   * 解析视频行数据
   */
  parseVideoRow(row, platform, filePath) {
    // 自动检测平台
    const detectedPlatform = this.detectPlatform(row, platform, filePath);

    switch (detectedPlatform) {
      case 'bilibili':
        return this.parseBilibiliRow(row);
      case 'douyin':
        return this.parseDouyinRow(row);
      default:
        return this.parseGenericRow(row);
    }
  }

  /**
   * 检测平台
   */
  detectPlatform(row, platform, filePath) {
    if (platform !== 'auto') return platform;

    const fileName = path.basename(filePath).toLowerCase();
    if (fileName.includes('bilibili') || fileName.includes('b站')) return 'bilibili';
    if (fileName.includes('douyin') || fileName.includes('抖音')) return 'douyin';

    // 根据字段名检测
    const headers = Object.keys(row).join(' ').toLowerCase();
    if (headers.includes('up主') || headers.includes('bilibili')) return 'bilibili';
    if (headers.includes('抖音')) return 'douyin';

    return 'generic';
  }

  /**
   * 解析 B站格式
   */
  parseBilibiliRow(row) {
    const title = row['标题'] || row['title'] || row['视频标题'] || '';
    const uploader = row['UP主'] || row['uploader'] || row['作者'] || '';
    const watchTime = row['观看时间'] || row['时间'] || row['watch_time'] || '';
    const category = row['分区'] || row['category'] || '';
    const link = row['链接'] || row['url'] || row['BV号'] || '';

    if (!title) return null;

    return {
      title,
      uploader,
      watchTime,
      category,
      link,
      platform: 'bilibili',
    };
  }

  /**
   * 解析抖音格式
   */
  parseDouyinRow(row) {
    const title = row['标题'] || row['title'] || row['视频标题'] || '';
    const author = row['作者'] || row['author'] || '';
    const watchTime = row['观看时间'] || row['时间'] || '';

    if (!title) return null;

    return {
      title,
      uploader: author,
      watchTime,
      platform: 'douyin',
    };
  }

  /**
   * 解析通用格式
   */
  parseGenericRow(row) {
    // 尝试常见的字段名
    const title = row['标题'] || row['title'] || row['视频标题'] || row['名称'] ||
      Object.values(row)[0] || '';
    const uploader = row['UP主'] || row['作者'] || row['uploader'] || row['author'] || '';
    const watchTime = row['观看时间'] || row['时间'] || row['date'] || row['watch_time'] || '';

    if (!title) return null;

    return {
      title,
      uploader,
      watchTime,
      platform: 'generic',
    };
  }

  /**
   * 解析 HTML 文件
   */
  parseHtmlFile(filePath, platform) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const entries = [];

    // 匹配视频卡片
    const cardPattern = /<div[^>]*class="[^"]*video[^"]*card[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const titlePattern = /<a[^>]*title="([^"]+)"/i;
    const linkPattern = /<a[^>]*href="([^"]+)"/i;

    let match;
    while ((match = cardPattern.exec(content)) !== null) {
      const block = match[1];
      const titleMatch = block.match(titlePattern);
      const linkMatch = block.match(linkPattern);

      if (titleMatch) {
        entries.push({
          title: titleMatch[1],
          uploader: '',
          watchTime: '',
          link: linkMatch ? linkMatch[1] : '',
          platform: platform === 'auto' ? 'generic' : platform,
        });
      }
    }

    return entries;
  }

  /**
   * 规范化为 chunk
   */
  normalize(entry) {
    const { title, uploader, watchTime, link, category, platform } = entry;

    const date = watchTime?.slice(0, 10) || '未知日期';
    const parts = [`- ${title}`];
    if (uploader) parts.push(`  UP主: ${uploader}`);
    if (link) parts.push(`  链接: ${link}`);
    if (category) parts.push(`  分区: ${category}`);

    return {
      title: `${platform} 观看历史 (${date})`,
      content: `## ${date}\n${parts.join('\n')}`,
      sourceId: `video:${platform}:${date}`,
      createdAt: watchTime || null,
    };
  }
}

// 注册采集器
const videoCollector = new VideoCollector();
registerCollector(videoCollector);

export default videoCollector;
