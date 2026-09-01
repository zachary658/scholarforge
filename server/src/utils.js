/**
 * 公共工具函数
 * 避免各模块重复定义 now()、时间格式化等
 */
import fs from 'fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 当前 Unix 时间戳（秒） */
export function now() {
  return Math.floor(Date.now() / 1000);
}

/** 当前日期字符串 YYYYMMDD（用于订单号前缀） */
export function datePrefix() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 归一化去重键：小写 + 去空白/标点/符号，保留 Unicode。
 * 注意：此前各源用 [^a-z0-9] 归一化，中文标题会被清空成空串，
 * 导致中文文献（CNKI/中文期刊）在去重阶段被整体丢弃——已修复为保留全部语言字符。
 */
export function dedupKeyOf(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 200);
}

// ===== 输入长度校验（入库前统一上限，防超长恶意串写库）=====
// 短文本（标题/名称类）与长文本（描述/需求/备注类）的通用上限
export const TEXT_MAX_SHORT = 200;
export const TEXT_MAX_LONG = 5000;

/**
 * 批量校验字符串字段长度：超限返回中文错误提示，全部通过返回 null。
 * items 元素形如 { value, label, max }；value 非字符串时跳过（类型校验由各路由自行负责）。
 */
export function checkTextLength(items) {
  for (const { value, label, max } of items) {
    if (typeof value === 'string' && value.length > max) {
      return `${label}过长（最多 ${max} 字符）`;
    }
  }
  return null;
}

// ===== SSRF 防护：校验出站 AI 服务地址 =====
// AI base_url 由管理员在后台配置，服务端会据此发起请求。
// 若管理员账号被攻破，可被用于 SSRF（探测内网 / 云元数据端点）。
// 策略：仅允许 http/https，并拒绝本机回环、链路本地（含云元数据 169.254.169.254）等危险目标。
// 注意：私网地址（10.x / 192.168.x / 172.16-31.x）默认放行，以兼容内网部署的模型服务（vLLM/Ollama）。
const CLOUD_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
]);

// DNS 重绑定域名后缀：解析结果指向内网/回环，绕过主机名字面量校验
const REBIND_SUFFIXES = ['.nip.io', '.sslip.io', '.xip.io', '.local', '.internal'];

// 主机名黑名单：localhost 及常见重绑定域名
function isBlockedHostname(host) {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '::' || h === '0:0:0:0:0:0:0:1') return true; // IPv6 回环
  if (REBIND_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return false;
}

// 从 IPv4 映射/兼容 IPv6 地址中提取内嵌的 IPv4（还原为点分十进制）。
// 覆盖 ::ffff:1.2.3.4（点分）与 ::ffff:HHHH:HHHH / 0:0:0:0:0:ffff:HHHH:HHHH（十六进制双字）。
// 例：URL 解析会把 ::ffff:169.254.169.254 规范化为 ::ffff:a9fe:a9fe，须能还原回 169.254.169.254。
function extractEmbeddedIpv4(lower) {
  let m = lower.match(/::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  m = lower.match(/(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const pair = (h) => {
      const n = parseInt(h, 16);
      return `${(n >> 8) & 255}.${n & 255}`;
    };
    return `${pair(m[1])}.${pair(m[2])}`;
  }
  return null;
}

// 判断解析出的 IP 是否不安全（回环/未指定/链路本地，含云元数据地址）
// allowPrivate=true（默认）放行 RFC1918 私网，兼容内网模型服务；
// allowPrivate=false 时额外拒绝 10/8、172.16/12、192.168/16，用于校验用户可控的外站 URL。
function isUnsafeIp(ip, allowPrivate = true) {
  if (!ip) return true;
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    // IPv4 映射/兼容 IPv6（如 ::ffff:169.254.169.254、::ffff:a9fe:a9fe、0:0:0:0:0:ffff:a9fe:a9fe）：
    // 还原内嵌的 IPv4 后按 IPv4 规则校验，拦截云元数据/回环穿透（含十六进制双字形式）
    const embedded = extractEmbeddedIpv4(lower);
    if (embedded) return isUnsafeIp(embedded, allowPrivate);
    // 链路本地 fe80::/10（fe80-fe8b 前缀；宽松匹配 fe8/fe9/fea/feb）
    if (/^fe[89ab]/.test(lower)) return true;
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  if (parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true; // 链路本地/云元数据
  if (!allowPrivate) {
    if (parts[0] === 10) return true;                                      // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;                 // 192.168.0.0/16
  }
  return false;
}

export function assertSafeAiBaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('AI 服务地址无效');
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('AI 服务地址格式不正确');
  }
  const proto = url.protocol;
  if (proto !== 'https:' && proto !== 'http:') {
    throw new Error('AI 服务地址仅支持 http/https 协议');
  }
  const host = url.hostname;
  if (!host) throw new Error('AI 服务地址缺少主机名');

  // 拦截云元数据主机名（GCP / AWS 元数据域名，兼容末尾点）
  const hostLower = host.toLowerCase().replace(/\.$/, '');
  if (CLOUD_METADATA_HOSTS.has(hostLower)) {
    throw new Error('AI 服务地址不允许指向云元数据端点');
  }

  // 拦截 localhost / IPv6 回环 / DNS 重绑定域名（此前仅拦 IPv4 字面量，可被绕过）
  if (isBlockedHostname(hostLower)) {
    throw new Error('AI 服务地址不允许指向本机、回环或重绑定域名');
  }

  // 拦截 IP 字面量：回环(127/8)、未指定(0.0.0.0)、链路本地(169.254/16，含云元数据 169.254.169.254)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostLower)) {
    const parts = hostLower.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)) {
      throw new Error('AI 服务地址不允许指向本机或链路本地地址');
    }
  }

  return url;
}

// 解析后校验：对域名做真实 DNS 解析，拦截解析到回环/链路本地/云元数据的地址（防 DNS 重绑定）
// 私网地址（10.x / 192.168.x / 172.16-31.x）默认放行，兼容内网部署的模型服务（vLLM/Ollama）
// allowPrivate=true（默认）：放行私网，兼容内网模型服务；
// allowPrivate=false：拒绝私网，用于校验用户可控的外站 URL（如文献 PDF 下载），纵深防御 SSRF。
export async function assertSafeAiResolvedUrl(rawUrl, { allowPrivate = true } = {}) {
  const url = assertSafeAiBaseUrl(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // IP 字面量也必须过 isUnsafeIp 校验：IPv4 映射 IPv6（如 ::ffff:169.254.169.254）
  // 不会被 assertSafeAiBaseUrl 的 IPv4 字面量检查拦截，须在此二次拦截（防云元数据/回环穿透）
  if (isIP(host)) {
    if (isUnsafeIp(host, allowPrivate)) {
      throw new Error('目标地址不允许指向本机、回环或链路本地地址');
    }
    return url;
  }
  try {
    const { address } = await lookup(host, { verbatim: true });
    if (isUnsafeIp(address, allowPrivate)) {
      throw new Error('目标地址解析到不安全的目标（回环/链路本地/云元数据/私网），已拒绝');
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      throw new Error('AI 服务地址无法解析');
    }
    throw err;
  }
  return url;
}

// 校验文件头（magic bytes）是否匹配任一签名（前缀匹配）
// 同步读取文件前若干字节（文件已由 multer 写入磁盘），供上传处理器在落盘后校验
export function checkFileSignature(filePath, signatures) {
  const maxBytes = signatures.reduce((m, s) => Math.max(m, s.length), 0);
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    return signatures.some((sig) => bytesRead >= sig.length && buf.subarray(0, sig.length).equals(sig));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

// 常见文件头签名（magic bytes）
export const FILE_SIGNATURES = {
  // ZIP（docx/pptx/xlsx 均为 ZIP 容器）
  docx: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  // WEBP（RIFF 容器头，扩展名已限制为 .webp，前缀校验足以排除 HTML/SVG 等）
  webp: Buffer.from('RIFF', 'ascii'),
  // PDF 文件头（上传 magic-byte 校验用）
  pdf: Buffer.from('%PDF', 'ascii'),
};

// 并发信号量：限制同时进行的异步任务数量（如出站 HTTP、AI 调用、PDF 下载），
// 防止单用户 / 单进程打满连接或 CPU（L-3 加固）。
// run(fn) 在获得许可时执行 fn，结束后自动释放许可给等待队列。
export function createSemaphore(maxConcurrent) {
  const max = Math.max(1, maxConcurrent | 0);
  let active = 0;
  const queue = [];
  return {
    async run(fn) {
      if (active < max) {
        active++;
      } else {
        await new Promise((resolve) => queue.push(resolve));
        active++;
      }
      try {
        return await fn();
      } finally {
        active--;
        if (queue.length > 0) {
          const next = queue.shift();
          next();
        }
      }
    },
    get active() {
      return active;
    },
  };
}

// ===== 错误信息脱敏（防内部信息泄露给客户端）=====
// 业务错误判定依据：本项目所有主动抛给用户看的错误（bizError、各服务层校验、
// ai-service 的分类错误）均为含中文的消息；而数据库（SQLite）、文件系统、
// 第三方 SDK 的非预期错误消息是英文技术细节，直接透传会把 SQL 语句、
// 文件路径、上游网关响应等信息泄露给客户端。故以「消息含中文字符」作为业务错误特征。

/**
 * 判断错误是否为业务错误（消息可安全透传给客户端）
 */
export function isBusinessError(err) {
  return !!(err && typeof err.message === 'string' && /[\u4e00-\u9fff]/.test(err.message));
}

/**
 * 错误消息脱敏：业务错误（中文提示）原样透传；非预期错误 console.error 记录真实错误后返回通用提示。
 * @param {Error} err catch 块捕获的错误
 * @param {string} scope 日志定位标识（如 'payment/mock'），可省略
 * @returns {string} 可安全返回给客户端的错误消息
 */
export function sanitizeErrorMessage(err, scope = '') {
  if (isBusinessError(err)) return err.message;
  console.error(`${scope ? `[${scope}] ` : ''}未预期内部错误:`, err);
  return '服务器内部错误，请稍后重试';
}