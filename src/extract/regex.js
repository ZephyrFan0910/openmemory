/**
 * OpenMemory - 正则抽取器
 * 移植自 OpenHuman 的 regex.rs
 *
 * 5 类基础模式 + 扩展模式
 */

const REGEX_PATTERNS = {
  // 基础模式（对齐 OpenHuman）
  email: /\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/gi,
  url: /https?:\/\/[^\s<>\]\[()]+[^\s<>\]\[()\.\,;:\!\?]/g,
  handle: /(?:^|[\s(])@([A-Za-z0-9_][A-Za-z0-9_.\-]{1,})/gm,
  hashtag: /(?:^|[\s(])#([A-Za-z][A-Za-z0-9_\-]{1,})/gm,

  // 扩展模式
  datetime: /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g,
};

/**
 * 用正则抽取实体
 * @param {string} text
 * @returns {Array<{ name: string, type: string }>}
 */
export function extractRegex(text) {
  if (!text) return [];

  const entities = [];

  for (const [type, pattern] of Object.entries(REGEX_PATTERNS)) {
    // 每次调用重置 lastIndex（因为 /g 标志）
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      // handle 和 hashtag 的捕获组在 match[1]
      const name = match[1] || match[0];
      if (name && name.length >= 2) {
        entities.push({ name: name.trim(), type });
      }
    }
  }

  return entities;
}
