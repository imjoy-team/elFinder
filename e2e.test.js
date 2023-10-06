const { test, expect } = require('@playwright/test');

test('can interact with elFinder in imjoy', async ({ page }) => {
  await page.goto('http://localhost:4000/test.html'); // replace with your test page 
  await page.waitForSelector("report-1")
  // obtain the window.api object in the page
  const api = await page.evaluateHandle(() => window.api);
  // call the createWindow method
  const fm = await api.evaluateHandle((api) => api.createWindow({src:"http://localhost:4000"}));
  // call the show method
  await api.evaluate((fm) => fm.show(), fm);
  // call the mount method
  await api.evaluate((fm) => fm.mount("s3://minioadmin:minioadmin@localhost:9000/testbucket"), fm);
  // call the get method
});
