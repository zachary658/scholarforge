// 模拟文献检索 MCP server（stdio JSON-RPC）
// 用途：mcp-literature-source.js 集成测试的 mock 端，验证 MCP 连接/工具发现/调用/解析全链路。
// 运行方式：node scripts/mock-mcp-server.mjs（由测试通过 CNKI_MCP_COMMAND 环境变量拉起）
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

const TOOLS = [
  {
    name: 'search_cnki',
    description: '知网文献检索',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词' },
        limit: { type: 'number', description: '返回数量' },
      },
    },
  },
];

const PAPERS = [
  {
    title: '基于深度学习的医学图像分割研究',
    authors: '王五; 赵六',
    journal: '计算机学报',
    year: '2023',
    abstract: '提出一种医学图像分割方法，accuracy of 96.1%。',
  },
  {
    title: '医学影像分割的注意力机制综述',
    authors: '李四',
    journal: '自动化学报',
    year: '2022',
    abstract: '系统综述了注意力机制，F1 score of 0.92。',
  },
];

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;

  if (msg.method === 'initialize') {
    respond({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-cnki-mcp', version: '1.0.0' },
      },
    });
  } else if (msg.method === 'tools/list') {
    respond({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === 'tools/call') {
    respond({
      jsonrpc: '2.0', id: msg.id,
      result: { content: [{ type: 'text', text: JSON.stringify(PAPERS) }] },
    });
  } else if (msg.method === 'ping') {
    respond({ jsonrpc: '2.0', id: msg.id, result: {} });
  } else {
    respond({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});
