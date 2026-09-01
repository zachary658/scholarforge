import { api } from '../lib/api.js';
import { FIELDS } from '../lib/constants.js';
import DocumentGenerator from '../components/DocumentGenerator.jsx';

export default function TaskBook() {
  return (
    <DocumentGenerator
      config={{
        title: '毕业论文任务书',
        subtitle: '生成规范的毕业论文任务书，含进度安排与考核指标',
        submitLabel: '生成任务书',
        apiCall: (payload) => api.taskBook(payload),
        validate: (form) => (!form.topic.trim() ? '请填写论文题目' : null),
        fields: [
          { key: 'topic', label: '论文题目', type: 'textarea', required: true, placeholder: '例如：基于深度学习的医学影像分割方法研究' },
          { key: 'studentName', label: '学生姓名', type: 'text', placeholder: '请输入学生姓名' },
          { key: 'studentId', label: '学号', type: 'text', placeholder: '请输入学号' },
          { key: 'field', label: '学科专业', type: 'select', required: true, defaultValue: '计算机科学', options: FIELDS },
          { key: 'advisor', label: '指导教师', type: 'text', placeholder: '请输入指导教师姓名' },
        ],
        resultLabel: (form) => (form.topic ? `${form.topic} · 任务书` : '生成结果'),
        downloadName: (form) => `${form.topic || '论文'}任务书`,
        emptyTitle: '填写论文信息后生成任务书',
        emptyDesc: '规范任务书含进度安排，一键导出 Word',
        docEmptyTitle: '任务书已生成 Word 文档',
        docEmptyDesc: '点击右上角「下载 Word」获取完整任务书',
      }}
    />
  );
}
