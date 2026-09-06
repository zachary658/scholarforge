// 系统设置页：统一加载/保存全部站点配置，按分区组合 section 组件。
// 表单分区拆分至 components/admin/settings/（站点/安全/AI 计费/支付）。
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';
import SiteSection from '../../components/admin/settings/SiteSection.jsx';
import SecuritySection from '../../components/admin/settings/SecuritySection.jsx';
import AiSection from '../../components/admin/settings/AiSection.jsx';
import PaymentSection from '../../components/admin/settings/PaymentSection.jsx';

const SENSITIVE_FIELDS = ['alipay_private_key', 'alipay_public_key', 'wechat_api_v3_key', 'wechat_private_key', 'wechat_platform_public_key', 'aliyun_access_key_secret', 'yidun_secret_key'];

const defaultSettings = {
  site_name: '',
  site_description: '',
  footer_text: '',
  icp_number: '',
  icp_link: '',
  announcement: '',
  service_wechat: '',
  service_wechat_qrcode: '',
  registration_open: true,
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
  wechat_platform_public_key: '',
  wechat_platform_serial_no: '',
  content_safety_provider: 'local',
  aliyun_access_key_id: '',
  aliyun_access_key_secret: '',
  yidun_secret_id: '',
  yidun_secret_key: '',
  yidun_business_id: '',
};

export default function AdminSettings() {
  const [settings, setSettings] = useState(defaultSettings);
  const [configured, setConfigured] = useState({}); // sensitive field -> already configured?
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      next.icp_number = s.icp_number ?? '';
      next.icp_link = s.icp_link ?? '';
      next.announcement = s.announcement ?? '';
      next.service_wechat = s.service_wechat ?? '';
      next.service_wechat_qrcode = s.service_wechat_qrcode ?? '';
      // 注册
      next.registration_open = parseBool(s.registration_open);
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
      next.wechat_platform_serial_no = s.wechat_platform_serial_no ?? '';
      // 内容安全审核
      next.content_safety_provider = s.content_safety_provider ?? 'local';
      next.aliyun_access_key_id = s.aliyun_access_key_id ?? '';
      next.yidun_secret_id = s.yidun_secret_id ?? '';
      next.yidun_business_id = s.yidun_business_id ?? '';
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
        icp_number: settings.icp_number,
        icp_link: settings.icp_link,
        announcement: settings.announcement,
        service_wechat: settings.service_wechat,
        registration_open: settings.registration_open ? 'true' : 'false',
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
        wechat_platform_serial_no: settings.wechat_platform_serial_no,
        content_safety_provider: settings.content_safety_provider,
        aliyun_access_key_id: settings.aliyun_access_key_id,
        yidun_secret_id: settings.yidun_secret_id,
        yidun_business_id: settings.yidun_business_id,
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
        <SiteSection settings={settings} update={update} />
        <SecuritySection settings={settings} update={update} configured={configured} />
        <AiSection settings={settings} update={update} />
        <PaymentSection settings={settings} update={update} configured={configured} />

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
