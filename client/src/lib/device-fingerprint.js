// 设备指纹：采集浏览器稳定特征生成 hash，用于注册风控（防同一设备反复注册薅积分）
// 说明：指纹用于辅助风控，可被高级用户通过改 UA/换浏览器绕过，但能拦截绝大多数普通用户批量注册。

// cyrb53 风格 hash，输出 16 位十六进制
function hashCode(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function getCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('ScholarForge 设备指纹', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('防滥用设备标识', 4, 32);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

// 采集浏览器稳定特征并生成设备指纹（16 位十六进制字符串）
export function getDeviceFingerprint() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const screen = typeof window !== 'undefined' && window.screen ? window.screen : {};
  const parts = [
    nav.userAgent || '',
    nav.language || '',
    nav.languages ? Array.from(nav.languages).join(',') : '',
    nav.platform || '',
    screen.width || '',
    screen.height || '',
    screen.colorDepth || '',
    String(new Date().getTimezoneOffset()),
    nav.hardwareConcurrency || '',
    nav.deviceMemory || '',
    getCanvasFingerprint(),
  ];
  return hashCode(parts.join('|'));
}
