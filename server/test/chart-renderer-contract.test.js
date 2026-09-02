import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { renderChart, renderFlowchart } = await import('../src/services/chart-renderer.js');

function assertCompatibleImage(result) {
  assert.ok(Buffer.isBuffer(result.buffer), 'Word 生成器需要 buffer 字段');
  assert.ok(Buffer.isBuffer(result.png), '图表下载接口需要 png 字段');
  assert.strictEqual(result.png, result.buffer, '两个字段应复用同一 Buffer，不能重复占用内存');
  assert.ok(result.buffer.length > 100, '应生成非空 PNG');
  assert.ok(result.width > 0 && result.height > 0, '应返回有效尺寸');
}

test('数据图表渲染结果同时兼容 Word 与图表 API', async () => {
  const result = await renderChart({
    data: { values: [{ category: 'A', value: 10 }, { category: 'B', value: 20 }] },
    mark: 'bar',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    },
  });
  assertCompatibleImage(result);
});

test('流程图渲染结果同时兼容 Word 与图表 API', async () => {
  const result = await renderFlowchart('graph TD\nA[开始] --> B[完成]');
  assertCompatibleImage(result);
});
