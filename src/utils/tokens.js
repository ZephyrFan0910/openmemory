/**
 * OpenMemory - Token 预算工具
 * 移植自 OpenHuman 的 summarise.rs
 */

/** 假设的模型上下文窗口 */
export const NUM_CTX_TOKENS = 60_000;

/** 系统提示 + 漂移的预留空间 */
export const OVERHEAD_RESERVE = 2_048;

/** 摘要输出的最大 token 数 */
export const MAX_OUTPUT_TOKENS = 5_000;

/**
 * 计算每个输入的 token 上限
 * @param {number} numInputs - 输入条目数
 * @param {number} totalBudget - 总预算
 * @returns {number} 每个输入的最大 token 数
 */
export function computePerInputCap(numInputs, totalBudget = NUM_CTX_TOKENS) {
  if (numInputs <= 0) return totalBudget;
  return Math.floor((totalBudget - OVERHEAD_RESERVE) / numInputs);
}

/**
 * 截断文本到指定 token 数（粗略估算：1 token ≈ 4 字符）
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
export function truncateToTokens(text, maxTokens) {
  if (!text) return '';
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[truncated]';
}

/**
 * 截断输出到预算
 */
export function clampOutput(text, maxTokens = MAX_OUTPUT_TOKENS) {
  return truncateToTokens(text, maxTokens);
}
