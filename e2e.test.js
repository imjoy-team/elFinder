const { test, expect } = require('@playwright/test');

test('can interact with elFinder in imjoy', async ({ page }) => {
  await page.goto('http://localhost:4000/test.html'); // replace with your test page URL
  await page.waitForSelector('#nav-v2_Lw');
});
