// 邮件服务
// 两种模式：
//   - mock（默认）：打印到控制台 + 写入 server/uploads/mail_log/，演示用
//   - smtp：配置 SMTP_URL 后，使用 nodemailer 真实发送
//
import logger from '../logger.js';
// 使用 mock 模式时，重置链接会输出到日志，便于演示和测试
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mailLogDir = join(__dirname, '..', 'uploads', 'mail_log');

const SMTP_URL = process.env.SMTP_URL || '';
const MAIL_FROM = process.env.MAIL_FROM || 'no-reply@scholarforge.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// 确保 mail_log 目录存在（mock 模式用）
try { fs.mkdirSync(mailLogDir, { recursive: true }); } catch {}

// 发送邮件：返回 { ok, mock, preview?, error? }
// to: 收件人邮箱
// subject: 主题
// text: 纯文本内容
// html: HTML 内容（可选）
// 安全：生产环境必须走 SMTP，禁止 mock 回退（防止密码重置 token 落入日志/磁盘文件）
export async function sendMail({ to, subject, text, html }) {
  // SMTP 模式：使用 nodemailer 真实发送
  if (SMTP_URL) {
    try {
      const nodemailer = (await import('nodemailer')).default;
      const transporter = nodemailer.createTransport(SMTP_URL);
      const info = await transporter.sendMail({
        from: MAIL_FROM,
        to,
        subject,
        text,
        html: html || text,
      });
      return { ok: true, mock: false, messageId: info.messageId };
    } catch (err) {
      logger.error('mailer', `SMTP 发送失败: ${err.message}`);
      // 生产环境不回退 mock，直接返回失败（敏感邮件如密码重置必须真实送达）
      if (process.env.NODE_ENV === 'production') {
        return { ok: false, mock: false, error: '邮件发送失败，请稍后重试' };
      }
      // 非生产环境才允许回退 mock
    }
  } else if (process.env.NODE_ENV === 'production') {
    // 生产环境未配置 SMTP：拒绝发送（尤其密码重置），避免 mock 落盘泄露 token
    logger.error('mailer', '生产环境未配置 SMTP_URL，邮件发送被拒绝');
    return { ok: false, mock: false, error: '邮件服务未配置' };
  }

  // mock 模式（仅非生产环境）：打印到控制台 + 写文件
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  // 收件人消毒：仅保留字母数字与 @.-，防路径分隔符/.. 逃逸 mail_log 目录
  const safeTo = String(to).replace(/[^\w@.-]/g, '_').slice(0, 100);
  const logFile = join(mailLogDir, `${ts}_${safeTo}.txt`);
  const logContent = `To: ${to}\nFrom: ${MAIL_FROM}\nSubject: ${subject}\nDate: ${new Date().toISOString()}\n\n${text}\n`;
  try {
    fs.writeFileSync(logFile, logContent, 'utf8');
  } catch (err) {
    logger.error('mailer', `写日志失败: ${err.message}`);
  }
  logger.info('mailer', `\n========== [邮件 mock] ==========\nTo: ${to}\nSubject: ${subject}\n--------------------------------\n${text}\n==================================\n`);
  return { ok: true, mock: true, preview: logFile };
}

// 构造密码重置邮件内容
export function buildPasswordResetEmail(to, resetToken) {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
  const subject = '【ScholarForge】密码重置';
  const text = `您正在重置 ScholarForge 账号密码。\n\n请点击以下链接重置密码（30 分钟内有效，一次性使用）：\n${resetUrl}\n\n如非本人操作，请忽略此邮件，您的账号安全不受影响。`;
  const html = `<p>您正在重置 ScholarForge 账号密码。</p><p>请点击以下链接重置密码（30 分钟内有效，一次性使用）：</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>如非本人操作，请忽略此邮件，您的账号安全不受影响。</p>`;
  return { subject, text, html };
}
