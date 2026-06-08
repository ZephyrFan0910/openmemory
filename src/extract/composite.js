/**
 * OpenMemory - 组合抽取器
 * 合并正则抽取和关键词抽取的结果
 */

import { extractRegex } from './regex.js';
import { extractKeywords } from './keywords.js';

/**
 * 组合抽取：正则 + 关键词
 * @param {string} text
 * @param {Object} options
 * @returns {{ entities: Array<{ name: string, type: string }>, topics: string[] }}
 */
export function extractEntities(text, options = {}) {
  const { topN = 10 } = options;

  if (!text) return { entities: [], topics: [] };

  // 正则抽取：邮箱、URL、@handle、#hashtag
  const regexEntities = extractRegex(text);

  // 关键词抽取：topic
  const keywordEntities = extractKeywords(text, topN);

  // 合并去重
  const seen = new Set();
  const entities = [];

  for (const entity of [...regexEntities, ...keywordEntities]) {
    const key = `${entity.type}:${entity.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push(entity);
    }
  }

  // 提取 topic 列表
  const topics = keywordEntities.map(e => e.name);

  return { entities, topics };
}
