import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('旧默认套餐价一次性升级，保留自定义价格和订单金额', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'sf-price-migration-')), 'test.db');
  const run = code => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import db from './src/db.js'; ${code}`], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1));
  };
  run(`db.prepare("DELETE FROM settings WHERE key='migration_full_paper_pricing_20260912'").run();
    db.prepare("UPDATE settings SET value='59' WHERE key='full_paper_price_undergraduate'").run();
    db.prepare("UPDATE settings SET value='159' WHERE key='full_paper_price_master'").run();
    db.prepare("UPDATE settings SET value='777' WHERE key='full_paper_price_doctorate'").run();
    db.prepare("UPDATE feature_prices SET price=59 WHERE feature_key='writing_fulltext'").run();
    const uid=db.prepare("INSERT INTO users(email,password_hash,name) VALUES('migration@test.invalid','x','test')").run().lastInsertRowid;
    db.prepare("INSERT INTO orders(order_no,user_id,amount) VALUES('OLD-PRICE',?,59)").run(uid);
    console.log('{}'); db.close();`);
  assert.deepEqual(run(`console.log(JSON.stringify({ prices: ['undergraduate','master','doctorate'].map(t=>db.prepare('SELECT value FROM settings WHERE key=?').get('full_paper_price_'+t).value),
    feature: db.prepare("SELECT price FROM feature_prices WHERE feature_key='writing_fulltext'").get().price,
    order: db.prepare("SELECT amount FROM orders WHERE order_no='OLD-PRICE'").get().amount }));
    db.prepare("UPDATE settings SET value='59' WHERE key='full_paper_price_undergraduate'").run(); db.close();`), { prices: ['139','449','777'], feature: 139, order: 59 });
  assert.equal(run(`console.log(JSON.stringify(db.prepare("SELECT value FROM settings WHERE key='full_paper_price_undergraduate'").get().value)); db.close();`), '59');
});
