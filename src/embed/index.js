/**
 * OpenMemory - 嵌入层入口
 * 提供统一的 embed/pack/unpack API，自动检测可用的 provider
 */

import * as ollama from './ollama.js';
import * as openai from './openai.js';
import { cosineSimilarity } from './similarity.js';

// 重新导出
export { cosineSimilarity };

/**
 * 检测可用的嵌入 provider
 * @returns {Object|null} provider 或 null
 */
function detectProvider() {
  // 优先 Ollama（本地，免费）
  if (process.env.OLLAMA_URL || process.env.OLLAMA_EMBED_MODEL) {
    return ollama;
  }

  // 其次 OpenAI 兼容 API
  if (process.env.OPENAI_API_KEY || process.env.EMBEDDING_API_KEY) {
    return openai;
  }

  return null;
}

/**
 * 生成文本嵌入
 * @param {string} text - 输入文本
 * @param {Object} options - provider 选项
 * @returns {Promise<Buffer|null>} 嵌入向量的 Buffer，无 provider 时返回 null
 */
export async function embedText(text, options = {}) {
  const provider = options.provider || detectProvider();
  if (!provider) return null;

  try {
    // 截断到合理长度
    const truncated = text.slice(0, 2000);
    const vector = await provider.embed(truncated, options);
    return packEmbedding(vector);
  } catch (err) {
    console.warn('[embed] 嵌入失败:', err.message);
    return null;
  }
}

/**
 * Float32Array → Buffer (little-endian)
 */
export function packEmbedding(float32Array) {
  if (!float32Array || float32Array.length === 0) return null;
  return Buffer.from(float32Array.buffer, float32Array.byteOffset, float32Array.byteLength);
}

/**
 * Buffer → Float32Array
 */
export function unpackEmbedding(buffer) {
  if (!buffer || buffer.length === 0) return null;
  // 创建一个新的 ArrayBuffer 并复制数据
  const ab = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buffer.length; i++) {
    view[i] = buffer[i];
  }
  return new Float32Array(ab);
}

/**
 * 检查是否有可用的嵌入 provider
 */
export async function hasEmbeddingSupport() {
  const provider = detectProvider();
  if (!provider) return false;

  // 对 Ollama 做额外的可用性检查
  if (provider === ollama) {
    return await ollama.isAvailable();
  }

  return true;
}
