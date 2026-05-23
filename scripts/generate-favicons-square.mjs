import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const logoFile = path.join(process.cwd(), 'public', 'logo.png');
const publicDir = path.join(process.cwd(), 'public');

async function generateSquareFavicons() {
  const metadata = await sharp(logoFile).metadata();
  const squareSize = metadata.height; // 290

  // Crop the leftmost square
  const croppedBuffer = await sharp(logoFile)
    .extract({ left: 0, top: 0, width: squareSize, height: squareSize })
    .toBuffer();

  const faviconSizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 }
  ];

  for (const { name, size } of faviconSizes) {
    const dest = path.join(publicDir, name);
    await sharp(croppedBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .toFile(dest);
    console.log(`Generated ${name} from cropped logo`);
  }

  const icoDest = path.join(publicDir, 'favicon.ico');
  fs.copyFileSync(path.join(publicDir, 'favicon-32x32.png'), icoDest);
  console.log('Generated favicon.ico from cropped logo');
}

generateSquareFavicons().catch(console.error);
