import test from 'node:test';
import assert from 'node:assert/strict';
import { api, downloadDocFile } from '../src/lib/api.js';

test('shared download asks for explicit acknowledgment and never fetches bytes on cancellation or failed persistence', async t => {
  let dialog;
  let downloaded = 0;
  let acknowledgmentSucceeds = true;
  const requests = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const element = { tag, children: [], setAttribute() {}, append(...items) { this.children.push(...items); }, showModal() { dialog = this; }, close() {}, remove() {}, focus() {}, addEventListener() {}, click() {} };
      return element;
    },
    body: { appendChild() {}, removeChild() {} },
  };
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    const acknowledgment = url.endsWith('/acknowledge');
    return { ok: !acknowledgment || acknowledgmentSucceeds, status: acknowledgment && !acknowledgmentSucceeds ? 500 : 200,
      json: async () => acknowledgment ? { error: '记录失败' } : { required: true, risk: { level: 'high' }, notice: '仅供参考', acknowledgedAt: null } };
  });
  t.mock.method(api, 'downloadDoc', async () => { downloaded++; return new Blob(['fixture']); });
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); });
  const waitForDialog = async () => {
    for (let i = 0; i < 10 && !dialog; i++) await Promise.resolve();
    assert.ok(dialog, 'risk dialog is displayed before bytes are fetched');
    assert.match(dialog.children[1].textContent, /高/);
  };
  let pending = downloadDocFile(1);
  await waitForDialog();
  dialog.children.find(e => e.textContent === '取消').onclick();
  await assert.rejects(pending, /已取消下载/);
  assert.equal(downloaded, 0);
  assert.equal(requests.length, 1);

  dialog = null;
  acknowledgmentSucceeds = false;
  pending = downloadDocFile(1);
  await waitForDialog();
  dialog.children.find(e => e.textContent === '我已知悉').onclick();
  await assert.rejects(pending, /记录失败/);
  assert.equal(downloaded, 0);

  dialog = null;
  acknowledgmentSucceeds = true;
  pending = downloadDocFile(1);
  await waitForDialog();
  dialog.children.find(e => e.textContent === '我已知悉').onclick();
  await pending;
  assert.equal(downloaded, 1);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { acknowledged: true });
});
