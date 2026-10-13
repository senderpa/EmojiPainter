#!/usr/bin/env node

// Static guard for the public gallery's first-paint loading policy. This is
// intentionally dependency-free so it can run before deployment or in CI.
const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve(__dirname, '../.website_work/gallery.html');
const source = fs.readFileSync(sourcePath, 'utf8');
const checks = [
  ['card image template is lazy', /<img class="card__image" loading="lazy"/],
  ['card videos use metadata preload', /video\.setAttribute\('preload', 'metadata'\)/],
  ['card video autoplay is viewport-controlled', /video\.autoplay = !galleryMediaObserver/],
  ['card media has an intersection observer', /const galleryMediaObserver = typeof IntersectionObserver/],
  ['first batch remains prioritized', /buildCard\(it, true\)/],
  ['later cards are built without priority', /const card = buildCard\(it\);/],
  ['feed still requests the existing 160-entry page', /per_page=160/],
  ['vote polling is throttled to 5 seconds', /votesTimer=setInterval\(refreshVotesOnly, 5_000\)/],
  ['vote polling prevents overlapping list requests', /if\(votesRefreshInFlight\) return/],
];

const failures = checks.filter(([, pattern]) => !pattern.test(source));
for (const [label] of checks) {
  const ok = !failures.some(([failedLabel]) => failedLabel === label);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}

if (failures.length) {
  process.exitCode = 1;
} else {
  console.log(`Gallery loading policy OK (${checks.length} checks; source ${source.length} bytes)`);
}
