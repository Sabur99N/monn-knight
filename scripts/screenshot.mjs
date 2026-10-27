import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:5188/?quality=high';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text());
});

console.log('Loading', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

// Wait for the preloader to disappear (models loaded).
await page
  .waitForFunction(() => !document.getElementById('preloader'), { timeout: 45000 })
  .catch(() => console.log('  (preloader still present, continuing)'));
await page.waitForTimeout(1500);

const total = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
const steps = 11;
for (let i = 0; i < steps; i++) {
  const y = Math.round((total * i) / (steps - 1));
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(1900); // let ScrollSmoother + scrub settle
  const file = `${OUT}/frame-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: file });
  console.log('Captured', file, 'at y=', y);
}

await browser.close();
console.log('Done.');
