/**
 * OpenMemory - 脱敏正则规则
 * 对应 PRD 第五章脱敏模块
 */

/**
 * 强制脱敏规则（必须替换）
 */
export const MANDATORY_RULES = [
  {
    name: 'phone',
    pattern: /1[3-9]\d{9}/g,
    replace: '[手机号]',
    description: '中国大陆手机号',
  },
  {
    name: 'idCard',
    pattern: /\d{17}[\dXx]/g,
    replace: '[身份证]',
    description: '18位身份证号',
  },
  {
    name: 'bankCard',
    pattern: /\d{16,19}/g,
    replace: '[银行卡]',
    description: '16-19位银行卡号',
  },
  {
    name: 'email',
    pattern: /[\w.-]+@[\w.-]+\.\w+/g,
    replace: '[邮箱]',
    description: '电子邮箱',
  },
];

/**
 * 可选脱敏规则（默认开启，可配置关闭）
 */
export const OPTIONAL_RULES = [
  {
    name: 'address',
    pattern: /[一-龥]{2,}(省|市|区|县|镇|村|路|街|号).{0,20}/g,
    replace: '[地址]',
    description: '中国地址',
  },
  {
    name: 'password',
    pattern: /(密码|password|pwd|token|secret|key|api[_-]?key)\s*[:=]\s*\S+/gi,
    replace: '[敏感配置]',
    description: '密码/token/密钥',
  },
  {
    name: 'ipAddress',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replace: '[IP地址]',
    description: 'IPv4 地址',
  },
];

/**
 * 所有规则（默认配置）
 */
export const ALL_RULES = [...MANDATORY_RULES, ...OPTIONAL_RULES];

/**
 * 对文本应用脱敏规则
 * @param {string} text - 原始文本
 * @param {Object[]} rules - 规则列表
 * @returns {{ text: string, replacements: Object }} - 脱敏后的文本和替换统计
 */
export function applyDesensitize(text, rules = ALL_RULES) {
  let result = text;
  const replacements = {};

  for (const rule of rules) {
    const matches = result.match(rule.pattern);
    if (matches && matches.length > 0) {
      replacements[rule.name] = (replacements[rule.name] || 0) + matches.length;
      result = result.replace(rule.pattern, rule.replace);
    }
  }

  return { text: result, replacements };
}
