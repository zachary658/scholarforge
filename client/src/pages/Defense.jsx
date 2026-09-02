import { api } from '../lib/api.js';
import { FIELDS } from '../lib/constants.js';
import DocumentGenerator from '../components/DocumentGenerator.jsx';

const DURATIONS = [
  { value: '10', label: '10 分钟' },
  { value: '15', label: '15 分钟' },
  { value: '20', label: '20 分钟' },
];

export default function Defense() {
  return (
    <DocumentGenerator
      config={{
        title: '答辩PPT与演讲稿',
        subtitle: '生成答辩PPT大纲与配套演讲稿，10-15分钟答辩全覆盖',
        submitLabel: '生成答辩材料',
        apiCall: (payload) => api.defense(payload),
        validate: (form) => (!form.topic.trim() ? '请填写论文题目' : null),
        fields: [
          { key: 'topic', label: '论文题目', type: 'textarea', required: true, placeholder: '例如：基于深度学习的医学影像分割方法研究' },
          { key: 'field', label: '学科领域', type: 'select', required: true, defaultValue: '计算机科学', options: FIELDS },
          { key: 'research_content', label: '研究内容摘要', type: 'textarea', placeholder: '简要描述研究的主要内容与结论' },
        ],
        advancedLabel: '更多选项（可选）',
        advancedFields: [
          { key: 'innovation', label: '创新点', type: 'text', placeholder: '研究的创新之处' },
        ],
        suffixFields: [
          { key: 'duration', label: '答辩时长', type: 'select', defaultValue: '10', options: DURATIONS },
        ],
        resultLabel: (form) => (form.topic ? `${form.topic} · 答辩材料` : '生成结果'),
        downloadName: (form) => `${form.topic || '论文'}答辩材料`,
        emptyTitle: '填写论文信息后生成答辩材料',
        emptyDesc: '答辩PPT大纲与演讲稿，一键导出 Word',
        docEmptyTitle: '答辩材料已生成 Word 文档',
        docEmptyDesc: '点击右上角「下载 Word」获取完整答辩材料',
      }}
    />
  );
}
