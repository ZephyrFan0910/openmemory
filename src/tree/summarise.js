/**
 * OpenMemory - 摘要生成
 * 支持 LLM 摘要和规则摘要两种模式
 */

import { estimateTokenCount } from '../store/chunks.js';

/**
 * 摘要配置
 */
const SUMMARY_CONFIG = {
  maxInputTokens: 1000,   // 摘要输入的 token 上限
};

/**
 * 生成摘要（自动选择 LLM 或规则）
 * @param {Object[]} children - 子节点列表
 * @param {Object} options
 * @returns {Promise<string>} 摘要文本
 */
export async function summarise(children, options = {}) {
  if (!children || children.length === 0) return '';

  // 如果有 LLM API key，用 LLM 生成
  if (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) {
    try {
      return await llmSummarise(children, options);
    } catch (err) {
      console.warn('[summarise] LLM 摘要失败，降级到规则摘要:', err.message);
      return ruleBasedSummarise(children);
    }
  }

  // 否则用规则生成
  return ruleBasedSummarise(children);
}

/**
 * LLM 摘要
 */
async function llmSummarise(children, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  // 拼接子节点内容
  const combined = children.map(c => {
    const time = c.time_from || c.created_at || '';
    const content = c.content || c.title || '';
    return `[${time}] ${content}`;
  }).join('\n\n');

  // 截断到 token 上限
  const truncated = truncateToTokens(combined, SUMMARY_CONFIG.maxInputTokens);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是一个记忆摘要助手。请用简洁的中文总结以下内容，提取关键主题和要点。摘要应该在 100-200 字之间。',
        },
        {
          role: 'user',
          content: truncated,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API 错误: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 规则摘要（不依赖 LLM）
 */
export function ruleBasedSummarise(children) {
  if (!children || children.length === 0) return '';

  // 收集主题
  const allTopics = children.flatMap(c => c.topics || []);
  const topicCounts = {};
  for (const topic of allTopics) {
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  // 时间范围
  const times = children
    .map(c => c.time_from || c.created_at)
    .filter(Boolean)
    .sort();

  const timeRange = times.length > 0
    ? `${times[0].slice(0, 10)} ~ ${times[times.length - 1].slice(0, 10)}`
    : '未知时间';

  // 来源统计
  const sources = children
    .map(c => c.source || c.tree_kind)
    .filter(Boolean);
  const sourceCounts = {};
  for (const s of sources) {
    sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  }
  const sourceStr = Object.entries(sourceCounts)
    .map(([s, n]) => `${s}(${n})`)
    .join(', ');

  // 构建摘要
  const parts = [
    `## 摘要`,
    `时间: ${timeRange}`,
    `条目数: ${children.length}`,
  ];

  if (topTopics.length > 0) {
    parts.push(`主题: ${topTopics.join(', ')}`);
  }

  if (sourceStr) {
    parts.push(`来源: ${sourceStr}`);
  }

  // 取前 3 个子节点的标题作为概览
  const titles = children
    .slice(0, 3)
    .map(c => c.title || c.content?.slice(0, 50) || '')
    .filter(Boolean);

  if (titles.length > 0) {
    parts.push('', '### 主要内容');
    for (const title of titles) {
      parts.push(`- ${title}`);
    }
  }

  return parts.join('\n');
}

/**
 * 截断文本到指定 token 数
 */
function truncateToTokens(text, maxTokens) {
  if (!text) return '';

  // 粗略估算：中文 1 字 = 1 token，英文 1 词 = 1 token
  const estimatedTokens = estimateTokenCount(text);
  if (estimatedTokens <= maxTokens) return text;

  // 按比例截断
  const ratio = maxTokens / estimatedTokens;
  const targetLength = Math.floor(text.length * ratio * 0.9); // 留 10% 余量
  return text.slice(0, targetLength) + '\n\n[已截断]';
}
