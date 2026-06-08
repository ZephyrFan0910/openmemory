/**
 * OpenMemory - 浏览器历史记录采集器
 * 支持 Chrome / Edge / Firefox
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { Collector, registerCollector } from './index.js';
import { shouldBlockUrl, sanitizeUrl } from '../desensitize/filters.js';

// Chrome/Edge WebKit 时间戳基准：1601-01-01
const WEBKIT_EPOCH = BigInt('11644473600000000');

class BrowserCollector extends Collector {
  constructor() {
    super('browser', 'browser');
  }

  /**
   * 获取浏览器 History 文件路径
   */
  getBrowserPaths() {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

    return {
      chrome: path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'History'),
      edge: path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'History'),
      firefox: path.join(appData, 'Mozilla', 'Firefox', 'Profiles'),
    };
  }

  /**
   * 扫描浏览器历史记录
   * @param {Object} config - { browsers: string[], since: string }
   */
  async scan(config = {}) {
    const { browsers = ['chrome', 'edge'], since } = config;
    const entries = [];

    for (const browser of browsers) {
      try {
        const browserEntries = await this.scanBrowser(browser, since);
        entries.push(...browserEntries);
      } catch (err) {
        console.warn(`[browser] 扫描 ${browser} 失败:`, err.message);
      }
    }

    return entries;
  }

  /**
   * 扫描单个浏览器
   */
  async scanBrowser(browser, since) {
    const paths = this.getBrowserPaths();
    const historyPath = paths[browser];

    if (!historyPath) {
      throw new Error(`不支持的浏览器: ${browser}`);
    }

    if (!fs.existsSync(historyPath)) {
      console.warn(`[browser] ${browser} History 文件不存在: ${historyPath}`);
      return [];
    }

    // 复制 History 文件到临时目录（浏览器运行时会锁定）
    const tmpPath = path.join(os.tmpdir(), `openmemory_${browser}_history_${Date.now()}`);
    fs.copyFileSync(historyPath, tmpPath);

    try {
      const db = new Database(tmpPath, { readonly: true });
      const entries = this.queryHistory(db, browser, since);
      db.close();
      return entries;
    } finally {
      // 清理临时文件
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  /**
   * 查询浏览器历史记录
   */
  queryHistory(db, browser, since) {
    let sql;
    const params = [];

    if (browser === 'firefox') {
      // Firefox 使用不同的表结构和时间戳
      sql = `
        SELECT url, title, visit_count, last_visit_date
        FROM moz_places
        WHERE last_visit_date > 0
      `;

      if (since) {
        // Firefox 时间戳是微秒 since 1970-01-01
        const sinceTimestamp = new Date(since).getTime() * 1000;
        sql += ' AND last_visit_date > ?';
        params.push(sinceTimestamp);
      }

      sql += ' ORDER BY last_visit_date DESC LIMIT 10000';
    } else {
      // Chrome / Edge 使用 WebKit 时间戳
      sql = `
        SELECT url, title, visit_count, last_visit_time
        FROM urls
        WHERE last_visit_time > 0
      `;

      if (since) {
        // Chrome 时间戳：微秒 since 1601-01-01
        const sinceDate = new Date(since);
        const chromeTimestamp = (BigInt(sinceDate.getTime()) + WEBKIT_EPOCH) * BigInt(1000);
        sql += ' AND last_visit_time > ?';
        params.push(Number(chromeTimestamp));
      }

      sql += ' ORDER BY last_visit_time DESC LIMIT 10000';
    }

    const rows = db.prepare(sql).all(...params);

    return rows.map(row => ({
      url: row.url,
      title: row.title || '',
      visitCount: row.visit_count || 0,
      visitTime: this.parseTimestamp(row.last_visit_time || row.last_visit_date, browser),
    }));
  }

  /**
   * 解析浏览器时间戳
   */
  parseTimestamp(timestamp, browser) {
    try {
      if (!timestamp || timestamp <= 0) {
        return new Date().toISOString();
      }

      if (browser === 'firefox') {
        // Firefox: 微秒 since 1970-01-01
        const ms = Number(BigInt(timestamp) / BigInt(1000));
        const date = new Date(ms);
        return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
      } else {
        // Chrome/Edge: 微秒 since 1601-01-01
        const ms = Number(BigInt(timestamp) / BigInt(1000) - WEBKIT_EPOCH);
        const date = new Date(ms);
        return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
      }
    } catch {
      return new Date().toISOString();
    }
  }

  /**
   * 规范化为 chunk
   */
  normalize(entry) {
    const { url, title, visitCount, visitTime } = entry;

    // 过滤敏感 URL
    const blockResult = shouldBlockUrl(url);
    if (blockResult.blocked) {
      return {
        title: `[已过滤] ${title}`,
        content: `[URL 已过滤: ${blockResult.reason}]`,
        sourceId: `browser:filtered:${visitTime?.slice(0, 10)}`,
        createdAt: visitTime,
      };
    }

    // 清理 URL 中的敏感参数
    const cleanUrl = sanitizeUrl(url);

    // 提取域名
    let domain = '';
    try {
      domain = new URL(cleanUrl).hostname;
    } catch {}

    return {
      title: `${domain} - 浏览历史 (${visitTime?.slice(0, 10) || '未知日期'})`,
      content: `## ${domain}\n- [${title || cleanUrl}](${cleanUrl})\n- 访问次数: ${visitCount}`,
      sourceId: `browser:${domain}:${visitTime?.slice(0, 10)}`,
      createdAt: visitTime,
      domain,
      url: cleanUrl,
    };
  }
}

// 注册采集器
const browserCollector = new BrowserCollector();
registerCollector(browserCollector);

export default browserCollector;
