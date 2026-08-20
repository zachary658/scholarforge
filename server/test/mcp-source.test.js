// MCP 文献源适配器单元 + 集成测试
// - parseCnkiResult：JSON 数组 / {results} 包裹 / 文本启发式 三种返回格式
// - searchCnkiViaMCP：通过 mock MCP server 验证 连接→工具发现→调用→解析 全链路
// 在 import 模块前设置临时 DB 路径（适配器链路间接加载 db），避免污染生产数据库
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

// 集成测试环境变量：拉起 mock MCP server（必须在 import 适配器之前设置，模块顶层读取配置）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockServerPath = path.resolve(__dirname, '..', 'scripts', 'mock-mcp-server.mjs');
process.env.CNKI_MCP_COMMAND = process.execPath; // node
process.env.CNKI_MCP_ARGS = JSON.stringify([mockServerPath]);
process.env.CNKI_MCP_TIMEOUT = '15000';

const { parseCnkiResult, searchCnkiViaMCP, isCnkiMCPConfigured, closeCnkiMCP } = await import('../src/services/mcp-literature-source.js');

// 测试结束显式关闭 MCP 连接（终止子进程），避免测试进程因活跃句柄挂住
test.after(async () => {
  await closeCnkiMCP();
});

test('parseCnkiResult：JSON 数组格式', () => {
  const text = JSON.stringify([
    { title: '论文A', authors: '张三;李四', journal: '计算机学报', year: '2023', abstract: '摘要A' },
    { title: '论文B', authors: '王五', journal: '自动化学报', year: '2022' },
  ]);
  const papers = parseCnkiResult(text, 8);
  assert.equal(papers.length, 2, '应解析出 2 篇');
  assert.equal(papers[0].title, '论文A');
  assert.equal(papers[0].authors, '张三, 李四', '分号分隔作者应归一化为逗号');
  assert.equal(papers[0].source_db, 'CNKI');
  assert.equal(papers[0].journal, '计算机学报');
});

test('parseCnkiResult：{results} 包裹格式与数量截断', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ title: `论文${i}`, authors: '作者' }));
  const papers = parseCnkiResult(JSON.stringify({ results: items }), 5);
  assert.equal(papers.length, 5, '应按 limit 截断');
});

test('parseCnkiResult：文本启发式解析', () => {
  const text = [
    '1. 基于深度学习的图像分割',
    '张三, 李四',
    '计算机学报 2023(5): 45-52',
    '2. 注意力机制综述',
    '王五',
    '自动化学报 2022(3): 1-10',
  ].join('\n');
  const papers = parseCnkiResult(text, 8);
  assert.equal(papers.length, 2, '应解析出 2 篇');
  assert.equal(papers[0].title, '基于深度学习的图像分割');
  assert.equal(papers[0].year, '2023');
  assert.equal(papers[1].authors, '王五');
});

test('searchCnkiViaMCP：mock server 全链路（连接→工具发现→调用→解析）', async () => {
  assert.ok(isCnkiMCPConfigured(), '测试环境应已配置 CNKI_MCP_COMMAND');
  const result = await searchCnkiViaMCP('医学影像分割', 8);
  assert.equal(result.disabled, false, '不应处于未配置状态');
  assert.ok(result.papers.length >= 1, '应返回检索结果');
  const p = result.papers[0];
  assert.equal(p.source_db, 'CNKI', '来源应为 CNKI');
  assert.ok(p.title.includes('医学图像分割') || p.title.includes('医学影像分割'), '标题应来自 mock 数据');
});
