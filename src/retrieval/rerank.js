/**
 * OpenMemory - 语义重排
 * 移植自 OpenHuman 的 retrieval 模块
 *
 * 使用余弦相似度对搜索结果进行重排
 */

import { embedText, unpackEmbedding, cosineSimilarity } from '../embed/index.js';

/**
 * 按嵌入向量重排搜索结果
 * @param {Object[]} hits - 搜索结果（可含 embedding BLOB）
 * @param {string} queryText - 查询文本
 * @returns {Promise<Object[]>} 重排后的结果
 */
export async function rerankByEmbedding(hits, queryText) {
  if (!hits || hits.length === 0) return hits;

  // 嵌入查询文本
  const queryEmb = await embedText(queryText);
  if (!queryEmb) return hits;  // 无嵌入支持，返回原顺序

  const queryVec = unpackEmbedding(queryEmb);
  if (!queryVec) return hits;

  // 计算每个 hit 的相似度分数
  const scored = hits.map(hit => {
    if (!hit.embedding) {
      return { ...hit, _rerankScore: -Infinity };
    }

    const hitVec = unpackEmbedding(hit.embedding);
    if (!hitVec) {
      return { ...hit, _rerankScore: -Infinity };
    }

    return { ...hit, _rerankScore: cosineSimilarity(queryVec, hitVec) };
  });

  // 排序：有嵌入的按相似度降序，无嵌入的排最后
  scored.sort((a, b) => {
    if (a._rerankScore === -Infinity && b._rerankScore === -Infinity) return 0;
    if (a._rerankScore === -Infinity) return 1;
    if (b._rerankScore === -Infinity) return -1;
    return b._rerankScore - a._rerankScore;
  });

  return scored;
}
