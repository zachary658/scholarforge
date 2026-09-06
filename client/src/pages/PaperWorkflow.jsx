import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadDocFile } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import FeaturePay from '../components/FeaturePay.jsx';
import AcademicIntegrityModal from '../components/AcademicIntegrityModal.jsx';
import { useAcademicIntegrity } from '../lib/useAcademicIntegrity.js';
import { FIELDS } from '../lib/constants.js';
import {
  Layers, Pen, Book, BookOpen, Check, X, Save, Edit, Refresh, Plus, Trash,
  ArrowRight, ChevronRight, ChevronLeft, Brain, FileWord, ExternalLink, AlertCircle, Shield,
} from '../components/Icons.jsx';

const DEGREES = ['本科', '硕士', '博士', '其他'];

// 工作流步骤（与后端状态机一一对应）
const WF_STEPS = [
  { key: 'setup', label: '创作目的与信息', desc: '确认论文题目、学科与学历' },
  { key: 'researching', label: '真实文献检索', desc: '检索并确认≥3篇可溯源文献' },
  { key: 'outline_review', label: '大纲生成与确认', desc: '生成论文结构大纲并确认' },
  { key: 'chapter_generating', label: '逐章生成', desc: '按已确认大纲逐章生成正文' },
  { key: 'chapter_review', label: '单章确认', desc: '逐章确认内容衔接与质量' },
  { key: 'final_review', label: '全文一致性检查', desc: '检查章节/引用/图表一致性' },
  { key: 'completed', label: '最终输出', desc: '导出 Word 并交付' },
];

function isVerifiedRef(r) {
  return Boolean(r?.verification_proof);
}

export default function PaperWorkflow() {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = Number(searchParams.get('projectId')) || null;
  const integrity = useAcademicIntegrity();

  const [loading, setLoading] = useState(true);
  const [wf, setWf] = useState(null);          // workflow 状态对象
  const [project, setProject] = useState(null); // 完整工作区（含 outline/sources/chapters）
  const [stepIdx, setStepIdx] = useState(0);

  // 各步骤本地编辑状态
  const [outline, setOutline] = useState([]);
  const [outlineText, setOutlineText] = useState('');
  const [outlineFromText, setOutlineFromText] = useState(false);
  const [outlineErrors, setOutlineErrors] = useState(null);
  const [outlineSavedAt, setOutlineSavedAt] = useState(null);

  const [references, setReferences] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchNotice, setSearchNotice] = useState('');
  const [researchBusy, setResearchBusy] = useState(false);
  const [outlineBusy, setOutlineBusy] = useState(false);
  const [refForm, setRefForm] = useState({ title: '', authors: '', year: '', source_db: '', source_url: '', doi: '' });

  const [chapters, setChapters] = useState([]);
  const currentIdx = wf?.currentChapterIndex || 0;
  const curChapter = chapters[currentIdx];
  const [generating, setGenerating] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const [needPay, setNeedPay] = useState(null);
  const [currentChapterContent, setCurrentChapterContent] = useState('');

  const [finalCheck, setFinalCheck] = useState(null);
  const [finalDoc, setFinalDoc] = useState(null);

  const pollRef = useRef(null);
  const pollInFlight = useRef(false);

  // ---------- 数据加载 ----------
  const loadAll = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    try {
      const [w, p] = await Promise.all([
        api.getWorkflowState(id),
        api.getProject(id),
      ]);
      setWf(w.workflow);
      setFinalCheck(w.workflow?.finalCheck || null);
      const proj = p.project || p;
      setProject(proj);
      setSearchQuery(q => q || proj.title || '');
      const idx = WF_STEPS.findIndex((s) => s.key === (w.workflow?.state));
      setStepIdx(idx >= 0 ? idx : 0);
      // 初始化各步骤本地状态
      setOutline(proj.outline || []);
      setReferences((proj.sources?.references || []).map((r) => ({ ...r })));
      try {
        const gc = await api.getChapters(id);
        setChapters(gc.chapters || []);
        setGenerating(!!gc.generating);
      } catch {}
    } catch (err) {
      toast.error('加载工作流失败：' + err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (projectId) loadAll(projectId);
    else setLoading(false);
  }, [projectId, loadAll]);

  // 章节生成轮询（兜底：部分场景生成在请求返回后才落库）
  const stopPoll = useCallback(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, []);
  useEffect(() => stopPoll, [stopPoll]);

  // 进入单章确认态时，把编辑缓冲同步为当前章内容（避免跨章串味）
  useEffect(() => {
    if (wf?.state === 'chapter_review' && curChapter) {
      setCurrentChapterContent(curChapter.content || '');
    }
  }, [wf?.state, currentIdx, curChapter?.id, curChapter?.content]);
  const startChapterPoll = useCallback((id) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const gc = await api.getChapters(id);
        setChapters(gc.chapters || []);
        setGenerating(!!gc.generating);
        const w = await api.getWorkflowState(id);
        setWf(w.workflow);
        const idx = WF_STEPS.findIndex((s) => s.key === w.workflow?.state);
        setStepIdx(idx >= 0 ? idx : 0);
        if (!gc.generating) stopPoll();
      } catch { stopPoll(); }
      finally { pollInFlight.current = false; }
    }, 2500);
  }, [stopPoll]);

  // Resume polling after a refresh/navigation during a long-running generation.
  useEffect(() => {
    if (projectId && generating) startChapterPoll(projectId);
    else stopPoll();
    return stopPoll;
  }, [projectId, generating, startChapterPoll, stopPoll]);

  // 创建新论文并启动工作流
  const [createMode, setCreateMode] = useState(!projectId);
  const [createForm, setCreateForm] = useState({ title: '', field: '', degree: '', writingRequirements: '' });
  const [creating, setCreating] = useState(false);
  const doCreateAndStart = async (e) => {
    e.preventDefault();
    if (!createForm.title.trim()) { toast.error('请填写论文标题'); return; }
    setCreating(true);
    try {
      const d = await api.createProject(createForm);
      const pid = d.project?.id || d.id;
      await api.startFullPaperWorkflow(pid, createForm);
      setSearchParams({ projectId: String(pid) });
      setCreateMode(false);
      await loadAll(pid);
      toast.success('已创建完整论文工作区');
    } catch (err) {
      toast.error('创建失败：' + err.message);
    } finally {
      setCreating(false);
    }
  };

  // 既有项目「开始完整论文流程」
  const startWorkflow = async () => {
    if (!projectId) return;
    try {
      await api.startFullPaperWorkflow(projectId, {
        title: project?.title, field: project?.field, degree: project?.degree,
        description: project?.description, writingRequirements: project?.writing_requirements,
      });
      await loadAll(projectId);
      toast.success('已进入完整论文流程');
    } catch (err) {
      toast.error('启动失败：' + err.message);
    }
  };

  // ---------- 文献检索步骤 ----------
  const verifiedCount = references.filter(isVerifiedRef).length;
  const searchLiterature = async () => {
    if (!searchQuery.trim() || researchBusy) return;
    setResearchBusy(true);
    setSearchResults([]);
    setSearchNotice('');
    try {
      const data = await api.searchRefs(searchQuery.trim());
      setSearchResults(data.results || []);
      if (data.health === 'unavailable') {
        setSearchNotice('学术数据源暂时无法连接，请稍后重试。系统不会用 AI 编造结果。');
      } else if (!data.results?.length) {
        setSearchNotice('未找到匹配论文，请缩短关键词或加入英文术语。系统不会用 AI 编造结果。');
      } else if (data.health === 'partial') {
        setSearchNotice(`已从 ${data.sources_used?.join('、') || '可用学术源'} 找到 ${data.results.length} 篇真实记录；部分来源暂时不可用，不影响选择现有结果。`);
      } else {
        setSearchNotice(`已从 ${data.sources_used?.join('、') || '公开学术数据库'} 找到 ${data.results.length} 篇真实记录，请通过“查看来源”复核适用性。`);
      }
    } catch (err) {
      setSearchNotice(err.status === 429 ? '本小时检索次数较多，请稍后再试；已加入的真实文献不会丢失。' : `${err.message}。系统不会用 AI 编造检索结果。`);
    }
    finally { setResearchBusy(false); }
  };
  const selectReference = (ref) => {
    setReferences(current => current.some(r => r.title === ref.title || (r.doi && r.doi === ref.doi)) ? current : [...current, ref]);
  };
  const generateOutline = async () => {
    setOutlineBusy(true);
    try {
      await api.writing({ type: 'outline', topic: project.title, field: project.field, projectId });
      await loadAll(projectId);
      toast.success('大纲已生成，请编辑并确认');
    } catch (err) { toast.error(err.message); }
    finally { setOutlineBusy(false); }
  };
  const importRefs = async () => {
    try {
      const d = await api.listRefs({ projectId });
      const mapped = d.references || [];
      setReferences(mapped);
      toast.success(`已从文献库导入 ${mapped.length} 条`);
    } catch (err) {
      toast.error('导入失败：' + err.message);
    }
  };
  const addRef = () => {
    if (!refForm.title.trim()) { toast.error('请填写文献标题'); return; }
    setReferences([...references, { ...refForm, year: refForm.year ? Number(refForm.year) : undefined }]);
    setRefForm({ title: '', authors: '', year: '', source_db: '', source_url: '', doi: '' });
  };
  const removeRef = (i) => setReferences(references.filter((_, idx) => idx !== i));
  const confirmLiterature = async () => {
    if (researchBusy) return;
    setResearchBusy(true);
    try {
      await api.confirmLiterature(projectId, references);
      await loadAll(projectId);
      toast.success('文献已确认，进入大纲环节');
      if (!project?.outline?.length) await generateOutline();
    } catch (err) {
      if (err.code === 'LITERATURE_INSUFFICIENT') toast.error(err.message);
      else toast.error('确认失败：' + err.message);
    } finally { setResearchBusy(false); }
  };

  // ---------- 大纲步骤 ----------
  const loadExistingOutline = () => { setOutline(project?.outline || []); setOutlineFromText(false); setOutlineErrors(null); toast.success('已载入现有大纲'); };
  const saveOutline = async (doConfirm) => {
    if (outlineBusy) return;
    setOutlineBusy(true);
    setOutlineErrors(null);
    try {
      const payload = outlineFromText
        ? { text: outlineText, fromText: true, autoFix: true }
        : { outline, autoFix: true };
      if (doConfirm) {
        await api.saveOutlineValidated(projectId, payload);
        await api.confirmOutlineValidated(projectId);
        await loadAll(projectId);
        toast.success('大纲已确认，开始逐章生成');
        generateChapter();
      } else {
        await api.saveOutlineValidated(projectId, payload);
        setOutlineSavedAt(Date.now());
        await loadAll(projectId);
        toast.success('大纲已保存并通过结构校验');
      }
    } catch (err) {
      if (err.code === 'OUTLINE_INVALID') {
        setOutlineErrors(err.data?.details || null);
        toast.error(err.message);
      } else {
        toast.error('操作失败：' + err.message);
      }
    } finally { setOutlineBusy(false); }
  };
  const addChapter = () => setOutline([...outline, { chapter: `第${outline.length + 1}章 新章节`, sections: [] }]);
  const updateChapterTitle = (i, v) => setOutline(outline.map((c, idx) => idx === i ? { ...c, chapter: v } : c));
  const removeChapter = (i) => setOutline(outline.filter((_, idx) => idx !== i));
  const addSection = (ci) => setOutline(outline.map((c, idx) => idx === ci ? { ...c, sections: [...(c.sections || []), { title: '新小节' }] } : c));
  const updateSection = (ci, si, v) => setOutline(outline.map((c, idx) => idx === ci ? { ...c, sections: (c.sections || []).map((s, j) => j === si ? { ...s, title: v } : s) } : c));
  const removeSection = (ci, si) => setOutline(outline.map((c, idx) => idx === ci ? { ...c, sections: (c.sections || []).filter((_, j) => j !== si) } : c));

  // ---------- 章节生成 / 确认 ----------
  const doGenerateChapter = async (orderNo) => {
    setGenerating(true);
    try {
      const r = await api.generateCurrentChapter(projectId, orderNo);
      setChapters(r.chapters || chapters);
      setWf(r.workflow || wf);
      const idx = WF_STEPS.findIndex((s) => s.key === r.workflow?.state);
      if (idx >= 0) setStepIdx(idx);
      // 若服务端已是 review 态但前端仍 generating，启动兜底轮询
      if (r.workflow?.state === 'chapter_review') { setGenerating(false); await loadAll(projectId); }
      else startChapterPoll(projectId);
    } catch (err) {
      const nd = err?.data?.needOrder;
      if (nd) setNeedPay({ itemType: err.data.itemType || 'writing_fulltext', amount: Number(err.data.amount || 0) });
      else toast.error(err.message);
      setGenerating(false);
    }
  };
  const generateChapter = () => {
    if (!integrity.ensure(() => doGenerateChapter())) return;
    doGenerateChapter();
  };
  const confirmChapter = async () => {
    if (generating || actionLock.current) return;
    actionLock.current = true; setActionBusy(true);
    try {
      const r = await api.confirmCurrentChapter(projectId, { chapterId: curChapter?.id, content: currentChapterContent });
      setWf(r.workflow || wf);
      const idx = WF_STEPS.findIndex((s) => s.key === r.workflow?.state);
      if (idx >= 0) setStepIdx(idx);
      await loadAll(projectId);
      if (r.workflow?.state === 'final_review') toast.success('全部章节已确认，进入全文检查');
      else { toast.success('本章已确认，正在生成下一章'); await doGenerateChapter(r.workflow?.orderNo); }
    } catch (err) { toast.error(err.message); }
    finally { actionLock.current = false; setActionBusy(false); }
  };
  const saveCurrentChapter = async () => {
    if (!curChapter || generating || actionLock.current) return;
    actionLock.current = true; setActionBusy(true);
    try { await api.editChapter(projectId, curChapter.id, currentChapterContent); toast.success('本章已保存'); }
    catch (err) { toast.error(err.message); }
    finally { actionLock.current = false; setActionBusy(false); }
  };
  const regenerateCurrent = async () => {
    if (!curChapter) return;
    const execute = async () => {
      setGenerating(true);
      try {
        const r = await api.regenerateChapter(projectId, curChapter.id, { orderNo: wf?.orderNo || undefined });
        setChapters(r.chapters || chapters); await loadAll(projectId); toast.success('已重新生成本章');
      } catch (err) { toast.error(err.message); }
      finally { setGenerating(false); }
    };
    if (integrity.ensure(execute)) await execute();
  };
  const backToChapter = async (index) => {
    const ok = await confirm({ title: '返回上一步', message: '将回到指定章节重新生成/调整，已确认进度可能重置，确定继续？', confirmText: '返回' });
    if (!ok) return;
    try { const r = await api.backToChapter(projectId, index); setWf(r.workflow || wf); const idx = WF_STEPS.findIndex((s) => s.key === r.workflow?.state); if (idx >= 0) setStepIdx(idx); await loadAll(projectId); }
    catch (err) { toast.error(err.message); }
  };

  // ---------- 全文检查 / 输出 ----------
  const runCheck = async () => {
    try { const d = await api.runFinalCheck(projectId); setFinalCheck(d.check); if (d.check.passed) toast.success('一致性检查通过'); else toast.error('存在需修复的问题，请查看下方明细'); }
    catch (err) { toast.error(err.message); }
  };
  const exportFinal = async () => {
    if (actionLock.current) return;
    actionLock.current = true; setActionBusy(true);
    try {
      const d = await api.generateFinalDocument(projectId, {});
      setFinalDoc(d.doc || null);
      if (d.workflow) { setWf(d.workflow); const idx = WF_STEPS.findIndex((s) => s.key === d.workflow.state); if (idx >= 0) setStepIdx(idx); }
      if (d.doc?.id) { await downloadDocFile(d.doc.id, project?.title || '论文'); toast.success('已生成并下载 Word'); }
      else if (d.quarto) toast.success('已生成文档');
      await loadAll(projectId);
    } catch (err) { toast.error(err.message); }
    finally { actionLock.current = false; setActionBusy(false); }
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 pt-8 pb-24">
      {/* 创建新论文（无 projectId 时选择「生成完整论文」触发） */}
      {createMode && !projectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-[560px] max-w-full rounded-xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-semibold text-ink">新建完整论文工作区</h3>
              <button onClick={() => setCreateMode(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={doCreateAndStart} className="space-y-4 px-6 py-5">
              <div>
                <label className="block text-sm font-medium text-ink">论文标题 *</label>
                <input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="如：基于深度学习的图像识别研究" className="input mt-1.5" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink">学科领域</label>
                  <select value={createForm.field} onChange={(e) => setCreateForm({ ...createForm, field: e.target.value })} className="input mt-1.5">
                    <option value="">请选择</option>{FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink">学历</label>
                  <select value={createForm.degree} onChange={(e) => setCreateForm({ ...createForm, degree: e.target.value })} className="input mt-1.5">
                    <option value="">请选择</option>{DEGREES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">写作要求</label>
                <textarea value={createForm.writingRequirements} onChange={(e) => setCreateForm({ ...createForm, writingRequirements: e.target.value })} rows={2} placeholder="如：8000字以上、学术规范、需引用近5年文献…" className="input mt-1.5" />
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setCreateMode(false)} className="btn-ghost">取消</button>
                <button type="submit" disabled={creating} className="btn-primary">{creating ? '创建中…' : '创建并开始'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 顶部标题 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">完整论文流程</h1>
          <p className="mt-1 text-sm text-slate-500">按步骤推进：文献 → 大纲 → 逐章生成 → 单章确认 → 全文检查 → 输出，无需自己想下一步</p>
        </div>
        {project && (
          <button onClick={() => navigate(`/app/projects?projectId=${projectId}&tab=pipeline`)} className="btn-ghost text-sm">
            <Layers className="h-4 w-4" /> 工作区详情
          </button>
        )}
      </div>

      {/* 步骤导航 */}
      <StepNav stepIdx={stepIdx} state={wf?.state} project={project} />
      {project && <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <p className="font-medium">{wf?.orderNo ? '本项目套餐已绑定，后续章节无需再次支付' : '大纲免费；正文按项目一次付费，生成前显示价格'}</p>
        <p className="mt-1 text-slate-500">包含全文逐章生成、每章最多 3 次成功重写及 Word 导出。技术失败保留原稿，不扣成功重写次数。人工专家服务另行报价。</p>
        {wf?.state !== 'researching' && <button disabled={generating || researchBusy || outlineBusy} className="mt-2 text-accent underline" onClick={async () => {
          if (!await confirm({ title: '重新核验文献', message: '正文会保留，但需要重新确认各章和全文检查。是否继续？' })) return;
          try { await api.reopenResearch(projectId); await loadAll(projectId); } catch (err) { toast.error(err.message); }
        }}>重新核验文献</button>}
      </div>}

      {/* 内容区 */}
      {!wf && projectId && (
        <div className="mt-6 card p-8 text-center text-sm text-slate-400">尚未初始化工作流，请先在「创作目的与信息」步骤开始。</div>
      )}

      {/* setup：开始完整论文流程 */}
      {wf?.state === 'setup' && (
        <div className="mt-6 card p-6">
          <h3 className="font-semibold text-ink">开始完整论文流程</h3>
          <p className="mt-1 text-sm text-slate-500">以下信息将作为全文生成的上下文：<span className="font-medium">{project?.title || '（未命名）'}</span> · {project?.field || '未设置学科'} · {project?.degree || '未设置学历'}</p>
          <div className="mt-4 flex gap-3">
            <button onClick={startWorkflow} className="btn-primary"><Pen className="h-4 w-4" /> 开始完整论文流程</button>
            <button onClick={() => navigate(`/app/projects?projectId=${projectId}&tab=overview`)} className="btn-ghost">编辑信息</button>
          </div>
        </div>
      )}

      {/* researching：真实文献检索 */}
      {wf?.state === 'researching' && (
        <div className="mt-6 space-y-4">
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-ink">真实文献检索与确认</h3>
                <p className="mt-1 text-sm text-slate-500">请确认至少 <span className="font-semibold text-accent">3 篇可溯源</span> 文献（需含来源链接 / DOI / 数据库）。不得补造参考文献。</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${verifiedCount >= 3 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                可溯源 {verifiedCount} / 3
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={importRefs} className="btn-ghost text-xs"><Book className="h-3.5 w-3.5" /> 从文献库导入</button>
            </div>
            <form className="mt-4 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); searchLiterature(); }}>
              <input aria-label="文献检索关键词" className="input min-w-0 flex-1" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="论文题目或中英文关键词" />
              <button disabled={researchBusy} className="btn-primary">{researchBusy ? '处理中…' : '检索真实论文'}</button>
            </form>
            {searchNotice && <p role="status" className="mt-3 text-sm text-slate-600">{searchNotice}</p>}
            <ul className="mt-3 divide-y divide-slate-100">
              {searchResults.map((r, i) => <li key={r.doi || r.source_url || i} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0"><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-slate-500">{r.year} · {r.source_db}</p>
                  {/^https?:\/\//i.test(r.source_url || '') && <a className="text-xs text-accent underline" href={r.source_url} target="_blank" rel="noopener noreferrer">查看来源</a>}
                </div>
                <button className="btn-ghost shrink-0 text-xs" disabled={references.some(x => x.title === r.title)} onClick={() => selectReference(r)}>{references.some(x => x.title === r.title) ? '已选择' : '加入论文'}</button>
              </li>)}
            </ul>
          </div>

          {/* 添加文献表单 */}
          <div className="card p-5">
            <h4 className="text-sm font-medium text-ink">添加文献</h4>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <input value={refForm.title} onChange={(e) => setRefForm({ ...refForm, title: e.target.value })} placeholder="标题 *" className="input text-sm" />
              <input value={refForm.authors} onChange={(e) => setRefForm({ ...refForm, authors: e.target.value })} placeholder="作者" className="input text-sm" />
              <input value={refForm.year} onChange={(e) => setRefForm({ ...refForm, year: e.target.value })} placeholder="年份" className="input text-sm" />
              <input value={refForm.source_db} onChange={(e) => setRefForm({ ...refForm, source_db: e.target.value })} placeholder="来源库(CNKI/Web of Science…)" className="input text-sm" />
              <input value={refForm.source_url} onChange={(e) => setRefForm({ ...refForm, source_url: e.target.value })} placeholder="来源链接" className="input text-sm" />
              <input value={refForm.doi} onChange={(e) => setRefForm({ ...refForm, doi: e.target.value })} placeholder="DOI" className="input text-sm" />
            </div>
            <button onClick={addRef} className="btn-secondary mt-3 text-xs"><Plus className="h-3.5 w-3.5" /> 添加</button>
          </div>

          {/* 文献列表 */}
          <div className="card p-5">
            <h4 className="mb-3 text-sm font-medium text-ink">已添加文献 ({references.length})</h4>
            {references.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">尚无文献，使用上方工具检索或从文献库导入</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {references.map((r, i) => (
                  <li key={i} className="flex items-start gap-3 py-2.5">
                    {isVerifiedRef(r) ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{r.title || '未命名文献'}</div>
                      <div className="text-xs text-slate-400">{r.authors || ''} {r.year ? `· ${r.year}` : ''} {r.source_db ? `· ${r.source_db}` : ''} {r.doi ? `· DOI:${r.doi}` : ''}</div>
                    </div>
                    <button aria-label={`移除文献 ${r.title}`} onClick={() => removeRef(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={confirmLiterature} disabled={references.length < 3 || researchBusy} className="btn-primary text-sm">
                <Check className="h-4 w-4" /> {researchBusy ? '核验中…' : '核验并确认文献'}{references.length < 3 ? '（需≥3篇）' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* outline_review：大纲生成与确认 */}
      {wf?.state === 'outline_review' && (
        <div className="mt-6 space-y-4">
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500">大纲必须是<span className="font-medium text-ink">论文正文章节结构</span>（如：绪论 / 文献综述 / 研究设计 / 现状与问题 / 对策 / 结论），系统会拒绝开题报告式结构。</p>
              <div className="flex gap-2">
                <button onClick={loadExistingOutline} className="btn-ghost text-xs"><Refresh className="h-3.5 w-3.5" /> 载入现有大纲</button>
                <button onClick={generateOutline} disabled={outlineBusy} className="btn-secondary text-xs">{outlineBusy ? '大纲生成中…' : 'AI 生成大纲'}</button>
              </div>
            </div>
            {outlineFromText ? (
              <textarea value={outlineText} onChange={(e) => setOutlineText(e.target.value)} rows={8} placeholder={'每行一章，如：\n第一章 绪论\n第二章 文献综述\n...'} className="input mt-3 font-mono text-sm" />
            ) : (
              <div className="mt-3 space-y-3">
                {outline.map((ch, ci) => (
                  <div key={ci} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center gap-2">
                      <input value={ch.chapter || ch.title || ''} onChange={(e) => updateChapterTitle(ci, e.target.value)} className="input flex-1 font-medium" placeholder="章节标题" />
                      <button aria-label={`移除第 ${ci + 1} 章`} onClick={() => removeChapter(ci)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash className="h-4 w-4" /></button>
                    </div>
                    {(ch.sections || []).map((sec, si) => (
                      <div key={si} className="mt-2 flex items-center gap-2 pl-4">
                        <span className="text-slate-300">└</span>
                        <input value={sec.title || ''} onChange={(e) => updateSection(ci, si, e.target.value)} className="input flex-1 text-sm" placeholder="小节标题" />
                        <button aria-label={`移除第 ${ci + 1} 章第 ${si + 1} 小节`} onClick={() => removeSection(ci, si)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    <button onClick={() => addSection(ci)} className="mt-2 ml-4 text-xs text-accent hover:underline">+ 添加小节</button>
                  </div>
                ))}
                <button onClick={addChapter} className="btn-ghost text-xs"><Plus className="h-3.5 w-3.5" /> 添加章节</button>
              </div>
            )}
            <div className="mt-3 flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={outlineFromText} onChange={(e) => setOutlineFromText(e.target.checked)} /> 使用文本粘贴模式
              </label>
            </div>
            {outlineErrors && (
              <div className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-600">
                <p className="font-medium">大纲未通过结构校验：</p>
                {outlineErrors.proposalChapters?.length > 0 && <p>· 检测到开题报告式章节：{outlineErrors.proposalChapters.join('、')}</p>}
                {outlineErrors.forbiddenChapters?.length > 0 && <p>· 不可作为章节：{outlineErrors.forbiddenChapters.join('、')}</p>}
                {outlineErrors.duplicateRefs && <p>· 存在重复的「参考文献」章节</p>}
                {outlineErrors.thesisCount != null && <p>· 论文正文章节数：{outlineErrors.thesisCount}（建议≥3）</p>}
                {outlineErrors.errors?.length > 0 && outlineErrors.errors.map((e, i) => <p key={i}>· {e}</p>)}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button disabled={outlineBusy} onClick={() => saveOutline(false)} className="btn-secondary text-sm"><Save className="h-4 w-4" /> 保存并校验</button>
              <button disabled={outlineBusy} onClick={() => saveOutline(true)} className="btn-primary text-sm"><Check className="h-4 w-4" /> 确认大纲并进入正文</button>
            </div>
            {outlineSavedAt && !outlineErrors && <p className="mt-2 text-right text-xs text-green-600">大纲已通过结构校验</p>}
          </div>
        </div>
      )}

      {/* chapter_generating：逐章生成 */}
      {wf?.state === 'chapter_generating' && (
        <div className="mt-6 space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold text-ink">逐章生成正文</h3>
            <p className="mt-1 text-sm text-slate-500">系统将按大纲<span className="font-medium">一次只生成一章</span>，确认后再继续下一章，保证内容与大纲一致、前后衔接。</p>
            <div className="mt-4 flex items-center justify-between rounded-lg bg-accent-50/60 p-4">
              <div>
                <div className="text-xs text-slate-500">当前章节（第 {currentIdx + 1} / {project?.outline?.length || 0} 章）</div>
                <div className="mt-0.5 font-semibold text-ink">{curChapter?.chapter || project?.outline?.[currentIdx]?.chapter || '—'}</div>
              </div>
              <button onClick={generateChapter} disabled={generating} className="btn-primary text-sm">
                <Pen className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} /> {generating ? '生成中…' : '生成本章'}
              </button>
            </div>
            <div className="mt-3 flex justify-end">
              <button disabled={generating} onClick={() => backToChapter(0)} className="btn-ghost text-xs"><ChevronLeft className="h-3.5 w-3.5" /> 返回第一章</button>
            </div>
          </div>
          {/* 已生成章节预览 */}
          {chapters.filter((c) => c.status === 'done').length > 0 && (
            <div className="card p-5">
              <h4 className="mb-2 text-sm font-medium text-ink">已生成章节</h4>
              <div className="space-y-2">
                {chapters.map((c, i) => (
                  <div key={c.id || i} className="rounded-lg border border-slate-100 p-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${c.status === 'done' ? 'bg-green-50 text-green-600' : c.status === 'processing' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>{c.status === 'done' ? '已完成' : c.status === 'processing' ? '生成中' : '待生成'}</span>
                      <span className="text-sm font-medium text-ink">{c.chapter}</span>
                      <span className="text-xs text-slate-400">{(c.content || '').length} 字</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* chapter_review：单章确认 */}
      {wf?.state === 'chapter_review' && (
        <div className="mt-6 space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">单章确认 · {curChapter?.chapter}</h3>
              <span className="text-xs text-slate-400">第 {currentIdx + 1} / {chapters.length} 章</span>
            </div>
            {curChapter?.orchestration?.usedRealAI === false && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">当前为本地模板演示，未调用真实大模型。内容仅用于测试流程，不代表论文质量或真实研究结论。</p>}
            <textarea
              value={currentChapterContent}
              disabled={generating || actionBusy}
              aria-label="当前章节正文"
              onChange={(e) => setCurrentChapterContent(e.target.value)}
              className="input mt-3 min-h-[260px] resize-y font-mono text-sm"
              placeholder="本章内容…"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button disabled={generating || actionBusy} onClick={saveCurrentChapter} className="btn-ghost text-xs"><Save className="h-3.5 w-3.5" /> 保存编辑</button>
                <button disabled={generating || actionBusy || (curChapter?.regenerate_count || 0) >= 3} onClick={regenerateCurrent} className="btn-ghost text-xs"><Refresh className="h-3.5 w-3.5" /> {generating ? '重写中…' : `重写本章（剩余 ${Math.max(0, 3 - (curChapter?.regenerate_count || 0))} 次）`}</button>
                {currentIdx > 0 && <button disabled={generating || actionBusy} onClick={() => backToChapter(currentIdx - 1)} className="btn-ghost text-xs"><ChevronLeft className="h-3.5 w-3.5" /> 上一章</button>}
              </div>
              <button disabled={generating || actionBusy || !currentChapterContent.trim()} onClick={confirmChapter} className="btn-primary text-sm"><Check className="h-4 w-4" /> {actionBusy ? '处理中…' : '保存并确认本章，继续下一步'}</button>
            </div>
          </div>
        </div>
      )}

      {/* final_review：全文检查 + 输出 */}
      {wf?.state === 'final_review' && (
        <div className="mt-6 space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">全文一致性检查</h3>
              <button onClick={runCheck} className="btn-secondary text-sm"><Shield className="h-4 w-4" /> 运行检查</button>
            </div>
            {!finalCheck && <p className="mt-3 text-sm text-slate-400">点击「运行检查」校验章节完整性、逐章确认、大纲一致性、重复段落、引文范围与遗留占位符。规则检查不替代人工学术审核。</p>}
            {finalCheck && (
              <div className="mt-3 space-y-2">
                {finalCheck.checks.map((c) => (
                  <div key={c.key} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${c.status === 'pass' ? 'border-green-100 bg-green-50/40' : c.status === 'warn' ? 'border-amber-100 bg-amber-50/40' : 'border-red-100 bg-red-50/40'}`}>
                    {c.status === 'pass' ? <Check className="mt-0.5 h-4 w-4 text-green-500" /> : c.status === 'warn' ? <AlertCircle className="mt-0.5 h-4 w-4 text-amber-500" /> : <AlertCircle className="mt-0.5 h-4 w-4 text-red-500" />}
                    <div>
                      <div className="font-medium text-ink">{c.detail}</div>
                    </div>
                  </div>
                ))}
                <div className={`mt-1 text-sm font-medium ${finalCheck.passed ? 'text-green-600' : 'text-red-600'}`}>
                  {finalCheck.passed ? '✓ 全部检查通过，可生成最终文档' : '✗ 存在失败项，建议先修复'}
                </div>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button disabled={actionBusy} onClick={() => backToChapter(0)} className="btn-secondary text-sm">返回章节修订</button>
              <button onClick={exportFinal} disabled={!finalCheck?.passed || generating || actionBusy} className="btn-primary text-sm"><FileWord className="h-4 w-4" /> {actionBusy ? '导出中…' : '生成最终文档（Word）'}</button>
            </div>
            {finalDoc && <p className="mt-2 text-right text-xs text-green-600">已生成最终文档</p>}
          </div>
        </div>
      )}

      {/* completed：完成 */}
      {wf?.state === 'completed' && (
        <div className="mt-6 card p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50"><Check className="h-7 w-7 text-green-500" /></div>
          <h3 className="mt-3 text-lg font-semibold text-ink">论文已生成完成</h3>
          <p className="mt-1 text-sm text-slate-500">最终文档已导出，可在「工作区详情 → 成果文件」中再次下载。</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button disabled={actionBusy} onClick={exportFinal} className="btn-secondary text-sm"><FileWord className="h-4 w-4" /> {actionBusy ? '下载中…' : '重新下载 Word'}</button>
            <button disabled={actionBusy} onClick={() => backToChapter(0)} className="btn-secondary text-sm">返回章节修订</button>
            <button onClick={() => navigate(`/app/courses?projectId=${projectId}`)} className="btn-primary text-sm"><ExternalLink className="h-4 w-4" /> 进入专家咨询</button>
          </div>
        </div>
      )}

      {/* 支付弹窗 */}
      {needPay && (
        <FeaturePay
          needOrder={needPay}
          onPaid={(orderNo) => { setNeedPay(null); doGenerateChapter(orderNo); }}
          onClose={() => setNeedPay(null)}
        />
      )}

      {/* 右下角专家服务悬浮入口 */}
      {projectId && wf?.state === 'completed' && (
        <button
          onClick={() => navigate(`/app/courses?projectId=${projectId}`)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium text-white shadow-card hover:opacity-90"
          title="联系人工专家，携带当前论文资料"
        >
          <Brain className="h-4 w-4" /> 对 AI 文章不满意？咨询专家
        </button>
      )}

      {integrity.show && (
        <AcademicIntegrityModal onAgreed={integrity.handleAgreed} onCancel={integrity.close} />
      )}
    </div>
  );
}
// ========== 步骤导航 ==========
function StepNav({ stepIdx, state, project }) {
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('[aria-current="step"]');
    if (active) nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
  }, [state]);
  const steps = WF_STEPS.filter(s => s.key !== 'chapter_review');
  const activeIdx = steps.findIndex(s => s.key === (state === 'chapter_review' ? 'chapter_generating' : state));
  stepIdx = Math.max(0, activeIdx);
  return (
    <div className="mt-6">
      <div ref={navRef} className="relative flex items-center gap-1 overflow-x-auto pb-1">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div aria-current={i === stepIdx ? 'step' : undefined} className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium ${i === stepIdx ? 'bg-accent text-white' : i < stepIdx ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i === stepIdx ? 'bg-white/20' : i < stepIdx ? 'bg-green-500 text-white' : 'bg-slate-200'}`}>{i < stepIdx ? <Check className="h-3 w-3" /> : i + 1}</span>
              {s.key === 'chapter_generating' ? (project?.outline?.length ? `正文（第 ${(project?.current_chapter_index || 0) + 1}/${project.outline.length} 章）` : '逐章生成与确认') : s.label}
            </div>
            {i < steps.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
          </div>
        ))}
      </div>
    </div>
  );
}
