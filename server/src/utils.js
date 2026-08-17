/**
 * 公共工具函数
 * 避免各模块重复定义 now()、时间格式化等
 */
import fs from 'fs';

/** 当前 Unix 时间戳（秒） */
export function now() {
  return Math.floor(Date.now() / 1000);
}

/** 当前日期字符串 YYYYMMDD（用于订单号前缀） */
export function datePrefix() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
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

  // 拦截 IP 字面量：回环(127/8)、未指定(0.0.0.0)、链路本地(169.254/16，含云元数据 169.254.169.254)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostLower)) {
    const parts = hostLower.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)) {
      throw new Error('AI 服务地址不允许指向本机或链路本地地址');
    }
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
};