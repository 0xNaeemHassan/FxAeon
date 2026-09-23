import type { Browser, Page, TestInfo } from '@playwright/test';
import { performance } from 'node:perf_hooks';

export type PerformanceStage = 'editable-form' | 'usable-quote' | 'refreshed-account';
export type PerformanceSource = 'browser-route' | 'deterministic-simulation';

export interface PerformanceSample {
  stage: PerformanceStage;
  durationMs: number;
  source: PerformanceSource;
  detail: string;
}

/** Record a duration using the browser's monotonic clock. Call only after the
 * corresponding user-visible state is asserted, so timings describe usable UI. */
export async function measureUntil(
  page: Page,
  stage: PerformanceStage,
  source: PerformanceSource,
  detail: string,
  action: () => Promise<void>,
): Promise<PerformanceSample> {
  return measureSince(page, stage, source, detail, performance.now(), action);
}

export async function measureSince(
  page: Page,
  stage: PerformanceStage,
  source: PerformanceSource,
  detail: string,
  startedAt: number,
  action: () => Promise<void>,
): Promise<PerformanceSample> {
  await action();
  return { stage, durationMs: Math.round((performance.now() - startedAt) * 100) / 100, source, detail };
}

/** Attach machine-readable evidence to the Playwright report and stdout. */
export async function reportPerformanceEvidence(
  browser: Browser,
  testInfo: TestInfo,
  samples: PerformanceSample[],
): Promise<void> {
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      browser: browser.browserType().name(),
      browserVersion: browser.version(),
      baseUrl: testInfo.project.use.baseURL ?? null,
      userAgent: page ? await page.evaluate(() => navigator.userAgent) : 'unavailable',
      viewport: page ? await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })) : null,
      project: testInfo.project.name,
      test: testInfo.title,
    },
    samples,
    interpretation: 'Single-run timings are observations, not a performance-improvement claim. Simulated delays are labeled separately from browser-route measurements.',
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await testInfo.attach('performance-evidence.json', { body, contentType: 'application/json' });
  console.log(`PERFORMANCE_EVIDENCE ${JSON.stringify(report)}`);
}
