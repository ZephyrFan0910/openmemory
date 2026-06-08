/**
 * OpenMemory - 组合抽取器
 * 移植自 OpenHuman 的 CompositeExtractor
 *
 * 链式合并：regex → keywords → LLM
 * 所有实体添加 canonical_id
 */

import { extractRegex } from './regex.js';
import { extractKeywords } from './keywords.js';
import { extractLlmEntities } from './llm.js';
import { canonicalIdFor } from './canonical.js';

/**
 * 组合抽取（async，支持可选 LLM）
 * @param {string} text
 * @param {Object} options
 * @param {boolean} options.useLlm - 是否使用 LLM（默认 true，无 API key 自动跳过）
 * @param {number} options.topN - 关键词数量
 * @returns {Promise<{ entities: Array, topics: string[], llmImportance: number }>}
 */
export async function extractEntities(text, options = {}) {
  const { useLlm = true, topN = 10 } = options;

  if (!text) return { entities: [], topics: [], llmImportance: 0 };

  // 1. 正则抽取
  const regexEntities = extractRegex(text);

  // 2. 关键词抽取
  const keywordEntities = extractKeywords(text, topN);

  // 3. LLM 抽取（可选）
  let llmEntities = [];
  let llmTopics = [];
  let llmImportance = 0;

  if (useLlm) {
    try {
      const llmResult = await extractLlmEntities(text, {
        emitTopics: true,
      });
      llmEntities = llmResult.entities;
      llmTopics = llmResult.topics;
      llmImportance = llmResult.importance;
    } catch {
      // LLM 失败不影响整体
    }
  }

  // 4. 合并去重（使用 canonical_id）
  const seen = new Set();
  const entities = [];

  const addEntity = (entity) => {
    const cid = canonicalIdFor(entity.type, entity.name);
    if (!cid) return;
    if (seen.has(cid)) return;
    seen.add(cid);
    entities.push({ ...entity, canonical_id: cid });
  };

  for (const entity of regexEntities) addEntity(entity);
  for (const entity of keywordEntities) addEntity({ name: entity.name, type: 'topic' });
  for (const entity of llmEntities) addEntity(entity);

  // 5. 合并 topics
  const allTopics = [
    ...keywordEntities.map(e => e.name),
    ...llmTopics,
  ];
  const uniqueTopics = [...new Set(allTopics.map(t => t.toLowerCase()))];

  return {
    entities,
    topics: uniqueTopics,
    llmImportance,
  };
}
