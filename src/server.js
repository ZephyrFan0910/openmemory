/**
 * OpenMemory - MCP Server
 * 暴露 4 个 Tools 给 AI Agent
 */

import { getDb, closeDb } from './store/db.js';
import { searchChunks, getAllChunks, getChunk } from './store/chunks.js';
import { getRootNodes, getTreeNode, getChildNodes, getTreeStructure } from './store/trees.js';
import { getEntitiesForChunk, searchEntities, getTopEntities } from './store/entities.js';

/**
 * MCP Server 实现
 * 使用 stdio 传输协议
 */
export class OpenMemoryServer {
  constructor() {
    this.db = getDb();
    this.tools = this.defineTools();
  }

  /**
   * 定义 MCP Tools
   */
  defineTools() {
    return {
      search_memory: {
        description: '搜索用户的个人记忆（全文搜索 + 实体过滤）',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            source: {
              type: 'string',
              enum: ['wechat', 'browser', 'video', 'session', 'file', 'all'],
              default: 'all',
              description: '按来源过滤',
            },
            limit: { type: 'integer', default: 10, description: '返回条数' },
          },
          required: ['query'],
        },
        handler: this.handleSearchMemory.bind(this),
      },

      get_memory_tree: {
        description: '获取记忆树的摘要视图（层级化的用户知识概览）',
        inputSchema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['source', 'global', 'topic'],
              default: 'global',
              description: '树类型',
            },
            max_level: { type: 'integer', default: 2, description: '最大显示层级' },
          },
        },
        handler: this.handleGetMemoryTree.bind(this),
      },

      drill_down: {
        description: '深入查看某个摘要节点的子节点详情',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'string', description: '节点 ID' },
          },
          required: ['node_id'],
        },
        handler: this.handleDrillDown.bind(this),
      },

      add_memory: {
        description: '手动添加一条记忆',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '标题' },
            content: { type: 'string', description: '内容' },
            tags: { type: 'string', description: '标签（逗号分隔）' },
          },
          required: ['content'],
        },
        handler: this.handleAddMemory.bind(this),
      },

      query_source: {
        description: '按来源查询记忆（支持时间窗口和语义重排）',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词（可选）' },
            source_kind: { type: 'string', enum: ['wechat', 'browser', 'video', 'session', 'file', 'all'], default: 'all', description: '来源类型' },
            time_window_days: { type: 'integer', description: '时间窗口（天）' },
            limit: { type: 'integer', default: 10, description: '返回条数' },
            rerank: { type: 'boolean', default: false, description: '是否启用语义重排' },
          },
        },
        handler: this.handleQuerySource.bind(this),
      },

      search_entities: {
        description: '模糊搜索实体（人名/地名/项目名等）',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            kinds: { type: 'array', items: { type: 'string' }, description: '实体类型过滤' },
            limit: { type: 'integer', default: 10, description: '返回条数' },
          },
          required: ['query'],
        },
        handler: this.handleSearchEntities.bind(this),
      },
    };
  }

  /**
   * 处理 search_memory 请求
   */
  async handleSearchMemory({ query, source = 'all', limit = 10 }) {
    const results = searchChunks(this.db, query, { limit: limit * 2 });

    let filtered = results;
    if (source !== 'all') {
      filtered = results.filter(r => r.source === source);
    }

    const items = filtered.slice(0, limit).map(chunk => ({
      id: chunk.id,
      title: chunk.title || '未命名',
      content: chunk.content?.slice(0, 200) + (chunk.content?.length > 200 ? '...' : ''),
      source: chunk.source,
      source_id: chunk.source_id,
      score: chunk.score,
      created_at: chunk.created_at,
      entities: getEntitiesForChunk(this.db, chunk.id).map(e => ({ name: e.name, type: e.type })),
    }));

    return {
      total: items.length,
      query,
      source,
      results: items,
    };
  }

  /**
   * 处理 get_memory_tree 请求
   */
  async handleGetMemoryTree({ kind = 'global', max_level = 2 }) {
    const roots = getRootNodes(this.db, kind);

    if (roots.length === 0) {
      return { kind, nodes: [], message: '记忆树为空，请先导入数据' };
    }

    const trees = roots.map(root => getTreeStructure(this.db, root.id, max_level));

    return {
      kind,
      trees: trees.map(tree => this.formatTreeNode(tree, 0, max_level)),
    };
  }

  /**
   * 格式化树节点（递归）
   */
  formatTreeNode(node, depth, maxDepth) {
    if (!node || depth > maxDepth) return null;

    const result = {
      id: node.id,
      level: node.level,
      score: node.score,
      time_from: node.time_from,
      time_to: node.time_to,
      summary: node.content?.slice(0, 150) + (node.content?.length > 150 ? '...' : ''),
    };

    if (node.children && node.children.length > 0 && depth < maxDepth) {
      result.children = node.children
        .map(child => this.formatTreeNode(child, depth + 1, maxDepth))
        .filter(Boolean);
    }

    return result;
  }

  /**
   * 处理 drill_down 请求
   */
  async handleDrillDown({ node_id, query, max_depth = 1, limit = 10, rerank = false }) {
    const { drillDown } = await import('./retrieval/query.js');
    return drillDown(this.db, {
      nodeId: node_id,
      query,
      maxDepth: max_depth,
      limit,
      rerank,
    });
  }

  /**
   * 处理 add_memory 请求
   */
  async handleAddMemory({ title, content, tags }) {
    const { insertChunk } = await import('./store/chunks.js');
    const { insertEntity, indexEntityForChunk } = await import('./store/entities.js');
    const { extractEntities } = await import('./extract/composite.js');
    const { desensitizeText } = await import('./desensitize/index.js');

    // 脱敏
    const { text: cleanContent } = desensitizeText(content);
    const { text: cleanTitle } = desensitizeText(title || '');

    // 插入 chunk
    const chunk = insertChunk(this.db, {
      source: 'manual',
      sourceId: `manual:${Date.now()}`,
      title: cleanTitle || '手动添加的记忆',
      content: cleanContent,
      score: 0.8,  // 手动添加的默认高分
      lifecycle: 'scored',
    });

    // 实体抽取
    const { entities } = await extractEntities(cleanContent);
    for (const entity of entities) {
      const dbEntity = insertEntity(this.db, {
        name: entity.name,
        type: entity.type,
        sourceChunkId: chunk.id,
      });
      if (dbEntity) {
        indexEntityForChunk(this.db, dbEntity.id, chunk.id);
      }
    }

    return {
      success: true,
      id: chunk.id,
      title: cleanTitle || '手动添加的记忆',
      entities_count: entities.length,
    };
  }

  /**
   * 处理 query_source 请求
   */
  async handleQuerySource({ query, source_kind = 'all', time_window_days, limit = 10, rerank = false }) {
    const { querySource } = await import('./retrieval/query.js');
    return querySource(this.db, {
      query,
      sourceKind: source_kind,
      timeWindowDays: time_window_days,
      limit,
      rerank,
    });
  }

  /**
   * 处理 search_entities 请求
   */
  async handleSearchEntities({ query, kinds, limit = 10 }) {
    const { searchEntitiesFuzzy } = await import('./retrieval/query.js');
    return searchEntitiesFuzzy(this.db, { query, kinds, limit });
  }

  /**
   * 处理 MCP 请求
   */
  async handleRequest(request) {
    const { method, params, id } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'openmemory',
              version: '0.1.0',
            },
          };
          break;

        case 'tools/list':
          result = {
            tools: Object.entries(this.tools).map(([name, tool]) => ({
              name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          };
          break;

        case 'tools/call':
          const { name, arguments: args } = params;
          const tool = this.tools[name];
          if (!tool) {
            throw new Error(`未知工具: ${name}`);
          }
          result = await tool.handler(args || {});
          break;

        default:
          throw new Error(`未知方法: ${method}`);
      }

      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message },
      };
    }
  }

  /**
   * 启动 stdio 服务器
   */
  async startStdio() {
    process.stdin.setEncoding('utf-8');

    let buffer = '';

    process.stdin.on('data', async (chunk) => {
      buffer += chunk;

      // 按行分割处理 JSON-RPC 消息
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';  // 保留不完整的行

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line);
          const response = await this.handleRequest(request);
          process.stdout.write(JSON.stringify(response) + '\n');
        } catch (err) {
          console.error('[MCP] 解析错误:', err.message);
        }
      }
    });

    process.stdin.on('end', () => {
      closeDb();
      process.exit(0);
    });

    // 优雅退出
    process.on('SIGINT', () => {
      closeDb();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      closeDb();
      process.exit(0);
    });

    console.error('[OpenMemory MCP Server] 已启动，等待连接...');
  }
}

// 如果直接运行此文件，启动服务器
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const server = new OpenMemoryServer();
  server.startStdio();
}
