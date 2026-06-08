/**
 * OpenMemory - 评分系统（7 信号加权）
 * 移植自 OpenHuman 的 score 模块
 */

/**
 * 评分权重配置
 */
export const SCORE_WEIGHTS = {
  tokenCount: 0.15,
  uniqueWords: 0.15,
  metadataWeight: 0.2,
  sourceWeight: 0.2,
  entityDensity: 0.3,
};

/**
 * 准入门槛
 */
export const DEFINITE_KEEP = 0.7;
export const DROP_THRESHOLD = 0.3;

/**
 * 计算 token 数量信号
 * 过短的 chunk 价值低，适中的最佳
 */
function calcTokenSignal(tokenCount) {
  if (!tokenCount || tokenCount <= 0) return 0;
  // 最佳范围：500-2000 tokens
  if (tokenCount < 50) return 0.1;
  if (tokenCount < 200) return 0.4;
  if (tokenCount < 500) return 0.7;
  if (tokenCount <= 2000) return 1.0;
  if (tokenCount <= 3000) return 0.8;
  return 0.5; // 过长
}

/**
 * 计算唯一词数量信号
 * 唯一词越多，信息密度越高
 */
function calcUniqueWords(content) {
  if (!content) return 0;
  // 分词
  const cnChars = content.match(/[一-鿿]/g) || [];
  const enWords = content.match(/[a-zA-Z]{2,}/g) || [];
  const allWords = [...cnChars, ...enWords.map(w => w.toLowerCase())];
  const unique = new Set(allWords);

  // 归一化：唯一词占比
  if (allWords.length === 0) return 0;
  const ratio = unique.size / allWords.length;
  return Math.min(1, ratio * 1.5); // 放大一点
}

/**
 * 计算元数据权重
 * 有标题、有结构的内容更有价值
 */
function calcMetadataWeight(title, content) {
  let score = 0;

  // 有标题
  if (title && title.length > 0) score += 0.3;

  // 有 Markdown 标题
  if (content && /^#{1,3}\s+/m.test(content)) score += 0.3;

  // 有列表结构
  if (content && /^[-*]\s+/m.test(content)) score += 0.2;

  // 有链接
  if (content && /\[.+?\]\(.+?\)/.test(content)) score += 0.1;

  // 有代码块
  if (content && /```/.test(content)) score += 0.1;

  return Math.min(1, score);
}

/**
 * 计算来源权重
 * 不同来源的默认可信度不同
 */
function calcSourceWeight(source) {
  const weights = {
    file: 1.0,      // 用户自己写的文档，最高
    session: 0.8,   // Agent 会话，较高
    wechat: 0.6,    // 聊天记录，中等
    browser: 0.4,   // 浏览历史，较低
    video: 0.3,     // 视频观看记录，最低
  };
  return weights[source] || 0.5;
}

/**
 * 计算实体密度信号
 * 实体越多，信息密度越高
 */
function calcEntityDensity(content) {
  if (!content) return 0;

  // 简化版：检测可能的实体模式
  const patterns = [
    /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/,  // 英文专有名词
    /@[\w]+/,                             // @handle
    /#[\w一-鿿]+/,                        // #hashtag
    /[\w.-]+@[\w.-]+\.\w+/,             // 邮箱
    /https?:\/\/[^\s]+/,                 // URL
  ];

  let entityCount = 0;
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) entityCount += matches.length;
  }

  // 归一化：每 1000 字的实体数
  const perThousand = (entityCount / (content.length || 1)) * 1000;
  return Math.min(1, perThousand / 10); // 10 个/千字 = 满分
}

/**
 * 计算 chunk 综合评分
 * @param {Object} chunk - { content, title, source, token_count, entities }
 * @returns {{ total: number, signals: Object }}
 */
export function scoreChunk(chunk) {
  const signals = {
    tokenCount: calcTokenSignal(chunk.token_count),
    uniqueWords: calcUniqueWords(chunk.content),
    metadataWeight: calcMetadataWeight(chunk.title, chunk.content),
    sourceWeight: calcSourceWeight(chunk.source),
    entityDensity: calcEntityDensity(chunk.content),
  };

  // 加权合并
  const total = Object.entries(signals)
    .reduce((sum, [k, v]) => sum + v * (SCORE_WEIGHTS[k] || 0), 0);

  return {
    total: Math.max(0, Math.min(1, total)),
    signals,
  };
}
