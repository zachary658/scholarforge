import { useState } from 'react';
import TemplatePicker from './TemplatePicker.jsx';
import { ChevronDown } from './Icons.jsx';

// 字段定义（配置驱动，业务页面只传字段数组）：
//   { key, label, type: 'text' | 'textarea' | 'select', required, placeholder,
//     defaultValue, options, textareaClass }
// options 支持字符串数组（value=label）或 { value, label } 对象数组。
function renderField(field, value, onChange) {
  if (field.type === 'textarea') {
    return (
      <textarea
        className={`input resize-none ${field.textareaClass || 'min-h-[60px]'}`}
        placeholder={field.placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <select className="input" value={value ?? ''} onChange={(e) => onChange(field.key, e.target.value)}>
        {field.placeholder && (
          <option value="" disabled>{field.placeholder}</option>
        )}
        {(field.options || []).map((o) => {
          const optValue = typeof o === 'string' ? o : o.value;
          const optLabel = typeof o === 'string' ? o : o.label;
          return <option key={optValue} value={optValue}>{optLabel}</option>;
        })}
      </select>
    );
  }
  return (
    <input
      className="input"
      placeholder={field.placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
    />
  );
}

// 生成器表单壳层：基础字段 + 可折叠高级字段 + 尾部字段 + 格式模板选择器。
export default function GeneratorForm({
  fields, advancedFields, suffixFields, advancedLabel, form, onChange,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const renderFields = (list) => list.map((f) => (
    <div key={f.key}>
      <label className="label">{f.label}{f.required ? ' *' : ''}</label>
      {renderField(f, form[f.key], onChange)}
    </div>
  ));

  return (
    <div className="space-y-4">
      {renderFields(fields || [])}

      {advancedFields && advancedFields.length > 0 && (
        <>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            <span>{advancedLabel || '更多选项（可选）'}</span>
            <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          {showAdvanced && (
            <div className="space-y-4 border-l-2 border-accent-100 pl-3">
              {renderFields(advancedFields)}
            </div>
          )}
        </>
      )}

      {suffixFields && suffixFields.length > 0 && renderFields(suffixFields)}

      <TemplatePicker value={form.template_id || ''} onChange={(v) => onChange('template_id', v)} />
    </div>
  );
}
