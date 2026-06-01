// Content script(薄壳)。提取逻辑已抽到 src/lib/extractors/wechat-article.js。
// 本文件只负责:监听 popup 的消息、调用纯函数、(可选)在页面侧抓图打 ZIP。
//
// 为什么 ZIP 在 content script 里打:图片在 mmbiz.qpic.cn 上有防盗链(校验 Referer)。
// content script 运行在 mp.weixin.qq.com 页面上下文,fetch 时 Referer 天然正确,
// 成功率远高于在扩展页里 fetch。抓不到的图(CORS/网络)会列进 _missing-images.txt,
// 不静默吞掉,也不把它的链接改写成本地(保留远端 URL 仍可在线显示)。

import JSZip from 'jszip';
import { extractArticle } from '../lib/extractors/wechat-article.js';
import { toMarkdownDocument } from '../lib/utils/frontmatter.js';
import { assetFilename, rewriteImageLinks } from '../lib/utils/markdown-assets.js';

console.log('[WeChat Liberator] content script loaded');

/** 文件名非法字符替换为 _(导出物命名约定见 DATA_MODEL.md)。 */
function safeName(name) {
  return String(name || 'article').replace(/[/\\:*?"<>|]/g, '_').slice(0, 120) || 'article';
}

/**
 * 抓取一篇文章的图片并打成 ZIP(MD + images/ + 可选 _missing-images.txt)。
 * @param {object} record ArticleRecord
 * @returns {Promise<{ base64: string, missing: string[], fetched: number }>}
 */
async function buildZip(record) {
  const zip = new JSZip();
  const urlToLocal = {};
  const missing = [];
  let fetched = 0;

  for (const url of record.image_urls || []) {
    try {
      const resp = await fetch(url, { credentials: 'omit' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const mime = (resp.headers.get('content-type') || '').split(';')[0].trim();
      const path = assetFilename(url, mime);
      zip.file(path, buf);
      urlToLocal[url] = path;
      fetched += 1;
    } catch (e) {
      // 失败不致命:保留远端链接,记录到清单。
      missing.push(`${url}  —  ${e && e.message ? e.message : 'fetch failed'}`);
    }
  }

  let markdown = toMarkdownDocument(record);
  markdown = rewriteImageLinks(markdown, urlToLocal);
  zip.file(`${safeName(record.title)}.md`, markdown);

  if (missing.length > 0) {
    zip.file(
      '_missing-images.txt',
      ['以下图片未能下载(已在 Markdown 中保留远端链接,可手动补抓):', '', ...missing].join('\n'),
    );
  }

  const base64 = await zip.generateAsync({ type: 'base64' });
  return { base64, missing, fetched };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'EXTRACT_CONTENT') {
    try {
      const record = extractArticle(document, window);
      sendResponse({ ok: true, record });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return false; // 同步响应
  }

  if (request.type === 'BUILD_ZIP') {
    (async () => {
      try {
        const record = extractArticle(document, window);
        const { base64, missing, fetched } = await buildZip(record);
        sendResponse({
          ok: true,
          base64,
          missing,
          fetched,
          filenameBase: safeName(record.title),
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true; // 异步响应,保持通道开启
  }

  return false;
});
