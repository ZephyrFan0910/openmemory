/**
 * OpenMemory - 摄入管线
 * 规范化 → 切块 → 评分 → 持久化 → 入树
 */

import crypto from 'crypto';
import { insertChunks, updateChunkScore, updateChunkLifecycle, estimateTokenCount } from '../store/chunks.js';
import { insertEntity, indexEntityForChunk } from '../store/entities.js';
import { scoreChunk, DROP_THRESHOLD, DEFINITE_KEEP } from '../tree/score.js';
import { extractEntities } from '../extract/composite.js';
import { desensitizeText } from '../desensitize/index.js';
import { writeChunkToVault } from '../store/content.js';

/**
 * 摄入配置
 */
const INGEST_CONFIG = {
  maxChunkTokens: 3000,    // 每个 chunk 最大 token 数
  dropThreshold: DROP_THRESHOLD,  // 低于此分数丢弃
};

/**
 * 完整的摄入流程
 * @param {import('better-sqlite3').Database} db
 * @param {Object[]} entries - 规范化后的条目列表（已脱敏）
 * @returns {Object} 摄入结果
 */
export async function ingest(db, entries) {
  const results = {
    total: entries.length,
    chunked: 0,
    scored: 0,
    kept: 0,
    dropped: 0,
    entities: 0,
    chunks: [],
  };

  for (const entry of entries) {
    // 1. 切块
    const chunks = chunkText(entry);

    // 2. 评分 + 实体抽取
    for (const chunk of chunks) {
      // 实体抽取
      const { entities, topics } = await extractEntities(chunk.content);
      chunk.entities = entities;
      chunk.topics = topics;
      chunk._entityCount = entities.length;

      // 评分（使用 3 级门控）
      const scoreResult = scoreChunk(chunk);
      chunk.score = scoreResult.total;
      chunk.scoreSignals = scoreResult.signals;
      chunk.gate = scoreResult.gate;

      results.scored++;
    }

    // 3. 过滤：使用 gate 决定保留/丢弃
    const kept = chunks.filter(c => c.gate === 'keep' || c.gate === 'borderline');
    const dropped = chunks.filter(c => c.gate === 'drop');

    results.kept += kept.length;
    results.dropped += dropped.length;
    results.chunked += chunks.length;

    // 4. 持久化
    if (kept.length > 0) {
      const dbChunks = kept.map(c => ({
        source: c.source,
        sourceId: c.sourceId,
        title: c.title,
        content: c.content,
        score: c.score,
        lifecycle: 'scored',
      }));

      const inserted = insertChunks(db, dbChunks);

      // 5. 索引实体
      for (let i = 0; i < inserted.length; i++) {
        const dbChunk = inserted[i];
        const origChunk = kept[i];

        if (origChunk.entities && origChunk.entities.length > 0) {
          for (const entity of origChunk.entities) {
            // 插入实体
            const dbEntity = insertEntity(db, {
              name: entity.name,
              type: entity.type,
              sourceChunkId: dbChunk.id,
              canonicalId: entity.canonical_id,
            });

            // 建立索引
            if (dbEntity) {
              indexEntityForChunk(db, dbEntity.id, dbChunk.id);
              results.entities++;
            }
          }
        }

        // 写入 vault
        writeChunkToVault(dbChunk);

        results.chunks.push(dbChunk);
      }
    }
  }

  return results;
}

/**
 * 将文本切分为 chunks
 * 按段落切分，每个 chunk 不超过 maxChunkTokens
 */
function chunkText(entry) {
  const { title, content, source, sourceId, createdAt } = entry;
  const maxTokens = INGEST_CONFIG.maxChunkTokens;

  if (!content) return [];

  // 如果内容足够短，直接作为一个 chunk
  const totalTokens = estimateTokenCount(content);
  if (totalTokens <= maxTokens) {
    return [{
      title,
      content,
      source,
      sourceId,
      createdAt,
      token_count: totalTokens,
    }];
  }

  // 按段落切分
  const paragraphs = content.split(/\n{2,}/);
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokenCount(para);

    if (paraTokens > maxTokens) {
      // 单个段落超长，按句子切分
      if (currentChunk) {
        chunks.push(createChunk(title, currentChunk, source, sourceId, createdAt));
        currentChunk = '';
        currentTokens = 0;
      }

      const sentences = splitBySentence(para, maxTokens);
      for (const sentence of sentences) {
        chunks.push(createChunk(title, sentence, source, sourceId, createdAt));
      }
      continue;
    }

    if (currentTokens + paraTokens > maxTokens) {
      // 当前 chunk 已满，开始新的 chunk
      if (currentChunk) {
        chunks.push(createChunk(title, currentChunk, source, sourceId, createdAt));
      }
      currentChunk = para;
      currentTokens = paraTokens;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      currentTokens += paraTokens;
    }
  }

  // 最后一个 chunk
  if (currentChunk) {
    chunks.push(createChunk(title, currentChunk, source, sourceId, createdAt));
  }

  return chunks;
}

/**
 * 创建 chunk 对象
 */
function createChunk(title, content, source, sourceId, createdAt) {
  return {
    title,
    content: content.trim(),
    source,
    sourceId,
    createdAt,
    token_count: estimateTokenCount(content),
  };
}

/**
 * 按句子切分超长段落
 */
function splitBySentence(text, maxTokens) {
  // 按中文句号、英文句号、换行切分
  const sentences = text.split(/(?<=[。！？.!?])\s*/);
  const chunks = [];
  let current = '';
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentTokens = estimateTokenCount(sentence);

    if (currentTokens + sentTokens > maxTokens) {
      if (current) {
        chunks.push(current.trim());
      }
      current = sentence;
      currentTokens = sentTokens;
    } else {
      current = current ? current + ' ' + sentence : sentence;
      currentTokens += sentTokens;
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}
