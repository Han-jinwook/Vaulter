import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sourceFile = path.join(process.cwd(), 'public', 'icon-source2.png');
const publicDir = path.join(process.cwd(), 'public');

async function generateFaviconsOnly() {
  // Trim surrounding transparent pixels
  const { data: trimmedBuffer, info } = await sharp(sourceFile)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer({ resolveWithObject: true });

  console.log(`Trimmed size: ${info.width}x${info.height}`);

  const faviconSizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 }
  ];

  for (const { name, size } of faviconSizes) {
    const dest = path.join(publicDir, name);
    // Force a square canvas, fit the trimmed icon inside it tightly
    await sharp(trimmedBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .toFile(dest);
    console.log(`Generated tight ${name}`);
  }

  const icoDest = path.join(publicDir, 'favicon.ico');
  fs.copyFileSync(path.join(publicDir, 'favicon-32x32.png'), icoDest);
  console.log('Generated tight favicon.ico');
}

generateFaviconsOnly().catch(console.error);
