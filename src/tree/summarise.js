/**
 * OpenMemory - 摘要生成
 * 移植自 OpenHuman 的 summarise.rs
 *
 * 支持 LLM 摘要和确定性 fallback
 * 输入按分数降序排列（高优先级内容最不容易被截断）
 */

import { estimateTokenCount } from '../store/chunks.js';
import { computePerInputCap, truncateToTokens, clampOutput, MAX_OUTPUT_TOKENS } from '../utils/tokens.js';

/**
 * 生成摘要（自动选择 LLM 或 fallback）
 * @param {Object[]} children - 子节点列表
 * @param {Object} options
 * @returns {Promise<string>} 摘要文本
 */
export async function summarise(children, options = {}) {
  if (!children || children.length === 0) return '';

  // 按分数降序排列（高优先级内容最不容易被截断）
  const sorted = [...children].sort((a, b) => (b.score || 0) - (a.score || 0));

  // 如果有 LLM API key，用 LLM 生成
  if (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) {
    try {
      return await llmSummarise(sorted, options);
    } catch (err) {
      console.warn('[summarise] LLM 失败，使用 fallback:', err.message);
      return fallbackSummary(sorted);
    }
  }

  // 否则用 fallback
  return fallbackSummary(sorted);
}

/**
 * LLM 摘要（对齐 OpenHuman 的提示词）
 */
async function llmSummarise(children, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const outputLanguage = options.outputLanguage || process.env.OUTPUT_LANGUAGE;

  // 计算每个输入的 token 上限
  const perInputCap = computePerInputCap(children.length);

  // 准备输入（带 provenance 前缀）
  const inputs = children.map(c => {
    const content = c.content || c.title || '';
    const truncated = truncateToTokens(content, perInputCap);
    const source = c.source || c.tree_kind || '';
    const time = c.time_from || c.created_at || '';
    return `[${source}|${time}] ${truncated}`;
  });

  const userContent = inputs.join('\n\n');

  // 系统提示（对齐 OpenHuman）
  const langLine = outputLanguage ? ` Output in ${outputLanguage}.` : '';
  const systemPrompt = `You are folding multiple notes into one compact summary.
Aim for ~${MAX_OUTPUT_TOKENS} tokens or fewer. Capture key facts, decisions, and entities.
Output only the summary prose -- no preamble, no JSON, no markdown headings.${langLine}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // 截断输出到预算
  return clampOutput(content);
}

/**
 * 确定性 fallback 摘要（永不失败）
 * 移植自 OpenHuman 的 fallback_summary()
 */
export function fallbackSummary(children) {
  if (!children || children.length === 0) return '';

  const parts = children.slice(0, 10).map(c => {
    const source = c.source || c.tree_kind || '';
    const time = c.time_from || c.created_at || '';
    const content = c.content || c.title || '';
    const preview = content.slice(0, 200).replace(/\n/g, ' ');
    return `-- [${source}|${time}] ${preview}`;
  });

  return parts.join('\n\n');
}
