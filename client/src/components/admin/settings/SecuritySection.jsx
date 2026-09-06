// 注册与安全 section：开放注册与注册风控（IP/设备指纹限制）、内容安全审核（本地/阿里云/易盾）。
import Toggle from './Toggle.jsx';

const CONTENT_SAFETY_PROVIDERS = [
  { value: 'local', label: '本地敏感词过滤（默认）' },
  { value: 'aliyun', label: '阿里云内容安全' },
  { value: 'yidun', label: '网易易盾' },
];

export default function SecuritySection({ settings, update, configured }) {
  return (
    <>
      {/* 注册与风控 */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-ink">注册与风控</h3>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-ink">开放注册</div>
              <div className="text-xs text-slate-400">关闭后新用户无法注册</div>
            </div>
            <Toggle
              checked={settings.registration_open}
              onChange={(v) => update('registration_open', v)}
            />
          </div>

          <div>
            <div className="text-sm font-medium text-ink">注册风控（防批量注册）</div>
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
        </div>
      </div>

      {/* 内容安全审核 */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-ink">内容安全审核</h3>
        <p className="mt-1 text-xs text-slate-400">
          对用户输入与 AI 生成内容进行文本审核，拦截违法/违规信息。本地敏感词过滤始终启用作为兜底；配置第三方服务后由其接管。
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">审核服务</label>
            <select
              className="input"
              value={settings.content_safety_provider}
              onChange={(e) => update('content_safety_provider', e.target.value)}
            >
              {CONTENT_SAFETY_PROVIDERS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {settings.content_safety_provider === 'aliyun' && (
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">阿里云内容安全（AccessKey）</div>
              <div>
                <label className="label">AccessKey ID</label>
                <input
                  className="input font-mono text-xs"
                  value={settings.aliyun_access_key_id}
                  onChange={(e) => update('aliyun_access_key_id', e.target.value)}
                  placeholder="阿里云 AccessKey ID"
                />
              </div>
              <div>
                <label className="label">AccessKey Secret</label>
                <input
                  type="password"
                  className="input font-mono text-xs"
                  value={settings.aliyun_access_key_secret}
                  onChange={(e) => update('aliyun_access_key_secret', e.target.value)}
                  placeholder={configured.aliyun_access_key_secret ? '已配置，留空不修改' : '阿里云 AccessKey Secret'}
                />
                <p className="mt-1.5 text-xs text-slate-400">{configured.aliyun_access_key_secret ? '当前已配置，留空将保持不变' : '尚未配置'}</p>
              </div>
            </div>
          )}

          {settings.content_safety_provider === 'yidun' && (
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">网易易盾（文本反垃圾）</div>
              <div>
                <label className="label">Secret ID</label>
                <input
                  className="input font-mono text-xs"
                  value={settings.yidun_secret_id}
                  onChange={(e) => update('yidun_secret_id', e.target.value)}
                  placeholder="易盾 Secret ID"
                />
              </div>
              <div>
                <label className="label">Secret Key</label>
                <input
                  type="password"
                  className="input font-mono text-xs"
                  value={settings.yidun_secret_key}
                  onChange={(e) => update('yidun_secret_key', e.target.value)}
                  placeholder={configured.yidun_secret_key ? '已配置，留空不修改' : '易盾 Secret Key'}
                />
                <p className="mt-1.5 text-xs text-slate-400">{configured.yidun_secret_key ? '当前已配置，留空将保持不变' : '尚未配置'}</p>
              </div>
              <div>
                <label className="label">业务 ID（Business ID）</label>
                <input
                  className="input font-mono text-xs"
                  value={settings.yidun_business_id}
                  onChange={(e) => update('yidun_business_id', e.target.value)}
                  placeholder="易盾业务 ID（可留空）"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
