import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sourceFile = path.join(process.cwd(), 'public', 'icon-source.png');
const publicDir = path.join(process.cwd(), 'public');

async function generateIcons() {
  if (!fs.existsSync(sourceFile)) {
    console.error(`Source file not found: ${sourceFile}`);
    process.exit(1);
  }

  const sizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'android-chrome-192x192.png', size: 192 },
    { name: 'android-chrome-512x512.png', size: 512 }
  ];

  for (const { name, size } of sizes) {
    const dest = path.join(publicDir, name);
    await sharp(sourceFile)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .toFile(dest);
    console.log(`Generated ${name}`);
  }

  // Generate favicon.ico (We can just use a renamed 32x32 png, browsers accept this nowadays)
  // Or copy favicon-32x32.png to favicon.ico
  const icoDest = path.join(publicDir, 'favicon.ico');
  fs.copyFileSync(path.join(publicDir, 'favicon-32x32.png'), icoDest);
  console.log('Generated favicon.ico');

  // Generate site.webmanifest
  const manifestPath = path.join(publicDir, 'site.webmanifest');
  const manifest = {
    "name": "금고지기",
    "short_name": "금고지기",
    "icons": [
        {
            "src": "/android-chrome-192x192.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "/android-chrome-512x512.png",
            "sizes": "512x512",
            "type": "image/png"
        }
    ],
    "theme_color": "#ffffff",
    "background_color": "#ffffff",
    "display": "standalone"
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Generated site.webmanifest');
}

generateIcons().catch(console.error);
