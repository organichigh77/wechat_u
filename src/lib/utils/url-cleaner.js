// URL 净化:对微信公众号文章 URL 做白名单式重建,删除 tracking / 会话痕迹参数,
// 保留真正影响打开的内容锚(__biz / mid / idx / sn / chksm)。
// 规格见 docs/CAPTURE_SPEC.md § B。

// 内容锚:决定「打开哪一篇」,必须保留。
const CONTENT_ANCHOR_PARAMS = ['__biz', 'mid', 'idx', 'sn', 'chksm'];

// tracking / 会话痕迹:删除后不影响文章打开。保留此表用于文档/可读性;
// 实际净化采用白名单策略(只留内容锚),此处仅作参考与潜在白名单豁免判断。
const TRACKING_PARAMS = new Set([
  'from',
  'scene',
  'ascene',
  'sessionid',
  'clicktime',
  'enterid',
  'devicetype',
  'version',
  'lang',
  'nettype',
  'exportkey',
  'pass_ticket',
  'wx_header',
  '__biz_no_redirect',
  'mid_no_redirect',
  'subscene',
  'srcid',
  'sharer_sharetime',
  'sharer_shareid',
  'sharer_appid',
  'key',
  'uin',
]);

const WECHAT_HOST = 'mp.weixin.qq.com';

/**
 * 判断 host 是否为微信公众号域(精确匹配,避免 mp.weixin.qq.com.attacker.com 之类绕过)。
 * @param {string} hostname
 * @returns {boolean}
 */
export function isWeChatArticleHost(hostname) {
  return hostname === WECHAT_HOST;
}

/**
 * 白名单式净化微信公众号文章 URL。
 *
 * 规则:
 * - 非 mp.weixin.qq.com 的 URL 原样返回,changed:false。
 * - 只保留内容锚白名单参数,其余(含未知 tracking)一律删除。
 * - 短链 `/s/xxxx` 保留 path,只清 query。
 * - 用 URL / URLSearchParams 重建,绝不做字符串替换。
 *
 * @param {string} rawUrl
 * @returns {{ url: string, changed: boolean, reason?: string }}
 */
export function cleanWeChatUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { url: rawUrl, changed: false, reason: 'empty' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // 不是合法绝对 URL,原样返回(可能是相对路径或用户粘错)。
    return { url: rawUrl, changed: false, reason: 'invalid_url' };
  }

  if (!isWeChatArticleHost(parsed.hostname)) {
    return { url: rawUrl, changed: false, reason: 'not_wechat' };
  }

  const original = parsed.searchParams;
  const cleaned = new URLSearchParams();
  let removed = 0;

  // 只保留内容锚白名单里的参数(其它一律视为可删除,包括未知 tracking)。
  // 顺序遵循内容锚固定顺序,生成稳定、可去重的 URL。
  for (const param of CONTENT_ANCHOR_PARAMS) {
    if (original.has(param)) {
      // 同名重复参数只取第一个,避免重复 query 污染。
      cleaned.set(param, original.get(param));
    }
  }

  // 统计被删除的参数数量(用于 changed 判定)。
  for (const name of new Set([...original.keys()])) {
    const count = original.getAll(name).length;
    if (!CONTENT_ANCHOR_PARAMS.includes(name)) {
      removed += count;
    } else if (count > 1) {
      // 重复的内容锚参数也算清理。
      removed += count - 1;
    }
  }

  const rebuilt = new URL(parsed.origin + parsed.pathname);
  const search = cleaned.toString();
  if (search) {
    rebuilt.search = search;
  }
  // 丢弃 hash 中的会话痕迹(微信文章 URL 一般无意义 hash)。
  const finalUrl = rebuilt.toString();

  const changed = removed > 0 || finalUrl !== rawUrl;
  return { url: finalUrl, changed };
}

export { TRACKING_PARAMS, CONTENT_ANCHOR_PARAMS };
