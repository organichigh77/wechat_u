import { describe, it, expect } from 'vitest';
import { cleanWeChatUrl, isWeChatArticleHost } from '../../src/lib/utils/url-cleaner.js';

describe('cleanWeChatUrl', () => {
  it('removes tracking params but keeps content anchors on a normal article URL', () => {
    const raw =
      'https://mp.weixin.qq.com/s?__biz=MzIxNjA1==&mid=2247491234&idx=1&sn=abcdef&chksm=99&from=singlemessage&scene=23&sessionid=1700000000&clicktime=1700000001&ascene=7&pass_ticket=SECRET';
    const { url, changed } = cleanWeChatUrl(raw);
    expect(changed).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('__biz')).toBe('MzIxNjA1==');
    expect(parsed.searchParams.get('mid')).toBe('2247491234');
    expect(parsed.searchParams.get('idx')).toBe('1');
    expect(parsed.searchParams.get('sn')).toBe('abcdef');
    expect(parsed.searchParams.get('chksm')).toBe('99');
    expect(parsed.searchParams.has('from')).toBe(false);
    expect(parsed.searchParams.has('pass_ticket')).toBe(false);
    expect(parsed.searchParams.has('scene')).toBe(false);
    expect(url).not.toContain('SECRET');
  });

  it('preserves the path for short links and clears query', () => {
    const raw = 'https://mp.weixin.qq.com/s/AbCdEf123?from=timeline&scene=2';
    const { url, changed } = cleanWeChatUrl(raw);
    expect(changed).toBe(true);
    expect(url).toBe('https://mp.weixin.qq.com/s/AbCdEf123');
  });

  it('returns non-wechat URLs unchanged', () => {
    const raw = 'https://example.com/post?utm_source=x&id=5';
    const { url, changed, reason } = cleanWeChatUrl(raw);
    expect(changed).toBe(false);
    expect(reason).toBe('not_wechat');
    expect(url).toBe(raw);
  });

  it('does not get fooled by a lookalike host', () => {
    expect(isWeChatArticleHost('mp.weixin.qq.com.attacker.com')).toBe(false);
    const raw = 'https://mp.weixin.qq.com.attacker.com/s?__biz=x&from=evil';
    const { changed, reason } = cleanWeChatUrl(raw);
    expect(changed).toBe(false);
    expect(reason).toBe('not_wechat');
  });

  it('collapses duplicate params (takes first) and counts them as changed', () => {
    const raw = 'https://mp.weixin.qq.com/s?__biz=A&__biz=B&idx=1';
    const { url, changed } = cleanWeChatUrl(raw);
    expect(changed).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('__biz')).toBe('A');
    expect(parsed.searchParams.getAll('__biz').length).toBe(1);
  });

  it('reports unchanged when an already-clean URL is passed', () => {
    const clean = 'https://mp.weixin.qq.com/s?__biz=A&mid=2&idx=1&sn=z';
    const { url, changed } = cleanWeChatUrl(clean);
    expect(url).toBe(clean);
    expect(changed).toBe(false);
  });

  it('handles missing params gracefully', () => {
    const raw = 'https://mp.weixin.qq.com/s';
    const { url, changed } = cleanWeChatUrl(raw);
    expect(url).toBe('https://mp.weixin.qq.com/s');
    expect(changed).toBe(false);
  });

  it('returns empty / invalid input unchanged', () => {
    expect(cleanWeChatUrl('').changed).toBe(false);
    expect(cleanWeChatUrl('not a url').changed).toBe(false);
    expect(cleanWeChatUrl(null).changed).toBe(false);
  });
});
