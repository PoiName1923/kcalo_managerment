import { z } from 'zod';

const amount = z.number().finite().min(0).max(100000);
const itemSchema = z.object({
  name: z.string().min(1).max(100), grams: amount.positive(),
  kcal: amount, kcal_low: amount, kcal_high: amount,
  protein_g: amount, carbs_g: amount, fat_g: amount,
});
export const estimateSchema = z.object({
  is_food: z.boolean(), items: z.array(itemSchema).max(15),
  confidence: z.enum(['low', 'medium', 'high']),
  assumptions: z.array(z.string().max(200)).max(6),
});
export type Estimate = ReturnType<typeof parseEstimate>;

export function parseEstimate(input: unknown) {
  const result = estimateSchema.parse(input);
  if (result.is_food !== (result.items.length > 0)) throw new Error('Inconsistent food result');
  for (const item of result.items) {
    if (item.kcal_low > item.kcal || item.kcal_high < item.kcal) throw new Error('Invalid calorie range');
  }
  const keys = ['grams', 'kcal', 'kcal_low', 'kcal_high', 'protein_g', 'carbs_g', 'fat_g'] as const;
  const totals = Object.fromEntries(keys.map(key => [key,
    Math.round(result.items.reduce((sum, item) => sum + item[key], 0) * 10) / 10,
  ])) as Record<typeof keys[number], number>;
  return { ...result, totals };
}

export function formatEstimate(value: Estimate): string {
  if (!value.is_food) return 'Mình không nhận diện được món ăn trong ảnh. Bạn gửi ảnh rõ hơn, chụp toàn bộ phần ăn nhé.';
  const t = value.totals;
  const confidence = { low: 'thấp', medium: 'trung bình', high: 'cao' }[value.confidence];
  return [`🍽 Tổng ước tính: ${t.kcal} kcal`, `Khoảng ước tính: ${t.kcal_low}–${t.kcal_high} kcal`, '',
    ...value.items.map(item => `• ${item.name}: ~${item.grams} g · ${item.kcal} kcal`), '',
    `Protein: ${t.protein_g} g · Carb: ${t.carbs_g} g · Chất béo: ${t.fat_g} g`,
    `Mức độ chắc chắn của mô hình: ${confidence}`,
    ...value.assumptions.map(text => `• ${text}`), '',
    'Đây là ước tính từ ảnh. Ghi thêm khối lượng, thành phần và dầu/sốt trong chú thích giúp kết quả sát hơn.',
  ].join('\n');
}
