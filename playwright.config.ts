import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end suite drives the real application in Chromium.
 *
 * The visual-regression project is separated from the functional one so that
 * a slow or rate-limited image CDN cannot make the functional suite flaky.
 */
export default defineConfig({
  testDir: './playwright',
  timeout: 120_000,
  expect: { timeout: 20_000, toHaveScreenshot: { maxDiffPixelRatio: 0.22 } },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.EMBED_URL ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'],
    },
  },
  projects: [
    {
      name: 'functional',
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
