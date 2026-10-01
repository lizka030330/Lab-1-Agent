import { expect, test } from '@playwright/test';

test('посилання «Стан сервісу» веде на ендпоінт /api/health', async ({ page }, testInfo) => {
  await page.goto('/');

  const link = page.getByRole('link', { name: 'Стан сервісу' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/api/health');

  // Скріншот як доказ: лишається артефактом у test-results/.
  const screenshotPath = testInfo.outputPath('home-health-link.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('home-health-link', { path: screenshotPath, contentType: 'image/png' });
});
