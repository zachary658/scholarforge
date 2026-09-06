import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';

test('完整论文页面首次渲染无变量初始化异常（真实 React SSR）', async () => {
  const result = await build({
    stdin: { contents: `import React from 'react'; import {renderToString} from 'react-dom/server'; import {MemoryRouter} from 'react-router-dom'; import {AuthProvider} from './src/lib/auth.jsx'; import PaperWorkflow from './src/pages/PaperWorkflow.jsx'; export function render(){return renderToString(<MemoryRouter><AuthProvider><PaperWorkflow/></AuthProvider></MemoryRouter>);}`, resolveDir: process.cwd(), loader:'jsx' },
    bundle:true, write:false, platform:'node', format:'cjs', jsx:'automatic', packages:'external',
  });
  const context = { module:{exports:{}}, exports:{}, require:createRequire(import.meta.url), console, URLSearchParams };
  context.exports = context.module.exports;
  vm.runInNewContext(result.outputFiles[0].text,context);
  assert.match(context.module.exports.render(),/加载中/);
});
