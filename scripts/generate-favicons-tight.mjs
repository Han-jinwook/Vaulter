import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const logoFile = path.join(process.cwd(), 'public', 'logo.png');
const publicDir = path.join(process.cwd(), 'public');

async function generateTightFavicons() {
  const metadata = await sharp(logoFile).metadata();
  const height = metadata.height; // 290
  const safeWidth = Math.min(250, metadata.width);

  // 1. Crop the left part (shield area)
  const croppedBuffer = await sharp(logoFile)
    .extract({ left: 0, top: 0, width: safeWidth, height: height })
    .toBuffer();

  // 2. Trim surrounding transparent pixels
  const { data: trimmedBuffer, info } = await sharp(croppedBuffer)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }) // Ensure we trim transparent pixels
    .toBuffer({ resolveWithObject: true });

  console.log(`Trimmed size: ${info.width}x${info.height}`);

  // 3. To make it a perfect square without distorting, we can use resize with fit: 'contain' 
  // on the trimmed buffer, so it occupies maximum space.
  const maxDim = Math.max(info.width, info.height);

  const faviconSizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'android-chrome-192x192.png', size: 192 },
    { name: 'android-chrome-512x512.png', size: 512 }
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

generateTightFavicons().catch(console.error);
