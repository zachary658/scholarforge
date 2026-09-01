import { api } from '../lib/api.js';
import { FIELDS } from '../lib/constants.js';
import DocumentGenerator from '../components/DocumentGenerator.jsx';

export default function Proposal() {
  return (
    <DocumentGenerator
      config={{
        title: '开题报告撰写',
        subtitle: '填写研究要素，生成结构完整的开题报告并导出 Word',
        submitLabel: '生成开题报告',
        apiCall: (payload) => api.proposal(payload),
        validate: (form) => (!form.topic.trim() ? '请填写论文题目' : null),
        fields: [
          { key: 'topic', label: '论文题目', type: 'textarea', required: true, placeholder: '例如：基于深度学习的医学影像分割方法研究' },
          { key: 'field', label: '学科领域', type: 'select', required: true, defaultValue: '计算机科学', options: FIELDS },
          { key: 'direction', label: '研究方向', type: 'text', placeholder: '例如：计算机视觉 / 自然语言处理' },
          { key: 'keywords', label: '关键词', type: 'text', placeholder: '多个关键词用逗号分隔' },
        ],
        advancedLabel: '更多研究要素（可选）',
        advancedFields: [
          { key: 'objective', label: '研究目标', type: 'textarea', textareaClass: 'min-h-[56px]', placeholder: '描述研究想要达成的目标' },
          { key: 'method', label: '研究方法', type: 'text', placeholder: '例如：问卷调查、实验法、案例研究' },
          { key: 'innovation', label: '创新点', type: 'text', placeholder: '研究的创新之处' },
        ],
        resultLabel: (form) => (form.topic ? `${form.topic} · 开题报告` : '生成结果'),
        downloadName: (form) => `${form.topic || '研究'}开题报告`,
        emptyTitle: '填写研究要素后生成开题报告',
        emptyDesc: '报告含 10 个标准章节，一键导出 Word',
        docEmptyTitle: '开题报告已生成 Word 文档',
        docEmptyDesc: '点击右上角「下载 Word」获取完整报告',
      }}
    />
  );
}
