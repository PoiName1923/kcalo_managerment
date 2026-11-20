import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export async function prepareImages(input: Buffer) {
  if (input.length > MAX_IMAGE_BYTES) throw new Error('Image too large');
  const image = sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate().flatten({ background: '#ffffff' });
  const [analysis, thumbnail] = await Promise.all([
    image.clone().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
    image.clone().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 30, effort: 6 }).toBuffer(),
  ]);
  return { analysis, thumbnail };
}
