import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('两类人工服务均提供选填推广码并进入统一服务工作区', () => {
  const course = read('../src/pages/CourseQuote.jsx');
  const graduation = read('../src/pages/GraduationProjects.jsx');
  const app = read('../src/App.jsx');
  assert.match(course, /promotion_code/);
  assert.match(course, /推广码（选填）/);
  assert.match(graduation, /promotionCode/);
  assert.match(graduation, /推广码（选填/);
  assert.match(app, /path="service-projects"/);
  assert.match(app, /path="service-projects\/:id"/);
});

test('服务详情具备补充、附件、修改申请和确认验收', () => {
  const detail = read('../src/pages/ServiceProjectDetail.jsx');
  for (const action of ['supplement', 'revision_request', 'acceptance', 'uploadServiceAttachment', 'downloadServiceAttachment']) {
    assert.match(detail, new RegExp(action));
  }
});
