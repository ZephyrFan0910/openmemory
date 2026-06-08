/**
 * OpenMemory - 评分系统（7 信号加权 + 3 级准入门控）
 * 移植自 OpenHuman 的 score 模块
 */

/**
 * 评分权重配置（对齐 OpenHuman）
 */
export const SCORE_WEIGHTS = {
  tokenCount: 1.0,
  uniqueWords: 1.0,
  metadataWeight: 1.5,
  sourceWeight: 1.5,
  interaction: 3.0,       // 最强信号
  entityDensity: 1.0,
  llmImportance: 0.0,     // 默认关闭，启用时为 2.0
};

/**
 * 3 级准入门控阈值
 */
export const DEFINITE_KEEP = 0.85;
export const DEFINITE_DROP = 0.15;
export const DROP_THRESHOLD = 0.3;
export const PRIORITY_BOOST = 0.25;

/**
 * 计算 token 数量信号（对齐 OpenHuman）
 */
function calcTokenSignal(tokenCount) {
  if (!tokenCount || tokenCount <= 0) return 0;
  if (tokenCount < 10) return 0;           // 噪音
  if (tokenCount < 30) return (tokenCount - 10) / 20;  // 线性爬坡
  if (tokenCount <= 3000) return 1.0;       // 平台期
  if (tokenCount <= 8000) return 1.0 - (tokenCount - 3000) / 10000;  // 线性下降
  return 0.5;                               // 过长
}

/**
 * 计算唯一词信号（type-token ratio）
 */
function calcUniqueWords(content) {
  if (!content) return 0;
  const cnChars = content.match(/[一-鿿]/g) || [];
  const enWords = content.match(/[a-zA-Z]{2,}/g) || [];
  const allWords = [...cnChars, ...enWords.map(w => w.toLowerCase())];

  if (allWords.length < 5) return 0.5;  // 不确定
  const unique = new Set(allWords);
  const ratio = unique.size / allWords.length;

  if (ratio <= 0.3) return 0.0;   // 重度重复
  if (ratio >= 0.7) return 1.0;   // 实质内容
  return (ratio - 0.3) / 0.4;     // 线性插值
}

/**
 * 计算元数据权重（来源类型基础权重）
 */
function calcMetadataWeight(source) {
  const weights = {
    file: 0.9,       // 文档
    session: 0.9,    // 对话
    wechat: 0.5,     // 聊天
    browser: 0.5,    // 浏览
    video: 0.5,      // 视频
    manual: 0.9,     // 手动添加
  };
  return weights[source] || 0.5;
}

/**
 * 计算来源权重（按具体平台）
 */
function calcSourceWeight(source, sourceId) {
  // 可以根据 sourceId 中的域名/平台进一步细化
  const weights = {
    file: 1.0,
    session: 0.9,
    wechat: 0.75,
    browser: 0.5,
    video: 0.4,
    manual: 1.0,
  };
  return weights[source] || 0.5;
}

/**
 * 计算交互信号（对齐 OpenHuman）
 * 基于 interaction_tags 标签
 */
function calcInteractionSignal(interactionTags) {
  if (!interactionTags) return 0.5;  // 无标签，中性

  const tags = interactionTags.split(',').map(t => t.trim().toLowerCase());
  let score = 0;

  if (tags.includes('sent')) score += 0.6;
  if (tags.includes('reply')) score += 0.5;
  if (tags.includes('dm')) score += 0.3;
  if (tags.includes('mention')) score += 0.2;

  return Math.min(1, score || 0.5);
}

/**
 * 计算实体密度信号
 */
function calcEntityDensity(content, entityCount = 0) {
  if (!content) return 0;

  // 如果有实体计数，使用精确计算
  if (entityCount > 0) {
    const tokenEstimate = content.length / 4;  // 粗略估算
    if (tokenEstimate === 0) return 0;
    const perToken = entityCount / tokenEstimate;
    return Math.min(1, perToken / 0.01);  // 每 100 token 1 个实体 = 满分
  }

  // 否则用正则估算
  const patterns = [
    /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g,
    /@[\w]+/g,
    /#[\w一-鿿]+/g,
    /[\w.-]+@[\w.-]+\.\w+/g,
    /https?:\/\/[^\s]+/g,
  ];

  let count = 0;
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }

  const perThousand = (count / (content.length || 1)) * 1000;
  return Math.min(1, perThousand / 10);
}

/**
 * 计算 LLM 重要性信号
 * 由 LLM 抽取器返回，范围 [0, 1]
 */
function calcLlmImportance(chunk) {
  return chunk.llm_importance || 0;
}

/**
 * 加权合并
 */
function combineSignals(signals, weights) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(weights)) {
    if (signals[key] !== undefined) {
      totalWeight += weight;
      weightedSum += signals[key] * weight;
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * 计算 chunk 综合评分（7 信号 + 3 级门控）
 * @param {Object} chunk
 * @returns {{ total: number, signals: Object, gate: string, reason?: string }}
 */
export function scoreChunk(chunk) {
  const signals = {
    tokenCount: calcTokenSignal(chunk.token_count),
    uniqueWords: calcUniqueWords(chunk.content),
    metadataWeight: calcMetadataWeight(chunk.source),
    sourceWeight: calcSourceWeight(chunk.source, chunk.source_id),
    interaction: calcInteractionSignal(chunk.interaction_tags),
    entityDensity: calcEntityDensity(chunk.content, chunk._entityCount),
    llmImportance: calcLlmImportance(chunk),
  };

  // 使用 cheap weights（不含 llm_importance）计算初步分数
  const cheapWeights = { ...SCORE_WEIGHTS, llmImportance: 0.0 };
  let total = combineSignals(signals, cheapWeights);

  // Priority boost
  const tags = chunk.interaction_tags?.split(',').map(t => t.trim().toLowerCase()) || [];
  if (tags.includes('priority')) {
    total = Math.min(1, total + PRIORITY_BOOST);
  }

  // Tiny entity-free 过滤
  if (chunk.token_count < 10 && (!chunk._entityCount || chunk._entityCount === 0) && !tags.includes('priority')) {
    return { total: 0, signals, gate: 'drop', reason: 'tiny_entity_free' };
  }

  // 3 级门控
  let gate;
  if (total >= DEFINITE_KEEP) {
    gate = 'keep';
  } else if (total <= DEFINITE_DROP) {
    gate = 'drop';
  } else {
    gate = 'borderline';  // 需要 LLM 判定（Phase 3 实现）
  }

  return {
    total: Math.max(0, Math.min(1, total)),
    signals,
    gate,
  };
}
