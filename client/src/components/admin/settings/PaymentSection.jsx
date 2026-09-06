// 支付 section：支付方式与订单策略、支付宝商户配置、微信支付商户配置。
import Toggle from './Toggle.jsx';

const PAYMENT_MODES = [
  { value: 'mock', label: '模拟支付（测试）' },
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信支付' },
  { value: 'mixed', label: '混合（用户可选）' },
];

export default function PaymentSection({ settings, update, configured }) {
  return (
    <>
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
            <Toggle
              checked={settings.alipay_sandbox}
              onChange={(v) => update('alipay_sandbox', v)}
            />
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
          <div>
            <label className="label">微信平台证书序列号</label>
            <input
              className="input font-mono text-xs"
              value={settings.wechat_platform_serial_no}
              onChange={(e) => update('wechat_platform_serial_no', e.target.value)}
              placeholder="微信支付平台证书序列号（回调验签必需）"
            />
            <p className="mt-1.5 text-xs text-slate-400">在微信支付商户平台「账户中心 → API 安全 → 平台证书」查看；未配置时回调将被拒绝</p>
          </div>
          <div>
            <label className="label">微信平台公钥</label>
            <textarea
              className="input min-h-[80px] resize-none font-mono text-xs"
              value={settings.wechat_platform_public_key}
              onChange={(e) => update('wechat_platform_public_key', e.target.value)}
              placeholder={configured.wechat_platform_public_key ? '已配置，留空不修改' : '粘贴微信支付平台公钥（PEM）'}
            />
            <p className="mt-1.5 text-xs text-slate-400">{configured.wechat_platform_public_key ? '当前已配置，留空将保持不变' : '回调验签必需，尚未配置'}</p>
          </div>
        </div>
      </div>
    </>
  );
}
