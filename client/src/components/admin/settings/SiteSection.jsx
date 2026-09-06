// 站点信息与公告 section：站点基础信息、ICP 备案、客服微信与二维码上传、前台公告。
import { useState } from 'react';
import { api } from '../../../lib/api.js';
import { toast } from '../../Toast.jsx';

export default function SiteSection({ settings, update }) {
  const [qrcodeUploading, setQrcodeUploading] = useState(false);

  const handleQrcodeUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    setQrcodeUploading(true);
    try {
      const data = await api.adminUploadWechatQrcode(file);
      update('service_wechat_qrcode', data.url);
      toast.success('客服微信二维码已上传');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setQrcodeUploading(false);
    }
  };

  const handleQrcodeDelete = async () => {
    setQrcodeUploading(true);
    try {
      await api.adminDeleteWechatQrcode();
      update('service_wechat_qrcode', '');
      toast.success('客服微信二维码已移除');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setQrcodeUploading(false);
    }
  };

  return (
    <>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">ICP 备案号</label>
              <input
                className="input"
                value={settings.icp_number}
                onChange={(e) => update('icp_number', e.target.value)}
                placeholder="如：沪ICP备XXXXXXXX号"
              />
              <p className="mt-1.5 text-xs text-slate-400">留空则页脚不展示备案信息</p>
            </div>
            <div>
              <label className="label">ICP 备案链接</label>
              <input
                className="input"
                value={settings.icp_link}
                onChange={(e) => update('icp_link', e.target.value)}
                placeholder="https://beian.miit.gov.cn/"
              />
              <p className="mt-1.5 text-xs text-slate-400">留空默认跳转工信部备案查询</p>
            </div>
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
    </>
  );
}
