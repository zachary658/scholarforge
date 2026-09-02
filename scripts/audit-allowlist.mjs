#!/usr/bin/env node
// 依赖审计门禁：用允许列表替代 `npm audit --audit-level=high || true`。
//
// 行为：
//   - 在目标目录（server / client）内运行 `npm audit --json`；
//   - 读取该目录下的 audit-allowlist.json（{ "advisories": ["GHSA-..."] }）；
//   - 仅当所有 high/critical 漏洞的 GHSA 编号都在允许列表中时才通过；
//   - 出现任何未列出的 high/critical 漏洞 → 退出码 1，阻断 CI；
//   - npm audit 因网络/注册表不可用而无法解析时 → 退出码 2（不静默放行）。
//
// 用法（CI 中 working-directory 为 server 或 client）：
//   node ../scripts/audit-allowlist.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const allowlistPath = resolve(process.argv[2] || 'audit-allowlist.json');

let allowlist;
try {
  const raw = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  allowlist = new Set(raw.advisories || []);
} catch (e) {
  console.error(`[audit] 无法读取允许列表 ${allowlistPath}: ${e.message}`);
  process.exit(2);
}

const res = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
let report;
try {
  report = JSON.parse(res.stdout || '{}');
} catch {
  console.error('[audit] npm audit 未返回可解析 JSON（可能因网络/注册表不可用）。');
  console.error((res.stderr || res.stdout || '').slice(0, 2000));
  process.exit(2);
}

const vulns = report.vulnerabilities || {};
const offenders = new Map(); // GHSA id -> Set(受影响包)

// 递归解析 via：对象项取 url 中的 GHSA 编号，字符串项指向同报告内另一个包，继续下钻。
function collectAdvisories(pkg, seen = new Set()) {
  const v = vulns[pkg];
  if (!v || seen.has(pkg)) return [];
  seen.add(pkg);
  const ids = [];
  for (const via of v.via || []) {
    if (typeof via === 'string') {
      ids.push(...collectAdvisories(via, seen));
    } else if (via && via.url) {
      const m = via.url.match(/GHSA-[a-z0-9-]+/i);
      if (m) ids.push(m[0]);
    }
  }
  return ids;
}

for (const [pkg, v] of Object.entries(vulns)) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;
  for (const id of collectAdvisories(pkg)) {
    if (!allowlist.has(id)) {
      if (!offenders.has(id)) offenders.set(id, new Set());
      offenders.get(id).add(pkg);
    }
  }
}

if (offenders.size > 0) {
  console.error('[audit] 发现未列入允许列表的 high/critical 漏洞，CI 失败：');
  for (const [id, pkgs] of offenders) {
    console.error(`  - ${id}（影响：${[...pkgs].join(', ')}）`);
  }
  console.error(`[audit] 若确认为已知且可接受的风险，请将其 GHSA 编号加入 ${allowlistPath} 的 advisories 列表。`);
  process.exit(1);
}

console.log('[audit] 通过：不存在未列入允许列表的高危漏洞。');
