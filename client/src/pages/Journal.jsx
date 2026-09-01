import { api } from '../lib/api.js';
import { FIELDS } from '../lib/constants.js';
import DocumentGenerator from '../components/DocumentGenerator.jsx';

const JOURNAL_TYPES = ['核心期刊', 'SCI', 'EI', '普通期刊'];

export default function Journal() {
  return (
    <DocumentGenerator
      config={{
        title: '期刊论文撰写',
        subtitle: '撰写符合期刊发表规范的完整学术论文，含中英文摘要',
        submitLabel: '撰写期刊论文',
        apiCall: (payload) => api.journal(payload),
        validate: (form) => (!form.topic.trim() ? '请填写论文题目' : null),
        fields: [
          { key: 'topic', label: '论文题目', type: 'textarea', required: true, placeholder: '例如：基于深度学习的医学影像分割方法研究' },
          { key: 'field', label: '学科领域', type: 'select', required: true, defaultValue: '计算机科学', options: FIELDS },
          { key: 'content', label: '研究内容', type: 'textarea', placeholder: '描述研究的核心内容、数据与主要发现' },
        ],
        advancedLabel: '更多选项（可选）',
        advancedFields: [
          { key: 'method', label: '研究方法', type: 'text', placeholder: '例如：实证分析、案例研究' },
          { key: 'journalType', label: '目标期刊类型', type: 'select', defaultValue: '核心期刊', options: JOURNAL_TYPES },
        ],
        resultLabel: (form) => (form.topic ? `${form.topic} · 期刊论文` : '生成结果'),
        downloadName: (form) => form.topic || '期刊论文',
        emptyTitle: '填写论文信息后撰写期刊论文',
        emptyDesc: '符合期刊规范的完整论文，一键导出 Word',
        docEmptyTitle: '期刊论文已生成 Word 文档',
        docEmptyDesc: '点击右上角「下载 Word」获取完整论文',
      }}
    />
  );
}
