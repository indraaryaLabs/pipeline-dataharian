import { defineConfig } from '@playwright/test';

// PW_CHANNEL=chrome runs against an installed Chrome instead of downloaded Chromium.
const channel = process.env['PW_CHANNEL'];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4175',
    trace: 'retain-on-failure',
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4175',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
