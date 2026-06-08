/**
 * OpenMemory - 微信聊天记录采集器
 * 支持 .txt 和 .html 格式的微信导出
 */

import fs from 'fs';
import path from 'path';
import { Collector, registerCollector } from './index.js';

class WechatCollector extends Collector {
  constructor() {
    super('wechat', 'wechat');
  }

  /**
   * 扫描微信聊天记录文件
   * @param {Object} config - { paths: string[] }
   */
  async scan(config = {}) {
    const { paths = [] } = config;

    if (paths.length === 0) {
      throw new Error('请指定微信聊天记录文件路径，例如: openmemory import wechat ~/exports/wechat.txt');
    }

    const entries = [];

    for (const filePath of paths) {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[wechat] 文件不存在: ${resolvedPath}`);
        continue;
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      if (!['.txt', '.html'].includes(ext)) {
        console.warn(`[wechat] 不支持的文件格式: ${ext}（支持 .txt/.html）`);
        continue;
      }

      try {
        const fileEntries = ext === '.txt'
          ? this.parseTxtFile(resolvedPath)
          : this.parseHtmlFile(resolvedPath);
        entries.push(...fileEntries);
      } catch (err) {
        console.warn(`[wechat] 解析失败: ${resolvedPath}`, err.message);
      }
    }

    return entries;
  }

  /**
   * 解析 .txt 格式的微信聊天记录
   * 格式：
   *   2026-06-01 14:30:00 张三
   *   你好
   *   2026-06-01 14:31:00 我
   *   你好啊
   */
  parseTxtFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const messages = [];
    let currentMsg = null;

    // 消息头正则：日期 时间 联系人
    const headerPattern = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+)$/;

    for (const line of lines) {
      const headerMatch = line.match(headerPattern);

      if (headerMatch) {
        // 新消息开始
        if (currentMsg) {
          messages.push(currentMsg);
        }
        currentMsg = {
          timestamp: headerMatch[1],
          sender: headerMatch[2].trim(),
          content: '',
        };
      } else if (currentMsg && line.trim()) {
        // 消息内容
        currentMsg.content += (currentMsg.content ? '\n' : '') + line.trim();
      }
    }

    if (currentMsg) {
      messages.push(currentMsg);
    }

    // 按联系人 + 时间窗口分组为会话
    return this.groupIntoSessions(messages);
  }

  /**
   * 解析 .html 格式的微信聊天记录
   */
  parseHtmlFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 简单的 HTML 解析（不依赖 DOM 库）
    const messages = [];

    // 匹配消息块：<div class="chat_item"> 或类似结构
    const msgPattern = /<div[^>]*class="[^"]*chat[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const timePattern = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
    const senderPattern = /<span[^>]*class="[^"]*sender[^"]*"[^>]*>([^<]+)<\/span>/i;

    let match;
    while ((match = msgPattern.exec(content)) !== null) {
      const block = match[1];
      const timeMatch = block.match(timePattern);
      const senderMatch = block.match(senderPattern);

      if (timeMatch) {
        // 提取消息文本（移除 HTML 标签）
        const text = block
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        messages.push({
          timestamp: timeMatch[1],
          sender: senderMatch ? senderMatch[1].trim() : '未知',
          content: text,
        });
      }
    }

    return this.groupIntoSessions(messages);
  }

  /**
   * 将消息按联系人和时间窗口分组为会话
   * 30 分钟无消息 = 新会话
   */
  groupIntoSessions(messages) {
    if (messages.length === 0) return [];

    const SESSION_GAP = 30 * 60 * 1000; // 30 分钟
    const sessions = [];
    let currentSession = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const curr = messages[i];

      const prevTime = new Date(prev.timestamp).getTime();
      const currTime = new Date(curr.timestamp).getTime();

      // 检查是否需要开始新会话
      if (currTime - prevTime > SESSION_GAP) {
        sessions.push(currentSession);
        currentSession = [];
      }

      currentSession.push(curr);
    }

    if (currentSession.length > 0) {
      sessions.push(currentSession);
    }

    // 转换为采集器格式
    return sessions.map(session => {
      // 确定联系人（非"我"的发送者）
      const contacts = [...new Set(session.map(m => m.sender).filter(s => s !== '我'))];
      const contact = contacts.join(', ') || '未知联系人';

      return {
        messages: session,
        contact,
        startTime: session[0].timestamp,
        endTime: session[session.length - 1].timestamp,
      };
    });
  }

  /**
   * 规范化为 chunk
   */
  normalize(entry) {
    const { messages, contact, startTime, endTime } = entry;

    const formattedMessages = messages.map(msg => {
      return `${msg.timestamp} ${msg.sender}: ${msg.content}`;
    }).join('\n');

    const date = startTime?.slice(0, 10) || '未知日期';
    const title = `与 ${contact} 的聊天 (${date})`;

    const content = `## ${date}\n${formattedMessages}`;

    return {
      title,
      content,
      sourceId: `wechat:${contact}:${date}`,
      createdAt: startTime,
    };
  }
}

// 注册采集器
const wechatCollector = new WechatCollector();
registerCollector(wechatCollector);

export default wechatCollector;
