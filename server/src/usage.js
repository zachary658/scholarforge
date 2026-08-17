// 使用日志服务（旧的会员/试用逻辑已移除，改由 services/billing.js 处理）
import db from './db.js';

export function getUserRecord(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// 记录使用日志
export function logUsage({
  userId,
  user,
  toolType,
  action,
  model,
  mode,
  inputChars,
  outputChars,
  tokens,
  status,
  message,
  orderId,
  chargeType, // 'free_signup' | 'free_course' | 'paid' | 'none'
  amount,
}) {
  try {
    db.prepare(
      `INSERT INTO usage_logs (user_id, email, name, tool_type, action, model_id, model_name, mode, input_chars, output_chars, tokens, status, message, order_id, charge_type, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId || (user && user.id) || null,
      user && user.email,
      user && user.name,
      toolType,
      action,
      model && model.id ? model.id : null,
      model && model.name ? model.name : null,
      mode || null,
      inputChars || 0,
      outputChars || 0,
      tokens || 0,
      status || 'success',
      message || null,
      orderId || null,
      chargeType || 'none',
      amount || 0
    );
  } catch {
    /* ignore logging errors */
  }
}
