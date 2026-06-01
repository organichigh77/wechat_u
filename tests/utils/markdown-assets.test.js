import { describe, it, expect } from 'vitest';
import {
  shortHash,
  guessExt,
  assetFilename,
  rewriteImageLinks,
  collectImageUrls,
} from '../../src/lib/utils/markdown-assets.js';

describe('shortHash', () => {
  it('is deterministic and 12 lowercase hex chars', () => {
    const h = shortHash('https://x/y.png');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(shortHash('https://x/y.png')).toBe(h);
  });
  it('differs for different inputs', () => {
    expect(shortHash('https://x/y.png')).not.toBe(shortHash('https://x/z.png'));
  });
});

describe('guessExt', () => {
  it('reads the wx_fmt query param', () => {
    expect(guessExt('https://mmbiz.qpic.cn/a?wx_fmt=jpeg')).toBe('jpg');
    expect(guessExt('https://mmbiz.qpic.cn/a?wx_fmt=png')).toBe('png');
  });
  it('reads a file extension', () => {
    expect(guessExt('https://x/a.webp')).toBe('webp');
    expect(guessExt('https://x/a.JPG')).toBe('jpg');
  });
  it('prefers the mime type when provided', () => {
    expect(guessExt('https://x/a', 'image/gif')).toBe('gif');
  });
  it('defaults to jpg', () => {
    expect(guessExt('https://x/noext')).toBe('jpg');
  });
});

describe('assetFilename', () => {
  it('builds images/{hash}.{ext}', () => {
    expect(assetFilename('https://mmbiz.qpic.cn/a?wx_fmt=png')).toMatch(/^images\/[0-9a-f]{12}\.png$/);
  });
});

describe('rewriteImageLinks', () => {
  it('replaces only mapped urls and leaves others intact', () => {
    const md = '![](https://x/a.png) and ![](https://x/b.png)';
    const out = rewriteImageLinks(md, { 'https://x/a.png': 'images/aa.png' });
    expect(out).toContain('images/aa.png');
    expect(out).toContain('https://x/b.png');
  });
  it('replaces the longest url first to avoid prefix collisions', () => {
    const md = 'A=https://x/a B=https://x/abc';
    const out = rewriteImageLinks(md, { 'https://x/a': 'SHORT', 'https://x/abc': 'LONG' });
    expect(out).toBe('A=SHORT B=LONG');
  });
});

describe('collectImageUrls', () => {
  it('collects markdown + html image urls, deduped', () => {
    const md = '![x](https://x/a.png)\n<img src="https://x/b.png">\n![y](https://x/a.png)';
    expect(collectImageUrls(md).sort()).toEqual(['https://x/a.png', 'https://x/b.png']);
  });
});
