// SSRF 与异常降级单元测试（PDF 下载通道）
// 覆盖：
//   1) PDF 下载禁止内网地址（回环 / RFC1918 私网 / 云元数据）
//   2) PDF 下载禁止危险重定向（3xx 跳转，含跳向内网/元数据端点的场景）
//   3) OA PDF 下载/解析失败时静默降级（不抛错、不影响既有 benchmarks）
// 使用临时数据库与 fetch 打桩，离线可跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ssrf-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const { downloadPdfBytes, enrichSourcesFromOpenAccess } = await import('../src/services/paper-distillation.js');

// ---------- 1) PDF 下载禁止内网地址（assertSafeAiResolvedUrl allowPrivate:false） ----------
const INTERNAL_URLS = [
  ['http://127.0.0.1:8080/paper.pdf', '回环 IPv4'],
  ['http://10.0.0.5/paper.pdf', 'RFC1918 私网 A'],
  ['http://172.16.0.1/paper.pdf', 'RFC1918 私网 B'],
  ['http://192.168.1.1/paper.pdf', 'RFC1918 私网 C'],
  ['http://169.254.169.254/latest/meta-data/', '云元数据'],
  ['http://[::1]/paper.pdf', 'IPv6 回环'],
];
for (const [url, label] of INTERNAL_URLS) {
  test(`PDF 下载拒绝内网地址: ${label} -> ${url}`, async () => {
    await assert.rejects(() => downloadPdfBytes(url), /不允许|拒绝|回环|链路本地|云元数据|私网/);
  });
}

// ---------- 2) PDF 下载禁止危险重定向 ----------
// 公网 IP 字面量（8.8.8.8）可通过地址校验（无需 DNS），fetch 打桩返回 3xx：
// 验证即使目标"看起来"是公网，也绝不自动跟随重定向（防校验后跳转内网/元数据）。
test('PDF 下载拒绝 3xx 重定向（含跳向内网地址）', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
    });
  };
  try {
    await assert.rejects(
      () => downloadPdfBytes('http://8.8.8.8/paper.pdf'),
      /重定向/,
      '3xx 响应必须被拒绝，不允许跟随',
    );
    assert.equal(calls.length, 1, '不应发起第二次请求（未跟随重定向）');
    assert.equal(calls[0], 'http://8.8.8.8/paper.pdf');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('PDF 下载拒绝 301/307 等其他 3xx 状态码', async () => {
  const realFetch = globalThis.fetch;
  for (const status of [301, 307, 308]) {
    globalThis.fetch = async () => new Response(null, { status, headers: { Location: 'http://10.0.0.1/x' } });
    try {
      await assert.rejects(() => downloadPdfBytes('http://8.8.8.8/paper.pdf'), /重定向/);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});

// ---------- 3) 异常降级：下载失败静默跳过，不影响既有结果 ----------
test('OA PDF 下载失败时静默降级（SSRF 拒绝 → 跳过该文献，不抛错）', async () => {
  const benchmarks = [{ metric: 'acc', value: 92 }];
  const papers = [
    { title: '内网目标论文', pdf_url: 'http://192.168.1.100/paper.pdf' },
    { title: '回环目标论文', pdf_url: 'http://127.0.0.1:9000/paper.pdf' },
  ];
  // enrichSourcesFromOpenAccess 内部捕获下载失败并跳过（降级），不应向外抛错
  const result = await enrichSourcesFromOpenAccess(papers, benchmarks);
  assert.deepEqual(result.benchmarks, benchmarks, '下载失败不应影响既有 benchmarks');
  assert.deepEqual(result.tables, [], '不应产出任何表格');
});

test('OA PDF 下载超时/网络错误时静默降级', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network unreachable');
  };
  try {
    const benchmarks = [{ metric: 'f1', value: 88 }];
    const result = await enrichSourcesFromOpenAccess(
      [{ title: '网络故障论文', pdf_url: 'http://8.8.8.8/paper.pdf' }],
      benchmarks,
    );
    assert.deepEqual(result.benchmarks, benchmarks, '网络错误不应影响既有 benchmarks');
  } finally {
    globalThis.fetch = realFetch;
  }
});
