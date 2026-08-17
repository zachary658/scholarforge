// 数学公式转换：LaTeX → OMML（Word 原生可编辑公式）
//
// 背景：原方案使用 latex-to-omml，其内部依赖已废弃的 mathjax-node，
// 后者通过 jsdom → request 拉入 form-data/qs/tough-cookie 等高危传递依赖（且无修复版本）。
// 本模块用 mathjax@4（现代、纯 JS、无 jsdom/request 依赖）替换 mathjax-node，
// 保留 MathML → OMML 的 mathml2omml 步骤，输出与原先一致的 OMML。
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { mml2omml } from 'mathml2omml';
import { init as initMathjax } from 'mathjax';

// MathJax v4 单例（init 有成本，仅初始化一次）
let _mjApi = null;
async function ensureMathjax() {
  if (_mjApi) return _mjApi;
  _mjApi = await initMathjax({ loader: { load: ['input/tex'] } });
  return _mjApi;
}

// 提取并移除 \tag 命令（与旧 latex-to-omml 行为一致，仅保留正文）
function extractTagFromLatex(latex) {
  let processed = latex;
  processed = processed.replace(/\\tag\*?\{[^}]*\}/g, '');
  // 规范化空白字符
  processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  processed = processed.replace(/[ \t]+/g, ' ');
  processed = processed.trim();
  return { tag: null, processedLatex: processed };
}

// LaTeX → MathML（mathjax@4，纯 JS 实现，不依赖 DOM/jsdom）
async function convertLatexToMathML(latex, displayMode = false) {
  const mj = await ensureMathjax();
  const { processedLatex } = extractTagFromLatex(latex);
  return mj.tex2mmlPromise(processedLatex, { display: displayMode });
}

// 修复求和/积分等 n 元运算符的表达式位置（与旧 latex-to-omml 一致）
// 将运算符后面的表达式包装到 <mrow> 中，使 mathml2omml 正确放入 <m:e>
function fixOperatorExpressions(mathml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(mathml, 'text/xml');
    const parserError = doc.getElementsByTagName('parsererror');
    if (parserError.length > 0) return mathml;

    const mathElement = doc.documentElement;
    if (!mathElement) return mathml;

    const operators = [];
    function findOperators(node) {
      if (node.nodeType === 1) {
        const tagName = node.tagName;
        if (tagName === 'munderover' || tagName === 'msubsup') {
          const firstChild = node.firstChild;
          if (firstChild && firstChild.nodeType === 1 && firstChild.tagName === 'mo') {
            const operatorText = firstChild.textContent || '';
            const operatorSymbols = ['∑', '∫', '∏', '∐', '⋂', '⋃', '∮', '∯', '∰'];
            if (operatorSymbols.some((sym) => operatorText.includes(sym))) {
              operators.push(node);
            }
          }
        }
        let child = node.firstChild;
        while (child) {
          findOperators(child);
          child = child.nextSibling;
        }
      }
    }
    findOperators(mathElement);

    for (let i = operators.length - 1; i >= 0; i--) {
      const operatorNode = operators[i];
      const parent = operatorNode.parentNode;
      if (!parent) continue;

      let nextSibling = operatorNode.nextSibling;
      while (nextSibling && nextSibling.nodeType !== 1) {
        nextSibling = nextSibling.nextSibling;
      }
      if (nextSibling && nextSibling.nodeType === 1) {
        const nextTag = nextSibling.tagName;
        let shouldWrap = true;
        if (nextTag === 'mo') {
          const moText = nextSibling.textContent || '';
          if (moText.match(/^[=,;]$/)) shouldWrap = false;
        }
        if (shouldWrap) {
          let currentSibling = nextSibling;
          const elementsToMove = [];
          while (currentSibling) {
            if (currentSibling.nodeType === 1) {
              const siblingTag = currentSibling.tagName;
              if (siblingTag === 'mo') {
                const moText = currentSibling.textContent || '';
                if (moText.match(/^[=,;]$/)) break;
              }
              elementsToMove.push(currentSibling);
              currentSibling = currentSibling.nextSibling;
            } else {
              currentSibling = currentSibling.nextSibling;
            }
          }
          if (elementsToMove.length > 0) {
            const mrow = doc.createElement('mrow');
            for (const elem of elementsToMove) mrow.appendChild(elem);
            if (operatorNode.nextSibling) {
              parent.insertBefore(mrow, operatorNode.nextSibling);
            } else {
              parent.appendChild(mrow);
            }
          }
        }
      }
    }
    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (err) {
    return mathml;
  }
}

// 清理 MathML：移除 MathJax 特有属性与注释，规范化空白
function cleanMathML(mathml) {
  let cleaned = mathml
    .replace(/<!--[\s\S]*?-->/g, '')           // 移除注释
    .replace(/\s+data-latex="[^"]*"/g, '')    // mathjax@4 的 data-latex 属性
    .replace(/\s+display="(?:block|inline)"/g, '') // mathjax@4 的 display 属性
    .replace(/\s+class="[^"]*"/g, '')          // 旧 mathjax 的 class 属性
    .replace(/\s+scriptlevel="[^"]*"/g, '')
    .replace(/\s+maxsize="[^"]*"/g, '')
    .replace(/\s+minsize="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
  cleaned = fixOperatorExpressions(cleaned);
  return cleaned;
}

/**
 * 将 LaTeX 转换为 Word 原生可编辑公式 OMML XML
 * @param {string} latex LaTeX 代码
 * @param {{ displayMode?: boolean }} options
 * @returns {Promise<string>} OMML XML 字符串
 */
export async function latexToOMML(latex, options = {}) {
  const { displayMode = false } = options;
  try {
    const mathml = await convertLatexToMathML(latex, displayMode);
    const cleanedMathml = cleanMathML(mathml);
    return mml2omml(cleanedMathml);
  } catch (err) {
    throw new Error(`LaTeX 转 OMML 转换失败: ${err.message}`);
  }
}
