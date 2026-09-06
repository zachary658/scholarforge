// 工作区详情数据 hook：集中管理 ProjectDetail 各 tab 的数据加载、生成轮询与状态操作。
// 拆分自 pages/Projects.jsx（原巨型组件内联逻辑），行为保持一致。
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useToast } from '../components/Toast.jsx';
import { useAcademicIntegrity } from './useAcademicIntegrity.js';
import { PAPER_STAGES } from './constants.js';

export function useProjectDetail({ project, onEdit, initialTab = 'pipeline' }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState(initialTab); // 支持从上一流程自动进入下一步
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [references, setReferences] = useState([]);
  const [charts, setCharts] = useState([]);
  const [evidenceQuality, setEvidenceQuality] = useState(null);
  const [evidenceResults, setEvidenceResults] = useState([]);
  const [evidenceQuery, setEvidenceQuery] = useState(project.title || '');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [outline, setOutline] = useState(project.outline || []);
  const [savingOutline, setSavingOutline] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState(project.outline_confirmed_at || null);
  const [chapters, setChapters] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [needPay, setNeedPay] = useState(null);
  const [merging, setMerging] = useState(false);
  // 合并导出用的格式模板（可选：高校/自定义模板，与写作类导出一致）
  const [templates, setTemplates] = useState([]);
  const [mergeTemplateId, setMergeTemplateId] = useState('');
  useEffect(() => {
    api.listTemplates().then((d) => setTemplates(d.templates || [])).catch(() => {});
  }, []);
  const integrity = useAcademicIntegrity();
  // 轮询定时器：用 ref 管理，防重复创建 interval；组件卸载时清理（此前存在内存泄漏）
  const pollRef = useRef(null);
  const pollInFlightRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // P1-4 论文主流程步骤导航：把每个阶段映射到具体工具入口（点击自动带上 projectId）
  const STAGE_NAV = {
    materials: { to: '/app/writing' },
    outline: { to: '/app/writing', type: 'outline' },
    literature: { to: '/app/literature-review' },
    writing: { to: '/app/writing', type: 'paragraph' },
    review: { to: '/app/rewrite' },
    defense: { to: '/app/defense' },
  };

  // 展示时以“人工阶段”和“实际产物推导阶段”中更靠后的为准，
  // 避免出现进度 25% 但仍显示“当前阶段：创建论文”的矛盾状态。
  const storedStageIdx = PAPER_STAGES.findIndex((s) => s.key === (project.current_stage || 'create'));
  const systemStageIdx = PAPER_STAGES.findIndex((s) => s.key === (project.system_stage || 'create'));
  const currentStageIdx = Math.max(0, storedStageIdx, systemStageIdx);

  const successfulTask = (predicate) => tasks.some((task) => task.status === 'success' && predicate(task));
  const hasFulltext = successfulTask((task) => task.tool_type === 'writing' && task.action === 'fulltext');

  // 每一步只按成功产物判定完成；大纲必须由用户确认后才能进入下一阶段。
  const stageStatus = (stage, i) => {
    const dataDone = {
      create: Boolean(project.title && project.field && project.degree && project.deadline),
      materials: materials.length > 0,
      outline: Boolean(confirmedAt),
      literature: successfulTask((task) => task.tool_type === 'literature_review'),
      writing: chapters.length > 0 || hasFulltext,
      review: successfulTask((task) => ['polish', 'rewrite', 'ai_reduce', 'grammar'].includes(task.tool_type)),
      defense: successfulTask((task) => task.tool_type === 'defense'),
      export: (chapters.length > 0 || hasFulltext) && Boolean(confirmedAt),
    }[stage.key];
    if (dataDone) return 'done';
    if (i === currentStageIdx) return 'current';
    return 'pending';
  };

  const goStage = (stage) => {
    if (stage.key === 'create') { onEdit(); return; }
    if (stage.key === 'outline' && outline.length > 0 && !confirmedAt) { setTab('outline'); return; }
    if (stage.key === 'export') { setTab('chapters'); return; }
    const nav = STAGE_NAV[stage.key];
    if (!nav) return;
    const params = new URLSearchParams();
    params.set('projectId', project.id);
    if (nav.type) params.set('type', nav.type);
    navigate(`${nav.to}?${params.toString()}`);
  };

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const d = await api.listProjectTasks(project.id, { page: 1, size: 50 });
      setTasks(d.tasks || []);
    } catch (err) {
      toast.error('加载任务失败：' + err.message);
    } finally {
      setLoadingTasks(false);
    }
  }, [project.id]);

  // 我的资料（本工作区上传的参考材料）
  const loadMaterials = useCallback(async () => {
    try {
      const d = await api.listMaterials({ projectId: project.id });
      setMaterials(d.materials || []);
    } catch (err) {
      toast.error('加载资料失败：' + err.message);
    }
  }, [project.id]);

  const loadChapters = useCallback(async () => {
    try {
      const d = await api.getChapters(project.id);
      setChapters(d.chapters || []);
      setGenerating(!!d.generating);
      if (d.outline_confirmed_at) setConfirmedAt(d.outline_confirmed_at);
    } catch (err) {
      toast.error('加载章节失败：' + err.message);
    }
  }, [project.id]);

  const loadArtifacts = useCallback(async () => {
    try {
      const d = await api.listDocs({ projectId: project.id });
      setArtifacts(d.docs || []);
    } catch (err) {
      toast.error('加载成果文件失败：' + err.message);
    }
  }, [project.id]);

  const loadEvidence = useCallback(async () => {
    try {
      const [refData, chartData, evidenceData] = await Promise.all([
        api.listRefs({ projectId: project.id }),
        api.listCharts({ projectId: project.id }),
        api.getProjectEvidence(project.id, { q: project.title, limit: 8 }),
      ]);
      setReferences(refData.references || []);
      setCharts(chartData.charts || []);
      setEvidenceQuality(evidenceData.quality || null);
      setEvidenceResults(evidenceData.results || []);
    } catch (err) {
      toast.error('加载项目证据失败：' + err.message);
    }
  }, [project.id, project.title]);

  const searchEvidence = async () => {
    setEvidenceBusy(true);
    try {
      const data = await api.getProjectEvidence(project.id, { q: evidenceQuery || project.title, limit: 12 });
      setEvidenceQuality(data.quality || null);
      setEvidenceResults(data.results || []);
    } catch (err) {
      toast.error('检索证据失败：' + err.message);
    } finally {
      setEvidenceBusy(false);
    }
  };

  const rebuildEvidence = async () => {
    setEvidenceBusy(true);
    try {
      const data = await api.rebuildProjectEvidence(project.id);
      setEvidenceQuality(data.quality || null);
      await loadEvidence();
      toast.success('证据索引已重建');
    } catch (err) {
      toast.error('重建证据索引失败：' + err.message);
    } finally {
      setEvidenceBusy(false);
    }
  };

  // 刷新工作区大纲：大纲生成/深度调研后自动写入结构化大纲，进入此 tab 时拉取最新
  const loadProject = useCallback(async () => {
    try {
      const d = await api.getProject(project.id);
      setOutline(d.project?.outline || []);
      if (d.project?.outline_confirmed_at) setConfirmedAt(d.project.outline_confirmed_at);
    } catch (err) {
      toast.error('加载大纲失败：' + err.message);
    }
  }, [project.id]);

  useEffect(() => {
    if (tab === 'tasks') loadTasks();
    if (tab === 'materials') loadMaterials();
    if (tab === 'chapters') loadChapters();
    if (tab === 'artifacts') loadArtifacts();
    if (tab === 'evidence') loadEvidence();
    if (tab === 'outline') loadProject();
    if (tab === 'pipeline') { loadTasks(); loadMaterials(); loadChapters(); loadArtifacts(); loadEvidence(); }
  }, [tab, loadTasks, loadMaterials, loadChapters, loadArtifacts, loadEvidence, loadProject]);

  const handleSaveOutline = async () => {
    setSavingOutline(true);
    try {
      await api.updateProject(project.id, { outline });
      toast.success('大纲已保存');
    } catch (err) {
      toast.error('保存失败：' + err.message);
    } finally {
      setSavingOutline(false);
    }
  };

  const handleConfirmOutline = async () => {
    try {
      await api.confirmOutline(project.id);
      setConfirmedAt(Math.floor(Date.now() / 1000));
      setTab('chapters');
      toast.success('大纲已确认，正在进入正文生成');
      if (!integrity.ensure(() => doGenerate())) return;
      await doGenerate();
    } catch (err) {
      toast.error('确认失败：' + err.message);
    }
  };

  const doGenerate = async (orderNo) => {
    setGenerating(true);
    try {
      await api.generateChapters(project.id, orderNo ? { orderNo } : {});
      await loadChapters();
      // 防重入：已有轮询则复用，避免多次点击产生多个并行 interval
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        if (pollInFlightRef.current) return;
        pollInFlightRef.current = true;
        try {
          const d = await api.getChapters(project.id);
          setChapters(d.chapters || []);
          setGenerating(!!d.generating);
          if (!d.generating) { stopPolling(); toast.success('章节生成完成'); }
        } catch { stopPolling(); }
        finally { pollInFlightRef.current = false; }
      }, 3000);
    } catch (err) {
      // 402 契约：后端返回 { error, needOrder, itemType, amount }，api.js 将其放入 err.data
      const nd = err?.data?.needOrder;
      if (nd) {
        setNeedPay({ itemType: err.data.itemType || 'writing_fulltext', amount: Number(err.data.amount || 0) });
      } else {
        toast.error(err.message);
      }
      setGenerating(false);
    }
  };

  const doRegenerate = async (chapterId) => {
    try {
      await api.regenerateChapter(project.id, chapterId, {});
      await loadChapters();
      toast.success('已提交重新生成');
    } catch (err) {
      const nd = err?.data?.needOrder;
      if (nd) setNeedPay({ itemType: err.data.itemType || 'writing_fulltext', amount: Number(err.data.amount || 0) });
      else toast.error(err.message);
    }
  };

  const saveChapter = async (chapterId, content) => {
    try {
      await api.editChapter(project.id, chapterId, content);
      toast.success('章节已保存');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doMerge = async () => {
    setMerging(true);
    try {
      const data = await api.mergeChapters(project.id, { template_id: mergeTemplateId || undefined });
      if (data.doc?.id) {
        const { downloadDocFile } = await import('./api.js');
        // await 使下载异常能被下方外层 catch 捕获并 toast 提示
        await downloadDocFile(data.doc.id, project.title);
      }
      toast.success('已生成 Word');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMerging(false);
    }
  };

  const addChapter = () => {
    setOutline([...outline, { chapter: `第${outline.length + 1}章 新章节`, sections: [] }]);
  };
  const updateChapter = (i, val) => {
    const next = [...outline];
    next[i] = { ...next[i], chapter: val };
    setOutline(next);
  };
  const addSection = (ci) => {
    const next = [...outline];
    next[ci] = { ...next[ci], sections: [...(next[ci].sections || []), { title: '新小节', content: '' }] };
    setOutline(next);
  };
  const updateSection = (ci, si, field, val) => {
    const next = [...outline];
    next[ci].sections[si] = { ...next[ci].sections[si], [field]: val };
    setOutline(next);
  };
  const removeChapter = (i) => {
    setOutline(outline.filter((_, idx) => idx !== i));
  };
  const removeSection = (ci, si) => {
    const next = [...outline];
    next[ci].sections = next[ci].sections.filter((_, idx) => idx !== si);
    setOutline(next);
  };

  return {
    // 导航与 tab
    navigate, tab, setTab,
    // 数据
    tasks, loadingTasks, materials, artifacts, references, charts,
    evidenceQuality, evidenceResults, evidenceQuery, setEvidenceQuery, evidenceBusy, searchEvidence, rebuildEvidence,
    outline, confirmedAt, savingOutline, handleSaveOutline, handleConfirmOutline,
    chapters, setChapters, generating, needPay, setNeedPay, doGenerate, doRegenerate, saveChapter,
    merging, doMerge, templates, mergeTemplateId, setMergeTemplateId,
    integrity,
    // 流程状态
    currentStageIdx, stageStatus, goStage,
    // 手动刷新
    loadChapters, loadArtifacts,
    // 大纲编辑
    addChapter, updateChapter, addSection, updateSection, removeChapter, removeSection,
  };
}
