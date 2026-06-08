/**
 * OpenMemory - 实体规范化 ID 生成
 * 移植自 OpenHuman 的 resolver.rs
 *
 * 规则：
 * - URL: 保留大小写（路径/查询区分大小写）
 * - 其他: lowercase + 去掉前导 @/#
 * - 格式: "kind:surface"
 */

/**
 * 实体类型枚举
 */
export const EntityKind = {
  Email: 'email',
  Handle: 'handle',
  Hashtag: 'hashtag',
  Url: 'url',
  Person: 'person',
  Organization: 'organization',
  Location: 'location',
  Event: 'event',
  Product: 'product',
  DateTime: 'datetime',
  Technology: 'technology',
  Artifact: 'artifact',
  Quantity: 'quantity',
  Topic: 'topic',
};

/**
 * 生成规范化实体 ID
 * @param {string} kind - 实体类型
 * @param {string} surface - 表面形式
 * @returns {string} 规范化 ID，如 "person:alice"
 */
export function canonicalIdFor(kind, surface) {
  if (!surface) return null;

  const trimmed = surface.trim();
  if (!trimmed) return null;

  // URL 保留大小写
  if (kind === EntityKind.Url) {
    return `${kind}:${trimmed}`;
  }

  // 其他类型：小写 + 去掉前导 @/#
  const clean = trimmed
    .toLowerCase()
    .replace(/^[@#]+/, '')
    .trim();

  return `${kind}:${clean}`;
}

/**
 * 从 canonical_id 反推 kind
 */
export function kindFromCanonicalId(canonicalId) {
  const idx = canonicalId.indexOf(':');
  return idx > 0 ? canonicalId.slice(0, idx) : null;
}

/**
 * 从 canonical_id 反推 surface
 */
export function surfaceFromCanonicalId(canonicalId) {
  const idx = canonicalId.indexOf(':');
  return idx > 0 ? canonicalId.slice(idx + 1) : canonicalId;
}
