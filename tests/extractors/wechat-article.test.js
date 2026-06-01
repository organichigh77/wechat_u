import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { extractArticle, pickWindowVar } from '../../src/lib/extractors/wechat-article.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '../fixtures');

function loadDom(name, url) {
  const html = readFileSync(join(FIX, name), 'utf8');
  return new JSDOM(html, { url });
}

describe('pickWindowVar', () => {
  it('extracts quoted vars including the `|| ""` suffix form', () => {
    const html = 'var biz = "MzI123==" || "";\nvar mid = "2247500001" || "";';
    expect(pickWindowVar(html, 'biz')).toBe('MzI123==');
    expect(pickWindowVar(html, 'mid')).toBe('2247500001');
  });
  it('extracts unquoted numeric vars', () => {
    expect(pickWindowVar('var copyright_stat = 11;', 'copyright_stat')).toBe('11');
  });
  it('returns null for a missing var', () => {
    expect(pickWindowVar('nothing here', 'biz')).toBe(null);
  });
});

describe('extractArticle · standard article', () => {
  let record;
  beforeAll(() => {
    const dom = loadDom(
      'article-standard.html',
      'https://mp.weixin.qq.com/s?__biz=MzStandard==&mid=2247500001&idx=1&sn=stdsn123&from=singlemessage&scene=23&pass_ticket=SECRET',
    );
    record = extractArticle(dom.window.document, dom.window);
  });

  it('parses identity from URL params and builds the dedup id', () => {
    expect(record.__biz).toBe('MzStandard==');
    expect(record.mid).toBe('2247500001');
    expect(record.idx).toBe('1');
    expect(record.sn).toBe('stdsn123');
    expect(record.id).toBe('MzStandard==_2247500001_1_stdsn123');
  });

  it('produces a clean source url without tracking/secret params', () => {
    expect(record.clean_source_url).toContain('__biz=MzStandard');
    expect(record.clean_source_url).not.toContain('from=');
    expect(record.clean_source_url).not.toContain('scene=');
    expect(record.clean_source_url).not.toContain('SECRET');
  });

  it('extracts title, account, author and metadata', () => {
    expect(record.title).toBe('深入理解 Rust 异步运行时');
    expect(record.pub_account_name).toBe('技术美学');
    expect(record.author).toBe('张三');
    expect(record.pub_time).toBe(1714500000 * 1000);
    expect(record.is_original).toBe(true);
    expect(record.cover_url).toContain('http');
    expect(record.captured_at).toBeGreaterThan(0);
    expect(record.archive_version).toBe(1);
  });

  it('keeps body text but drops footer promotion noise', () => {
    expect(record.content_md).toContain('Rust');
    expect(record.content_md).toContain('executor');
    expect(record.content_md).not.toContain('扫描二维码');
    expect(record.content_md).not.toContain('长按识别');
  });

  it('fixes lazy images into image_urls', () => {
    expect(record.image_urls.some((u) => u.includes('rust_async_diagram.png'))).toBe(true);
    expect(record.image_urls.some((u) => u.startsWith('data:'))).toBe(false);
  });
});

describe('extractArticle · code blocks', () => {
  it('converts a wechat code-snippet into a fenced code block', () => {
    const dom = loadDom(
      'article-code.html',
      'https://mp.weixin.qq.com/s?__biz=MzCode==&mid=2247500002&idx=1&sn=codesn',
    );
    const record = extractArticle(dom.window.document, dom.window);
    expect(record.content_md).toContain('```');
    expect(record.content_md).toContain('fn main()');
    expect(record.content_md).toContain('println!');
    expect(record.is_original).toBe(false);
  });
});

describe('extractArticle · short link / window-var fallback', () => {
  it('falls back to window vars when the URL lacks identity params', () => {
    const dom = loadDom('article-minimal.html', 'https://mp.weixin.qq.com/s/AbCdEfShortLink');
    const record = extractArticle(dom.window.document, dom.window);
    expect(record.__biz).toBe('MzMinimal==');
    expect(record.mid).toBe('2247500003');
    expect(record.idx).toBe('1');
    expect(record.sn).toBe('minsn');
    expect(record.title).toBe('短链文章标题');
    expect(record.content_md.length).toBeGreaterThan(10);
    expect(record.clean_source_url).toBe('https://mp.weixin.qq.com/s/AbCdEfShortLink');
  });

  it('throws a clear error when #js_content is absent', () => {
    const dom = new JSDOM('<html><body><p>not an article</p></body></html>', {
      url: 'https://mp.weixin.qq.com/s?__biz=x',
    });
    expect(() => extractArticle(dom.window.document, dom.window)).toThrow(/js_content|图文/);
  });
});
