import { api } from '../lib/api.js';
import { FIELDS } from '../lib/constants.js';
import DocumentGenerator from '../components/DocumentGenerator.jsx';

const JOURNAL_TYPES = ['核心期刊', 'SCI', 'EI', '普通期刊'];

export default function Journal() {
  return (
    <DocumentGenerator
      config={{
        title: '期刊投稿辅助',
        subtitle: '基于你的研究材料生成投稿初稿与结构建议，含中英文摘要',
        submitLabel: '生成投稿初稿',
        apiCall: (payload) => api.journal(payload),
        validate: (form) => (!form.topic.trim() ? '请填写论文题目' : !form.field ? '请选择学科领域' : null),
        fields: [
          { key: 'topic', label: '论文题目', type: 'textarea', required: true, placeholder: '例如：基于深度学习的医学影像分割方法研究' },
          { key: 'field', label: '学科领域', type: 'select', required: true, defaultValue: '', placeholder: '请选择学科领域', options: FIELDS },
          { key: 'research_content', label: '研究内容', type: 'textarea', placeholder: '描述研究的核心内容、数据与主要发现' },
        ],
        advancedLabel: '更多选项（可选）',
        advancedFields: [
          { key: 'method', label: '研究方法', type: 'text', placeholder: '例如：实证分析、案例研究' },
          { key: 'journal_type', label: '目标期刊类型', type: 'select', defaultValue: '核心期刊', options: JOURNAL_TYPES },
        ],
        resultLabel: (form) => (form.topic ? `${form.topic} · 期刊论文` : '生成结果'),
        downloadName: (form) => form.topic || '期刊论文',
        emptyTitle: '填写研究信息后生成投稿初稿',
        emptyDesc: '生成后请核验事实、引用，并按目标期刊规范人工修改',
        docEmptyTitle: '投稿初稿已生成 Word 文档',
        docEmptyDesc: '点击右上角下载带 AI 辅助标识的 Word 初稿',
      }}
    />
  );
}
