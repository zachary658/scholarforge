import { api } from '../lib/api.js';
import { FIELDS } from '../lib/constants.js';
import DocumentGenerator from '../components/DocumentGenerator.jsx';

export default function LiteratureReview() {
  return (
    <DocumentGenerator
      config={{
        title: '文献综述生成',
        subtitle: '按主题分类梳理，生成结构化文献综述并导出 Word',
        submitLabel: '生成文献综述',
        apiCall: (payload) => api.literatureReview(payload),
        validate: (form) => (!form.topic.trim() ? '请填写研究主题' : !form.field ? '请选择学科领域' : null),
        fields: [
          { key: 'topic', label: '研究主题', type: 'textarea', required: true, placeholder: '例如：深度学习在医学影像分割中的应用' },
          { key: 'field', label: '学科领域', type: 'select', required: true, defaultValue: '', placeholder: '请选择学科领域', options: FIELDS },
          { key: 'keywords', label: '关键词', type: 'text', placeholder: '多个关键词用逗号分隔' },
        ],
        advancedLabel: '更多选项（可选）',
        advancedFields: [
          { key: 'years', label: '文献时间范围', type: 'text', defaultValue: '近5年', placeholder: '例如：近5年 / 2018-2023' },
        ],
        resultLabel: (form) => (form.topic ? `${form.topic} · 文献综述` : '生成结果'),
        downloadName: (form) => `${form.topic || '研究'}文献综述`,
        emptyTitle: '填写研究主题后生成文献综述',
        emptyDesc: '按主题分类梳理文献，一键导出 Word',
        docEmptyTitle: '文献综述已生成 Word 文档',
        docEmptyDesc: '点击右上角「下载 Word」获取完整文献综述',
      }}
    />
  );
}
