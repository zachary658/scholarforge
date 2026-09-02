import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTool } from '../lib/useTool.js';
import { api, downloadDocFile } from '../lib/api.js';
import FeaturePay from './FeaturePay.jsx';
import GeneratorForm from './GeneratorForm.jsx';
import GenerationProgress from './GenerationProgress.jsx';
import { toast } from './Toast.jsx';
import { Refresh, Sparkle } from './Icons.jsx';

// 文档生成器统一壳层：业务页面只传 config，不再重复表单/结果/计费结构。
// config 结构：
//   title / subtitle / submitLabel
//   apiCall(payload)   — 后端工具调用（payload 已含 template_id / orderNo）
//   validate(form)     — 返回错误文案或空
//   fields / advancedFields / suffixFields / advancedLabel
//   resultLabel(form) / downloadName(form)
//   emptyTitle / emptyDesc / docEmptyTitle / docEmptyDesc
function buildInitialForm(config) {
  const form = {};
  const all = [...(config.fields || []), ...(config.advancedFields || []), ...(config.suffixFields || [])];
  for (const f of all) form[f.key] = f.defaultValue ?? '';
  form.template_id = '';
  return form;
}

export default function DocumentGenerator({ config }) {
  const tool = useTool();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(() => buildInitialForm(config));
  const [linkedProject, setLinkedProject] = useState(null);
  const projectId = searchParams.get('projectId');

  // 从论文工作区进入时自动关联并带入已有信息，避免客户重复填写，
  // 同时确保生成任务、文档和上下文真正归档到该工作区。
  useEffect(() => {
    if (!projectId) {
      setLinkedProject(null);
      return undefined;
    }
    let cancelled = false;
    api.getProject(projectId).then(({ project }) => {
      if (cancelled || !project) return;
      setLinkedProject(project);
      setForm((current) => ({
        ...current,
        ...(Object.hasOwn(current, 'topic') && project.title ? { topic: project.title } : {}),
        ...(Object.hasOwn(current, 'field') && project.field ? { field: project.field } : {}),
        ...(Object.hasOwn(current, 'research_content') && project.description
          ? { research_content: project.description }
          : {}),
      }));
    }).catch((err) => {
      if (!cancelled) tool.setError(`加载论文工作区失败：${err.message}`);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  const result = tool.result;
  const docInfo = result?.doc || null;
  const content = result?.content || '';

  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const run = (orderNo) => {
    const err = config.validate ? config.validate(form) : null;
    if (err) {
      tool.setError(err);
      return;
    }
    tool.run(() => config.apiCall({
      ...form,
      template_id: form.template_id || undefined,
      projectId: projectId || undefined,
      orderNo: orderNo || undefined,
    }));
  };

  const handleDownload = async () => {
    if (!docInfo?.id) return;
    try {
      await downloadDocFile(docInfo.id, config.downloadName ? config.downloadName(form) : '文档');
    } catch (err) {
      toast.error(err.message || '下载失败');
    }
  };

  const title = config.resultLabel ? config.resultLabel(form) : '生成结果';

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">{config.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{config.subtitle}</p>
          {linkedProject && (
            <p className="mt-2 text-xs font-medium text-blue-600">
              已关联论文工作区：{linkedProject.title}
            </p>
          )}
        </div>
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-[380px_1fr]">
        {/* 设置面板 */}
        <div className="card flex flex-col p-6">
          <GeneratorForm
            fields={config.fields || []}
            advancedFields={config.advancedFields || []}
            suffixFields={config.suffixFields || []}
            advancedLabel={config.advancedLabel}
            form={form}
            onChange={update}
          />

          <div className="mt-5 flex-1" />
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            本功能为付费功能，先下单支付后再生成
          </div>
          <button onClick={() => run()} disabled={tool.loading} className="btn-primary w-full py-3">
            {tool.loading ? (
              <><Refresh className="h-4 w-4 animate-spin" /> 生成中…</>
            ) : (
              <><Sparkle className="h-4 w-4" /> {config.submitLabel}</>
            )}
          </button>
          {tool.error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{tool.error}</div>
          )}
        </div>

        {/* 结果面板 */}
        <GenerationProgress
          loading={tool.loading}
          result={result}
          docInfo={docInfo}
          content={content}
          title={title}
          onDownload={handleDownload}
          onRegenerate={() => run()}
          emptyTitle={config.emptyTitle}
          emptyDesc={config.emptyDesc}
          docEmptyTitle={config.docEmptyTitle}
          docEmptyDesc={config.docEmptyDesc}
        />
      </div>

      {tool.needOrder && (
        <FeaturePay needOrder={tool.needOrder} onPaid={(orderNo) => run(orderNo)} onClose={() => tool.cancelOrder()} />
      )}
    </div>
  );
}
