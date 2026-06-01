import { describe, it, expect } from 'vitest';
import {
  buildFrontmatter,
  toMarkdownDocument,
  formatIso8601Beijing,
} from '../../src/lib/utils/frontmatter.js';

const base = {
  id: 'MzI==_2247491234_1_abc',
  __biz: 'MzI==',
  pub_account_biz: 'MzI==',
  pub_account_name: '技术美学',
  title: '一篇"带引号"的文章',
  author: '张三',
  source_url: 'https://mp.weixin.qq.com/s?__biz=MzI==&mid=1&idx=1&sn=abc&from=x',
  clean_source_url: 'https://mp.weixin.qq.com/s?__biz=MzI==&mid=1&idx=1&sn=abc',
  pub_time: 1714530180000,
  captured_at: 1717110900000,
  is_original: true,
  read_count: 12345,
  like_count: 234,
  tags: ['rust', 'async'],
  content_md: '正文第一段。\n\n正文第二段。',
};

describe('formatIso8601Beijing', () => {
  it('returns null for non-positive / invalid input', () => {
    expect(formatIso8601Beijing(0)).toBe(null);
    expect(formatIso8601Beijing(-1)).toBe(null);
    expect(formatIso8601Beijing(NaN)).toBe(null);
    expect(formatIso8601Beijing('x')).toBe(null);
  });
  it('formats ms to a +08:00 ISO string', () => {
    const s = formatIso8601Beijing(1714530180000);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
  });
});

describe('buildFrontmatter', () => {
  const fm = buildFrontmatter(base);
  it('opens and closes with YAML fences', () => {
    expect(fm.startsWith('---\n')).toBe(true);
    expect(fm.trimEnd().endsWith('\n---')).toBe(true);
  });
  it('includes core fields', () => {
    expect(fm).toContain('source: wechat');
    expect(fm).toContain('liberator_id: "MzI==_2247491234_1_abc"');
    expect(fm).toContain('schema_version: 1');
    expect(fm).toContain('is_original: true');
    expect(fm).toContain('read_count: 12345');
    expect(fm).toContain('like_count: 234');
    expect(fm).toContain('tags: ["rust", "async"]');
    expect(fm).toContain('pub_account: "技术美学"');
    expect(fm).toContain('pub_account_biz: "MzI=="');
  });
  it('escapes embedded double quotes in the title', () => {
    expect(fm).toContain('title: "一篇\\"带引号\\"的文章"');
  });
  it('omits empty optional fields', () => {
    const min = buildFrontmatter({ id: 'a_b_c_d', content_md: 'x' });
    expect(min).not.toContain('author:');
    expect(min).not.toContain('wayback_snapshot_url:');
    expect(min).not.toContain('read_count:');
    expect(min).toContain('source: wechat');
    expect(min).toContain('schema_version: 1');
  });
});

describe('toMarkdownDocument', () => {
  it('composes frontmatter + title + author + body', () => {
    const doc = toMarkdownDocument(base);
    expect(doc.startsWith('---\n')).toBe(true);
    expect(doc).toContain('# 一篇"带引号"的文章');
    expect(doc).toContain('**作者:** 张三');
    expect(doc).toContain('正文第一段。');
    expect(doc).toContain('正文第二段。');
  });
  it('can omit frontmatter for quick paste', () => {
    const doc = toMarkdownDocument(base, { withFrontmatter: false });
    expect(doc.startsWith('# ')).toBe(true);
    expect(doc).not.toContain('schema_version');
  });
});
