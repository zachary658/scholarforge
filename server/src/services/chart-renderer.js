/**
 * 统一图表/公式渲染服务
 * 支持：
 *   1. vega-lite 数据图表（柱状/折线/饼图/散点/雷达等）→ SVG → PNG
 *   2. 流程图/架构图（简化 mermaid 语法，自实现 SVG 生成，无浏览器依赖）
 *   3. SVG → PNG 转换（sharp）
 *
 * 设计目标：在无 Chromium/puppeteer 的环境下，仍能生成知网级质量的图表
 * 数学公式（LaTeX）已迁移为可编辑的 OMML（见 docx-generator.js），不再使用已废弃的 mathjax-node
 */

// 动态导入 vega/vega-lite（它们是 ESM + top-level await，不能用 require）
let _vega = null;
let _vegaLite = null;
async function ensureVega() {
  if (_vega && _vegaLite) return { vega: _vega, vegaLite: _vegaLite };
  _vega = await import('vega');
  _vegaLite = await import('vega-lite');
  return { vega: _vega, vegaLite: _vegaLite };
}

// 动态导入 sharp
let _sharp = null;
async function ensureSharp() {
  if (_sharp) return _sharp;
  const mod = await import('sharp');
  _sharp = mod.default;
  return _sharp;
}

// ===== SVG → PNG 转换 =====
/**
 * 将 SVG 字符串转为 PNG Buffer
 * @param {string} svg SVG 字符串
 * @param {number} scale 缩放倍数（2 = 2倍清晰度，适配 Word 打印）
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
// 出站 SVG 净化（纵深防御）：剥离 <script>、事件处理器（on\w+）与 javascript: 伪协议，
// 即便上游生成逻辑被绕过，也不会向渲染管道 / 客户端注入可执行内容（M-1 加固）。
export function sanitizeSvg(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}

export async function svgToPng(svg, scale = 2) {
  svg = sanitizeSvg(svg);
  const sharp = await ensureSharp();
  // 修复 mathjax 等 SVG 缺少 xlink 命名空间声明的问题（sharp/libxml2 严格校验）
  if (svg.includes('xlink:') && !svg.includes('xmlns:xlink')) {
    svg = svg.replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
  }
  // 解析尺寸：优先 viewBox（mathjax 等用 ex/em 单位，viewBox 是绝对坐标）
  // viewBox="minX minY width height"
  const vbMatch = svg.match(/viewBox=["']?\s*[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  let width, height;
  if (vbMatch) {
    // mathjax viewBox 单位是 1/100 em，1 em ≈ 12pt，12pt = 16px
    // 所以 viewBox 单位 × 0.16 ≈ 像素；再乘 scale 得到高清图
    const vbW = parseFloat(vbMatch[1]);
    const vbH = parseFloat(vbMatch[2]);
    // mathjax 的 viewBox 值通常很大（如 3864.5），需要缩放到合理像素
    // 目标宽度 400px，按比例计算高度
    const targetW = Math.min(600, Math.max(200, vbW * 0.12));
    const ratio = vbH / vbW;
    width = targetW;
    // P15: 限制高度上限 2000px，防止极端 viewBox 比例导致 OOM
    height = Math.min(2000, targetW * ratio);
  } else {
    // 从 width/height 属性解析（vega-lite 用像素单位）
    const wMatch = svg.match(/width=["']?(\d+\.?\d*)/);
    const hMatch = svg.match(/height=["']?(\d+\.?\d*)/);
    width = wMatch ? parseFloat(wMatch[1]) : 600;
    height = hMatch ? parseFloat(hMatch[1]) : 400;
  }
  // 用 sharp 的 density 控制清晰度，不修改 SVG 的 width/height（避免破坏命名空间声明）
  const buffer = await sharp(Buffer.from(svg), { density: Math.round(96 * scale) })
    .resize(Math.round(width * scale), Math.round(height * scale), { fit: 'contain' })
    .png()
    .toBuffer();
  return { buffer, width: Math.round(width), height: Math.round(height) };
}

// ===== vega-lite 数据图表渲染 =====
// 安全：受限 loader 禁止加载任何外部数据源（data.url），仅允许内联数据，防止 SSRF
// （对应 CVE-2025-27793 / open-webui GHSA-rffm-9q57-q649 的 data.url 风险）
const restrictedLoader = {
  load: (uri) => Promise.reject(new Error('禁止加载外部数据源')),
  sanitize: (uri) => String(uri),
  http: () => Promise.reject(new Error('禁止加载外部 HTTP 数据源')),
  file: () => Promise.reject(new Error('禁止加载本地文件数据源')),
  baseURL: () => '',
};

// 递归拒绝外部数据源（data.url）与表达式/信号注入点，防止 SSRF 与任意代码执行
// （对应 CVE-2025-27793 / open-webui GHSA-rffm-9q57-q649）
function assertSafeVegaSpec(node, path = 'spec') {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => assertSafeVegaSpec(n, `${path}[${i}]`));
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url') throw new Error('图表禁止使用外部数据源（data.url）');
    if (k === 'expr' || k === 'signal' || k === 'param' || k === 'params' || k === 'calculate') {
      throw new Error(`图表禁止使用表达式/信号（${path}.${k}）`);
    }
    assertSafeVegaSpec(v, `${path}.${k}`);
  }
}

/**
 * 用 vega-lite 渲染数据图表
 * @param {object} spec vega-lite 规范
 * @returns {Promise<{png: Buffer, width: number, height: number}>}
 */
export async function renderChart(spec) {
  const { vega, vegaLite } = await ensureVega();
  assertSafeVegaSpec(spec);
  // 学术风格配置：白底、无网格、Times 字体感
  const styledSpec = {
    ...spec,
    config: {
      background: '#ffffff',
      font: 'serif',
      axis: {
        labelFontSize: 12,
        titleFontSize: 13,
        domainColor: '#333',
        tickColor: '#333',
        labelColor: '#333',
        titleColor: '#333',
      },
      legend: {
        labelFontSize: 12,
        titleFontSize: 13,
      },
      title: {
        fontSize: 14,
        anchor: 'middle',
      },
      ...spec.config,
    },
  };
  const compiled = vegaLite.compile(styledSpec).spec;
  const view = new vega.View(vega.parse(compiled), {
    renderer: 'none',
    // 安全：受限 loader 阻断外部数据加载（SSRF）
    loader: restrictedLoader,
  });
  try {
    const svg = await view.toSVG();
    const rendered = await svgToPng(svg, 2);
    // 高层渲染 API 历史上存在两种调用约定：Word 生成器读取 buffer，
    // 图表下载接口读取 png。两者指向同一个 Buffer，兼容旧调用方并避免额外复制。
    return { ...rendered, png: rendered.buffer };
  } finally {
    // P14: 释放 vega View 内部资源（DOM 事件监听、定时器等），防止内存泄漏
    view.finalize();
  }
}

// ===== 流程图/架构图渲染（自实现，无浏览器依赖）=====
//
// 支持简化的 mermaid 语法子集：
//   graph TD | graph LR          方向：TD=自上而下，LR=从左到右
//   A[文本]                       矩形节点
//   A(文本)                       圆角矩形
//   A{文本}                       菱形（判断节点）
//   A((文本))                     圆形
//   A --> B                       箭头
//   A -->|标签| B                 带标签箭头
//   A --- B                       无箭头连接
//   A --> C                       多对一/多分支
//
// 自动分层布局：按拓扑序分层，每层水平/垂直排列

/**
 * 解析简化版 mermaid 语法
 * @returns {{nodes: Map, edges: Array, direction: 'TD'|'LR'}}
 */
function parseMermaid(code) {
  const lines = code.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let direction = 'TD';
  const nodes = new Map(); // id -> { id, text, shape }
  const edges = [];

  // Mermaid 常用节点写法。圆形必须先于圆角矩形匹配，避免 ((文本)) 被误判。
  function parseNodeToken(token) {
    const match = String(token).trim().match(
      /^([A-Za-z0-9_]+)\s*(?:(?:\[([^\]]*)\])|(?:\(\(([^)]*)\)\))|(?:\(([^)]*)\))|(?:\{([^}]*)\}))?$/
    );
    if (!match) return null;
    const [, id, bracket, circle, round, diamond] = match;
    if (bracket !== undefined) return { id, text: bracket, shape: 'rect', explicit: true };
    if (circle !== undefined) return { id, text: circle, shape: 'circle', explicit: true };
    if (round !== undefined) return { id, text: round, shape: 'round', explicit: true };
    if (diamond !== undefined) return { id, text: diamond, shape: 'diamond', explicit: true };
    return { id, text: id, shape: 'rect', explicit: false };
  }

  // 边：两端都允许携带节点文字/形状，例如 A[开始] -->|通过| B{完成?}
  const edgeRegex = /^(.+?)\s*(-->|---)\s*(?:\|([^|]*)\|\s*)?(.+?)$/;

  for (const line of lines) {
    if (/^graph\s+(TD|LR|TB)/i.test(line)) {
      direction = line.match(/^graph\s+(TD|LR|TB)/i)[1].toUpperCase().replace('TB', 'TD');
      continue;
    }
    // 尝试匹配边
    const em = line.match(edgeRegex);
    if (em) {
      const [, fromToken, arrow, label, toToken] = em;
      const fromNode = parseNodeToken(fromToken);
      const toNode = parseNodeToken(toToken);
      if (fromNode && toNode) {
        for (const node of [fromNode, toNode]) {
          if (!nodes.has(node.id)) {
            nodes.set(node.id, { id: node.id, text: node.text, shape: node.shape });
          } else if (node.explicit) {
            const existing = nodes.get(node.id);
            existing.text = node.text;
            existing.shape = node.shape;
          }
        }
        edges.push({ from: fromNode.id, to: toNode.id, arrow: arrow === '-->', label: label || '' });
        continue;
      }
    }
    // 尝试匹配独立节点定义
    const node = parseNodeToken(line);
    if (node?.explicit) {
      nodes.set(node.id, { id: node.id, text: node.text, shape: node.shape });
    }
  }
  // P15: 限制节点和边数量，防止超大流程图导致渲染时间过长或 OOM
  if (nodes.size > 200) throw new Error(`流程图节点数 ${nodes.size} 超过上限 200`);
  if (edges.length > 500) throw new Error(`流程图边数 ${edges.length} 超过上限 500`);
  return { nodes, edges, direction };
}

/**
 * 分层布局：按拓扑序将节点分配到各层
 * @returns {Array<Array<string>>} 每层的节点 id 数组
 */
function layoutLayers(nodes, edges) {
  // 计算入度
  const inDegree = new Map();
  for (const id of nodes.keys()) inDegree.set(id, 0);
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }
  // 拓扑分层：入度为 0 的在第 0 层，逐层推进
  const layers = [];
  const placed = new Set();
  const remaining = new Set(nodes.keys());
  // 先放入度为 0 的
  let current = [...nodes.keys()].filter((id) => (inDegree.get(id) || 0) === 0);
  if (current.length === 0 && nodes.size > 0) {
    // 有环，取第一个节点
    current = [nodes.keys().next().value];
  }
  while (remaining.size > 0) {
    const layer = [];
    for (const id of current) {
      if (!placed.has(id)) {
        layer.push(id);
        placed.add(id);
        remaining.delete(id);
      }
    }
    if (layer.length === 0) break;
    layers.push(layer);
    // 找下一层：已放置节点的后继中，所有前驱都已放置的
    const next = [];
    for (const id of remaining) {
      const preds = edges.filter((e) => e.to === id).map((e) => e.from);
      if (preds.every((p) => placed.has(p))) next.push(id);
    }
    if (next.length === 0 && remaining.size > 0) {
      // 有环，把剩余节点都放下一层
      next.push(...remaining);
    }
    current = next;
  }
  return layers;
}

/**
 * 生成流程图 SVG
 * @param {string} code mermaid 语法代码
 * @returns {Promise<{png: Buffer, width: number, height: number}>}
 */
export async function renderFlowchart(code) {
  const { nodes, edges, direction } = parseMermaid(code);
  if (nodes.size === 0) throw new Error('流程图无节点');

  const layers = layoutLayers(nodes, edges);
  const isVertical = direction === 'TD';

  // 布局参数
  const nodeW = 140;
  const nodeH = 50;
  const gapX = 60; // 同层节点间距
  const gapY = 80; // 层间距
  const pad = 30;
  const fontSize = 13;

  // 计算每层宽度/高度，确定画布尺寸
  const layerSizes = layers.map((layer) => layer.length);
  const maxLayerCount = Math.max(...layerSizes);
  const canvasW = isVertical
    ? maxLayerCount * (nodeW + gapX) - gapX + pad * 2
    : layers.length * (nodeW + gapX) - gapX + pad * 2;
  const canvasH = isVertical
    ? layers.length * (nodeH + gapY) - gapY + pad * 2
    : maxLayerCount * (nodeH + gapY) - gapY + pad * 2;

  // 计算每个节点的坐标（中心点）
  const positions = new Map();
  layers.forEach((layer, li) => {
    const layerSize = layer.length;
    if (isVertical) {
      // 每层水平排列
      const totalW = layerSize * (nodeW + gapX) - gapX;
      const startX = (canvasW - totalW) / 2;
      layer.forEach((id, i) => {
        positions.set(id, {
          x: startX + i * (nodeW + gapX) + nodeW / 2,
          y: pad + li * (nodeH + gapY) + nodeH / 2,
        });
      });
    } else {
      // LR：每层垂直排列
      const totalH = layerSize * (nodeH + gapY) - gapY;
      const startY = (canvasH - totalH) / 2;
      layer.forEach((id, i) => {
        positions.set(id, {
          x: pad + li * (nodeW + gapX) + nodeW / 2,
          y: startY + i * (nodeH + gapY) + nodeH / 2,
        });
      });
    }
  });

  // 生成 SVG
  const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">`;
  svg += `<rect width="${canvasW}" height="${canvasH}" fill="#ffffff"/>`;

  // 先画边（在节点下方）
  for (const e of edges) {
    const from = positions.get(e.from);
    const to = positions.get(e.to);
    if (!from || !to) continue;

    // 计算连接点（节点边缘）
    let x1 = from.x, y1 = from.y, x2 = to.x, y2 = to.y;
    if (isVertical) {
      y1 = from.y + nodeH / 2;
      y2 = to.y - nodeH / 2;
    } else {
      x1 = from.x + nodeW / 2;
      x2 = to.x - nodeW / 2;
    }

    // 绘制连接线（折线或直线）
    if (isVertical) {
      const midY = (y1 + y2) / 2;
      svg += `<path d="M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}" stroke="#555" stroke-width="1.5" fill="none"`;
    } else {
      const midX = (x1 + x2) / 2;
      svg += `<path d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}" stroke="#555" stroke-width="1.5" fill="none"`;
    }
    if (e.arrow) {
      svg += ` marker-end="url(#arrowhead)"`;
    }
    svg += `/>`;

    // 边标签
    if (e.label) {
      const lx = (x1 + x2) / 2;
      const ly = isVertical ? (y1 + y2) / 2 : (y1 + y2) / 2 - 5;
      const labelW = escapeXml(e.label).length * fontSize * 0.6 + 10;
      svg += `<rect x="${lx - labelW / 2}" y="${ly - 10}" width="${labelW}" height="20" fill="#ffffff" stroke="#ddd" rx="3"/>`;
      svg += `<text x="${lx}" y="${ly + 5}" text-anchor="middle" font-size="${fontSize - 2}" fill="#666" font-family="serif">${escapeXml(e.label)}</text>`;
    }
  }

  // 箭头标记定义
  svg += `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#555"/></marker></defs>`;

  // 画节点
  for (const [id, node] of nodes) {
    const pos = positions.get(id);
    if (!pos) continue;
    const x = pos.x - nodeW / 2;
    const y = pos.y - nodeH / 2;
    const text = escapeXml(node.text);
    const textLines = wrapText(node.text, 8);
    const cy = pos.y - (textLines.length - 1) * fontSize / 2;

    if (node.shape === 'rect') {
      svg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" fill="#e8f0fe" stroke="#4a86c8" stroke-width="1.5" rx="2"/>`;
    } else if (node.shape === 'round') {
      svg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" fill="#e6f4ea" stroke="#34a853" stroke-width="1.5" rx="20"/>`;
    } else if (node.shape === 'diamond') {
      const dw = nodeW / 2 + 10;
      const dh = nodeH / 2 + 10;
      svg += `<polygon points="${pos.x},${pos.y - dh} ${pos.x + dw},${pos.y} ${pos.x},${pos.y + dh} ${pos.x - dw},${pos.y}" fill="#fef7e0" stroke="#fbbc04" stroke-width="1.5"/>`;
    } else if (node.shape === 'circle') {
      svg += `<circle cx="${pos.x}" cy="${pos.y}" r="${nodeH / 2 + 5}" fill="#fce8e6" stroke="#ea4335" stroke-width="1.5"/>`;
    }

    // 节点文字（多行居中）
    textLines.forEach((line, i) => {
      svg += `<text x="${pos.x}" y="${cy + i * fontSize}" text-anchor="middle" font-size="${fontSize}" fill="#333" font-family="serif">${escapeXml(line)}</text>`;
    });
  }

  svg += `</svg>`;
  const rendered = await svgToPng(svg, 2);
  return { ...rendered, png: rendered.buffer };
}

// 简单文本换行（按字符数）
function wrapText(text, maxChars) {
  if (!text) return [''];
  const chars = [...text];
  if (chars.length <= maxChars) return [text];
  const lines = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    lines.push(chars.slice(i, i + maxChars).join(''));
  }
  return lines;
}

// ===== 统一渲染入口 =====
/**
 * 根据代码块类型渲染为 PNG
 * @param {string} type 类型：vega | mermaid | math
 * @param {string|object} content vega 规范对象 / mermaid 代码 / LaTeX 字符串
 * @returns {Promise<{png: Buffer, width: number, height: number}>}
 */
// P15: 各类型渲染超时时间（毫秒）
const RENDER_TIMEOUTS = { vega: 10000, chart: 10000, mermaid: 8000, flowchart: 8000 };

export async function renderBlock(type, content) {
  let promise;
  switch (type) {
    case 'vega':
    case 'chart': {
      let spec;
      try {
        spec = typeof content === 'string' ? JSON.parse(content) : content;
      } catch (e) {
        throw new Error(`图表 JSON 解析失败：${e.message}`);
      }
      promise = renderChart(spec);
      break;
    }
    case 'mermaid':
    case 'flowchart':
      promise = renderFlowchart(content);
      break;
    default:
      throw new Error('未知图表类型: ' + type);
  }
  const timeout = RENDER_TIMEOUTS[type] || 10000;
  // P15: 渲染超时保护，超时后 reject 并降级
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${type} 渲染超时（${timeout / 1000}s）`)), timeout)
    ),
  ]);
}
