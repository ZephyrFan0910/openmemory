/**
 * OpenMemory - 入口文件
 * 导出所有模块供外部使用
 */

// 数据库层
export { getDb, closeDb, runInTransaction } from './store/db.js';
export { insertChunk, insertChunks, getChunk, getChunksBySource, getAllChunks, updateChunkScore, updateChunkLifecycle, deleteChunk, searchChunks, getChunkStats } from './store/chunks.js';
export { insertTreeNode, getTreeNode, getTreeNodesByLevel, getChildNodes, getRootNodes, linkChildren, updateNodeContent, getTreeStats, getTreeStructure, createTree, getTreeById, ensureTree } from './store/trees.js';
export { insertEntity, insertEntities, getEntitiesForChunk, getChunksForEntity, searchEntities, getTopEntities, getEntityStats } from './store/entities.js';
export { writeVaultFile, readVaultFile, listVaultFiles, writeChunkToVault, writeTreeNodeToVault } from './store/content.js';
export { getBuffer, appendToBuffer, clearBuffer, getStaleBuffers } from './store/buffers.js';

// 树机制
export { scoreChunk, SCORE_WEIGHTS, DEFINITE_KEEP, DEFINITE_DROP, DROP_THRESHOLD } from './tree/score.js';
export { buildTree, ingestIntoTree, flushStaleBuffers } from './tree/build.js';
export { summarise, fallbackSummary } from './tree/summarise.js';
export { sealBuffer, sealAllPending } from './tree/seal.js';
export { shouldSeal, INPUT_TOKEN_BUDGET, SUMMARY_FANOUT } from './tree/buffer.js';

// 摄入管线
export { ingest } from './memory/ingest.js';

// 脱敏模块
export { desensitizeText, desensitizeEntry, desensitizeEntries } from './desensitize/index.js';

// 实体抽取
export { extractEntities } from './extract/composite.js';
export { canonicalIdFor, EntityKind } from './extract/canonical.js';

// 嵌入
export { embedText, packEmbedding, unpackEmbedding, cosineSimilarity, hasEmbeddingSupport } from './embed/index.js';

// 检索
export { querySource, searchEntitiesFuzzy, drillDown, fetchLeaves } from './retrieval/query.js';
export { rerankByEmbedding } from './retrieval/rerank.js';

// 采集器
export { Collector, registerCollector, getCollector, getAllCollectors, runCollector } from './collectors/index.js';
