import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:18251'
const composeArgs = [
  process.env.COMPOSE_PROJECT_NAME
    ? `-p ${process.env.COMPOSE_PROJECT_NAME}`
    : '',
  process.env.TCP_ENV_FILE ? `--env-file ${process.env.TCP_ENV_FILE}` : '',
]
  .filter(Boolean)
  .join(' ')
const composeCommand =
  `cd .. && docker compose ${composeArgs} up -d --build`.trim()

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: composeCommand,
        url: `${baseURL}/api/capability-model`,
        reuseExistingServer: true,
        timeout: 180000,
      },
})
