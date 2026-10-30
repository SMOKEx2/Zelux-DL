// Responsive release smoke check against the Vite browser preview (npm run dev --prefix app).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../extension/package.json', import.meta.url));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
try {
  for (const lang of ['th', 'en']) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:1420/?lang=${lang}&theme=dark`);
    await page.locator('.toolbar .caption__btn').first().waitFor();
    for (const width of [940, 960, 1180, 1320]) {
      await page.setViewportSize({ width, height: 820 });
      const boxes = await page.locator('.toolbar .caption__btn').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };
      }));
      assert.equal(boxes.length, 3);
      for (const box of boxes) assert(box.left >= 0 && box.right <= width && box.width >= 40, `${lang} ${width}: clipped caption ${JSON.stringify(box)}`);
      if (width <= 1180) {
        await page.locator('.toolbar__overflow').click();
        await page.locator('[role="menu"]').waitFor();
        assert(await page.locator('[role="menu"] [role^="menuitem"]').count() >= 8);
        await page.keyboard.press('Escape');
      }
      console.log(`PASS ${lang} ${width}px: window controls and overflow menu`);
    }
    await page.close();
  }
  const large = await browser.newPage({ viewport: { width: 1320, height: 820 } });
  await large.goto('http://localhost:1420/?demo=10000&theme=dark');
  await large.locator('.row').first().waitFor();
  assert(await large.locator('.row').count() < 100, 'large list must remain virtualized');
  await large.locator('.table__body').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await large.waitForTimeout(150);
  assert(await large.locator('.row').count() > 0);
  assert(await large.locator('.row').count() < 100, 'scrolling must not mount every download');
  console.log('PASS 10,000-item list: bounded mounted rows before and after scrolling');
  await large.close();
} finally { await browser.close(); }
