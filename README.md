# OpenMemory

本地记忆树系统 — 将你的数据（浏览器历史、聊天记录、文档等）转化为可搜索的记忆树。

移植自 [OpenHuman](https://github.com/openhuman) 的记忆树架构，数据入口从 OAuth 自动拉取改为用户手动导入。

## 功能

- **5 种数据源**：本地文档、浏览器历史、微信聊天、视频观看、Agent 会话
- **自动脱敏**：手机号/身份证/邮箱/密码/敏感 URL 自动过滤
- **评分系统**：5 信号加权评分，自动过滤低价值内容
- **记忆树**：多级摘要树，从叶子节点递归生成摘要
- **全文搜索**：SQLite FTS5 全文索引
- **实体抽取**：自动提取关键词、URL、@handle、#hashtag
- **Obsidian 兼容**：输出 .md 文件到 vault 目录，带 YAML frontmatter
- **MCP Server**：暴露 4 个 Tools 供 AI Agent 调用

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

启动后可通过 MCP 协议调用 4 个 Tools：

| Tool | 说明 |
|------|------|
| `search_memory` | 全文搜索记忆 |
| `get_memory_tree` | 获取记忆树摘要视图 |
| `drill_down` | 深入查看节点详情 |
| `add_memory` | 手动添加记忆 |

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
│   ├── score.js            # 评分系统（5 信号加权）
│   ├── build.js            # 批量构建树
│   └── summarise.js        # 摘要生成（LLM + 规则）
├── store/
│   ├── db.js               # SQLite 连接
│   ├── schema.js           # DDL 建表
│   ├── chunks.js           # chunks 表 CRUD
│   ├── trees.js            # tree_nodes 表 CRUD
│   ├── entities.js         # entities 表 CRUD
│   └── content.js          # vault .md 文件读写
├── extract/
│   ├── regex.js            # 正则抽取
│   ├── keywords.js         # 关键词抽取
│   └── composite.js        # 组合抽取器
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
    └── logger.js           # 日志工具
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

在 `src/tree/score.js` 中可调整评分权重：

```javascript
export const SCORE_WEIGHTS = {
  tokenCount: 0.15,      // token 数量
  uniqueWords: 0.15,     // 唯一词比例
  metadataWeight: 0.2,   // 元数据（标题/结构）
  sourceWeight: 0.2,     // 来源权重
  entityDensity: 0.3,    // 实体密度
};
```

在 `src/tree/build.js` 中可调整树构建参数：

```javascript
const BUILD_CONFIG = {
  summaryFanout: 10,   // 每层最多子节点数
  maxTreeDepth: 10,     // 最大树深度
};
```

## LLM 摘要

设置环境变量启用 LLM 摘要（否则使用规则摘要）：

```bash
export OPENAI_API_KEY=sk-...
# 或
export LLM_API_KEY=sk-...
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL=gpt-4o-mini
```

## License

MIT
