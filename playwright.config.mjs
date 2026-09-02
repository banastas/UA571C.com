import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5710',
    trace: 'on-first-retry',
    launchOptions: executablePath ? { executablePath } : undefined
  },
  webServer: {
    command: 'npm run start:test',
    url: 'http://127.0.0.1:5710/index.html',
    reuseExistingServer: false,
    timeout: 15_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 1060 } }
    }
  ]
});
