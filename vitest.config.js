/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Turndown 在 Node 下需要一个全局 DOM 来解析 HTML 字符串;jsdom 环境同时
// 满足 Readability(测试里用独立 JSDOM 实例喂 fixture)与 Turndown 的 DOMParser 依赖。
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    globals: false,
  },
});
