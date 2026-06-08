/**
 * OpenMemory - Agent 会话日志采集器
 * 支持 sess_*.jsonl 格式的 Agent 会话日志
 */

import fs from 'fs';
import path from 'path';
import { Collector, registerCollector } from './index.js';

class SessionCollector extends Collector {
  constructor() {
    super('session', 'session');
  }

  /**
   * 扫描 Agent 会话日志
   * @param {Object} config - { paths: string[] }
   */
  async scan(config = {}) {
    const { paths = [] } = config;

    if (paths.length === 0) {
      // 默认扫描 data/ 目录
      const defaultPath = path.join(process.cwd(), 'data');
      if (fs.existsSync(defaultPath)) {
        paths.push(defaultPath);
      }
    }

    const entries = [];

    for (const dirPath of paths) {
      const resolvedPath = path.resolve(dirPath);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[session] 目录不存在: ${resolvedPath}`);
        continue;
      }
      const sessions = this.scanSessionFiles(resolvedPath);
      entries.push(...sessions);
    }

    return entries;
  }

  /**
   * 扫描目录下的 sess_*.jsonl 文件
   */
  scanSessionFiles(dirPath) {
    const entries = [];

    try {
      const files = fs.readdirSync(dirPath);
      const sessionFiles = files.filter(f => f.startsWith('sess_') && f.endsWith('.jsonl'));

      for (const file of sessionFiles) {
        const filePath = path.join(dirPath, file);
        try {
          const sessions = this.parseSessionFile(filePath);
          entries.push(...sessions);
        } catch (err) {
          console.warn(`[session] 解析文件失败: ${filePath}`, err.message);
        }
      }
    } catch (err) {
      console.warn(`[session] 扫描目录失败: ${dirPath}`, err.message);
    }

    return entries;
  }

  /**
   * 解析单个 session JSONL 文件
   * 每行一个 JSON 对象，包含 role/content/timestamp/topic
   */
  parseSessionFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    const messages = [];
    let currentTopic = null;
    let sessionStartTime = null;

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);

        // 过滤 system prompt 和工具调用
        if (msg.role === 'system' || msg.type === 'tool_call' || msg.type === 'tool_result') {
          continue;
        }

        if (!msg.role || !msg.content) continue;

        // 记录会话开始时间
        if (!sessionStartTime && msg.timestamp) {
          sessionStartTime = msg.timestamp;
        }

        // 获取主题
        if (msg.topic) {
          currentTopic = msg.topic;
        }

        messages.push({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        });
      } catch {
        // 跳过无法解析的行
        continue;
      }
    }

    if (messages.length === 0) return [];

    // 按时间窗口分组（30 分钟无消息 = 新会话）
    const sessions = this.groupByTimeWindow(messages, 30 * 60 * 1000);

    return sessions.map((session, idx) => ({
      messages: session,
      topic: currentTopic || path.basename(filePath, '.jsonl'),
      startTime: session[0].timestamp,
      endTime: session[session.length - 1].timestamp,
      filePath,
      sessionIndex: idx,
    }));
  }

  /**
   * 按时间窗口分组消息
   */
  groupByTimeWindow(messages, windowMs) {
    if (messages.length === 0) return [];

    const groups = [];
    let currentGroup = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const curr = messages[i];

      const prevTime = prev.timestamp ? new Date(prev.timestamp).getTime() : 0;
      const currTime = curr.timestamp ? new Date(curr.timestamp).getTime() : 0;

      if (currTime - prevTime > windowMs) {
        groups.push(currentGroup);
        currentGroup = [];
      }

      currentGroup.push(curr);
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * 规范化为 chunk
   */
  normalize(entry) {
    const { messages, topic, startTime, endTime, filePath, sessionIndex } = entry;

    // 格式化对话内容
    const formattedMessages = messages.map(msg => {
      const role = msg.role === 'user' ? '用户' : 'AI';
      return `${role}: ${msg.content}`;
    }).join('\n\n');

    // 时间范围
    const startDate = startTime ? new Date(startTime) : new Date();
    const endDate = endTime ? new Date(endTime) : startDate;
    const timeRange = `${startDate.toISOString().slice(0, 16)} - ${endDate.toISOString().slice(0, 16)}`;

    const title = topic
      ? `Agent 会话: ${topic} (${startDate.toISOString().slice(0, 10)})`
      : `Agent 会话 (${startDate.toISOString().slice(0, 10)})`;

    const content = `## ${timeRange}\n\n${formattedMessages}`;

    return {
      title,
      content,
      sourceId: `session:${startDate.toISOString().slice(0, 10)}-${sessionIndex}`,
      createdAt: startDate.toISOString(),
      topic,
      messageCount: messages.length,
    };
  }
}

// 注册采集器
const sessionCollector = new SessionCollector();
registerCollector(sessionCollector);

export default sessionCollector;
