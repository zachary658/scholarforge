// AI 计费与课程报价 section：大模型成本/利润率定价、论文 1 对 1 课程报价规则。
export default function AiSection({ settings, update }) {
  return (
    <>
      {/* AI 计费 */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-ink">AI 计费配置</h3>
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-sm font-medium text-ink">按大模型用量计费</div>
            <p className="mt-1 text-xs text-slate-400">
              售价 = 成本 ÷ (1 - 利润率)，利润率 0.8 时售价为成本的 5 倍，保证利润不低于 80%
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">输入成本（元/百万 token）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.ai_input_cost_per_million}
                onChange={(e) => update('ai_input_cost_per_million', e.target.value)}
              />
            </div>
            <div>
              <label className="label">输出成本（元/百万 token）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.ai_output_cost_per_million}
                onChange={(e) => update('ai_output_cost_per_million', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">目标利润率（0~0.99）</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="0.99"
              className="input max-w-[200px]"
              value={settings.ai_profit_margin}
              onChange={(e) => update('ai_profit_margin', e.target.value)}
            />
            <p className="mt-1.5 text-xs text-slate-400">0.8 = 80% 利润率，售价 = 成本 × 5</p>
          </div>
        </div>
      </div>

      {/* 课程定制报价 */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-ink">课程定制报价规则</h3>
        <p className="mt-1 text-xs text-slate-400">
          论文 1 对 1 指导：课程"起"价为基础价，用户填写需求后在其上累加。字数、图表、图纸按量加价，公式按复杂度分级加价，加急按系数加成。
        </p>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">基准字数（字）</label>
              <input
                type="number"
                className="input"
                value={settings.course_quote_base_word_count}
                onChange={(e) => update('course_quote_base_word_count', e.target.value)}
              />
              <p className="mt-1.5 text-xs text-slate-400">含在起价内的字数，超出部分加价</p>
            </div>
            <div>
              <label className="label">每超 1 万字加价（元）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.course_quote_word_price}
                onChange={(e) => update('course_quote_word_price', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">每张图表加价（元）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.course_quote_chart_price}
                onChange={(e) => update('course_quote_chart_price', e.target.value)}
              />
            </div>
            <div>
              <label className="label">每张图纸加价（元）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.course_quote_drawing_price}
                onChange={(e) => update('course_quote_drawing_price', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">公式·少量（元）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.course_quote_formula_low}
                onChange={(e) => update('course_quote_formula_low', e.target.value)}
              />
            </div>
            <div>
              <label className="label">公式·较多（元）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.course_quote_formula_mid}
                onChange={(e) => update('course_quote_formula_mid', e.target.value)}
              />
            </div>
            <div>
              <label className="label">公式·大量（元）</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={settings.course_quote_formula_high}
                onChange={(e) => update('course_quote_formula_high', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">加急系数（≥1）</label>
            <input
              type="number"
              step="0.1"
              min="1"
              className="input max-w-[200px]"
              value={settings.course_quote_urgent_multiplier}
              onChange={(e) => update('course_quote_urgent_multiplier', e.target.value)}
            />
            <p className="mt-1.5 text-xs text-slate-400">加急时小计乘以此系数（1.3 = 加收 30%）</p>
          </div>
        </div>
      </div>
    </>
  );
}
