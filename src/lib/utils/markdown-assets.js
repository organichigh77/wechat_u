// 导出 ZIP 时的图片资产辅助:稳定文件名、扩展名推断、Markdown 图片链接重写。
// 纯函数,无 IO,可被 content script(实际抓取)和 Vitest 共用。
//
// 注意:此处的 shortHash 用于「单篇文章 ZIP 内的图片文件名」,只需稳定 + 低碰撞,
// 不是密码学哈希。Act 2 的 assets 表去重用真正的 sha256(见 DATA_MODEL.md)。

/**
 * FNV-1a 32-bit 的双路变体,产出 12 位十六进制。对单篇文章内的几十张图片
 * 足够稳定且几乎不碰撞;跨文章碰撞无所谓(每篇 ZIP 独立目录)。
 * @param {string} str
 * @returns {string} 12-hex
 */
export function shortHash(str) {
  const s = String(str == null ? '' : str);
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ s.length) >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0').slice(0, 4);
  return hex1 + hex2;
}

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/**
 * 从 URL 或 mime 推断图片扩展名。微信图片 URL 常见 `?wx_fmt=jpeg` / `?wx_fmt=png`。
 * @param {string} url
 * @param {string} [mime]
 * @returns {string} 不含点的扩展名,默认 'jpg'
 */
export function guessExt(url, mime) {
  if (mime && MIME_TO_EXT[mime.toLowerCase()]) {
    return MIME_TO_EXT[mime.toLowerCase()];
  }
  const u = String(url || '');
  // 微信特有:wx_fmt 查询参数。
  const wxFmt = u.match(/[?&]wx_fmt=([a-z0-9]+)/i);
  if (wxFmt) {
    const fmt = wxFmt[1].toLowerCase();
    return fmt === 'jpeg' ? 'jpg' : fmt;
  }
  // 普通后缀。
  const ext = u.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (ext) {
    const e = ext[1].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(e)) {
      return e === 'jpeg' ? 'jpg' : e;
    }
  }
  return 'jpg';
}

/**
 * 给某张图片在 ZIP 内的相对路径(images/{hash}.{ext})。
 * @param {string} url
 * @param {string} [mime]
 * @returns {string}
 */
export function assetFilename(url, mime) {
  return `images/${shortHash(url)}.${guessExt(url, mime)}`;
}

/**
 * 在 Markdown 文本里,把出现过的远端图片 URL 重写为本地相对路径。
 * 只替换 mapping 中出现的 URL,其它链接原样保留。
 *
 * @param {string} markdown
 * @param {Record<string,string>} urlToLocalPath  远端 URL → ZIP 内相对路径
 * @returns {string}
 */
export function rewriteImageLinks(markdown, urlToLocalPath) {
  let out = String(markdown || '');
  // 按 URL 长度降序替换,避免短 URL 是长 URL 前缀时误替换。
  const urls = Object.keys(urlToLocalPath || {}).sort((a, b) => b.length - a.length);
  for (const url of urls) {
    if (!url) continue;
    out = out.split(url).join(urlToLocalPath[url]);
  }
  return out;
}

/**
 * 从 Markdown 里收集所有图片 URL(`![alt](url)` 与 HTML `<img src>`)。
 * 主要用于补充 extractArticle 之外手动场景;extractArticle 已直接产出 image_urls。
 * @param {string} markdown
 * @returns {string[]} 去重后的 http(s) 图片 URL
 */
export function collectImageUrls(markdown) {
  const md = String(markdown || '');
  const urls = new Set();
  const mdImg = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = mdImg.exec(md)) !== null) {
    urls.add(m[1]);
  }
  const htmlImg = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  while ((m = htmlImg.exec(md)) !== null) {
    urls.add(m[1]);
  }
  return [...urls];
}
