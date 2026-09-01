import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Logo, ChevronLeft } from '../components/Icons.jsx';

// 隐私政策（阶段四 4.3）
export default function Privacy() {
  const [siteName, setSiteName] = useState('ScholarForge');

  useEffect(() => {
    api.getSite().then((s) => setSiteName(s.site_name || 'ScholarForge')).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#F7F5F0] font-sans">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="text-lg font-bold text-ink">{siteName}</span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-accent">
            <ChevronLeft className="h-4 w-4" /> 返回首页
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">隐私政策</h1>
        <p className="mt-1.5 text-xs text-slate-400">更新日期：2026-08-19</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">1. 我们收集的信息</h2>
            <p>为向您提供本平台服务，我们可能收集以下信息：</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>账号信息</strong>：昵称、邮箱、加密存储的密码；</li>
              <li><strong>使用信息</strong>：您在使用 AI 工具时输入的论文信息、大纲、写作要求及生成结果；</li>
              <li><strong>订单与支付信息</strong>：订单记录、支付渠道返回的交易流水号（我们<strong>不直接存储</strong>您的支付卡号等敏感支付凭证）；</li>
              <li><strong>设备与日志信息</strong>：设备指纹、IP 地址、访问时间等，用于安全风控与反滥用。</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">2. 我们如何使用信息</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>提供、维护并改进 AI 写作、润色、文献检索、格式导出等服务；</li>
              <li>处理订单、支付与售后服务；</li>
              <li>进行内容安全审核与安全风控，防范欺诈、滥用与攻击；</li>
              <li>在法律法规要求或您授权时，履行相应义务。</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">3. 信息共享与第三方服务</h2>
            <p>
              为实现服务，我们可能与以下第三方共享必要信息：大模型服务商（用于 AI 生成）、支付渠道（微信支付 / 支付宝，用于完成交易）、内容安全服务商（用于文本审核）。我们仅共享实现相应功能所必需的最小范围信息，并要求第三方依法保护您的信息。
            </p>
            <p className="mt-2">
              <strong>关于 AI 训练</strong>：您上传的资料与输入的论文内容，仅用于当次 AI 生成服务，<strong>不会被用于训练大模型</strong>；我们与模型服务商的协议中亦明确禁止其将您的输入内容用于模型训练。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">4. 数据存储与删除</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>存储位置</strong>：您的数据存储于中华人民共和国境内的服务器。</li>
              <li><strong>上传资料与生成文档</strong>：默认保留 30 天（以站点设置为准），到期自动删除，请及时下载保存到本地。</li>
              <li><strong>删除项目</strong>：删除论文项目后，该项目归档不再展示，其关联的资料、任务记录与生成文档随项目一并不可见；资料与文档也可单独删除。</li>
              <li><strong>管理员与客服可见范围</strong>：为提供人工报价、订单对接与售后服务，管理员与客服可查看您的订单信息、需求描述与联系方式；您的完整论文内容与生成结果仅用于必要的服务处理，不对外公开。</li>
              <li><strong>订单数据</strong>：根据《中华人民共和国电子商务法》及税务相关法规要求，订单与支付记录依法留存，保留期限不少于法定期限。</li>
              <li><strong>导出与删除</strong>：您可通过站内功能随时删除项目、文档与资料；可通过客服渠道申请数据导出或账号注销，我们将在合理期限内处理。</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">5. Cookie 与本地存储</h2>
            <p>
              我们使用 Cookie 与浏览器本地存储来维持登录状态、提升使用体验与保障安全。您可通过浏览器设置管理或清除 Cookie，但这可能导致部分功能无法正常使用。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">6. 您的权利</h2>
            <p>
              在符合法律法规的前提下，您有权访问、更正、删除您的个人信息，撤回同意，或注销账号。您可通过平台客服渠道联系我们行使上述权利。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">7. 未成年人保护</h2>
            <p>
              本平台主要面向具备完全民事行为能力的用户。未成年人应在监护人指导下使用本平台服务，并取得监护人同意。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">8. 政策更新与联系我们</h2>
            <p>
              我们可能适时更新本政策，更新后将在页面公示。如您对本政策有任何疑问、意见或投诉，可通过本平台公布的客服渠道与我们联系，我们将在合理期限内予以答复。
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        © 2026 {siteName}
      </footer>
    </div>
  );
}
