import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/visual',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/preview-server.cjs',
    url: 'http://127.0.0.1:4174/preview.html',
    reuseExistingServer: false,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
