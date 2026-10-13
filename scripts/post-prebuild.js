#!/usr/bin/env node
// Guard script to ensure local pods are linked after any prebuild
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function patchPodfile(podfilePath) {
  let text = fs.readFileSync(podfilePath, 'utf8');
  let changed = false;
  const ensurePod = (name, pathStr, comment) => {
    if (text.includes(`pod '${name}'`)) return;
    const needle = 'use_expo_modules!';
    if (text.includes(needle)) {
      text = text.replace(needle, `${needle}\n\n  # ${comment}\n  pod '${name}', :path => '${pathStr}'`);
    } else {
      text = text.replace(
        /target\s+['\"]\w+['\"]\s+do/,
        (m) => `${m}\n  pod '${name}', :path => '${pathStr}'`
      );
    }
    changed = true;
  };

  ensurePod('emojispray-bridge', '../modules/emojispray-bridge', 'Ensure local bridge pod stays linked deterministically');
  ensurePod('emojipaint-exporter', '../modules/emojipaint-exporter', 'Ensure local exporter pod stays linked deterministically');

  if (changed) {
    fs.writeFileSync(podfilePath, text, 'utf8');
    console.log('[post-prebuild] Ensured local pods (bridge/exporter) in Podfile.');
  }
  return changed;
}

(function main() {
  const iosDir = path.join(process.cwd(), 'ios');
  const podfilePath = path.join(iosDir, 'Podfile');
  if (!fs.existsSync(podfilePath)) {
    console.warn('[post-prebuild] No Podfile found. Skipping.');
    return;
  }
  const changed = patchPodfile(podfilePath);
  if (changed) {
    console.log('[post-prebuild] Please run `cd ios && pod install` to re-sync pods.');
  }

  // Sync MARKETING_VERSION and CURRENT_PROJECT_VERSION from app.json into pbxproj.
  // expo prebuild always resets these to 1.0 / 1 which breaks App Store versioning.
  const appJsonPath = path.join(process.cwd(), 'app.json');
  const pbxprojPath = path.join(iosDir, 'EmojiPainter.xcodeproj', 'project.pbxproj');
  if (fs.existsSync(appJsonPath) && fs.existsSync(pbxprojPath)) {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    const version = appJson?.expo?.version;
    const build = appJson?.expo?.ios?.buildNumber;
    if (version && build) {
      let pbx = fs.readFileSync(pbxprojPath, 'utf8');
      pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
      pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
      fs.writeFileSync(pbxprojPath, pbx, 'utf8');
      console.log(`[post-prebuild] ✅ Version synced → ${version} (${build})`);
    }
  }

  // Generate logo manifest if logos folder exists
  const logosDir = path.join(process.cwd(), 'assets', 'logos');
  if (fs.existsSync(logosDir)) {
    console.log('[post-prebuild] Generating logo manifest...');
    try {
      execSync('npm run gen:logos', { stdio: 'inherit' });
    } catch (error) {
      console.warn('[post-prebuild] Failed to generate logo manifest:', error.message);
    }
  }
})();
