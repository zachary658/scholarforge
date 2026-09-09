import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Logo, ChevronLeft } from '../components/Icons.jsx';

// 用户协议（阶段四 4.3）
export default function Terms() {
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
        <h1 className="text-2xl font-bold text-ink">用户协议</h1>
        <p className="mt-1.5 text-xs text-slate-400">更新日期：2026-09-09</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">1. 服务说明</h2>
            <p>
              {siteName}（以下简称"本平台"）是面向研究与学术写作场景的 AI 辅助工具平台，提供真实文献检索、研究提纲、章节初稿、引用核验、语言辅助、图表和格式导出等服务。本平台输出会保留 AI 辅助标识，<strong>用于帮助用户研究与修改，不是可直接提交的代写成果，也不构成专业建议或事实保证</strong>。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">2. 账号与安全</h2>
            <p>
              用户注册时应提供真实、准确的信息，并妥善保管账号与密码。因用户保管不善导致账号被盗用或产生的一切后果，由用户自行承担。用户不得利用本平台从事任何违法违规活动，不得批量注册、恶意刷单、绕过风控或攻击本平台系统。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">3. 付费与订单</h2>
            <p>
              本平台采用按项目或按功能付费，支持固定价格与人工报价。购买前会展示服务范围、价格与交付方式。未支付订单可申请取消；已支付订单如遇重复扣款、功能持续不可用、未按约定提供服务或法律规定的其他情形，可在“我的订单”提交售后。退款需经核实并按原支付渠道规则处理，结果与退款流水会记录在订单中。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">4. 学术诚信与合规使用</h2>
            <p>
              用户使用研究初稿、表达辅助等敏感功能前，须阅读并同意《学术诚信承诺书》。用户应遵守所在学校、期刊和适用法律的学术规范，<strong>不得把 AI 输出冒充为本人独立完成的学术成果直接提交</strong>。平台检索到的文献会尽可能提供 DOI、URL 或来源标识；用户仍须阅读原文并核验引用语义。数据、结论和图表只有在存在可验证依据时才能用于正式成果。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">5. 内容审核与责任限制</h2>
            <p>
              本平台对用户输入与 AI 生成内容进行内容安全审核，但审核不构成对内容合法性、准确性、完整性的保证。AI 生成内容可能存在事实性错误、引用偏差或表述局限，用户需自行核验。在法律允许的最大范围内，本平台不对因使用或无法使用本平台服务而产生的间接损失、数据丢失或第三方主张承担责任。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">6. 知识产权</h2>
            <p>
              本平台的软件、界面设计、商标、模板等知识产权归本平台所有。用户对其自行上传、输入的内容享有相应权利，并授权本平台在提供服务所必需的范围内进行处理与存储。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">7. 协议变更与终止</h2>
            <p>
              本平台有权根据业务发展需要适时修订本协议，修订后的协议将在页面公示。用户继续使用本平台服务即视为接受修订后的协议。用户可随时停止使用本平台服务；对违反本协议或法律法规的用户，本平台有权限制或终止其账号及相关服务。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-ink">8. 法律适用与争议解决</h2>
            <p>
              本协议的订立、效力、解释与争议解决均适用中华人民共和国法律。因本协议产生的争议，双方应友好协商解决；协商不成的，任何一方可向本平台运营方所在地有管辖权的人民法院提起诉讼。
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
