/**
 * OpenMemory - 日志工具
 */

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel = LEVELS.info;

/**
 * 设置日志级别
 */
export function setLogLevel(level) {
  currentLevel = LEVELS[level] ?? LEVELS.info;
}

/**
 * 格式化时间戳
 */
function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

export const logger = {
  debug(...args) {
    if (currentLevel <= LEVELS.debug) {
      console.error(`[${timestamp()}] 🔍`, ...args);
    }
  },

  info(...args) {
    if (currentLevel <= LEVELS.info) {
      console.error(`[${timestamp()}] ℹ️ `, ...args);
    }
  },

  warn(...args) {
    if (currentLevel <= LEVELS.warn) {
      console.error(`[${timestamp()}] ⚠️ `, ...args);
    }
  },

  error(...args) {
    if (currentLevel <= LEVELS.error) {
      console.error(`[${timestamp()}] ❌`, ...args);
    }
  },

  /**
   * 创建子日志器（带前缀）
   */
  child(prefix) {
    return {
      debug: (...args) => logger.debug(`[${prefix}]`, ...args),
      info: (...args) => logger.info(`[${prefix}]`, ...args),
      warn: (...args) => logger.warn(`[${prefix}]`, ...args),
      error: (...args) => logger.error(`[${prefix}]`, ...args),
    };
  },
};
