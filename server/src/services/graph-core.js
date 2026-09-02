// 轻量状态机编排内核（LangGraph 语义兼容层）
//
// 目标：为 ScholarForge 深度研究流程提供 LangGraph 的核心能力——有向节点图、
// 持久化状态、单节点失败重试、条件边、子图——但不引入 @langchain/langgraph 的
// 庞大依赖树（LangChain 全家桶与本项目轻量、自洽的设计不符）。
//
// 方案优先级 6 的定位是「最后再迁移到 LangGraph.js」。因此本模块刻意保持与
// LangGraph 的 StateGraph 语义对齐（节点 = 纯函数 (state) => 局部更新；边 = 顺序/
// 条件/入口出口），使未来若真要切到官方 LangGraph.js，节点函数体可原样复用，
// 只需替换编排内核（research-graph.js 顶部 switch 即可）。
//
// 支持的语义：
//   - addNode(name, fn)          注册节点（fn 返回部分状态，深合并进全局 state）
//   - addEdge(from, to)          顺序边
//   - addConditionalEdges(from, fn)  条件边（fn(state) 返回下一节点名）
//   - setEntryPoint(name) / setFinishPoint(name)
//   - compile() 返回 { invoke(state) }
//   - 单节点失败重试：节点抛错时按 retry 策略重跑，超过上限才中止
import logger from '../logger.js';

const RETRY_LIMIT = Number(process.env.RESEARCH_NODE_RETRY) || 2;

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      out[k] = v;
    } else {
      out[k] = deepMerge(base?.[k], v);
    }
  }
  return out;
}

export function createStateGraph(initialState = {}) {
  const nodes = new Map();       // name -> { fn, retry }
  const edges = new Map();       // from -> to
  const conditionalEdges = new Map(); // from -> fn
  let entryPoint = null;
  let finishPoint = null;

  const api = {
    addNode(name, fn, { retry = RETRY_LIMIT } = {}) {
      nodes.set(name, { fn, retry });
      return api;
    },
    addEdge(from, to) {
      edges.set(from, to);
      return api;
    },
    addConditionalEdges(from, fn) {
      conditionalEdges.set(from, fn);
      return api;
    },
    setEntryPoint(name) {
      entryPoint = name;
      return api;
    },
    setFinishPoint(name) {
      finishPoint = name;
      return api;
    },
    compile() {
      if (!entryPoint) throw new Error('StateGraph 未设置入口点');
      return {
        async invoke(input = {}) {
          let state = deepMerge({ ...initialState }, input);
          let current = entryPoint;
          const visited = new Set();
          const trace = [];
          // finishPoint 是「执行完即停止」的终止节点：循环条件用 null 哨兵，
          // 每轮先执行当前节点，再决定是否还有下一节点（终点之后 current 置 null）。
          while (current) {
            if (visited.has(current)) throw new Error(`状态机死循环：节点 ${current} 被重复访问`);
            visited.add(current);
            const node = nodes.get(current);
            if (!node) throw new Error(`状态机未注册节点：${current}`);
            // 单节点失败重试：某篇 PDF 解析失败只重跑该节点，不需要整条任务重来
            let patch;
            let lastErr = null;
            for (let attempt = 0; attempt <= node.retry; attempt++) {
              try {
                patch = await node.fn(state);
                lastErr = null;
                break;
              } catch (err) {
                lastErr = err;
                logger.warn('research-graph', `节点 ${current} 第 ${attempt + 1} 次失败: ${err.message}`);
                if (attempt < node.retry) {
                  await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
                }
              }
            }
            if (lastErr) {
              state._lastFailedNode = current;
              state._lastError = String(lastErr.message || lastErr);
              // 节点有降级回调时调用；否则抛错由上层决定
              const fallback = node.fallback;
              if (fallback) {
                patch = await fallback(state, lastErr);
              } else {
                throw lastErr;
              }
            }
            state = deepMerge(state, patch || {});
            state._trace = [...trace, current];
            trace.push(current);

            // 到达终点：执行完即停止
            if (current === finishPoint) break;

            // 决定下一节点：优先条件边，其次顺序边
            if (conditionalEdges.has(current)) {
              current = await conditionalEdges.get(current)(state);
            } else if (edges.has(current)) {
              current = edges.get(current);
            } else {
              current = finishPoint || null;
            }
          }
          return state;
        },
      };
    },
  };
  return api;
}
