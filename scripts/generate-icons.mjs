import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, '../public/icon.svg');
const svgContent = readFileSync(svgPath, 'utf8');

const sizes = [16, 32, 48, 128];

async function generate() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            * { margin: 0; padding: 0; }
            body, html { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
            svg { width: 100%; height: 100%; display: block; }
          </style>
        </head>
        <body>
          ${svgContent}
        </body>
      </html>
    `);

    const outPath = resolve(__dirname, `../public/icon-${size}.png`);
    const buffer = await page.screenshot({ omitBackground: true });
    writeFileSync(outPath, buffer);
    console.log(`Generated ${outPath}`);
  }

  await browser.close();
}

generate().catch(console.error);
