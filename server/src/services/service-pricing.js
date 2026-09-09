import { getSetting } from '../config-store.js';

export const DISCIPLINE_CATEGORIES = Object.freeze({
  stem: '理工科',
  humanities: '人文社科',
});

function positiveSetting(key, fallback) {
  const value = Number(getSetting(key, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getServicePricingPolicy() {
  return {
    labor_cost_stem: positiveSetting('service_labor_cost_stem', 80),
    labor_cost_humanities: positiveSetting('service_labor_cost_humanities', 50),
    min_profit_markup: Math.max(5, positiveSetting('service_min_profit_markup', 5)),
  };
}

export function calculateServiceQuoteFloor({ disciplineCategory, estimatedHours }) {
  if (!Object.hasOwn(DISCIPLINE_CATEGORIES, disciplineCategory)) {
    const error = new Error('请选择理工科或人文社科');
    error.status = 400;
    throw error;
  }
  const hours = Number(estimatedHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 10000) {
    const error = new Error('预计工时须为大于 0 的有效数字');
    error.status = 400;
    throw error;
  }
  const policy = getServicePricingPolicy();
  const hourlyCost = disciplineCategory === 'stem' ? policy.labor_cost_stem : policy.labor_cost_humanities;
  const laborCost = Math.round(hourlyCost * hours * 100) / 100;
  const minimumPrice = Math.ceil(laborCost * (1 + policy.min_profit_markup) * 100) / 100;
  return { disciplineCategory, disciplineLabel: DISCIPLINE_CATEGORIES[disciplineCategory], hours, hourlyCost, laborCost, minimumPrice, minProfitMarkup: policy.min_profit_markup };
}
