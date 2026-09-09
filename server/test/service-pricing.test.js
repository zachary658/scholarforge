import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const db = (await import('../src/db.js')).default;
const { calculateServiceQuoteFloor } = await import('../src/services/service-pricing.js');

test('人工服务按理工科与人文社科分别计算成本并保持500%最低利润/成本', () => {
  db.prepare("UPDATE settings SET value='80' WHERE key='service_labor_cost_stem'").run();
  db.prepare("UPDATE settings SET value='50' WHERE key='service_labor_cost_humanities'").run();
  db.prepare("UPDATE settings SET value='5' WHERE key='service_min_profit_markup'").run();
  const stem = calculateServiceQuoteFloor({ disciplineCategory: 'stem', estimatedHours: 10 });
  const humanities = calculateServiceQuoteFloor({ disciplineCategory: 'humanities', estimatedHours: 10 });
  assert.equal(stem.laborCost, 800);
  assert.equal(stem.minimumPrice, 4800);
  assert.equal(humanities.laborCost, 500);
  assert.equal(humanities.minimumPrice, 3000);
});

test('人工服务报价拒绝未知学科和无效工时', () => {
  assert.throws(() => calculateServiceQuoteFloor({ disciplineCategory: 'other', estimatedHours: 10 }), /请选择/);
  assert.throws(() => calculateServiceQuoteFloor({ disciplineCategory: 'stem', estimatedHours: 0 }), /预计工时/);
});
