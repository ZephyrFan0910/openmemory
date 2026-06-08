/**
 * OpenMemory - 缓冲区逻辑
 * 移植自 OpenHuman 的 bucket_seal.rs
 *
 * 核心函数：shouldSeal() 判断是否触发密封
 */

/**
 * 密封阈值常量（对齐 OpenHuman）
 */
export const INPUT_TOKEN_BUDGET = 50_000;   // L0 密封：token 门槛
export const SUMMARY_FANOUT = 10;            // L1+ 密封：兄弟节点数门槛
export const MAX_CASCADE_DEPTH = 32;         // 安全阀：最大级联深度
export const FLUSH_AGE_DAYS = 7;             // 时间冲洗：7 天

/**
 * 判断缓冲区是否应该密封
 * @param {Object} buffer - { item_ids: string[], token_sum: number }
 * @param {number} level - 当前层级
 * @returns {boolean}
 */
export function shouldSeal(buffer, level) {
  if (!buffer || !buffer.item_ids || buffer.item_ids.length === 0) {
    return false;
  }

  if (level === 0) {
    // L0: token 预算 OR 条目数
    return buffer.token_sum >= INPUT_TOKEN_BUDGET || buffer.item_ids.length >= SUMMARY_FANOUT;
  }

  // L1+: 只看条目数
  return buffer.item_ids.length >= SUMMARY_FANOUT;
}

/**
 * 获取默认树 ID
 */
export function getDefaultTreeId(kind = 'global') {
  return `tree_${kind}_default`;
}
