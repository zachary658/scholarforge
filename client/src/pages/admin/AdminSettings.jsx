import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmModal.jsx';

const SENSITIVE_FIELDS = ['alipay_private_key', 'alipay_public_key', 'wechat_api_v3_key', 'wechat_private_key'];

const PAYMENT_MODES = [
  { value: 'mock', label: '模拟支付（测试）' },
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信支付' },
  { value: 'mixed', label: '混合（用户可选）' },
];

const defaultSettings = {
  site_name: '',
  site_description: '',
  footer_text: '',
  announcement: '',
  service_wechat: '',
  service_wechat_qrcode: '',
  registration_open: true,
  signup_points: 30,
  signup_ip_limit: 3,
  signup_device_limit: 1,
  ai_input_cost_per_million: 1,
  ai_output_cost_per_million: 16,
  ai_profit_margin: 0.8,
  course_quote_base_word_count: 10000,
  course_quote_word_price: 500,
  course_quote_chart_price: 100,
  course_quote_drawing_price: 150,
  course_quote_formula_low: 200,
  course_quote_formula_mid: 500,
  course_quote_formula_high: 1000,
  course_quote_urgent_multiplier: 1.3,
  payment_mode: 'mock',
  order_expire_seconds: 900,
  doc_retention_days: 30,
  alipay_appid: '',
  alipay_private_key: '',
  alipay_public_key: '',
  alipay_gateway: '',
  alipay_sandbox: false,
  wechat_appid: '',
  wechat_mch_id: '',
  wechat_api_v3_key: '',
  wechat_serial_no: '',
  wechat_private_key: '',
  wechat_notify_url: '',
};

export default function AdminSettings() {
  const confirm = useConfirm();
  const [settings, setSettings] = useState(defaultSettings);
  const [configured, setConfigured] = useState({}); // sensitive field -> already configured?
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrcodeUploading, setQrcodeUploading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminGetSettings();
      const s = data.settings || data;
      const next = { ...defaultSettings };
      const cfg = {};
      // 站点信息
      next.site_name = s.site_name ?? '';
      next.site_description = s.site_description ?? '';
      next.footer_text = s.footer_text ?? '';
      next.announcement = s.announcement ?? '';
      next.service_wechat = s.service_wechat ?? '';
      next.service_wechat_qrcode = s.service_wechat_qrcode ?? '';
      // 注册与赠送积分
      next.registration_open = parseBool(s.registration_open);
      next.signup_points = s.signup_points ?? 30;
      next.signup_ip_limit = s.signup_ip_limit ?? 3;
      next.signup_device_limit = s.signup_device_limit ?? 1;
      // AI 计费
      next.ai_input_cost_per_million = s.ai_input_cost_per_million ?? 1;
      next.ai_output_cost_per_million = s.ai_output_cost_per_million ?? 16;
      next.ai_profit_margin = s.ai_profit_margin ?? 0.8;
      // 课程定制报价
      next.course_quote_base_word_count = s.course_quote_base_word_count ?? 10000;
      next.course_quote_word_price = s.course_quote_word_price ?? 500;
      next.course_quote_chart_price = s.course_quote_chart_price ?? 100;
      next.course_quote_drawing_price = s.course_quote_drawing_price ?? 150;
      next.course_quote_formula_low = s.course_quote_formula_low ?? 200;
      next.course_quote_formula_mid = s.course_quote_formula_mid ?? 500;
      next.course_quote_formula_high = s.course_quote_formula_high ?? 1000;
      next.course_quote_urgent_multiplier = s.course_quote_urgent_multiplier ?? 1.3;
      // 支付配置
      next.payment_mode = s.payment_mode ?? 'mock';
      next.order_expire_seconds = s.order_expire_seconds ?? 900;
      next.doc_retention_days = s.doc_retention_days ?? 30;
      // 支付宝
      next.alipay_appid = s.alipay_appid ?? '';
      next.alipay_gateway = s.alipay_gateway ?? '';
      next.alipay_sandbox = parseBool(s.alipay_sandbox);
      // 微信
      next.wechat_appid = s.wechat_appid ?? '';
      next.wechat_mch_id = s.wechat_mch_id ?? '';
      next.wechat_serial_no = s.wechat_serial_no ?? '';
      next.wechat_notify_url = s.wechat_notify_url ?? '';
      // 敏感字段：已配置则留空并标记
      SENSITIVE_FIELDS.forEach((f) => {
        const v = s[f] ?? '';
        if (v === '已配置' || (typeof v === 'string' && v.length > 0)) {
          cfg[f] = true;
          next[f] = '';
        } else {
          cfg[f] = false;
          next[f] = '';
        }
      });
      setConfigured(cfg);
      setSettings(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        site_name: settings.site_name,
        site_description: settings.site_description,
        footer_text: settings.footer_text,
        announcement: settings.announcement,
        service_wechat: settings.service_wechat,
        registration_open: settings.registration_open ? 'true' : 'false',
        signup_points: Number(settings.signup_points) || 0,
        signup_ip_limit: Number(settings.signup_ip_limit) || 0,
        signup_device_limit: Number(settings.signup_device_limit) || 0,
        ai_input_cost_per_million: Number(settings.ai_input_cost_per_million) || 0,
        ai_output_cost_per_million: Number(settings.ai_output_cost_per_million) || 0,
        ai_profit_margin: Number(settings.ai_profit_margin) || 0,
        course_quote_base_word_count: Number(settings.course_quote_base_word_count) || 0,
        course_quote_word_price: Number(settings.course_quote_word_price) || 0,
        course_quote_chart_price: Number(settings.course_quote_chart_price) || 0,
        course_quote_drawing_price: Number(settings.course_quote_drawing_price) || 0,
        course_quote_formula_low: Number(settings.course_quote_formula_low) || 0,
        course_quote_formula_mid: Number(settings.course_quote_formula_mid) || 0,
        course_quote_formula_high: Number(settings.course_quote_formula_high) || 0,
        course_quote_urgent_multiplier: Number(settings.course_quote_urgent_multiplier) || 1,
        payment_mode: settings.payment_mode,
        order_expire_seconds: Number(settings.order_expire_seconds) || 0,
        doc_retention_days: Number(settings.doc_retention_days) || 0,
        alipay_appid: settings.alipay_appid,
        alipay_gateway: settings.alipay_gateway,
        alipay_sandbox: settings.alipay_sandbox ? 'true' : 'false',
        wechat_appid: settings.wechat_appid,
        wechat_mch_id: settings.wechat_mch_id,
        wechat_serial_no: settings.wechat_serial_no,
        wechat_notify_url: settings.wechat_notify_url,
      };
      // 敏感字段：仅当用户输入了新值才发送
      SENSITIVE_FIELDS.forEach((f) => {
        if (settings[f] && String(settings[f]).trim().length > 0) {
          payload[f] = settings[f];
        }
      });
      await api.adminUpdateSettings(payload);
      toast.success('设置已保存');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleQrcodeUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    setQrcodeUploading(true);
    setError('');
    try {
      const data = await api.adminUploadWechatQrcode(file);
      setSettings((prev) => ({ ...prev, service_wechat_qrcode: data.url }));
      toast.success('客服微信二维码已上传');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setQrcodeUploading(false);
    }
  };

  const handleQrcodeDelete = async () => {
    setQrcodeUploading(true);
    setError('');
    try {
      await api.adminDeleteWechatQrcode();
      setSettings((prev) => ({ ...prev, service_wechat_qrcode: '' }));
      toast.success('客服微信二维码已移除');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setQrcodeUploading(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-4xl px-8 py-8 text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">系统设置</h1>
          <p className="mt-1 text-sm text-slate-500">站点信息、注册、赠送额度与支付配置</p>
        </div>
        <button onClick={save} disabled={saving} className="btn-primary">
          <Refresh className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="mt-6 space-y-6">
        {/* 站点信息 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">站点信息</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className="label">站点名称</label>
              <input
                className="input"
                value={settings.site_name}
                onChange={(e) => update('site_name', e.target.value)}
                placeholder="ScholarForge"
              />
            </div>
            <div>
              <label className="label">站点描述</label>
              <input
                className="input"
                value={settings.site_description}
                onChange={(e) => update('site_description', e.target.value)}
                placeholder="学术写作辅助平台"
              />
            </div>
            <div>
              <label className="label">页脚文字</label>
              <textarea
                className="input min-h-[72px] resize-none"
                value={settings.footer_text}
                onChange={(e) => update('footer_text', e.target.value)}
                placeholder="© 2026 ScholarForge"
              />
            </div>
            <div>
              <label className="label">客服微信</label>
              <input
                className="input"
                value={settings.service_wechat}
                onChange={(e) => update('service_wechat', e.target.value)}
                placeholder="例如：ScholarForge2026"
              />
              <p className="mt-1.5 text-xs text-slate-400">课程购买等人工咨询用，前台展示，用户添加微信详聊</p>
            </div>
            <div>
              <label className="label">客服微信二维码</label>
              <div className="flex items-start gap-4">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {settings.service_wechat_qrcode ? (
                    <img src={settings.service_wechat_qrcode} alt="客服微信二维码" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs text-slate-400">未上传</span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="btn-secondary cursor-pointer px-3 py-2 text-xs">
                    {qrcodeUploading ? '处理中…' : '上传二维码'}
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/*"
                      className="hidden"
                      onChange={handleQrcodeUpload}
                      disabled={qrcodeUploading}
                    />
                  </label>
                  {settings.service_wechat_qrcode && (
                    <button onClick={handleQrcodeDelete} disabled={qrcodeUploading} className="btn-ghost px-3 py-2 text-xs text-red-600">
                      移除二维码
                    </button>
                  )}
                  <p className="text-xs text-slate-400">建议上传方形二维码图片（png/jpg），前台展示供用户扫码添加</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 公告 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">公告</h3>
          <div className="mt-4">
            <label className="label">公告内容</label>
            <textarea
              className="input min-h-[88px] resize-none"
              value={settings.announcement}
              onChange={(e) => update('announcement', e.target.value)}
              placeholder="留空则不显示公告"
            />
            <p className="mt-1.5 text-xs text-slate-400">留空时前台不显示公告横幅</p>
          </div>
        </div>

        {/* 注册与 AI 计费 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">注册与 AI 计费</h3>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-ink">开放注册</div>
                <div className="text-xs text-slate-400">关闭后新用户无法注册</div>
              </div>
              <button
                type="button"
                onClick={() => update('registration_open', !settings.registration_open)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  settings.registration_open ? 'bg-accent' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    settings.registration_open ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            <div>
              <label className="label">注册赠送积分</label>
              <input
                type="number"
                className="input max-w-[200px]"
                value={settings.signup_points}
                onChange={(e) => update('signup_points', e.target.value)}
              />
              <p className="mt-1.5 text-xs text-slate-400">新用户注册时赠送的积分数量（默认 30）</p>
            </div>

            <div className="my-3 border-t border-slate-100" />

            <div>
              <div className="text-sm font-medium text-ink">注册风控（防批量注册白嫖积分）</div>
              <p className="mt-1 text-xs text-slate-400">0 表示不限制</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">同 IP 24h 最大注册数</label>
                <input
                  type="number"
                  className="input"
                  value={settings.signup_ip_limit}
                  onChange={(e) => update('signup_ip_limit', e.target.value)}
                />
                <p className="mt-1.5 text-xs text-slate-400">同一 IP 在 24 小时内最多注册的账号数</p>
              </div>
              <div>
                <label className="label">同设备最大注册数</label>
                <input
                  type="number"
                  className="input"
                  value={settings.signup_device_limit}
                  onChange={(e) => update('signup_device_limit', e.target.value)}
                />
                <p className="mt-1.5 text-xs text-slate-400">同一浏览器设备指纹最多注册的账号数</p>
              </div>
            </div>

            <div className="my-3 border-t border-slate-100" />

            <div>
              <div className="text-sm font-medium text-ink">AI 计费配置（按大模型用量计费）</div>
              <p className="mt-1 text-xs text-slate-400">
                售价 = 成本 ÷ (1 - 利润率)，利润率 0.8 时售价为成本的 5 倍，保证利润不低于 80%
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">输入成本（元/百万 token）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.ai_input_cost_per_million}
                  onChange={(e) => update('ai_input_cost_per_million', e.target.value)}
                />
              </div>
              <div>
                <label className="label">输出成本（元/百万 token）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.ai_output_cost_per_million}
                  onChange={(e) => update('ai_output_cost_per_million', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">目标利润率（0~0.99）</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="0.99"
                className="input max-w-[200px]"
                value={settings.ai_profit_margin}
                onChange={(e) => update('ai_profit_margin', e.target.value)}
              />
              <p className="mt-1.5 text-xs text-slate-400">0.8 = 80% 利润率，售价 = 成本 × 5</p>
            </div>
          </div>
        </div>

        {/* 课程定制报价 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">课程定制报价规则</h3>
          <p className="mt-1 text-xs text-slate-400">
            论文 1 对 1 指导：课程"起"价为基础价，用户填写需求后在其上累加。字数、图表、图纸按量加价，公式按复杂度分级加价，加急按系数加成。
          </p>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">基准字数（字）</label>
                <input
                  type="number"
                  className="input"
                  value={settings.course_quote_base_word_count}
                  onChange={(e) => update('course_quote_base_word_count', e.target.value)}
                />
                <p className="mt-1.5 text-xs text-slate-400">含在起价内的字数，超出部分加价</p>
              </div>
              <div>
                <label className="label">每超 1 万字加价（元）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.course_quote_word_price}
                  onChange={(e) => update('course_quote_word_price', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">每张图表加价（元）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.course_quote_chart_price}
                  onChange={(e) => update('course_quote_chart_price', e.target.value)}
                />
              </div>
              <div>
                <label className="label">每张图纸加价（元）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.course_quote_drawing_price}
                  onChange={(e) => update('course_quote_drawing_price', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">公式·少量（元）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.course_quote_formula_low}
                  onChange={(e) => update('course_quote_formula_low', e.target.value)}
                />
              </div>
              <div>
                <label className="label">公式·较多（元）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.course_quote_formula_mid}
                  onChange={(e) => update('course_quote_formula_mid', e.target.value)}
                />
              </div>
              <div>
                <label className="label">公式·大量（元）</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={settings.course_quote_formula_high}
                  onChange={(e) => update('course_quote_formula_high', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">加急系数（≥1）</label>
              <input
                type="number"
                step="0.1"
                min="1"
                className="input max-w-[200px]"
                value={settings.course_quote_urgent_multiplier}
                onChange={(e) => update('course_quote_urgent_multiplier', e.target.value)}
              />
              <p className="mt-1.5 text-xs text-slate-400">加急时小计乘以此系数（1.3 = 加收 30%）</p>
            </div>
          </div>
        </div>

        {/* 支付配置 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">支付配置</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className="label">支付方式</label>
              <select
                className="input"
                value={settings.payment_mode}
                onChange={(e) => update('payment_mode', e.target.value)}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-400">模拟支付仅用于测试，不会发生真实交易</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">订单过期时间(秒)</label>
                <input
                  type="number"
                  className="input"
                  value={settings.order_expire_seconds}
                  onChange={(e) => update('order_expire_seconds', e.target.value)}
                  placeholder="900"
                />
                <p className="mt-1.5 text-xs text-slate-400">未支付订单自动关闭的时长</p>
              </div>
              <div>
                <label className="label">文档保留天数</label>
                <input
                  type="number"
                  className="input"
                  value={settings.doc_retention_days}
                  onChange={(e) => update('doc_retention_days', e.target.value)}
                  placeholder="30"
                />
                <p className="mt-1.5 text-xs text-slate-400">生成文档的保留期限</p>
              </div>
            </div>
          </div>
        </div>

        {/* 支付宝配置 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">支付宝配置</h3>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">AppID</label>
                <input
                  className="input"
                  value={settings.alipay_appid}
                  onChange={(e) => update('alipay_appid', e.target.value)}
                  placeholder="支付宝应用 AppID"
                />
              </div>
              <div>
                <label className="label">网关地址</label>
                <input
                  className="input"
                  value={settings.alipay_gateway}
                  onChange={(e) => update('alipay_gateway', e.target.value)}
                  placeholder="https://openapi.alipay.com/gateway.do"
                />
              </div>
            </div>
            <div>
              <label className="label">应用私钥</label>
              <textarea
                className="input min-h-[80px] resize-none font-mono text-xs"
                value={settings.alipay_private_key}
                onChange={(e) => update('alipay_private_key', e.target.value)}
                placeholder={configured.alipay_private_key ? '已配置，留空不修改' : '粘贴应用私钥'}
              />
              <p className="mt-1.5 text-xs text-slate-400">{configured.alipay_private_key ? '当前已配置，留空将保持不变' : '尚未配置'}</p>
            </div>
            <div>
              <label className="label">支付宝公钥</label>
              <textarea
                className="input min-h-[80px] resize-none font-mono text-xs"
                value={settings.alipay_public_key}
                onChange={(e) => update('alipay_public_key', e.target.value)}
                placeholder={configured.alipay_public_key ? '已配置，留空不修改' : '粘贴支付宝公钥'}
              />
              <p className="mt-1.5 text-xs text-slate-400">{configured.alipay_public_key ? '当前已配置，留空将保持不变' : '尚未配置'}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-ink">沙箱模式</div>
                <div className="text-xs text-slate-400">启用后使用支付宝沙箱环境</div>
              </div>
              <button
                type="button"
                onClick={() => update('alipay_sandbox', !settings.alipay_sandbox)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  settings.alipay_sandbox ? 'bg-accent' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    settings.alipay_sandbox ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* 微信支付配置 */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink">微信支付配置</h3>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">AppID</label>
                <input
                  className="input"
                  value={settings.wechat_appid}
                  onChange={(e) => update('wechat_appid', e.target.value)}
                  placeholder="公众号/小程序 AppID"
                />
              </div>
              <div>
                <label className="label">商户号 MchID</label>
                <input
                  className="input"
                  value={settings.wechat_mch_id}
                  onChange={(e) => update('wechat_mch_id', e.target.value)}
                  placeholder="微信支付商户号"
                />
              </div>
            </div>
            <div>
              <label className="label">商户证书序列号</label>
              <input
                className="input font-mono text-xs"
                value={settings.wechat_serial_no}
                onChange={(e) => update('wechat_serial_no', e.target.value)}
                placeholder="商户 API 证书序列号"
              />
            </div>
            <div>
              <label className="label">APIv3 密钥</label>
              <input
                type="password"
                className="input font-mono text-xs"
                value={settings.wechat_api_v3_key}
                onChange={(e) => update('wechat_api_v3_key', e.target.value)}
                placeholder={configured.wechat_api_v3_key ? '已配置，留空不修改' : 'APIv3 密钥'}
              />
              <p className="mt-1.5 text-xs text-slate-400">{configured.wechat_api_v3_key ? '当前已配置，留空将保持不变' : '尚未配置'}</p>
            </div>
            <div>
              <label className="label">商户私钥</label>
              <textarea
                className="input min-h-[80px] resize-none font-mono text-xs"
                value={settings.wechat_private_key}
                onChange={(e) => update('wechat_private_key', e.target.value)}
                placeholder={configured.wechat_private_key ? '已配置，留空不修改' : '粘贴商户私钥（PEM）'}
              />
              <p className="mt-1.5 text-xs text-slate-400">{configured.wechat_private_key ? '当前已配置，留空将保持不变' : '尚未配置'}</p>
            </div>
            <div>
              <label className="label">支付回调地址</label>
              <input
                className="input"
                value={settings.wechat_notify_url}
                onChange={(e) => update('wechat_notify_url', e.target.value)}
                placeholder="https://your-domain.com/api/payment/wechat/notify"
              />
              <p className="mt-1.5 text-xs text-slate-400">微信支付异步通知地址，需为公网可访问的 HTTPS URL</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn-primary">
            <Refresh className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  if (typeof v === 'number') return v !== 0;
  return false;
}
