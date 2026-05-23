import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const logoFile = path.join(process.cwd(), 'public', 'logo.png');
const sourceFile = path.join(process.cwd(), 'public', 'icon-source.png');
const publicDir = path.join(process.cwd(), 'public');

async function generateFavicons() {
  if (!fs.existsSync(logoFile)) {
    console.error(`Logo file not found: ${logoFile}`);
    process.exit(1);
  }

  // Use the transparent logo.png for favicons
  const faviconSizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 }
  ];

  for (const { name, size } of faviconSizes) {
    const dest = path.join(publicDir, name);
    await sharp(logoFile)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .toFile(dest);
    console.log(`Generated ${name} from logo.png`);
  }

  const icoDest = path.join(publicDir, 'favicon.ico');
  fs.copyFileSync(path.join(publicDir, 'favicon-32x32.png'), icoDest);
  console.log('Generated favicon.ico from logo.png');
}

generateFavicons().catch(console.error);
