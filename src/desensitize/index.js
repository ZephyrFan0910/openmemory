/**
 * OpenMemory - 脱敏模块入口
 * 所有采集器的数据在写入 SQLite 之前，必须经过脱敏处理
 */

import { applyDesensitize, ALL_RULES, MANDATORY_RULES, OPTIONAL_RULES } from './patterns.js';
import { shouldBlockUrl, filterUrls, sanitizeUrl } from './filters.js';

/**
 * 脱敏配置
 */
const DEFAULT_CONFIG = {
  rules: ALL_RULES,        // 使用的脱敏规则
  filterUrls: true,        // 是否过滤敏感 URL
  sanitizeUrls: true,      // 是否清理 URL 中的敏感参数
};

/**
 * 对文本进行完整脱敏处理
 * @param {string} text - 原始文本
 * @param {Object} config - 脱敏配置
 * @returns {{ text: string, replacements: Object, blockedUrls: Array }}
 */
export function desensitizeText(text, config = DEFAULT_CONFIG) {
  const { rules, filterUrls: shouldFilterUrls, sanitizeUrls: shouldSanitizeUrls } = { ...DEFAULT_CONFIG, ...config };

  let result = text;
  let replacements = {};
  let blockedUrls = [];

  // 1. 应用文本脱敏规则
  const desensitized = applyDesensitize(result, rules);
  result = desensitized.text;
  replacements = desensitized.replacements;

  // 2. 如果启用 URL 过滤，提取并过滤 URL
  if (shouldFilterUrls) {
    const urlPattern = /https?:\/\/[^\s<>"]+/g;
    const urls = result.match(urlPattern) || [];
    const filtered = filterUrls(urls);

    blockedUrls = filtered.blocked;

    // 从文本中移除被阻止的 URL
    for (const { url } of blockedUrls) {
      result = result.replace(url, '[已过滤URL]');
    }
  }

  // 3. 如果启用 URL 清理，清理剩余 URL 中的敏感参数
  if (shouldSanitizeUrls) {
    const urlPattern = /https?:\/\/[^\s<>"]+/g;
    result = result.replace(urlPattern, (url) => sanitizeUrl(url));
  }

  return { text: result, replacements, blockedUrls };
}

/**
 * 对数据条目进行脱敏（适用于采集器输出）
 * @param {Object} entry - 数据条目 { title, content, ... }
 * @param {Object} config - 脱敏配置
 * @returns {Object} 脱敏后的条目
 */
export function desensitizeEntry(entry, config = DEFAULT_CONFIG) {
  const result = { ...entry };

  // 脱敏 title
  if (result.title) {
    const titleResult = desensitizeText(result.title, config);
    result.title = titleResult.text;
  }

  // 脱敏 content
  if (result.content) {
    const contentResult = desensitizeText(result.content, config);
    result.content = contentResult.text;
    result._desensitizeInfo = {
      replacements: contentResult.replacements,
      blockedUrls: contentResult.blockedUrls,
    };
  }

  return result;
}

/**
 * 批量脱敏
 * @param {Object[]} entries - 数据条目列表
 * @param {Object} config - 脱敏配置
 * @returns {Object[]} 脱敏后的条目列表
 */
export function desensitizeEntries(entries, config = DEFAULT_CONFIG) {
  return entries.map(entry => desensitizeEntry(entry, config));
}

// 导出内部模块供直接使用
export {
  applyDesensitize,
  shouldBlockUrl,
  filterUrls,
  sanitizeUrl,
  ALL_RULES,
  MANDATORY_RULES,
  OPTIONAL_RULES,
};
