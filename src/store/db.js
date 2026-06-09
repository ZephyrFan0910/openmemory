/**
 * OpenMemory - SQLite 数据库连接
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initSchema, migrateSchema } from './schema.js';

const DEFAULT_DB_PATH = process.env.OPENMEMORY_DB || path.join(process.cwd(), 'data', 'memory.db');

let _db = null;

/**
 * 获取数据库连接（单例）
 * @param {string} dbPath - 数据库文件路径，默认 data/memory.db
 * @returns {import('better-sqlite3').Database}
 */
export function getDb(dbPath = DEFAULT_DB_PATH) {
  if (_db) return _db;

  // 确保 data 目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);

  // 开启 WAL 模式（更好的并发性能）
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // 初始化 schema + 迁移
  initSchema(_db);
  migrateSchema(_db);

  return _db;
}

/**
 * 关闭数据库连接
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * 在事务中执行多个操作
 * @param {import('better-sqlite3').Database} db
 * @param {Function} fn - 事务内执行的函数
 */
export function runInTransaction(db, fn) {
  const transaction = db.transaction(fn);
  return transaction();
}
