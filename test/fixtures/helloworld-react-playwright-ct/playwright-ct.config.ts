import { defineConfig, devices } from '@playwright/experimental-ct-react';

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  reporter: 'list',
  use: { trace: 'on-first-retry', ctPort: 3100 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
