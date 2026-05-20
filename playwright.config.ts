import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * The e2e suite spins up its own `next dev` on port 3100 with an isolated
 * state file under `.playwright-data/` (via VILLA_STATE_FILE), so it never
 * touches the live `.data/state.json` the family is using.
 *
 * Tests are run sequentially against this single dev server. Each test that
 * mutates state resets the server's state via PUT /api/state in a
 * `beforeEach`, so there's no cross-test contamination.
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_STATE_FILE = path.join(
  __dirname,
  ".playwright-data",
  "state.json",
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 480, height: 900 } },
    },
  ],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `${BASE_URL}/api/state`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      VILLA_STATE_FILE: TEST_STATE_FILE,
      // Block any accidental Vercel Blob writes during tests.
      BLOB_READ_WRITE_TOKEN: "",
    },
  },
});
