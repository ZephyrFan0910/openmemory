/**
 * OpenMemory - 采集器注册 + 统一入口
 * 每个采集器实现统一接口：scan → normalize → desensitize
 */

import { desensitizeEntries } from '../desensitize/index.js';
import { insertChunks } from '../store/chunks.js';

/**
 * 采集器基类
 */
export class Collector {
  name;           // 'wechat' / 'browser' / 'video' / 'session' / 'file'
  sourceType;     // 对应 chunks.source 字段

  constructor(name, sourceType) {
    this.name = name;
    this.sourceType = sourceType;
  }

  /**
   * 扫描数据源，返回原始条目列表
   * @param {Object} config - 采集配置
   * @returns {Promise<Object[]>} 原始条目列表
   */
  async scan(config) {
    throw new Error(`${this.name} collector: scan() not implemented`);
  }

  /**
   * 将原始条目规范化为 Markdown
   * @param {Object} rawEntry - 原始条目
   * @returns {Object} 规范化后的条目 { title, content, sourceId, ... }
   */
  normalize(rawEntry) {
    throw new Error(`${this.name} collector: normalize() not implemented`);
  }

  /**
   * 完整的采集流程：scan → normalize → desensitize → insert
   * @param {import('better-sqlite3').Database} db
   * @param {Object} config - 采集配置
   * @returns {Promise<Object>} 采集结果
   */
  async collect(db, config = {}) {
    console.log(`[${this.name}] 开始扫描...`);

    // 1. 扫描
    const rawEntries = await this.scan(config);
    console.log(`[${this.name}] 扫描到 ${rawEntries.length} 条原始数据`);

    if (rawEntries.length === 0) {
      return { total: 0, inserted: 0, skipped: 0, entries: [] };
    }

    // 2. 规范化
    const normalized = rawEntries.map(entry => this.normalize(entry));
    console.log(`[${this.name}] 规范化完成`);

    // 3. 脱敏
    const desensitized = desensitizeEntries(normalized);
    console.log(`[${this.name}] 脱敏完成`);

    // 4. 添加 source 信息
    const chunks = desensitized.map(entry => ({
      ...entry,
      source: this.sourceType,
    }));

    // 5. 写入数据库
    const inserted = insertChunks(db, chunks);
    console.log(`[${this.name}] 写入 ${inserted.length} 条数据`);

    return {
      total: rawEntries.length,
      inserted: inserted.length,
      skipped: rawEntries.length - inserted.length,
      entries: inserted,
    };
  }
}

// 采集器注册表
const collectors = {};

/**
 * 注册采集器
 */
export function registerCollector(collector) {
  collectors[collector.name] = collector;
}

/**
 * 获取采集器
 */
export function getCollector(name) {
  return collectors[name];
}

/**
 * 获取所有已注册的采集器
 */
export function getAllCollectors() {
  return Object.values(collectors);
}

/**
 * 执行采集
 * @param {import('better-sqlite3').Database} db
 * @param {string} name - 采集器名称
 * @param {Object} config - 采集配置
 */
export async function runCollector(db, name, config = {}) {
  const collector = collectors[name];
  if (!collector) {
    throw new Error(`未知的采集器: ${name}。可用的采集器: ${Object.keys(collectors).join(', ')}`);
  }
  return collector.collect(db, config);
}
