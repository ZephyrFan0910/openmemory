# OpenMemory

本地记忆树系统 — 将你的数据（浏览器历史、聊天记录、文档等）转化为可搜索的记忆树。

移植自 [OpenHuman](https://github.com/openhuman) 的记忆树架构，数据入口从 OAuth 自动拉取改为用户手动导入。

## 功能

- **5 种数据源**：本地文档、浏览器历史、微信聊天、视频观看、Agent 会话
- **自动脱敏**：手机号/身份证/邮箱/密码/敏感 URL 自动过滤
- **7 信号评分**：token_count、unique_words、metadata、source、interaction、entity_density、llm_importance
- **3 级准入门控**：definite_keep (≥0.85) / borderline / definite_drop (≤0.15)
- **流式 Buffer+Seal**：增量式树构建，L0→L1→L2→... 自动级联密封
- **实体抽取**：正则 + 关键词 + LLM 三重抽取，canonical_id 规范化去重
- **向量嵌入**：支持 Ollama (bge-m3) 和 OpenAI 兼容 API，余弦相似度重排
- **记忆树**：多级摘要树，从叶子节点递归生成摘要
- **全文搜索**：SQLite FTS5 全文索引
- **语义重排**：基于嵌入向量的余弦相似度重排
- **Obsidian 兼容**：输出 .md 文件到 vault 目录，带 YAML frontmatter
- **MCP Server**：暴露 6 个 Tools 供 AI Agent 调用

## 安装

```bash
# 克隆项目
git clone <repo-url> openmemory
cd openmemory

# 安装依赖
npm install
```

## 快速开始

```bash
# 1. 导入浏览器历史
node src/cli.js import browser

# 2. 导入本地文档
node src/cli.js import files ~/Documents ~/notes

# 3. 查看记忆树
node src/cli.js tree

# 4. 搜索记忆
node src/cli.js search "关键词"

# 5. 查看统计
node src/cli.js stats
```

## CLI 命令

### 导入数据

```bash
# 导入本地文档 (md/txt)
openmemory import files <paths...>

# 导入浏览器历史 (Chrome/Edge/Firefox)
openmemory import browser [-b chrome edge] [-s 2026-01-01]

# 导入微信聊天记录 (txt/html)
openmemory import wechat <paths...>

# 导入视频观看历史 (csv/html)
openmemory import video <paths...> [-p bilibili]

# 导入 Agent 会话日志 (sess_*.jsonl)
openmemory import session [paths...]
```

所有导入命令默认会自动评分 + 构建树。加 `--no-ingest` 只导入不处理。

### 搜索

```bash
openmemory search "项目架构"           # 全文搜索
openmemory search "github" -l 5       # 限制返回 5 条
openmemory search "AI" -s browser     # 只搜浏览器历史
```

### 记忆树

```bash
openmemory tree                       # 查看全局摘要树
openmemory tree -l 1                  # 只显示 L1+ 层级
openmemory tree --leaves              # 显示叶子节点
openmemory tree --build               # 清空并重新构建树
```

### 其他

```bash
openmemory stats                      # 查看统计信息
openmemory vault                      # 列出 vault 文件
openmemory serve                      # 启动 MCP Server
openmemory reset -y                   # 清空所有数据
```

## MCP Server

启动后可通过 MCP 协议调用 6 个 Tools：

| Tool | 说明 |
|------|------|
| `search_memory` | 全文搜索记忆 |
| `get_memory_tree` | 获取记忆树摘要视图 |
| `drill_down` | 深入查看节点详情（支持 BFS + 语义重排） |
| `add_memory` | 手动添加记忆 |
| `query_source` | 按来源查询（支持时间窗口 + 语义重排） |
| `search_entities` | 模糊搜索实体（canonical_id + surface） |

```bash
# 启动
openmemory serve

# 测试
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node src/server.js
```

## 项目结构

```
src/
├── index.js                # 模块导出入口
├── cli.js                  # CLI 命令行
├── server.js               # MCP Server
├── memory/
│   └── ingest.js           # 摄入管线：切块 + 评分 + 持久化
├── tree/
│   ├── score.js            # 评分系统（7 信号 + 3 级门控）
│   ├── build.js            # 流式树构建（Buffer + Seal）
│   ├── buffer.js           # 缓冲区逻辑 + shouldSeal
│   ├── seal.js             # 密封逻辑 + 级联
│   └── summarise.js        # 摘要生成（LLM + fallback）
├── store/
│   ├── db.js               # SQLite 连接 + 迁移
│   ├── schema.js           # DDL 建表
│   ├── chunks.js           # chunks 表 CRUD
│   ├── trees.js            # tree_nodes + trees 表 CRUD
│   ├── buffers.js          # buffers 表 CRUD
│   ├── entities.js         # entities 表 CRUD
│   └── content.js          # vault .md 文件读写
├── extract/
│   ├── regex.js            # 正则抽取（5 类模式）
│   ├── keywords.js         # 关键词抽取
│   ├── canonical.js        # 实体规范化 ID
│   ├── llm.js              # LLM 实体抽取 + importance
│   └── composite.js        # 组合抽取器（async）
├── embed/
│   ├── index.js            # 嵌入层入口
│   ├── ollama.js           # Ollama provider
│   ├── openai.js           # OpenAI 兼容 provider
│   └── similarity.js       # 余弦相似度
├── retrieval/
│   ├── query.js            # 检索查询（querySource, drillDown）
│   └── rerank.js           # 语义重排
├── collectors/
│   ├── index.js            # 采集器基类
│   ├── files.js            # 本地文档
│   ├── browser.js          # 浏览器历史
│   ├── wechat.js           # 微信聊天
│   ├── video.js            # 视频平台
│   └── session.js          # Agent 会话
├── desensitize/
│   ├── patterns.js         # 脱敏规则
│   ├── filters.js          # URL 过滤
│   └── index.js            # 脱敏入口
└── utils/
    ├── logger.js           # 日志工具
    └── tokens.js           # Token 预算工具
```

## 数据模型

| 表 | 说明 |
|----|------|
| `chunks` | 数据块，记忆的最小单位 |
| `chunks_fts` | FTS5 全文搜索索引 |
| `tree_nodes` | 摘要树节点 |
| `entities` | 实体（人名/地名/项目名等） |
| `entity_index` | 实体倒排索引 |
| `scores` | 评分详情 |

## 配置

在 `src/tree/score.js` 中可调整评分权重（对齐 OpenHuman）：

```javascript
export const SCORE_WEIGHTS = {
  tokenCount: 1.0,
  uniqueWords: 1.0,
  metadataWeight: 1.5,
  sourceWeight: 1.5,
  interaction: 3.0,       // 最强信号
  entityDensity: 1.0,
  llmImportance: 0.0,     // 默认关闭，启用时为 2.0
};
```

在 `src/tree/buffer.js` 中可调整密封参数：

```javascript
export const INPUT_TOKEN_BUDGET = 50_000;   // L0 密封：token 门槛
export const SUMMARY_FANOUT = 10;            // L1+ 密封：兄弟节点数门槛
export const FLUSH_AGE_DAYS = 7;             // 时间冲洗：7 天
```

## LLM 摘要

设置环境变量启用 LLM 摘要（否则使用 fallback 摘要）：

```bash
export OPENAI_API_KEY=sk-...
# 或
export LLM_API_KEY=sk-...
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL=gpt-4o-mini
```

## 数据库路径

默认在项目根目录的 `data/memory.db`。可通过环境变量自定义：

```bash
export OPENMEMORY_DB=/path/to/custom/memory.db
```

## 向量嵌入

设置环境变量启用语义搜索和重排：

```bash
# Ollama（本地，推荐）
export OLLAMA_URL=http://localhost:11434
export OLLAMA_EMBED_MODEL=bge-m3

# 或 OpenAI 兼容 API
export EMBEDDING_API_KEY=sk-...
export EMBEDDING_BASE_URL=https://api.openai.com/v1
export EMBEDDING_MODEL=text-embedding-3-small
```

## License

MIT
