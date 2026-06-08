/**
 * OpenMemory - Ollama 嵌入提供者
 * 支持 bge-m3 (1024-dim) 等本地模型
 */

/**
 * 使用 Ollama 生成嵌入
 * @param {string} text - 输入文本
 * @param {Object} options
 * @returns {Promise<Float32Array>}
 */
export async function embed(text, options = {}) {
  const url = options.url || process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = options.model || process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

  const response = await fetch(`${url}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.embedding || !Array.isArray(data.embedding)) {
    throw new Error('Ollama returned invalid embedding');
  }

  return new Float32Array(data.embedding);
}

/**
 * 检测 Ollama 是否可用
 */
export async function isAvailable() {
  const url = process.env.OLLAMA_URL || 'http://localhost:11434';
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}
