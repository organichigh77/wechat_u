// Popup 交互:复制 MD / 下载 MD / 下载 HTML 快照 / 下载 ZIP(MD + 图片)。
// 提取与 ZIP 打包都在 content script 完成,popup 只负责触发与落盘。

import { toMarkdownDocument } from '../lib/utils/frontmatter.js';

const WECHAT_ARTICLE_HOST = 'mp.weixin.qq.com';

document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const buttons = {
    copy: document.getElementById('copy-btn'),
    download: document.getElementById('download-btn'),
    html: document.getElementById('html-btn'),
    zip: document.getElementById('zip-btn'),
  };

  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
  }

  function setBusy(busy) {
    Object.values(buttons).forEach((b) => {
      if (b) b.disabled = busy;
    });
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function extractRecord(tab) {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || '提取内容失败');
    }
    return response.record;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    return chrome.downloads
      .download({ url, filename, saveAs: true })
      .finally(() => setTimeout(() => URL.revokeObjectURL(url), 60_000));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function htmlSnapshot(record) {
    const title = record.title || 'article';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<meta name="liberator:source_url" content="${escapeHtml(record.source_url || '')}">
<meta name="liberator:captured_at" content="${record.captured_at || ''}">
<style>
  body { max-width: 720px; margin: 2rem auto; padding: 0 1rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #222; }
  img { max-width: 100%; height: auto; }
  pre { background: #f6f8fa; padding: 1rem; overflow: auto; border-radius: 6px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<article>${record.content_html || ''}</article>
</body>
</html>`;
  }

  function base64ToBlob(base64, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function safeName(name) {
    return String(name || 'article').replace(/[/\\:*?"<>|]/g, '_').slice(0, 120) || 'article';
  }

  async function handle(action) {
    setBusy(true);
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.url || !tab.url.includes(WECHAT_ARTICLE_HOST)) {
        showStatus('当前不是微信公众号文章页面', 'error');
        return;
      }

      if (action === 'zip') {
        showStatus('正在抓取图片并打包…');
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'BUILD_ZIP' });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || '打包失败');
        const blob = base64ToBlob(resp.base64, 'application/zip');
        await triggerDownload(blob, `${safeName(resp.filenameBase)}.zip`);
        const note = resp.missing && resp.missing.length
          ? `已下载 ZIP(${resp.fetched} 张图,${resp.missing.length} 张未抓到,见 _missing-images.txt)`
          : `已下载 ZIP(含 ${resp.fetched} 张图片)`;
        showStatus(note, 'success');
        return;
      }

      const record = await extractRecord(tab);

      if (action === 'copy') {
        await navigator.clipboard.writeText(toMarkdownDocument(record));
        showStatus('已复制 Markdown 到剪贴板!', 'success');
      } else if (action === 'download') {
        const blob = new Blob([toMarkdownDocument(record)], { type: 'text/markdown' });
        await triggerDownload(blob, `${safeName(record.title)}.md`);
        showStatus('已下载 .md 文件', 'success');
      } else if (action === 'html') {
        const blob = new Blob([htmlSnapshot(record)], { type: 'text/html' });
        await triggerDownload(blob, `${safeName(record.title)}.html`);
        showStatus('已下载 HTML 快照', 'success');
      }
    } catch (error) {
      console.error(error);
      showStatus('错误: ' + error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  buttons.copy.addEventListener('click', () => handle('copy'));
  buttons.download.addEventListener('click', () => handle('download'));
  buttons.html.addEventListener('click', () => handle('html'));
  buttons.zip.addEventListener('click', () => handle('zip'));
});
