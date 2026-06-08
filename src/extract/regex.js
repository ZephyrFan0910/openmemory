/**
 * OpenMemory - 正则抽取器
 * 抽取机械标识符：邮箱、URL、@handle、#hashtag
 */

const REGEX_PATTERNS = {
  email: /[\w.-]+@[\w.-]+\.\w+/g,
  url: /https?:\/\/[^\s<>"]+/g,
  handle: /@[\w一-鿿]+/g,
  hashtag: /#[\w一-鿿]+/g,
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
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      entities.push({ name: match[0], type });
    }
  }

  return entities;
}
