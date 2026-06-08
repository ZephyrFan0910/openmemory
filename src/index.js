/**
 * OpenMemory - 入口文件
 * 导出所有模块供外部使用
 */

// 数据库层
export { getDb, closeDb, runInTransaction } from './store/db.js';
export { insertChunk, insertChunks, getChunk, getChunksBySource, getAllChunks, updateChunkScore, updateChunkLifecycle, deleteChunk, searchChunks, getChunkStats } from './store/chunks.js';
export { insertTreeNode, getTreeNode, getTreeNodesByLevel, getChildNodes, getRootNodes, linkChildren, updateNodeContent, getTreeStats, getTreeStructure } from './store/trees.js';
export { insertEntity, insertEntities, getEntitiesForChunk, getChunksForEntity, searchEntities, getTopEntities, getEntityStats } from './store/entities.js';
export { writeVaultFile, readVaultFile, listVaultFiles, writeChunkToVault, writeTreeNodeToVault } from './store/content.js';

// 脱敏模块
export { desensitizeText, desensitizeEntry, desensitizeEntries } from './desensitize/index.js';

// 采集器
export { Collector, registerCollector, getCollector, getAllCollectors, runCollector } from './collectors/index.js';
