/**
 * OpenMemory - LLM 实体抽取器
 * 移植自 OpenHuman 的 llm.rs
 *
 * 调用 LLM 提取命名实体 + 重要性评分
 * 支持 span recovery（验证实体存在于原文，防幻觉）
 */

import { EntityKind } from './canonical.js';

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  maxRetries: 3,
  emitTopics: false,
  outputLanguage: null,
};

/**
 * Kind 名称标准化（LLM 输出 → EntityKind）
 */
const KIND_NORMALIZE = {
  'person': EntityKind.Person,
  'people': EntityKind.Person,
  'organization': EntityKind.Organization,
  'org': EntityKind.Organization,
  'company': EntityKind.Organization,
  'location': EntityKind.Location,
  'place': EntityKind.Location,
  'event': EntityKind.Event,
  'product': EntityKind.Product,
  'datetime': EntityKind.DateTime,
  'date': EntityKind.DateTime,
  'time': EntityKind.DateTime,
  'technology': EntityKind.Technology,
  'tech': EntityKind.Technology,
  'tool': EntityKind.Technology,
  'framework': EntityKind.Technology,
  'library': EntityKind.Technology,
  'language': EntityKind.Technology,
  'service': EntityKind.Technology,
  'artifact': EntityKind.Artifact,
  'ref': EntityKind.Artifact,
  'pr': EntityKind.Artifact,
  'ticket': EntityKind.Artifact,
  'file': EntityKind.Artifact,
  'commit': EntityKind.Artifact,
  'quantity': EntityKind.Quantity,
  'topic': EntityKind.Topic,
};

/**
 * 构建系统提示
 */
function buildSystemPrompt(emitTopics, outputLanguage) {
  const langLine = outputLanguage ? `\nOutput in ${outputLanguage}.` : '';
  const topicsLine = emitTopics
    ? '\nAlso extract short theme labels as "topics".'
    : '';

  return `You are a named-entity extractor and importance rater.
Extract entities from the text below. Return ONLY valid JSON with this schema:
{
  "entities": [{"kind": "person|organization|location|event|product|datetime|technology|artifact|quantity", "text": "<exact surface form from text>"}],
  ${emitTopics ? '"topics": ["<short theme label>"],' : ''}
  "importance": 0.0,
  "importance_reason": "<one short sentence>"
}${topicsLine}${langLine}

Rules:
- "text" must be the EXACT substring from the input (case-preserved)
- "kind" must be one of the listed values
- "importance" is a float in [0.0, 1.0] rating how important this text is
- Extract ALL named entities, not just the most prominent ones
- Do NOT invent entities not present in the text`;
}

/**
 * 标准化 LLM 返回的 kind
 */
function normalizeKind(raw) {
  const lower = raw.toLowerCase().trim();
  return KIND_NORMALIZE[lower] || EntityKind.Topic;
}

/**
 * Span recovery：验证实体表面形式存在于原文
 * 防止 LLM 幻觉
 */
function recoverSpans(text, entities) {
  const recovered = [];
  const usedPositions = new Map(); // surface -> last found position

  for (const entity of entities) {
    const surface = entity.text;
    if (!surface || surface.length < 2) continue;

    const searchFrom = usedPositions.get(surface.toLowerCase()) || 0;
    const idx = text.toLowerCase().indexOf(surface.toLowerCase(), searchFrom);

    if (idx !== -1) {
      usedPositions.set(surface.toLowerCase(), idx + surface.length);
      recovered.push({
        ...entity,
        spanStart: idx,
        spanEnd: idx + surface.length,
      });
    }
    // 幻觉实体被丢弃
  }

  return recovered;
}

/**
 * 调用 LLM 抽取实体（带重试）
 * @param {string} text - 输入文本
 * @param {Object} options - 配置
 * @returns {{ entities: Array, topics: string[], importance: number }}
 */
export async function extractLlmEntities(text, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;

  if (!apiKey) {
    return { entities: [], topics: [], importance: 0 };
  }

  const baseUrl = config.baseUrl || process.env.LLM_BASE_URL || DEFAULT_CONFIG.baseUrl;
  const model = config.model || process.env.LLM_MODEL || DEFAULT_CONFIG.model;

  const systemPrompt = buildSystemPrompt(config.emitTopics, config.outputLanguage);
  const userContent = text.slice(0, 4000); // 截断防超长

  // 重试逻辑
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
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
          max_tokens: 500,
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`[llm-extract] API 错误 (${response.status}): ${errText.slice(0, 100)}`);
        if (response.status === 429) {
          // 速率限制，等待后重试
          await sleep(250 * Math.pow(2, attempt));
          continue;
        }
        return { entities: [], topics: [], importance: 0 };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        console.warn('[llm-extract] 空响应');
        continue;
      }

      // 解析 JSON
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        console.warn('[llm-extract] JSON 解析失败');
        return { entities: [], topics: [], importance: 0 };
      }

      // 标准化实体
      const rawEntities = (parsed.entities || []).map(e => ({
        name: e.text,
        type: normalizeKind(e.kind),
        importance: Math.max(0, Math.min(1, parseFloat(e.importance) || 0)),
      }));

      // Span recovery
      const entities = recoverSpans(text, rawEntities);

      return {
        entities: entities.map(e => ({ name: e.text, type: e.type })),
        topics: (parsed.topics || []).map(t => t.toLowerCase()),
        importance: Math.max(0, Math.min(1, parseFloat(parsed.importance) || 0)),
      };
    } catch (err) {
      if (attempt < config.maxRetries - 1) {
        await sleep(250 * Math.pow(2, attempt));
        continue;
      }
      console.warn('[llm-extract] 最终失败:', err.message);
      return { entities: [], topics: [], importance: 0 };
    }
  }

  return { entities: [], topics: [], importance: 0 };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
