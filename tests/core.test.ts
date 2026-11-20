import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { parseEstimate, formatEstimate } from '../src/estimate.js';
import { prepareImages } from '../src/images.js';

export const food = {
  is_food: true,
  items: [{ name: 'Cơm', grams: 150, kcal: 195, kcal_low: 170, kcal_high: 230,
    protein_g: 4, carbs_g: 43, fat_g: 0.5 }],
  confidence: 'medium', assumptions: ['Khối lượng ước tính từ ảnh'],
};

test('computes meal totals from individual foods rather than model totals', () => {
  const value = parseEstimate({ ...food, total_kcal: 999, items: [...food.items,
    { ...food.items[0], name: 'Trứng', kcal: 75, kcal_low: 60, kcal_high: 90 }] });
  assert.equal(value.totals.kcal, 270);
  assert.equal(value.totals.kcal_low, 230);
  assert.match(formatEstimate(value), /270 kcal/);
  assert.match(formatEstimate(value), /230–320/);
  assert.match(formatEstimate(value), /Protein/);
});
test('rejects negative nutrition, contradictory ranges and empty food results', () => {
  for (const patch of [{ kcal: -1 }, { kcal_low: 250 }, { kcal_high: 100 }, { grams: 0 }]) {
    assert.throws(() => parseEstimate({ ...food, items: [{ ...food.items[0], ...patch }] }));
  }
  assert.throws(() => parseEstimate({ ...food, items: [] }));
  assert.throws(() => parseEstimate({ ...food, is_food: false }));
});
test('non-food has no invented nutrition', () => {
  const value = parseEstimate({ ...food, is_food: false, items: [] });
  assert.equal(value.totals.kcal, 0);
  assert.match(formatEstimate(value), /không nhận diện/i);
});
test('stores a small stripped WebP separately from the clearer analysis image', async () => {
  const input = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#aabbcc' } })
    .jpeg().withMetadata().toBuffer();
  const output = await prepareImages(input);
  const stored = await sharp(output.thumbnail).metadata();
  const analysis = await sharp(output.analysis).metadata();
  assert.equal(stored.format, 'webp');
  assert.equal(stored.width, 640);
  assert.equal(analysis.width, 1600);
  assert.equal(stored.exif, undefined);
  assert.ok(output.thumbnail.length < input.length);
});
test('invalid images and excessive downloads are rejected before analysis', async () => {
  await assert.rejects(prepareImages(Buffer.from('not an image')));
  await assert.rejects(prepareImages(Buffer.alloc(10 * 1024 * 1024 + 1)), /large/i);
});
