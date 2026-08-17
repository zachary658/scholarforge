import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Refresh, Save } from '../../components/Icons.jsx';
import { toast } from '../../components/Toast.jsx';

const CATEGORY_LABEL = {
  writing: '论文写作',
  polish: '润色降重',
  translate: '翻译',
  grammar: '语法纠错',
  reference: '文献',
};

export default function AdminFeaturePricing() {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({}); // feature_key -> price 字符串
  const [savingKey, setSavingKey] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListFeatures();
      const list = Array.isArray(data.features) ? data.features : [];
      setFeatures(list);
      const d = {};
      for (const f of list) d[f.feature_key] = String(f.price ?? 0);
      setDrafts(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (f) => {
    if (!f.is_unlimited) {
      const price = Number(drafts[f.feature_key]);
      if (!Number.isFinite(price) || price < f.min_points) {
        toast.warning(`「${f.name}」积分不能低于最低值 ${f.min_points}`);
        return;
      }
    }
    setSavingKey(f.feature_key);
    setError('');
    try {
      await api.adminSaveFeature({
        feature_key: f.feature_key,
        name: f.name,
        price: f.is_unlimited ? 0 : Number(drafts[f.feature_key]),
        unit: f.unit,
        category: f.category,
        description: f.description,
        is_active: f.is_active,
        is_unlimited: f.is_unlimited,
        sort_order: f.sort_order,
      });
      toast.success(`「${f.name}」已更新`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const toggleActive = async (f) => {
    setSavingKey(f.feature_key);
    setError('');
    try {
      await api.adminSaveFeature({
        feature_key: f.feature_key,
        name: f.name,
        price: f.is_unlimited ? 0 : Number(drafts[f.feature_key]),
        unit: f.unit,
        category: f.category,
        description: f.description,
        is_active: !f.is_active,
        is_unlimited: f.is_unlimited,
        sort_order: f.sort_order,
      });
      toast.success(f.is_active ? `「${f.name}」已停用` : `「${f.name}」已启用`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">功能定价</h1>
          <p className="mt-1 text-sm text-slate-500">
            调整每个功能每次消耗的积分。收费功能积分不得低于最低值（= 该功能 token 成本的 5 倍，1 元 = 10 积分）。
          </p>
        </div>
        <button onClick={load} className="btn-ghost text-xs">
          <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="card mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">功能</th>
                <th className="px-4 py-3">分类</th>
                <th className="px-4 py-3">最低积分</th>
                <th className="px-4 py-3">消耗积分 / 次</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">加载中…</td>
                </tr>
              ) : features.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">暂无功能</td>
                </tr>
              ) : (
                features.map((f) => {
                  const free = !!f.is_unlimited;
                  const active = f.is_active !== false;
                  const belowMin = !free && (Number(drafts[f.feature_key]) || 0) < (f.min_points || 0);
                  return (
                    <tr key={f.feature_key} className="border-b border-slate-100 text-sm last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{f.name}</div>
                        <div className="text-xs text-slate-400">{f.description || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{CATEGORY_LABEL[f.category] || f.category}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {free ? '—' : `${f.min_points ?? 0} 分`}
                      </td>
                      <td className="px-4 py-3">
                        {free ? (
                          <span className="rounded-md bg-green-50 px-2 py-0.5 text-xs text-green-600">免费不限次</span>
                        ) : (
                          <div>
                            <input
                              type="number"
                              min={f.min_points ?? 0}
                              step="1"
                              className={`input w-28 py-1.5 text-sm ${belowMin ? 'border-red-400' : ''}`}
                              value={drafts[f.feature_key] ?? ''}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [f.feature_key]: e.target.value }))}
                            />
                            {belowMin && (
                              <div className="mt-1 text-xs text-red-500">低于最低值</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleActive(f)}
                          disabled={savingKey === f.feature_key}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                            active ? 'bg-accent' : 'bg-slate-200'
                          }`}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                              active ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => save(f)}
                          disabled={savingKey === f.feature_key}
                          className="btn-primary px-3 py-1.5 text-xs"
                        >
                          <Save className={`h-3.5 w-3.5 ${savingKey === f.feature_key ? 'animate-pulse' : ''}`} />
                          {savingKey === f.feature_key ? '保存中…' : '保存'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
