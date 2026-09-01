import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Layers } from './Icons.jsx';

// 格式模板选择器：自加载模板列表，供所有文档生成器共用。
// value / onChange 由外层 DocumentGenerator 统一管控（键为 template_id）。
export default function TemplatePicker({ value, onChange }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    api.listTemplates().then((d) => setTemplates(d.templates || [])).catch(() => {});
  }, []);

  return (
    <div>
      <label className="label">
        <span className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-slate-400" />格式模板（可选）
        </span>
      </label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">使用默认学术格式</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}{t.is_global ? '（全局）' : t.is_mine ? '（我的）' : ''}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-slate-400">
        上传 .docx 模板可按你的格式生成，{' '}
        <button onClick={() => navigate('/app/templates')} className="text-accent hover:underline">去上传</button>
      </p>
    </div>
  );
}
