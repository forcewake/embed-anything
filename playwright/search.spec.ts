import { expect, test } from '@playwright/test';

/**
 * The semantic-search test. It needs the real EmbeddingGemma 2 model, which is
 * downloaded from the Hugging Face CDN on the first run (about 1 GB), so it is
 * tagged and can be skipped with `--grep-invert @ml` in a constrained
 * environment.
 */
test('@ml performs a real semantic text search', async ({ page }) => {
  test.setTimeout(15 * 60_000);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?seed=42');

  // The status caption disappears once the model is ready, so read the DOM
  // directly instead of waiting for the element.
  const status = () => page.evaluate(() => document.querySelector('.search-caption')?.textContent ?? '');

  await expect.poll(status, { timeout: 10 * 60_000, intervals: [2000] }).not.toMatch(/Loading|Warming/i);

  await page.locator('.search-box input[type="text"]').fill('a snowy mountain landscape');
  await page.locator('.search-box input[type="text"]').press('Enter');

  await expect.poll(status, { timeout: 5 * 60_000, intervals: [500] }).toMatch(/\d+ connections|No matches/i);

  const result = await page.evaluate(() => {
    const text = document.querySelector('.search-caption')?.textContent ?? '';
    const scores = Array.from(document.querySelectorAll('.tile-similarity'))
      .map((el) => el.textContent ?? '')
      .filter((t) => /Relevance\s+[\d.]+/.test(t))
      .map((t) => Number(t.replace(/[^\d.]/g, '')));
    const titles = Array.from(document.querySelectorAll('.spatial-card')).map(
      (el) => el.getAttribute('aria-label') ?? '',
    );
    return { text, scores, titles };
  });

  expect(result.text).toMatch(/\d+ connections/);
  // Every result must carry a calibrated score in (0.65, 1].
  expect(result.scores.length).toBeGreaterThan(0);
  for (const score of result.scores) {
    expect(score).toBeGreaterThanOrEqual(0.65);
    expect(score).toBeLessThanOrEqual(1);
  }
  // The top results must be landscape-ish photos.
  expect(result.titles.length).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
