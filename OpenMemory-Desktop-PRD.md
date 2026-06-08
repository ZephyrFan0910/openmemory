# OpenMemory — 项目规划文档

> **版本**: v0.4
> **日期**: 2026-06-04
> **基于**: OpenHuman 记忆树架构（Rust → Node.js 移植）
> **原则**: 复用 OpenHuman 记忆树引擎，数据入口从 OAuth 自动拉取改为用户手动导入

---

## 一、我们要做什么

把 OpenHuman 的记忆树系统**移植到本地 CLI 工具**。

### OpenHuman 做了什么（原版）

```
OAuth 授权 (118+ 服务) → 20 分钟自动拉取 → 规范化→切块→评分
→ Buffer + Seal 机制 → 多级摘要树 → LLM 摘要 → Obsidian vault
```

### 我们做什么（本地版）

```
用户手动导入 (5 种本地数据源) → 规范化→切块→评分
→ 批量构建树 → 多级摘要树 → LLM 摘要 → Obsidian vault + MCP Server
```

### 复用 / 砍掉 / 改造

| 模块 | 处理方式 | 说明 |
|------|---------|------|
| 多级摘要树结构 | ✅ 1:1 复用 | 树结构本身不变 |
| 评分系统 (7 信号) | ✅ 1:1 复用 | score 模块直接搬 |
| 实体抽取 (正则+LLM) | ✅ 1:1 复用 | extract 模块直接搬 |
| 摘要生成 | ✅ 1:1 复用 | summarise 模块直接搬 |
| 检索/遍历 | ✅ 1:1 复用 | retrieval 模块直接搬 |
| 摄入管线 | ✅ 复用，微调 | 规范化→切块→评分→持久化 不变 |
| 持久层 (SQLite) | ✅ 复用，微调 | schema 基本一致，砍掉 buffer 表 |
| Obsidian vault 输出 | ✅ 1:1 复用 | .md 文件生成不变 |
| Buffer + Seal 机制 | 🔄 **改造** | 流式密封 → 批量构建（见第六章） |
| OAuth 连接器 | ❌ **替换** | 118+ 远程连接器 → 5 个本地 collectors |
| 20 分钟定时器 | ❌ **替换** | 自动定时 → 用户手动 `openmemory import` |
| TokenJuice 压缩 | ❌ 砍掉 | 不做 token 压缩 |
| 模型路由 | ❌ 砍掉 | 不做多模型调度 |
| Composio / billing | ❌ 砍掉 | 不做 |

---

## 二、技术栈

| 用什么 | 干什么 | 为什么 |
|--------|--------|--------|
| **Node.js** | 整个后端 | 你已经会了 |
| **SQLite** (better-sqlite3) | 存储 chunks/trees/entities/scores | OpenHuman 也用 SQLite |
| **SQLite FTS5** | 全文搜索 | SQLite 自带 |
| **@modelcontextprotocol/sdk** | MCP Server | Agent 接入 |
| **Commander.js** | CLI | 命令行管理 |

**OpenHuman 用 Rust，我们用 Node.js 重写核心逻辑。** 数据结构和算法一样，语言不同。

---

## 三、目录结构

```
openmemory/
├── package.json
├── src/
│   ├── index.js                # 入口
│   ├── cli.js                  # CLI 命令
│   ├── server.js               # MCP Server
│   │
│   ├── memory/                 # 编排层（对应 OpenHuman 的 memory/）
│   │   ├── ingest.js           # 摄入管线：规范化→切块→评分→持久化
│   │   ├── query.js            # 查询编排：搜索、树遍历
│   │   └── remember.js         # 记忆分类：chat/file/note
│   │
│   ├── tree/                   # 树机制（对应 OpenHuman 的 memory_tree/）
│   │   ├── build.js            # 批量构建树（替代 OpenHuman 的 bucket_seal + flush）
│   │   ├── summarise.js        # 摘要：LLM 或规则生成上级摘要
│   │   ├── retrieval.js        # 检索：walk/drill_down/fetch_leaves
│   │   └── score.js            # 评分：7 信号加权评分
│   │
│   ├── store/                  # 持久层（对应 OpenHuman 的 memory_store/）
│   │   ├── db.js               # SQLite 连接 + 事务
│   │   ├── chunks.js           # chunk 表 CRUD
│   │   ├── trees.js            # tree 节点表 CRUD
│   │   ├── entities.js         # 实体表 + 倒排索引
│   │   ├── content.js          # 磁盘 .md 文件读写
│   │   └── schema.js           # 建表 DDL
│   │
│   ├── collectors/             # 数据采集器（本地）
│   │   ├── index.js            # 采集器注册 + 统一入口
│   │   ├── wechat.js           # 微信/QQ 聊天记录 (.bak/.txt/.html)
│   │   ├── browser.js          # Chrome/Edge/Firefox 历史记录 (SQLite)
│   │   ├── video.js            # 视频平台观看历史 (CSV/Excel/网页导出)
│   │   ├── session.js          # Agent 会话日志 (sess_*.jsonl)
│   │   └── files.js            # 本地文档 (md/txt)
│   │
│   ├── desensitize/            # 脱敏模块
│   │   ├── index.js            # 脱敏管线入口
│   │   ├── patterns.js         # 正则规则：手机号/身份证/地址/密码
│   │   └── filters.js          # URL 过滤：支付页/隐私页/登录页
│   │
│   └── extract/                # 实体抽取
│       ├── regex.js            # 正则抽取：邮箱/URL/@/#/
│       ├── keywords.js         # 关键词抽取（TF-IDF 简化版）
│       └── composite.js        # 组合抽取器
│
├── data/                       # 运行时自动创建
│   ├── memory.db               # SQLite 数据库
│   └── vault/                  # Obsidian 兼容的 .md 文件
└── README.md
```

---

## 四、数据模型（SQLite 表结构）

### 4.1 核心表

```sql
-- 数据块：记忆的最小单位（对应 OpenHuman 的 chunks）
CREATE TABLE chunks (
    id          TEXT PRIMARY KEY,        -- 内容哈希（去重用）
    source      TEXT NOT NULL,           -- 来源类型: 'wechat' / 'browser' / 'video' / 'session' / 'file'
    source_id   TEXT,                    -- 来源标识：文件路径 / URL / 聊天对象
    title       TEXT,                    -- 标题
    content     TEXT NOT NULL,           -- 原始 Markdown 内容
    token_count INTEGER,                 -- token 数量
    score       REAL DEFAULT 0.0,        -- 评分 0.0-1.0
    lifecycle   TEXT DEFAULT 'pending',  -- pending → scored → built → sealed → dropped
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- 全文搜索索引
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    title, content,
    content='chunks',
    content_rowid='rowid'
);

-- 树节点：摘要树的每个节点（对应 OpenHuman 的 tree nodes）
CREATE TABLE tree_nodes (
    id          TEXT PRIMARY KEY,
    tree_kind   TEXT NOT NULL,           -- 'source' / 'global' / 'topic'
    level       INTEGER NOT NULL,        -- 层级：0=叶子, 1+=摘要
    parent_id   TEXT,                    -- 父节点
    content     TEXT,                    -- 摘要文本（叶子节点为 NULL，内容在 chunks 表）
    summary_md  TEXT,                    -- 摘要的 .md 文件路径
    score       REAL,                    -- 该节点的最大分数
    time_from   TEXT,                    -- 子节点的最早时间
    time_to     TEXT,                    -- 子节点的最晚时间
    token_count INTEGER,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- 实体：抽取出来的人名/地名/项目名等
CREATE TABLE entities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    type        TEXT,                    -- 'person' / 'place' / 'project' / 'tool' / ...
    source_chunk_id TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(name, type, source_chunk_id)
);

-- 实体倒排索引：实体 → 出现在哪些 chunk 中
CREATE TABLE entity_index (
    entity_id   INTEGER NOT NULL,
    chunk_id    TEXT NOT NULL,
    PRIMARY KEY (entity_id, chunk_id),
    FOREIGN KEY (entity_id) REFERENCES entities(id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- 评分详情（对应 OpenHuman 的 score rationale）
CREATE TABLE scores (
    chunk_id        TEXT PRIMARY KEY,
    token_signal    REAL,
    unique_words    REAL,
    metadata_weight REAL,
    source_weight   REAL,
    entity_density  REAL,
    total           REAL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);
```

### 4.2 记忆树层级

```
Level 2: [全局摘要]                     ← 最抽象："用户最近关注 AI 记忆系统"
            ▲ 密封（SUMMARY_FANOUT 个子节点）
Level 1: [摘要A: 技术调研] [摘要B: 项目规划]  ← 中等抽象
            ▲ 密封（SUMMARY_FANOUT 个子节点）
Level 0: [chunk1][chunk2][chunk3]...    ← 原始数据块（≤3k tokens）
```

---

## 五、数据采集器设计

### 5.1 采集器总览

| 采集器 | 数据来源 | 文件格式 | 解析方案 |
|--------|---------|---------|---------|
| `wechat.js` | 微信/QQ PC 端导出备份 | .bak / .txt / .html | 自定义解析器，拆分会话、联系人、时间、消息类型 |
| `browser.js` | Chrome/Edge/Firefox 历史记录 | SQLite 数据库 | 直接读取浏览器本地 SQLite，提取 URL、标题、访问时间 |
| `video.js` | 抖音/B站/视频号观看历史 | CSV / Excel / 网页导出 | 解析导出文件，提取标题、UP主、观看时间、标签 |
| `session.js` | OpenClaw 等 Agent 的 session 日志 | sess_*.jsonl | JSONL 逐行解析，拆分问答、时间、主题 |
| `files.js` | 本地笔记/文档 | .md / .txt | 通用文本解析，按文件拆分段落 |

### 5.2 采集器接口

每个采集器实现统一接口：

```javascript
// collectors/index.js
class Collector {
  name;           // 'wechat' / 'browser' / 'video' / 'session' / 'file'
  sourceType;     // 对应 chunks.source 字段

  // 扫描数据源，返回原始条目列表
  async scan(config) {}

  // 将原始条目规范化为 Markdown
  normalize(rawEntry) {}

  // 返回该采集器需要的脱敏规则
  getDesensitizeRules() {}
}
```

### 5.3 各采集器详细设计

#### 5.3.1 微信聊天记录 (`wechat.js`)

```
数据来源：微信 PC 端 → 备份与恢复 → 导出聊天记录
文件格式：.bak（加密备份）/ .txt（文本导出）/ .html（网页导出）

解析流程：
  1. 检测文件格式（.bak 需先用第三方工具解密，MVP 只支持 .txt/.html）
  2. 按消息行正则拆分：
     - txt 格式：^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+联系人名\n消息内容
     - html 格式：<div class="chat_item">...</div>
  3. 按联系人 + 时间窗口分组为"会话"（30 分钟无消息 = 新会话）
  4. 每个会话 → 一个 chunk
  5. 消息类型识别：文本 / 图片([图片]) / 语音([语音]) / 文件([文件])

输出格式：
  title: "与 张三 的聊天 (2026-06-01)"
  content: "## 2026-06-01 14:30\n张三: 你好\n我: 你好啊\n..."
  source_id: "wechat:张三:2026-06-01"
```

#### 5.3.2 浏览器历史 (`browser.js`)

```
数据来源：浏览器本地 SQLite 数据库
  - Chrome:  %LOCALAPPDATA%/Google/Chrome/User Data/Default/History
  - Edge:    %LOCALAPPDATA%/Microsoft/Edge/User Data/Default/History
  - Firefox: %APPDATA%/Mozilla/Firefox/Profiles/*/places.sqlite

解析流程：
  1. 复制 History 文件到临时目录（浏览器运行时会锁定）
  2. 打开副本，执行 SQL：
     SELECT url, title, last_visit_time, visit_count
     FROM urls
     WHERE last_visit_time > {上次采集的时间戳}
     ORDER BY last_visit_time DESC
  3. Chrome 时间戳 → ISO 时间（Chrome 用 WebKit 时间：微秒 since 1601-01-01）
  4. 按域名 + 日期分组，每组 → 一个 chunk
  5. URL 过滤（见脱敏模块）

输出格式：
  title: "浏览器历史 - github.com (2026-06-04)"
  content: "## github.com\n- [openhuman/openhuman](https://github.com/...) 访问 5 次\n- ..."
  source_id: "browser:github.com:2026-06-04"
```

#### 5.3.3 视频平台 (`video.js`)

```
数据来源：平台导出的观看历史
  - B站：个人空间 → 历史记录 → 导出（CSV/网页）
  - 抖音：观看历史 → 导出
  - 视频号：暂无官方导出，支持手动粘贴

解析流程：
  1. 检测文件格式（CSV / Excel / HTML）
  2. CSV/Excel：用 csv-parser / xlsx 解析，提取列映射
     - B站 CSV：标题、UP主、观看时间、分区、链接
  3. HTML：DOM 解析，提取视频卡片信息
  4. 按日期分组，每天 → 一个 chunk
  5. 标签提取：分区/标签列 → tags 字段

输出格式：
  title: "B站观看历史 (2026-06-04)"
  content: "## 2026-06-04\n- [【xxx】视频标题](https://bilibili.com/...) UP主: xxx\n- ..."
  source_id: "video:bilibili:2026-06-04"
```

#### 5.3.4 Agent 会话日志 (`session.js`)

```
数据来源：OpenClaw 等 Agent 的 session 日志
文件格式：sess_*.jsonl（每行一个 JSON 对象）

解析流程：
  1. 读取 data/ 目录下的 sess_*.jsonl 文件
  2. 逐行 JSON.parse，提取字段：
     - role: 'user' / 'assistant'
     - content: 消息内容
     - timestamp: 时间戳
     - topic: 主题标签（如果有）
  3. 按 topic + 时间窗口分组（同主题连续对话 → 一个 chunk）
  4. 过滤掉 system prompt 和工具调用的原始 JSON

输出格式：
  title: "Agent 会话: 项目架构讨论 (2026-06-04)"
  content: "## 2026-06-04 14:00 - 15:30\n用户: 帮我设计一下架构\nAI: 好的，...\n..."
  source_id: "session:2026-06-04-14:00"
```

#### 5.3.5 本地文档 (`files.js`)

```
数据来源：用户指定目录下的文档文件
文件格式：.md / .txt

解析流程：
  1. glob 扫描指定目录：**/*.{md,txt}
  2. 读取文件内容，跳过 > 1MB 的文件
  3. 按段落（空行分隔）切分，每个段落如果太短则合并
  4. 每个文件 → 一个 chunk
  5. 提取 Markdown 标题作为 tags

输出格式：
  title: "README.md"
  content: "# 项目名称\n这是一个...\n## 功能\n..."
  source_id: "file:/path/to/README.md"
```

### 5.4 脱敏模块 (`desensitize/`)

**所有采集器的数据在写入 SQLite 之前，必须经过脱敏处理。**

```javascript
// desensitize/patterns.js
const DESENSITIZE_RULES = {
  // 强制脱敏（必须替换）
  phone:     { pattern: /1[3-9]\d{9}/g,              replace: '[手机号]' },
  idCard:    { pattern: /\d{17}[\dXx]/g,              replace: '[身份证]' },
  bankCard:  { pattern: /\d{16,19}/g,                 replace: '[银行卡]' },
  email:     { pattern: /[\w.-]+@[\w.-]+\.\w+/g,     replace: '[邮箱]' },

  // 可选脱敏（默认开启，可配置关闭）
  address:   { pattern: /[一-龥]{2,}(省|市|区|县|镇|村|路|街|号).{0,20}/g, replace: '[地址]' },
  password:  { pattern: /(密码|password|pwd|token|secret|key)\s*[:=]\s*\S+/gi, replace: '[敏感配置]' },
};

// desensitize/filters.js
const URL_BLOCKLIST = [
  /.*\/pay.*/i,           // 支付页面
  /.*\/login.*/i,         // 登录页面
  /.*\/account.*/i,       // 账户设置
  /.*\/password.*/i,      // 密码页面
  /.*bank.*/i,            // 银行相关
  /.*alipay.*/i,          // 支付宝
  /.*wechat.*pay.*/i,     // 微信支付
];

function shouldBlockUrl(url) {
  return URL_BLOCKLIST.some(pattern => pattern.test(url));
}
```

#### 脱敏策略汇总

| 采集器 | 脱敏要点 |
|--------|---------|
| `wechat.js` | 隐藏手机号、身份证、地址、账号密码；图片/语音替换为占位符 |
| `browser.js` | 过滤支付页、隐私网址、登录页；URL 中的 token 参数清空 |
| `video.js` | 无强敏感信息，可选过滤私密收藏夹 |
| `session.js` | 过滤对话内出现的 API key、密码、token |
| `files.js` | 用户可手动标记敏感文件跳过；自动检测包含密码/token 的文件 |

---

## 六、核心算法（移植自 OpenHuman）

### 6.1 摄入管线

```javascript
async function ingest(source, rawData) {
  // 1. 规范化：转成 Markdown
  const markdown = canonicalize(source, rawData);

  // 2. 切块：按 ≤3k tokens 切分
  const chunks = chunkMarkdown(markdown, { maxTokens: 3000 });

  // 3. 快速评分：7 信号加权
  for (const chunk of chunks) {
    chunk.score = scoreChunk(chunk);  // → [0.0, 1.0]
  }

  // 4. 持久化：写入 SQLite + 磁盘 .md
  await persistChunks(chunks);

  // 5. 过滤 + 入树
  const kept = chunks.filter(c => c.score >= DROP_THRESHOLD);
  await buildTree(kept);  // 批量构建，不用 buffer
}
```

### 6.2 评分系统

```javascript
function scoreChunk(chunk) {
  const signals = {
    tokenCount:    calcTokenSignal(chunk.token_count),
    uniqueWords:   calcUniqueWords(chunk.content),
    metadataWeight: calcMetadataWeight(chunk.source, chunk.source_id),
    sourceWeight:  calcSourceWeight(chunk.source),
    entityDensity: calcEntityDensity(chunk.entities),
  };

  // 加权合并
  const weights = { tokenCount: 0.15, uniqueWords: 0.15, metadataWeight: 0.2,
                    sourceWeight: 0.2, entityDensity: 0.3 };

  const total = Object.entries(signals)
    .reduce((sum, [k, v]) => sum + v * weights[k], 0);

  return Math.max(0, Math.min(1, total));
}

// 准入门槛
const DEFINITE_KEEP = 0.7;   // 直接保留
const DROP_THRESHOLD = 0.3;  // 直接丢弃
// 0.3-0.7 之间：可选 LLM 判定（MVP 先保留）
```

### 6.3 批量构建树（替代 OpenHuman 的 Buffer + Seal）

**OpenHuman 用 Buffer + Seal 处理流式数据（20 分钟拉一次，少量 chunk 陆续到达）。我们是批量导入，数据一次性到达，不需要 buffer 攒够再 seal 的机制。**

核心思路：导入完成后，按 (source + 日期) 分组，每组直接生成 Level 1 摘要，Level 1 再分组生成 Level 2，一次性递归构建整棵树。

```javascript
// tree/build.js — 批量构建树

/**
 * 批量构建记忆树
 * @param {Chunk[]} chunks - 评分后保留的 chunks（已过滤掉低分的）
 * @param {string} treeKind - 'source' / 'global' / 'topic'
 */
async function buildTree(chunks, treeKind = 'source') {
  if (chunks.length === 0) return;

  // 1. 所有 chunks 作为 Level 0 叶子节点
  const leaves = chunks.map(chunk => ({
    id: chunk.id,
    level: 0,
    chunk_id: chunk.id,
    score: chunk.score,
    time_from: chunk.created_at,
    time_to: chunk.created_at,
    token_count: chunk.token_count,
  }));

  // 2. 按 (source + 日期) 分组
  const groups = groupBySourceAndDate(leaves);
  // 例：{ "browser:github.com:2026-06-04": [leaf1, leaf2, ...], ... }

  // 3. 每组生成 Level 1 摘要节点
  const level1Nodes = [];
  for (const [groupKey, groupLeaves] of Object.entries(groups)) {
    const summary = await summarise(groupLeaves);
    const { entities, topics } = extractEntities(summary);

    const node = {
      id: generateId(),
      tree_kind: treeKind,
      level: 1,
      content: summary,
      score: Math.max(...groupLeaves.map(l => l.score)),
      time_from: minTime(groupLeaves),
      time_to: maxTime(groupLeaves),
      token_count: estimateTokens(summary),
      children: groupLeaves.map(l => l.id),
    };

    level1Nodes.push(node);

    // 持久化：插入节点 + 索引实体 + 写 .md 文件
    await db.transaction(async () => {
      await insertTreeNode(node);
      await indexEntities(node.id, entities);
      await linkChildren(node.id, groupLeaves.map(l => l.id));
    });
    await writeVaultFile(node);
  }

  // 4. Level 1 再分组 → Level 2（按 source 分组，不按日期）
  if (level1Nodes.length > SUMMARY_FANOUT) {
    const l2Groups = groupBySource(level1Nodes);
    const level2Nodes = [];

    for (const [sourceKey, groupNodes] of Object.entries(l2Groups)) {
      const summary = await summarise(groupNodes);
      const { entities, topics } = extractEntities(summary);

      const node = {
        id: generateId(),
        tree_kind: treeKind,
        level: 2,
        content: summary,
        score: Math.max(...groupNodes.map(n => n.score)),
        time_from: minTime(groupNodes),
        time_to: maxTime(groupNodes),
        token_count: estimateTokens(summary),
        children: groupNodes.map(n => n.id),
      };

      level2Nodes.push(node);

      await db.transaction(async () => {
        await insertTreeNode(node);
        await indexEntities(node.id, entities);
        await linkChildren(node.id, groupNodes.map(n => n.id));
      });
      await writeVaultFile(node);
    }

    // 5. 如果 Level 2 还超过阈值，继续向上（递归）
    if (level2Nodes.length > SUMMARY_FANOUT) {
      await buildTreeLevel(level2Nodes, treeKind, 3);
    }
  }
}

/**
 * 递归构建更高层级
 */
async function buildTreeLevel(nodes, treeKind, level) {
  if (nodes.length <= 1) return;  // 只剩一个节点，它就是根

  const summary = await summarise(nodes);
  const { entities, topics } = extractEntities(summary);

  const node = {
    id: generateId(),
    tree_kind: treeKind,
    level,
    content: summary,
    score: Math.max(...nodes.map(n => n.score)),
    time_from: minTime(nodes),
    time_to: maxTime(nodes),
    token_count: estimateTokens(summary),
    children: nodes.map(n => n.id),
  };

  await db.transaction(async () => {
    await insertTreeNode(node);
    await indexEntities(node.id, entities);
    await linkChildren(node.id, nodes.map(n => n.id));
  });
  await writeVaultFile(node);

  // 递归
  if (nodes.length > SUMMARY_FANOUT) {
    const groups = chunk(nodes, SUMMARY_FANOUT);  // 每 SUMMARY_FANOUT 个一组
    await buildTreeLevel(groups.map(g => createGroupNode(g)), treeKind, level + 1);
  }
}

/**
 * 分组策略
 */
function groupBySourceAndDate(leaves) {
  const groups = {};
  for (const leaf of leaves) {
    const chunk = getChunk(leaf.chunk_id);
    const date = chunk.created_at.slice(0, 10);  // "2026-06-04"
    const key = `${chunk.source}:${chunk.source_id}:${date}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(leaf);
  }
  return groups;
}

function groupBySource(nodes) {
  const groups = {};
  for (const node of nodes) {
    const key = node.tree_kind;  // 按树类型分组
    if (!groups[key]) groups[key] = [];
    groups[key].push(node);
  }
  return groups;
}
```

**与 OpenHuman 的对比：**

| | OpenHuman (流式) | OpenMemory (批量) |
|---|---|---|
| 数据到达 | 少量 chunk 陆续到达 | 一次性批量到达 |
| L0 缓冲区 | 需要，攒够再 seal | 不需要，直接用 |
| seal 阈值 | `INPUT_TOKEN_BUDGET` / `SUMMARY_FANOUT` | `SUMMARY_FANOUT`（只用于分组） |
| flush 超时 | 需要，低流量源也要密封 | 不需要 |
| 级联逻辑 | 复杂，可能中断、重入 | 简单，一次性递归构建 |
| 树结构 | ✅ 多级摘要树 | ✅ 一样的多级摘要树 |
| 摘要生成 | ✅ LLM 或规则 | ✅ 一样 |
| 实体抽取 | ✅ | ✅ 一样 |
| 代码复杂度 | 高（~300 行 bucket_seal.rs） | 中（~150 行 build.js） |

### 6.4 实体抽取

```javascript
// 正则抽取器：机械标识符
const REGEX_PATTERNS = {
  email:    /[\w.-]+@[\w.-]+\.\w+/g,
  url:      /https?:\/\/[^\s]+/g,
  handle:   /@[\w]+/g,
  hashtag:  /#[\w一-鿿]+/g,
};

function extractRegex(text) {
  const entities = [];
  for (const [type, pattern] of Object.entries(REGEX_PATTERNS)) {
    for (const match of text.matchAll(pattern)) {
      entities.push({ name: match[0], type });
    }
  }
  return entities;
}

// 关键词抽取器：TF-IDF 简化版
function extractKeywords(text, topN = 10) {
  // 分词（中文按字，英文按空格）
  // 计算 TF
  // 返回 top N 关键词作为 topic 类型实体
}

// 组合抽取器
function extractEntities(text) {
  return [
    ...extractRegex(text),
    ...extractKeywords(text).map(k => ({ name: k, type: 'topic' })),
  ];
}
```

### 6.5 摘要生成

```javascript
async function summarise(children) {
  // MVP 方案：拼接子节点内容，截断到 1000 tokens，用 LLM 生成摘要
  // 备选方案：不用 LLM，直接取前 N 个关键词 + 时间范围作为摘要

  const combined = children.map(c =>
    `[${c.time_from}] ${c.content || c.title}`
  ).join('\n\n');

  const truncated = truncateToTokens(combined, 1000);

  // 如果有 LLM API key，用 LLM 生成
  if (process.env.OPENAI_API_KEY) {
    return await llmSummarise(truncated);
  }

  // 否则用规则生成
  return ruleBasedSummarise(children);
}

function ruleBasedSummarise(children) {
  const topics = [...new Set(children.flatMap(c => c.topics || []))].slice(0, 5);
  const timeRange = `${children[0].time_from} ~ ${children[children.length-1].time_to}`;
  return `## 摘要\n时间: ${timeRange}\n主题: ${topics.join(', ')}\n条目数: ${children.length}`;
}
```

---

## 七、MCP Server

暴露 4 个 Tools 给 AI Agent：

### 7.1 `search_memory`

```json
{
  "name": "search_memory",
  "description": "搜索用户的个人记忆（全文搜索 + 实体过滤）",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "source": { "type": "string", "enum": ["wechat", "browser", "video", "session", "file", "all"] },
      "limit": { "type": "integer", "default": 10 }
    },
    "required": ["query"]
  }
}
```

### 7.2 `get_memory_tree`

```json
{
  "name": "get_memory_tree",
  "description": "获取记忆树的摘要视图（层级化的用户知识概览）",
  "inputSchema": {
    "type": "object",
    "properties": {
      "kind": { "type": "string", "enum": ["source", "global", "topic"], "default": "global" },
      "max_level": { "type": "integer", "default": 2 }
    }
  }
}
```

### 7.3 `drill_down`

```json
{
  "name": "drill_down",
  "description": "深入查看某个摘要节点的子节点详情",
  "inputSchema": {
    "type": "object",
    "properties": {
      "node_id": { "type": "string" }
    },
    "required": ["node_id"]
  }
}
```

### 7.4 `add_memory`

```json
{
  "name": "add_memory",
  "description": "手动添加一条记忆",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "content": { "type": "string" },
      "tags": { "type": "string" }
    },
    "required": ["content"]
  }
}
```

---

## 八、CLI 命令

```bash
# 启动 MCP Server
openmemory serve

# 手动导入数据
openmemory import wechat ~/exports/wechat.html        # 导入微信聊天记录
openmemory import browser                              # 导入浏览器历史
openmemory import video ~/exports/bilibili.csv         # 导入 B站观看历史
openmemory import session                              # 导入 Agent 会话日志
openmemory import files ~/Documents ~/notes            # 导入本地文件

# 搜索
openmemory search "项目架构"

# 查看记忆树
openmemory tree                                       # 显示全局摘要树
openmemory tree --kind source --level 0               # 显示原始 chunks

# 查看统计
openmemory stats
```

---

## 九、开发计划（2-3 周）

### Week 1: 存储 + 采集器 + 脱敏

| 天 | 任务 | 产出 |
|----|------|------|
| D1 | 项目初始化 + SQLite schema 建表 | 能跑的空项目 |
| D2 | store/: chunks.js + trees.js + entities.js | 数据库 CRUD 完成 |
| D3 | desensitize/: 脱敏规则 + URL 过滤 | 脱敏模块完成 |
| D4 | collectors/files.js + collectors/browser.js | 2 个采集器能跑 |
| D5 | collectors/session.js: Agent 会话日志解析 | 第 3 个采集器 |

### Week 2: 记忆树 + MCP + 更多采集器

| 天 | 任务 | 产出 |
|----|------|------|
| D6 | memory/ingest.js: 规范化 + 切块 + 评分 + 持久化 | 摄入管线完成 |
| D7 | tree/build.js: 批量构建树（分组 + 递归摘要） | 记忆树能生长 |
| D8 | tree/summarise.js + extract/: 摘要 + 实体抽取 | 树能生成摘要 |
| D9 | server.js: MCP Server + 4 个 tools | Agent 能调用 |
| D10 | collectors/wechat.js + collectors/video.js | 5 个采集器全有 |

### Week 3: 打磨 + CLI + 发布

| 天 | 任务 | 产出 |
|----|------|------|
| D11 | cli.js: 完整 CLI 命令（5 个 import 子命令） | 命令行体验 |
| D12 | store/content.js: .md 文件输出到 vault | Obsidian 兼容 |
| D13 | 联调：全量导入 → 树生长 → Agent 搜索 → vault 浏览 | 端到端能跑 |
| D14 | 错误处理 + 日志 + 边界情况 | 稳定性 |
| D15 | README + 使用文档 | 可发布 |

---

## 十、与 OpenHuman 的对应关系

| OpenHuman (Rust) | OpenMemory (Node.js) | 说明 |
|------------------|---------------------|------|
| `memory/` (编排层) | `src/memory/` | 摄入、查询、记忆分类 |
| `memory_tree/` (树机制) | `src/tree/` | 摘要、检索、评分（见下） |
| `memory_store/` (持久层) | `src/store/` | SQLite + 磁盘文件 |
| `memory_tree/score/` | `src/tree/score.js` + `src/extract/` | 评分 + 实体抽取 |
| `memory_tree/tree/bucket_seal.rs` | `src/tree/build.js` | **改造**：流式密封 → 批量构建 |
| `memory_tree/tree/flush.rs` | ❌ 砍掉 | 批量导入不需要超时密封 |
| `memory/ingest_pipeline.rs` | `src/memory/ingest.js` | 管线逻辑 1:1 移植 |
| OAuth 连接器 (118+) | `src/collectors/` (5 个) | wechat/browser/video/session/file |
| — (新增) | `src/desensitize/` | 脱敏模块：手机号/身份证/地址/密码/URL过滤 |
| 20 分钟自动拉取 | `openmemory import` | 用户手动触发 |
| `tree_buffers` 表 | ❌ 砍掉 | 批量构建不需要缓冲区 |
| `tokenjuice/` | ❌ 砍掉 | 不做 token 压缩 |
| `inference/` + `routing/` | ❌ 砍掉 | 不做模型路由 |
| `app/` (Tauri GUI) | ❌ 砍掉 | 纯 CLI |

---

## 十一、关键设计决策

### 为什么用批量构建替代 Buffer + Seal

OpenHuman 的 Buffer + Seal 机制是为**流式数据**设计的：
- 每 20 分钟从 118+ OAuth 服务拉取少量数据
- chunk 陆续到达，需要缓冲区攒够再密封
- 需要 flush 超时机制处理低流量源

我们的场景是**批量导入**：
- 用户手动执行 `openmemory import`，数据一次性到达
- 不需要缓冲区、不需要等、不需要超时密封
- 按 (source + 日期) 分组，一次性递归构建整棵树

**树结构本身（多级摘要 + 实体 + 搜索）完全一样，只是构建方式不同。**

### 为什么不用 OpenHuman 的 20 分钟更新

OpenHuman 的 20 分钟更新是 OAuth 数据拉取的节奏，不是记忆树构建的节奏。记忆树是每次有新 chunk 就触发 seal 的。

我们把"数据拉取"这一步换成"用户手动导入"，所以：
- 不需要定时器
- 不需要 OAuth
- 不需要网络（除了 LLM 摘要，可选本地模型）
- 用户完全掌控什么时候导入、导入什么数据

---

## 十二、常量配置

```javascript
// 对应 OpenHuman 的常量
const CONFIG = {
  // 切块
  MAX_CHUNK_TOKENS: 3000,        // 每个 chunk 的最大 token 数

  // 评分门槛
  DEFINITE_KEEP: 0.7,            // 直接保留
  DEFINITE_DROP: 0.3,            // 直接丢弃
  DROP_THRESHOLD: 0.3,           // 低于此分数丢弃

  // 批量构建树
  SUMMARY_FANOUT: 10,            // 每层最多子节点数（超过则继续向上构建）
  MAX_TREE_DEPTH: 10,            // 最大树深度

  // 摘要
  SUMMARY_TOKEN_BUDGET: 1000,    // 摘要输入的 token 上限

  // 评分权重
  SCORE_WEIGHTS: {
    tokenCount: 0.15,
    uniqueWords: 0.15,
    metadataWeight: 0.2,
    sourceWeight: 0.2,
    entityDensity: 0.3,
  },
};
```

---

## 十一、后续扩展（MVP 之后）

| 版本 | 功能 | 说明 |
|------|------|------|
| v0.3 | LLM 摘要 | 接 OpenAI/Claude API 生成更好的摘要 |
| v0.4 | 向量搜索 | sqlite-vss 存 embedding，语义搜索 |
| v0.5 | Tauri 桌面 GUI | 可视化记忆树 |
| v0.6 | 更多数据源 | Obsidian Vault 直连、Git 历史、Notion API |
| v0.7 | 自动导入 | 定时任务 + 文件监听（替代手动 import） |
| v1.0 | 完整功能 | 对齐 OpenHuman 的记忆能力 |

---

## 附录：OpenHuman 关键源码路径

| 功能 | OpenHuman 路径 |
|------|---------------|
| 记忆树模块入口 | `src/openhuman/memory_tree/mod.rs` |
| 桶密封算法 | `src/openhuman/memory_tree/tree/bucket_seal.rs` |
| 评分系统 | `src/openhuman/memory_tree/score/mod.rs` |
| 实体抽取 | `src/openhuman/memory_tree/score/extract/` |
| 摘要生成 | `src/openhuman/memory_tree/summarise.rs` |
| 摄入管线 | `src/openhuman/memory/ingest_pipeline.rs` |
| 存储层 | `src/openhuman/memory_store/` |
| 树持久化 | `src/openhuman/memory_store/trees/` |
| 实体存储 | `src/openhuman/memory_store/entities.rs` |
