// 内容安全审核（阶段四 4.2）
// 统一入口 checkContent(text)：对用户输入与 AI 输出进行文本审核
// - 本地敏感词过滤（默认、可工作，作为兜底）
// - 可配置接入网易易盾 / 阿里云内容安全（密钥从管理后台读取，不硬编码）
// - 外部审核服务调用失败时回退本地过滤，保证审核链路不因上游故障而中断
import crypto from 'crypto';
import logger from '../logger.js';
import { getContentSafetyConfig } from '../config-store.js';

// 本地敏感词黑名单（按类别）。仅收录明确违法/违规内容，用于兜底过滤。
const BLOCKED_WORDS = {
  违法广告: ['代开发票', '办证', '赌博', '博彩', '时时彩', '彩票代购', '高利贷', '非法集资', '刷单', '刷钻'],
  诈骗: ['兼职刷单', '日赚', '转账到安全账户', '中奖通知', '免费领', '点击领取红包'],
  色情低俗: ['裸聊', '约炮', '色情服务', '卖淫', '嫖娼'],
  毒品违禁: ['冰毒', '海洛因', '毒品', '枪支买卖', '管制刀具'],
  政治敏感: ['颠覆国家', '分裂国家', '邪教', '恐怖主义'],
};

function localCheck(text) {
  const t = String(text || '');
  for (const [category, words] of Object.entries(BLOCKED_WORDS)) {
    for (const w of words) {
      if (t.includes(w)) {
        return { safe: false, reason: `内容包含违规信息（${category}），请修改后重试`, provider: 'local' };
      }
    }
  }
  return { safe: true };
}

// 网易易盾文本检测 v5（若在后台配置了 secretId/secretKey/businessId）
async function yidunCheck(text) {
  const cfg = getContentSafetyConfig().yidun;
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString('hex');
  const version = 'v5.2';
  const params = {
    secretId: cfg.secretId,
    businessId: cfg.businessId || 'default',
    version,
    timestamp,
    nonce,
    dataId: crypto.randomBytes(16).toString('hex'),
    content: String(text),
  };
  // 易盾签名：参数按 key 升序拼接，用 secretKey 做 HMAC-SHA256
  const keys = Object.keys(params).sort();
  const signStr = keys.map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHmac('sha256', cfg.secretKey).update(signStr).digest('hex');
  const resp = await fetch('https://as.dun.163yun.com/v5/text/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, signature, signatureMethod: 'HMAC-SHA256' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`易盾返回 ${resp.status}`);
  const data = await resp.json();
  // antispam.suggestion: 0=通过, 1=嫌疑, 2=不通过
  const suggestion = data?.antispam?.suggestion;
  if (suggestion === 2) {
    return { safe: false, reason: '内容审核未通过，请修改后重试', provider: 'yidun' };
  }
  return { safe: true, provider: 'yidun' };
}

// 阿里云内容安全文本反垃圾（若在后台配置了 AccessKey）
async function aliyunCheck(text) {
  const cfg = getContentSafetyConfig().aliyun;
  const host = 'green.cn-shanghai.aliyuncs.com';
  const path = '/green/text/scan';
  const body = JSON.stringify({
    scenes: ['antispam'],
    tasks: [{ dataId: crypto.randomUUID(), content: String(text) }],
  });
  const method = 'POST';
  const date = new Date().toUTCString();
  const contentType = 'application/json';
  const contentMd5 = crypto.createHash('md5').update(body).digest('base64');
  const nonce = crypto.randomUUID();
  const stringToSign = `${method}\n${contentMd5}\n${contentType}\n${date}\nx-acs-signature-method:HMAC-SHA1\nx-acs-signature-nonce:${nonce}\nx-acs-version:2018-05-09\n${path}`;
  const signature = crypto.createHmac('sha1', cfg.accessKeySecret).update(stringToSign).digest('base64');
  const resp = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      'Content-Type': contentType,
      'Content-MD5': contentMd5,
      Date: date,
      Accept: 'application/json',
      'x-acs-signature-method': 'HMAC-SHA1',
      'x-acs-signature-nonce': nonce,
      'x-acs-signature-version': '1.0',
      'x-acs-version': '2018-05-09',
      'x-acs-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`阿里云返回 ${resp.status}`);
  const data = await resp.json();
  const results = data?.data || [];
  for (const r of results) {
    const resultsArr = r.results || [];
    for (const item of resultsArr) {
      if (item.suggestion === 'block' || item.suggestion === 'review') {
        return { safe: false, reason: '内容审核未通过，请修改后重试', provider: 'aliyun' };
      }
    }
  }
  return { safe: true, provider: 'aliyun' };
}

// 统一审核入口
export async function checkContent(text) {
  if (!text || !String(text).trim()) return { safe: true };
  // 1. 本地快速过滤（始终执行，作为兜底）
  const local = localCheck(text);
  if (!local.safe) return local;

  // 2. 外部审核服务（若配置）
  const cfg = getContentSafetyConfig();
  try {
    if (cfg.provider === 'yidun' && cfg.yidun.secretId && cfg.yidun.secretKey) {
      return await yidunCheck(text);
    }
    if (cfg.provider === 'aliyun' && cfg.aliyun.accessKeyId && cfg.aliyun.accessKeySecret) {
      return await aliyunCheck(text);
    }
  } catch (err) {
    logger.error('content-safety', `外部审核调用失败，回退本地过滤：${err.message}`);
  }
  return { safe: true, provider: 'local' };
}
