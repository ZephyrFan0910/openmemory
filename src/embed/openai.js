/**
 * OpenMemory - OpenAI 兼容嵌入提供者
 * 支持 OpenAI、Voyage、本地兼容 API
 */

/**
 * 使用 OpenAI 兼容 API 生成嵌入
 * @param {string} text - 输入文本
 * @param {Object} options
 * @returns {Promise<Float32Array>}
 */
export async function embed(text, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || process.env.EMBEDDING_API_KEY;
  if (!apiKey) throw new Error('No API key configured');

  const baseUrl = options.baseUrl || process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = options.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text.slice(0, 8000), // 截断防超长
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Embedding API error: ${response.status} ${errText.slice(0, 100)}`);
  }

  const data = await response.json();
  const values = data.data?.[0]?.embedding;

  if (!values || !Array.isArray(values)) {
    throw new Error('Embedding API returned invalid response');
  }

  return new Float32Array(values);
}
