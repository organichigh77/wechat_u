// 公众号文章提取核心管线。从原 src/content/index.js 抽离为可测试的纯函数。
//
// extractArticle(document, window) -> ArticleRecord
//   - 既能被 popup 触发(EXTRACT_CONTENT),也能被 Act 2 的自动归档内部调用。
//   - 不依赖 chrome.* API,只吃 DOM + window,便于 Vitest + jsdom 跑 fixture。
//
// 字段规格见 docs/DATA_MODEL.md § articles;选择器/window 变量见 docs/CAPTURE_SPEC.md § A。

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { cleanWeChatUrl } from '../utils/url-cleaner.js';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});
turndownService.use(gfm);
turndownService.addRule('wechat-code', {
  filter(node) {
    return node.nodeName === 'PRE' && node.classList && node.classList.contains('code-snippet__js');
  },
  replacement(content) {
    return '```\n' + content + '\n```';
  },
});

const NOISE_SELECTORS = [
  '#js_pc_qr_code',
  '.rich_media_area_extra',
  '#js_tags',
  '#js_view_source',
  '.reward_area',
  '.like_comment_primary_inner',
  '.mp_profile_iframe',
  'mp-common-profile',
  'mp-miniprogram',
  '.rich_media_tool',
  '#js_toobar3',
  '.profile_container',
];

const FOOTER_KEYWORDS = [
  '相关文章推荐',
  '往期推荐',
  '欢迎加入',
  '关注我们',
  '点击下方卡片',
  '扫描二维码',
  '识别二维码',
  '长按识别',
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从整页 HTML 文本里提取微信注入的 JS 变量,如 `var biz = "MzI..." || "";`。
 * 优先取引号内的值,降级取到分号/竖线/换行前的裸 token。
 * @param {string} html
 * @param {string} name
 * @returns {string|null}
 */
export function pickWindowVar(html, name) {
  const src = String(html || '');
  const n = escapeRegExp(name);
  const dq = src.match(new RegExp(`(?:var\\s+|window\\.)?${n}\\s*=\\s*"([^"]*)"`));
  if (dq) return dq[1];
  const sq = src.match(new RegExp(`(?:var\\s+|window\\.)?${n}\\s*=\\s*'([^']*)'`));
  if (sq) return sq[1];
  const uq = src.match(new RegExp(`(?:var\\s+|window\\.)?${n}\\s*=\\s*([^;\\n|]+)`));
  if (uq) return uq[1].trim() || null;
  return null;
}

function textOf(root, selector) {
  const el = root.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 在 LIVE DOM 上(克隆前)用 getComputedStyle 标记「伪标题」(字号接近正文的 h1~h6)。
 * jsdom 下 getComputedStyle 一般返回空 fontSize,自动跳过,不影响测试。
 * @param {Document} doc
 * @param {Window} win
 */
function markFakeHeaders(doc, win) {
  try {
    const contentBox = doc.querySelector('#js_content');
    if (!contentBox || !win || typeof win.getComputedStyle !== 'function') return;

    const sampleP = contentBox.querySelector('p');
    let bodyFontSize = 16;
    if (sampleP) {
      const fs = parseFloat(win.getComputedStyle(sampleP).fontSize);
      if (!Number.isNaN(fs) && fs > 0) bodyFontSize = fs;
    }

    const headers = contentBox.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headers.forEach((header) => {
      const fs = parseFloat(win.getComputedStyle(header).fontSize);
      if (!Number.isNaN(fs) && Math.abs(fs - bodyFontSize) <= 2) {
        header.setAttribute('data-wechat-downgrade-header', 'true');
      }
    });
  } catch {
    /* 视觉检测失败不致命,跳过降级即可 */
  }
}

/** 修复懒加载图片(data-src -> src),清掉可能干扰的 style/class。 */
function fixLazyImages(clone) {
  clone.querySelectorAll('img').forEach((img) => {
    if (img.dataset && img.dataset.src) {
      img.setAttribute('src', img.dataset.src);
    }
    img.removeAttribute('style');
    img.removeAttribute('class');
  });
}

/** 把微信非标准代码块标准化为 <pre><code>。 */
function normalizeCodeBlocks(clone) {
  const codeSelectors = ['.code-snippet__fix', '.code-snippet', 'pre'];
  const selectorStr = codeSelectors.join(',');
  const potential = clone.querySelectorAll(selectorStr);

  const topLevel = Array.from(potential).filter((block) => {
    let parent = block.parentElement;
    while (parent) {
      if (parent.matches && parent.matches(selectorStr)) return false;
      parent = parent.parentElement;
    }
    return true;
  });

  topLevel.forEach((block) => {
    const temp = block.cloneNode(true);
    temp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const codeContent = temp.textContent;

    const pre = clone.createElement('pre');
    const code = clone.createElement('code');
    code.textContent = codeContent;
    pre.appendChild(code);
    block.replaceWith(pre);
  });
}

/** 删除噪声节点(二维码、赞赏、推荐、底部工具栏等)。 */
function removeNoise(clone) {
  NOISE_SELECTORS.forEach((selector) => {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  });
}

/** 启发式尾部清理 + 伪标题降级(基于克隆前打的标记)。 */
function cleanFooterAndDowngrade(clone) {
  const container = clone.querySelector('#js_content');
  if (!container) return;

  const children = Array.from(container.children);
  let foundFooter = false;

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    const text = child.textContent.trim();

    if (child.hasAttribute && child.hasAttribute('data-wechat-downgrade-header')) {
      const p = clone.createElement('p');
      p.innerHTML = child.innerHTML;
      child.replaceWith(p);
      children[i] = p;
    }

    if (!foundFooter) {
      for (const keyword of FOOTER_KEYWORDS) {
        if (text.includes(keyword)) {
          if (text.length < 50 || text.startsWith(keyword)) {
            foundFooter = true;
            if (i > 0) {
              const prev = children[i - 1];
              const prevText = prev.textContent.trim();
              if (prevText.length < 5 && /^\d+$/.test(prevText)) {
                prev.remove();
              }
            }
            break;
          }
        }
      }
    }

    if (foundFooter) child.remove();
  }
}

/** 收集正文容器内所有 http(s) 图片 URL(懒加载已修复),去重。 */
function collectImageUrls(container) {
  if (!container) return [];
  const urls = [];
  const seen = new Set();
  container.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (/^https?:\/\//i.test(src) && !seen.has(src)) {
      seen.add(src);
      urls.push(src);
    }
  });
  return urls;
}

/**
 * 主入口:从微信文章页提取结构化 ArticleRecord。
 * @param {Document} doc  默认全局 document(content script 环境)
 * @param {Window} win   默认全局 window
 * @returns {object} ArticleRecord
 */
export function extractArticle(
  doc = (typeof document !== 'undefined' ? document : null),
  win = (typeof window !== 'undefined' ? window : null),
) {
  if (!doc) throw new Error('extractArticle: 缺少 document');
  const fullHtml = doc.documentElement ? doc.documentElement.outerHTML : '';
  const href = (win && win.location && win.location.href) || '';

  // 1) 元数据:URL 参数优先,window 变量兜底。
  let params = null;
  try {
    if (href) params = new URL(href).searchParams;
  } catch {
    params = null;
  }
  const fromUrl = (key) => (params && params.get(key)) || null;

  const __biz = fromUrl('__biz') || pickWindowVar(fullHtml, 'biz') || '';
  const mid = fromUrl('mid') || pickWindowVar(fullHtml, 'mid') || '';
  const idx = fromUrl('idx') || pickWindowVar(fullHtml, 'idx') || '';
  const sn = fromUrl('sn') || pickWindowVar(fullHtml, 'sn') || '';

  const id = `${__biz}_${mid}_${idx}_${sn}`;
  const sourceUrl = href;
  const cleanSourceUrl = cleanWeChatUrl(sourceUrl).url;

  const nickname = textOf(doc, '#js_name') || pickWindowVar(fullHtml, 'nickname') || '';
  const avatarUrl = pickWindowVar(fullHtml, 'ori_head_img_url') || '';
  const coverUrl = pickWindowVar(fullHtml, 'msg_cdn_url') || '';
  const summaryRaw = pickWindowVar(fullHtml, 'msg_desc') || '';
  const summary = summaryRaw ? summaryRaw.slice(0, 200) : '';
  const author = textOf(doc, '#js_author_name') || '';

  const ct = toNumberOrNull(pickWindowVar(fullHtml, 'ct'));
  const pubTime = ct ? ct * 1000 : null;

  const copyrightStat = toNumberOrNull(pickWindowVar(fullHtml, 'copyright_stat'));
  const isOnlyRead = pickWindowVar(fullHtml, 'is_only_read');
  const isOriginal = isOnlyRead != null ? isOnlyRead === '1' : (copyrightStat === 11 ? true : undefined);

  const domTitle = textOf(doc, '#activity-name');
  const msgTitle = pickWindowVar(fullHtml, 'msg_title') || '';

  // 2) 视觉伪标题标记(克隆前,需 live DOM)。
  markFakeHeaders(doc, win);

  // 3) 克隆 + 清洗管线。
  const clone = doc.cloneNode(true);
  fixLazyImages(clone);
  normalizeCodeBlocks(clone);
  removeNoise(clone);
  cleanFooterAndDowngrade(clone);

  const contentContainer = clone.querySelector('#js_content');
  if (!contentContainer) {
    throw new Error('未找到文章正文(#js_content),当前可能不是公众号图文页面');
  }
  const imageUrls = collectImageUrls(contentContainer);

  // 4) Readability 解析,失败兜底直接吃 #js_content。
  let title = domTitle || msgTitle || '';
  let contentMd = '';
  let contentHtml = '';
  let readabilityOk = false;

  try {
    const reader = new Readability(clone.cloneNode(true));
    const article = reader.parse();
    if (article && article.content) {
      readabilityOk = true;
      if (!title) title = (article.title || '').trim();
      contentHtml = article.content;
      contentMd = turndownService.turndown(article.content).trim();
    }
  } catch {
    readabilityOk = false;
  }

  if (!readabilityOk || !contentMd) {
    // 兜底:Readability 失败时直接用清洗后的 #js_content innerHTML 走 Turndown。
    contentHtml = contentContainer.innerHTML;
    contentMd = turndownService.turndown(contentHtml).trim();
    if (!title) title = domTitle || msgTitle || (doc.title || '').trim();
  }

  if (!contentMd) {
    throw new Error('文章正文为空,提取失败');
  }

  return {
    id,
    __biz,
    mid,
    idx,
    sn,
    source_url: sourceUrl,
    clean_source_url: cleanSourceUrl,
    title,
    author,
    pub_account_biz: __biz,
    pub_account_name: nickname,
    pub_account_avatar_url: avatarUrl,
    pub_time: pubTime,
    captured_at: Date.now(),
    is_original: typeof isOriginal === 'boolean' ? isOriginal : undefined,
    copyright_stat: copyrightStat,
    summary,
    cover_url: coverUrl,
    content_md: contentMd,
    content_html: contentHtml,
    image_urls: imageUrls,
    archive_version: 1,
    _readability_ok: readabilityOk,
  };
}
