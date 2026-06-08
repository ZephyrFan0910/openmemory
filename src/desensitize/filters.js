/**
 * OpenMemory - URL 过滤规则
 * 过滤支付页面、隐私页面、登录页面等敏感 URL
 */

/**
 * URL 黑名单模式
 */
export const URL_BLOCKLIST = [
  { pattern: /.*\/pay.*/i, reason: '支付页面' },
  { pattern: /.*\/login.*/i, reason: '登录页面' },
  { pattern: /.*\/signin.*/i, reason: '登录页面' },
  { pattern: /.*\/account.*/i, reason: '账户设置' },
  { pattern: /.*\/password.*/i, reason: '密码页面' },
  { pattern: /.*\/reset.*/i, reason: '密码重置' },
  { pattern: /.*bank.*/i, reason: '银行相关' },
  { pattern: /.*alipay.*/i, reason: '支付宝' },
  { pattern: /.*wechat.*pay.*/i, reason: '微信支付' },
  { pattern: /.*\/auth.*/i, reason: '认证页面' },
  { pattern: /.*\/oauth.*/i, reason: 'OAuth 认证' },
  { pattern: /.*\/token.*/i, reason: 'Token 页面' },
  { pattern: /.*\/checkout.*/i, reason: '结账页面' },
];

/**
 * 域名黑名单（整个域名跳过）
 */
export const DOMAIN_BLOCKLIST = [
  'bank.icbc.com.cn',
  'mybank.icbc.com.cn',
  'pbank.psbc.com',
  'per.cmbchina.com',
  'personalbanking.ccb.com',
];

/**
 * 检查 URL 是否应该被过滤
 * @param {string} url
 * @returns {{ blocked: boolean, reason: string | null }}
 */
export function shouldBlockUrl(url) {
  if (!url) return { blocked: false, reason: null };

  try {
    const urlObj = new URL(url);

    // 检查域名黑名单
    if (DOMAIN_BLOCKLIST.includes(urlObj.hostname)) {
      return { blocked: true, reason: `域名黑名单: ${urlObj.hostname}` };
    }

    // 检查 URL 模式黑名单
    for (const rule of URL_BLOCKLIST) {
      if (rule.pattern.test(url)) {
        return { blocked: true, reason: rule.reason };
      }
    }

    return { blocked: false, reason: null };
  } catch {
    // URL 解析失败，不阻止
    return { blocked: false, reason: null };
  }
}

/**
 * 过滤 URL 列表，返回保留的 URL
 * @param {string[]} urls
 * @returns {{ kept: string[], blocked: Array<{ url: string, reason: string }> }}
 */
export function filterUrls(urls) {
  const kept = [];
  const blocked = [];

  for (const url of urls) {
    const result = shouldBlockUrl(url);
    if (result.blocked) {
      blocked.push({ url, reason: result.reason });
    } else {
      kept.push(url);
    }
  }

  return { kept, blocked };
}

/**
 * 清理 URL 中的敏感参数
 * @param {string} url
 * @returns {string} 清理后的 URL
 */
export function sanitizeUrl(url) {
  try {
    const urlObj = new URL(url);

    // 移除常见的敏感查询参数
    const sensitiveParams = [
      'token', 'access_token', 'refresh_token',
      'key', 'api_key', 'apikey',
      'secret', 'password', 'pwd',
      'session', 'sid', 'jsessionid',
    ];

    for (const param of sensitiveParams) {
      urlObj.searchParams.delete(param);
    }

    return urlObj.toString();
  } catch {
    return url;
  }
}
