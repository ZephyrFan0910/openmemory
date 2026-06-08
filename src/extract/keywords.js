/**
 * OpenMemory - 关键词抽取器（TF-IDF 简化版）
 * 从文本中抽取关键词作为 topic 类型实体
 */

// 中文停用词（高频无意义词）
const CN_STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '怎么', '如何', '可以',
  '把', '被', '让', '给', '从', '向', '对', '以', '所以', '因为', '但是', '但', '而',
  '如果', '虽然', '或', '或者', '还', '又', '再', '已', '已经', '曾', '曾经',
  '这个', '那个', '这些', '那些', '这里', '那里', '哪', '哪里', '哪些',
]);

// 英文停用词
const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
  'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'him', 'his', 'she', 'her', 'they', 'them', 'their',
]);

/**
 * 简单分词
 * - 中文按 2-4 字 gram 切分
 * - 英文按空格分词
 */
function tokenize(text) {
  const tokens = [];

  // 提取英文单词
  const enWords = text.match(/[a-zA-Z]{2,}/g) || [];
  for (const word of enWords) {
    const lower = word.toLowerCase();
    if (!EN_STOPWORDS.has(lower) && lower.length >= 2) {
      tokens.push(lower);
    }
  }

  // 提取中文 2-gram
  const cnChars = text.match(/[一-鿿]+/g) || [];
  for (const segment of cnChars) {
    if (segment.length < 2) continue;
    // 2-gram
    for (let i = 0; i < segment.length - 1; i++) {
      const gram = segment.slice(i, i + 2);
      if (!CN_STOPWORDS.has(gram)) {
        tokens.push(gram);
      }
    }
    // 3-gram
    if (segment.length >= 3) {
      for (let i = 0; i < segment.length - 2; i++) {
        const gram = segment.slice(i, i + 3);
        if (!CN_STOPWORDS.has(gram)) {
          tokens.push(gram);
        }
      }
    }
  }

  return tokens;
}

/**
 * 计算词频 (TF)
 */
function calcTF(tokens) {
  const tf = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  // 归一化
  const max = Math.max(...Object.values(tf), 1);
  for (const key in tf) {
    tf[key] = tf[key] / max;
  }
  return tf;
}

/**
 * 抽取关键词
 * @param {string} text
 * @param {number} topN - 返回前 N 个关键词
 * @returns {Array<{ name: string, type: 'topic', score: number }>}
 */
export function extractKeywords(text, topN = 10) {
  if (!text || text.length < 10) return [];

  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const tf = calcTF(tokens);

  // 按 TF 排序取 top N
  const sorted = Object.entries(tf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return sorted.map(([name, score]) => ({
    name,
    type: 'topic',
    score: Math.round(score * 100) / 100,
  }));
}
