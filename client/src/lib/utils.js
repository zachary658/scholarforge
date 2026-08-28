import { toast } from '../components/Toast.jsx';

/**
 * 防抖 & 节流工具
 * 用于搜索输入、滚动加载等高频事件
 */
export function debounce(fn, delay = 300) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function throttle(fn, delay = 300) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= delay) {
      last = now;
      fn(...args);
    }
  };
}

/**
 * 格式化数字：超过 1000 显示为 1k+
 */
export function formatCount(n) {
  if (n == null) return '0';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

/**
 * 截断文本，保留指定长度，超出加省略号
 */
export function truncate(text, maxLen = 100) {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen) + '...';
}

/**
 * 复制到剪贴板（含旧浏览器降级）
 * navigator.clipboard 优先，不可用或失败时降级 document.execCommand('copy')，均失败 toast 提示
 * label 传入时成功会 toast「{label}已复制」；返回是否成功，调用方据此决定是否展示 copied 状态
 */
export async function copyText(text, label) {
  if (!text) return false;
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = true;
    try {
      document.execCommand('copy');
      if (label) toast.success(`${label}已复制`);
    } catch {
      ok = false;
      toast.error('复制失败，请手动复制');
    }
    document.body.removeChild(ta);
    return ok;
  };
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      if (label) toast.success(`${label}已复制`);
      return true;
    } catch {
      return fallback();
    }
  }
  return fallback();
}

/**
 * 外链安全校验：仅放行 http(s) 协议
 * 防止 javascript: / data: 等协议注入（渲染 <a href> 前必须校验）
 */
export function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}