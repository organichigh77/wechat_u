// 把 ArticleRecord 转成带 YAML frontmatter 的 Markdown 文档(导出 .md / ZIP / 复制用)。
// frontmatter 字段规格见 docs/DATA_MODEL.md § Frontmatter Spec。
// 纯函数,可被 popup、content script、Vitest 共用。

/** 给字符串做 YAML 双引号转义(反斜杠、双引号、换行)。 */
function yamlQuote(value) {
  const s = String(value == null ? '' : value);
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

/**
 * 把 unix 毫秒格式化为带 +08:00 偏移的 ISO 8601(微信内容默认中国时区)。
 * 不引第三方库:手动把时间平移到 UTC+8 再切片。
 * @param {number} ms
 * @returns {string|null}
 */
export function formatIso8601Beijing(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const shifted = new Date(ms + 8 * 3600 * 1000);
  const iso = shifted.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ (数值此时表示北京时间)
  return iso.replace(/\.\d{3}Z$/, '+08:00');
}

/**
 * 生成 YAML frontmatter 块(含首尾 `---`)。空/未知字段省略,不输出 null。
 * @param {object} record ArticleRecord
 * @returns {string}
 */
export function buildFrontmatter(record = {}) {
  const lines = ['---'];

  const push = (key, rawValue, { quote = true } = {}) => {
    if (rawValue == null || rawValue === '') return;
    lines.push(`${key}: ${quote ? yamlQuote(rawValue) : rawValue}`);
  };

  push('title', record.title);
  push('author', record.author);
  lines.push('source: wechat');
  push('source_url', record.source_url);
  push('clean_source_url', record.clean_source_url);
  push('wayback_snapshot_url', record.wayback_snapshot_url);
  push('pub_account', record.pub_account_name);
  push('pub_account_biz', record.pub_account_biz || record.__biz);

  const pubIso = formatIso8601Beijing(record.pub_time);
  if (pubIso) lines.push(`pub_time: ${pubIso}`);
  const capIso = formatIso8601Beijing(record.captured_at);
  if (capIso) lines.push(`captured_at: ${capIso}`);

  if (typeof record.is_original === 'boolean') {
    lines.push(`is_original: ${record.is_original}`);
  }
  if (typeof record.read_count === 'number') {
    lines.push(`read_count: ${record.read_count}`);
  }
  if (typeof record.like_count === 'number') {
    lines.push(`like_count: ${record.like_count}`);
  }

  if (Array.isArray(record.tags) && record.tags.length > 0) {
    const items = record.tags.map(yamlQuote).join(', ');
    lines.push(`tags: [${items}]`);
  }

  push('liberator_id', record.id);
  lines.push(`schema_version: ${record.archive_version || 1}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * 组装完整的可下载 Markdown 文档:frontmatter + 标题 + 作者 + 正文。
 * content_md 是不含标题 H1 的正文(Readability 把标题剥离到 record.title)。
 * @param {object} record ArticleRecord
 * @param {{ withFrontmatter?: boolean }} [options]
 * @returns {string}
 */
export function toMarkdownDocument(record = {}, options = {}) {
  const { withFrontmatter = true } = options;
  const parts = [];
  if (withFrontmatter) {
    parts.push(buildFrontmatter(record), '');
  }
  if (record.title) {
    parts.push(`# ${record.title}`, '');
  }
  if (record.author) {
    parts.push(`**作者:** ${record.author}`, '');
  }
  parts.push(record.content_md || '');
  return parts.join('\n');
}
