// 账号锁测试：内存模式锁定/清除/隔离 + Redis 不可达时降级内存（不阻断登录流程）
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.REDIS_URL; // 先以纯内存模式验证基础行为

const {
  accountLockRemaining,
  recordAccountFailure,
  clearAccountFailures,
  resetAccountLockMemory,
  ACCOUNT_LOCK_THRESHOLD,
} = await import('../src/middleware/accountLock.js');
const { closeSharedRedisClient } = await import('../src/middleware/redisClient.js');

// 清理 ioredis 连接句柄：后台重连会保持事件循环存活，导致测试进程挂起
after(async () => {
  await closeSharedRedisClient();
});

test('内存模式：未达阈值不锁定，达到阈值后返回剩余锁定期', async () => {
  resetAccountLockMemory();
  const email = 'lock-a@example.com';
  for (let i = 1; i < ACCOUNT_LOCK_THRESHOLD; i++) {
    await recordAccountFailure(email);
    assert.equal(await accountLockRemaining(email), 0, `第 ${i} 次失败不应锁定`);
  }
  await recordAccountFailure(email); // 达到阈值
  const remaining = await accountLockRemaining(email);
  assert.ok(remaining > 0 && remaining <= 15 * 60, '达到阈值后应有剩余锁定期（≤15 分钟）');
});

test('内存模式：登录成功清除计数并解除锁定', async () => {
  resetAccountLockMemory();
  const email = 'lock-b@example.com';
  for (let i = 0; i < ACCOUNT_LOCK_THRESHOLD; i++) await recordAccountFailure(email);
  assert.ok((await accountLockRemaining(email)) > 0, '应处于锁定状态');
  await clearAccountFailures(email);
  assert.equal(await accountLockRemaining(email), 0, '登录成功后应解除锁定');
  // 清除后重新从 0 计数
  await recordAccountFailure(email);
  assert.equal(await accountLockRemaining(email), 0, '清除后不应残留旧计数');
});

test('内存模式：不同账号计数隔离（大小写归一化为同一账号）', async () => {
  resetAccountLockMemory();
  const email = 'lock-c@example.com';
  for (let i = 0; i < ACCOUNT_LOCK_THRESHOLD; i++) await recordAccountFailure(email);
  assert.ok((await accountLockRemaining(email)) > 0);
  assert.equal(await accountLockRemaining('other@example.com'), 0, '其他账号不应被牵连');
  // 未归一化的大小写应命中同一账号（调用方负责 toLowerCase，此处验证模块不额外区分）
  assert.ok((await accountLockRemaining(email.toUpperCase())) > 0, '同邮箱不同大小写应视为同一账号');
});

test('Redis 不可达时降级内存：记录失败不抛错，锁定仍生效', async () => {
  resetAccountLockMemory();
  // 指向必然拒绝连接的地址（端口 1 无 Redis）：验证命令失败时降级内存，不阻断登录流程
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  const email = 'lock-d@example.com';
  try {
    for (let i = 0; i < ACCOUNT_LOCK_THRESHOLD; i++) {
      await assert.doesNotReject(recordAccountFailure(email), 'Redis 故障时记录失败不应抛错');
    }
    const remaining = await accountLockRemaining(email);
    assert.ok(remaining > 0, '降级内存后锁定仍应生效');
    await assert.doesNotReject(clearAccountFailures(email), 'Redis 故障时清除计数不应抛错');
    assert.equal(await accountLockRemaining(email), 0, '清除后应解锁');
  } finally {
    delete process.env.REDIS_URL;
  }
});
