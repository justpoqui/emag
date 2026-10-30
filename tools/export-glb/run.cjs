// Starts Vite, opens the export page in headless Chromium and writes the
// .glb files it produces to godot/models/.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'godot/models');
const port = 5179;

(async () => {
  const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
  try {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    for (let i = 0; ; i++) {
      try {
        await page.goto(`http://localhost:${port}/tools/export-glb/`);
        break;
      } catch (e) {
        if (i > 40) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await page.waitForFunction(() => window.__glb || window.__glbError, null, { timeout: 300000 });
    const err = await page.evaluate(() => window.__glbError);
    if (err) throw new Error(err);
    const files = await page.evaluate(() => window.__glb);
    for (const [name, b64] of Object.entries(files)) {
      const file = path.join(outDir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log(`${name}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    }
    await browser.close();
  } finally {
    vite.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
