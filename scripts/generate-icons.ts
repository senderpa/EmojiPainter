import * as fs from 'fs';
import * as path from 'path';
const sharp = require('sharp');

const ROOT = process.cwd();
const SRC_ICON = path.join(ROOT, 'assets', 'icon.png');

// iOS AppIcon sizes (pt * scale)
// Based on Apple's Human Interface Guidelines
const iosIcons: { size: number; scale: number; idiom: string; filename: string }[] = [
  { size: 20, scale: 2, idiom: 'iphone', filename: 'Icon-App-20x20@2x.png' },
  { size: 20, scale: 3, idiom: 'iphone', filename: 'Icon-App-20x20@3x.png' },
  { size: 29, scale: 2, idiom: 'iphone', filename: 'Icon-App-29x29@2x.png' },
  { size: 29, scale: 3, idiom: 'iphone', filename: 'Icon-App-29x29@3x.png' },
  { size: 40, scale: 2, idiom: 'iphone', filename: 'Icon-App-40x40@2x.png' },
  { size: 40, scale: 3, idiom: 'iphone', filename: 'Icon-App-40x40@3x.png' },
  { size: 60, scale: 2, idiom: 'iphone', filename: 'Icon-App-60x60@2x.png' },
  { size: 60, scale: 3, idiom: 'iphone', filename: 'Icon-App-60x60@3x.png' },

  { size: 20, scale: 1, idiom: 'ipad', filename: 'Icon-App-20x20@1x.png' },
  { size: 20, scale: 2, idiom: 'ipad', filename: 'Icon-App-20x20@2x.png' },
  { size: 29, scale: 1, idiom: 'ipad', filename: 'Icon-App-29x29@1x.png' },
  { size: 29, scale: 2, idiom: 'ipad', filename: 'Icon-App-29x29@2x.png' },
  { size: 40, scale: 1, idiom: 'ipad', filename: 'Icon-App-40x40@1x.png' },
  { size: 40, scale: 2, idiom: 'ipad', filename: 'Icon-App-40x40@2x.png' },
  { size: 76, scale: 1, idiom: 'ipad', filename: 'Icon-App-76x76@1x.png' },
  { size: 76, scale: 2, idiom: 'ipad', filename: 'Icon-App-76x76@2x.png' },
  { size: 83.5, scale: 2, idiom: 'ipad', filename: 'Icon-App-83.5x83.5@2x.png' },

  // App Store icon
  { size: 1024, scale: 1, idiom: 'ios-marketing', filename: 'ItunesArtwork@1024.png' },
];

const iosContents = (images: any[]) => ({
  images,
  info: { version: 1, author: 'xcode' },
});

const ensureDir = (p: string) => fs.mkdirSync(p, { recursive: true });

async function genIOS() {
  const setDir = path.join(ROOT, 'ios', 'EmojiPainter', 'Images.xcassets', 'AppIcon.appiconset');
  ensureDir(setDir);
  const images: any[] = [];
  for (const icon of iosIcons) {
    const px = Math.round(icon.size * icon.scale);
    const out = path.join(setDir, icon.filename);
    await sharp(SRC_ICON).resize(px, px).png().toFile(out);
    images.push({
      size: `${icon.size}x${icon.size}`,
      idiom: icon.idiom,
      filename: icon.filename,
      scale: `${icon.scale}x`,
    });
  }
  fs.writeFileSync(path.join(setDir, 'Contents.json'), JSON.stringify(iosContents(images), null, 2));
  console.log('iOS AppIcon set updated:', setDir);
}

// Android mipmap sizes (dp buckets for baseline 48dp)
const androidMipmaps: { dir: string; px: number }[] = [
  { dir: 'mipmap-mdpi', px: 48 },
  { dir: 'mipmap-hdpi', px: 72 },
  { dir: 'mipmap-xhdpi', px: 96 },
  { dir: 'mipmap-xxhdpi', px: 144 },
  { dir: 'mipmap-xxxhdpi', px: 192 },
];

async function genAndroid() {
  const resDir = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
  for (const m of androidMipmaps) {
    const dir = path.join(resDir, m.dir);
    ensureDir(dir);
    const out = path.join(dir, 'ic_launcher.png');
    await sharp(SRC_ICON).resize(m.px, m.px).png().toFile(out);
    console.log('Android icon updated:', out);
  }
}

async function main() {
  if (!fs.existsSync(SRC_ICON)) {
    throw new Error(`Missing source icon: ${SRC_ICON}`);
  }
  await genIOS();
  await genAndroid();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
