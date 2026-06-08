#!/usr/bin/env node

/**
 * OpenMemory - CLI 命令行工具
 * 本地记忆树系统
 */

import { Command } from 'commander';
import { getDb, closeDb } from './store/db.js';
import { getChunkStats, searchChunks, getAllChunks } from './store/chunks.js';
import { getTreeStats, getRootNodes, getTreeNode, getChildNodes } from './store/trees.js';
import { getEntityStats, getTopEntities } from './store/entities.js';
import { runCollector } from './collectors/index.js';
import { ingest } from './memory/ingest.js';
import { buildTree } from './tree/build.js';
import { scoreChunk } from './tree/score.js';
import { extractEntities } from './extract/composite.js';
import { insertEntity, indexEntityForChunk } from './store/entities.js';
import { updateChunkScore } from './store/chunks.js';
import fs from 'fs';
import path from 'path';

// 导入采集器（触发注册）
import './collectors/files.js';
import './collectors/browser.js';
import './collectors/session.js';
import './collectors/wechat.js';
import './collectors/video.js';

const program = new Command();

program
  .name('openmemory')
  .description([
    '',
    '  OpenMemory - 本地记忆树系统',
    '  将你的数据（浏览器历史、聊天记录、文档等）转化为可搜索的记忆树',
    '',
  ].join('\n'))
  .version('0.1.0');

// ==================== import 命令 ====================
const importCmd = program
  .command('import')
  .description('导入数据并构建记忆树');

/**
 * 通用的导入后处理：评分 + 实体抽取 + 构建树
 */
async function postImport(db, result, options) {
  if (!options.ingest || result.entries.length === 0) return;

  console.log('\n📝 评分中...');
  let scored = 0, entities = 0;

  for (const entry of result.entries) {
    // 评分
    const scoreResult = scoreChunk(entry);
    updateChunkScore(db, entry.id, scoreResult.total, 'scored');
    scored++;

    // 实体抽取
    const { entities: ents } = extractEntities(entry.content);
    for (const entity of ents) {
      const dbEntity = insertEntity(db, {
        name: entity.name,
        type: entity.type,
        sourceChunkId: entry.id,
      });
      if (dbEntity) {
        indexEntityForChunk(db, dbEntity.id, entry.id);
        entities++;
      }
    }
  }

  console.log(`   评分 ${scored} 条，抽取 ${entities} 个实体`);

  console.log('\n🌳 构建记忆树...');
  const treeResult = await buildTree(db);
  console.log(`   ${treeResult.nodesCreated} 个节点，${treeResult.levels} 层`);
}

importCmd
  .command('files <paths...>')
  .description('导入本地文档\n\n  支持格式: .md .txt\n  示例: openmemory import files ~/Documents ~/notes')
  .option('--no-ingest', '只导入，不评分/构建树')
  .action(async (paths, options) => {
    const db = getDb();
    try {
      const result = await runCollector(db, 'files', { paths });
      console.log(`\n✅ 导入完成: ${result.inserted} 条新数据, ${result.skipped} 条跳过`);
      await postImport(db, result, options);
    } catch (err) {
      console.error('\n❌ 导入失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

importCmd
  .command('browser')
  .description('导入浏览器历史记录\n\n  默认导入 Chrome 和 Edge\n  示例: openmemory import browser -b chrome edge -s 2026-01-01')
  .option('-b, --browsers <browsers...>', '浏览器 (chrome/edge/firefox)', ['chrome', 'edge'])
  .option('-s, --since <date>', '只导入此日期之后的记录 (YYYY-MM-DD)')
  .option('--no-ingest', '只导入，不评分/构建树')
  .action(async (options) => {
    const db = getDb();
    try {
      const result = await runCollector(db, 'browser', {
        browsers: options.browsers,
        since: options.since,
      });
      console.log(`\n✅ 导入完成: ${result.inserted} 条新数据, ${result.skipped} 条跳过`);
      await postImport(db, result, options);
    } catch (err) {
      console.error('\n❌ 导入失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

importCmd
  .command('session [paths...]')
  .description('导入 Agent 会话日志\n\n  支持格式: sess_*.jsonl\n  示例: openmemory import session ./data')
  .option('--no-ingest', '只导入，不评分/构建树')
  .action(async (paths, options) => {
    const db = getDb();
    try {
      const result = await runCollector(db, 'session', { paths: paths || [] });
      console.log(`\n✅ 导入完成: ${result.inserted} 条新数据, ${result.skipped} 条跳过`);
      await postImport(db, result, options);
    } catch (err) {
      console.error('\n❌ 导入失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

importCmd
  .command('wechat <paths...>')
  .description('导入微信聊天记录\n\n  支持格式: .txt .html\n  示例: openmemory import wechat ~/exports/wechat.txt')
  .option('--no-ingest', '只导入，不评分/构建树')
  .action(async (paths, options) => {
    const db = getDb();
    try {
      const result = await runCollector(db, 'wechat', { paths });
      console.log(`\n✅ 导入完成: ${result.inserted} 条新数据, ${result.skipped} 条跳过`);
      await postImport(db, result, options);
    } catch (err) {
      console.error('\n❌ 导入失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

importCmd
  .command('video <paths...>')
  .description('导入视频平台观看历史\n\n  支持格式: .csv .html\n  示例: openmemory import video ~/exports/bilibili.csv -p bilibili')
  .option('-p, --platform <platform>', '平台 (bilibili/douyin/auto)', 'auto')
  .option('--no-ingest', '只导入，不评分/构建树')
  .action(async (paths, options) => {
    const db = getDb();
    try {
      const result = await runCollector(db, 'video', { paths, platform: options.platform });
      console.log(`\n✅ 导入完成: ${result.inserted} 条新数据, ${result.skipped} 条跳过`);
      await postImport(db, result, options);
    } catch (err) {
      console.error('\n❌ 导入失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

// ==================== search 命令 ====================
program
  .command('search <query>')
  .description('搜索记忆\n\n  示例: openmemory search "项目架构" -l 5')
  .option('-l, --limit <n>', '返回条数', '10')
  .option('-s, --source <source>', '按来源过滤 (wechat/browser/video/session/file)')
  .action(async (query, options) => {
    const db = getDb();
    try {
      let results = searchChunks(db, query, { limit: parseInt(options.limit) * 2 });

      if (options.source) {
        results = results.filter(r => r.source === options.source);
      }

      results = results.slice(0, parseInt(options.limit));

      if (results.length === 0) {
        console.log('未找到匹配的记忆');
        return;
      }

      console.log(`找到 ${results.length} 条记忆:\n`);
      for (const chunk of results) {
        const score = chunk.score?.toFixed(2) || 'N/A';
        const preview = (chunk.content || '').replace(/\n/g, ' ').slice(0, 80);
        console.log(`  📌 ${chunk.title || '未命名'}  [${score}]`);
        console.log(`     ${chunk.source} | ${preview}...`);
        console.log('');
      }
    } catch (err) {
      console.error('❌ 搜索失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

// ==================== tree 命令 ====================
program
  .command('tree')
  .description('查看记忆树')
  .option('-k, --kind <kind>', '树类型 (source/global/topic)', 'global')
  .option('-l, --level <level>', '最大显示层级 (不含叶子节点)', '2')
  .option('--leaves', '显示叶子节点')
  .option('--build', '清空并重新构建树')
  .action(async (options) => {
    const db = getDb();
    try {
      if (options.build) {
        console.log('🌳 清空旧树并重新构建...\n');
        db.prepare('DELETE FROM tree_nodes').run();
        const treeResult = await buildTree(db, { treeKind: 'global' });
        console.log(`✅ 构建完成: ${treeResult.nodesCreated} 个节点, ${treeResult.levels} 层\n`);
      }

      const roots = getRootNodes(db, options.kind);
      if (roots.length === 0) {
        console.log('记忆树为空。使用 --build 构建，或先导入数据:');
        console.log('  openmemory import browser');
        console.log('  openmemory import files ~/Documents');
        return;
      }

      console.log(`🌳 记忆树 (${options.kind})\n`);
      const maxLevel = parseInt(options.level);
      for (const root of roots) {
        printTree(db, root.id, 0, maxLevel, options.leaves);
      }
    } catch (err) {
      console.error('❌ 获取树失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

/**
 * 打印树结构
 */
function printTree(db, nodeId, depth, maxLevel, showLeaves = false) {
  const node = getTreeNode(db, nodeId);
  if (!node) return;

  // 叶子节点默认不显示
  if (node.level === 0 && !showLeaves) return;

  const indent = '  '.repeat(depth);
  const icons = ['🌲', '🌿', '🍃', '🌱', '🌾'];
  const icon = icons[Math.min(depth, icons.length - 1)];
  const levelTag = `L${node.level}`;
  const score = node.score ? ` ${node.score.toFixed(2)}` : '';

  // 摘要内容（取第一行，截断）
  let summary = '';
  if (node.content) {
    summary = node.content.split('\n').find(l => l.trim() && !l.startsWith('#')) || '';
    summary = summary.slice(0, 60);
  } else if (node.chunk_id) {
    const chunk = db.prepare('SELECT title FROM chunks WHERE id = ?').get(node.chunk_id);
    summary = chunk?.title || `[${node.chunk_id.slice(0, 8)}]`;
  }

  console.log(`${indent}${icon} [${levelTag}${score}] ${summary}`);

  // 递归子节点
  if (depth < maxLevel || showLeaves) {
    const children = getChildNodes(db, nodeId);
    // 按分数排序，只显示前 20 个
    const sorted = children.sort((a, b) => (b.score || 0) - (a.score || 0));
    const toShow = showLeaves ? sorted : sorted.slice(0, 20);

    for (const child of toShow) {
      printTree(db, child.id, depth + 1, maxLevel, showLeaves);
    }

    if (!showLeaves && sorted.length > 20) {
      const indent2 = '  '.repeat(depth + 1);
      console.log(`${indent2}... 还有 ${sorted.length - 20} 个节点`);
    }
  }
}

// ==================== stats 命令 ====================
program
  .command('stats')
  .description('查看统计信息')
  .action(async () => {
    const db = getDb();
    try {
      const chunkStats = getChunkStats(db);
      const treeStats = getTreeStats(db);
      const entityStats = getEntityStats(db);

      console.log('📊 OpenMemory 统计\n');

      console.log(`  Chunks:     ${chunkStats.total} 条  (平均分 ${chunkStats.avgScore.toFixed(2)})`);
      for (const [src, count] of Object.entries(chunkStats.bySource)) {
        console.log(`    ${src}: ${count}`);
      }

      console.log(`\n  Tree Nodes: ${treeStats.total} 个`);
      for (const [level, count] of Object.entries(treeStats.byLevel)) {
        const label = level === '0' ? '叶子' : `L${level}`;
        console.log(`    ${label}: ${count}`);
      }

      console.log(`\n  Entities:   ${entityStats.total} 个`);
      for (const [type, count] of Object.entries(entityStats.byType)) {
        console.log(`    ${type}: ${count}`);
      }

      const topEntities = getTopEntities(db, { limit: 5 });
      if (topEntities.length > 0) {
        console.log('\n  热门实体:');
        for (const e of topEntities) {
          console.log(`    ${e.name} (${e.type}) ×${e.chunk_count}`);
        }
      }
    } catch (err) {
      console.error('❌ 获取统计失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

// ==================== serve 命令 ====================
program
  .command('serve')
  .description('启动 MCP Server (供 AI Agent 调用)')
  .action(async () => {
    const { OpenMemoryServer } = await import('./server.js');
    const server = new OpenMemoryServer();
    await server.startStdio();
  });

// ==================== reset 命令 ====================
program
  .command('reset')
  .description('清空所有数据（chunks + tree + entities）')
  .option('-y, --yes', '跳过确认')
  .action(async (options) => {
    if (!options.yes) {
      console.log('⚠️  这将清空所有数据。使用 -y 确认。');
      return;
    }

    const db = getDb();
    try {
      db.prepare('DELETE FROM entity_index').run();
      db.prepare('DELETE FROM entities').run();
      db.prepare('DELETE FROM scores').run();
      db.prepare('DELETE FROM tree_nodes').run();
      db.prepare('DELETE FROM chunks').run();
      // 重建 FTS 索引
      db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");

      // 清空 vault
      const vaultPath = path.join(process.cwd(), 'data', 'vault');
      if (fs.existsSync(vaultPath)) {
        fs.rmSync(vaultPath, { recursive: true, force: true });
      }

      console.log('✅ 所有数据已清空');
    } catch (err) {
      console.error('❌ 重置失败:', err.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  });

// ==================== vault 命令 ====================
program
  .command('vault')
  .description('查看 vault 文件列表')
  .option('-l, --limit <n>', '显示条数', '20')
  .action(async (options) => {
    const vaultPath = path.join(process.cwd(), 'data', 'vault');
    if (!fs.existsSync(vaultPath)) {
      console.log('vault 目录不存在，请先导入数据');
      return;
    }

    const files = [];
    function scanDir(dir, prefix = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          scanDir(fullPath, relPath);
        } else if (entry.name.endsWith('.md')) {
          const stat = fs.statSync(fullPath);
          files.push({ path: relPath, size: stat.size });
        }
      }
    }

    scanDir(vaultPath);

    const limit = parseInt(options.limit);
    const toShow = files.slice(0, limit);

    console.log(`📁 Vault 文件 (${files.length} 个 .md 文件)\n`);
    for (const f of toShow) {
      const sizeStr = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
      console.log(`  ${f.path}  (${sizeStr})`);
    }

    if (files.length > limit) {
      console.log(`\n  ... 还有 ${files.length - limit} 个文件`);
    }
  });

program.parse();
