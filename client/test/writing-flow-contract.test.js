import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('工作区入口会带入论文信息并把 projectId 提交给生成接口', () => {
  const writing = read('../src/pages/Writing.jsx');
  const generator = read('../src/components/DocumentGenerator.jsx');
  assert.match(writing, /api\.getProject\(pid\)/);
  assert.match(writing, /topic: project\.title/);
  assert.match(generator, /api\.getProject\(projectId\)/);
  assert.match(generator, /projectId: projectId \|\| undefined/);
});

test('配置表单字段名与服务端工具契约一致', () => {
  assert.match(read('../src/pages/LiteratureReview.jsx'), /key: 'years'/);
  const taskBook = read('../src/pages/TaskBook.jsx');
  assert.match(taskBook, /key: 'student_name'/);
  assert.match(taskBook, /key: 'student_id'/);
  assert.match(read('../src/pages/Defense.jsx'), /key: 'research_content'/);
  const journal = read('../src/pages/Journal.jsx');
  assert.match(journal, /key: 'research_content'/);
  assert.match(journal, /key: 'journal_type'/);
});

test('论文流程展示优先采用实际产物推导的阶段', () => {
  const projects = read('../src/pages/Projects.jsx');
  assert.match(projects, /Math\.max\(0, storedStageIdx, systemStageIdx\)/);
});
