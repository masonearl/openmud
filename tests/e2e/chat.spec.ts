import { expect, test, type Page } from '@playwright/test';

async function openChat(page: Page) {
  await page.goto('/chat.html');
  await expect(page.locator('#chat-input')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test('agent mode sends use_tools=true', async ({ page }) => {
  let requestPayload: Record<string, unknown> | null = null;

  await page.route('**/api/chat', async (route) => {
    requestPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: 'Tool path ok.', tools_used: ['estimate_project_cost'] }),
    });
  });

  await openChat(page);
  await page.fill('#chat-input', 'Give me a quick utility bid outline.');
  await page.keyboard.press('Enter');

  await expect(page.locator('.msg-assistant p').last()).toContainText('Tool path ok.');
  expect(requestPayload).not.toBeNull();
  expect(requestPayload?.chat_mode).toBe('agent');
  expect(requestPayload?.use_tools).toBe(true);
});

test('ask mode sends use_tools=false', async ({ page }) => {
  let requestPayload: Record<string, unknown> | null = null;

  await page.route('**/api/chat', async (route) => {
    requestPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ response: 'Ask mode ok.', tools_used: [] }),
    });
  });

  await openChat(page);
  await page.click('#agent-dropdown');
  await page.click('.mode-dropdown-item[data-value="ask"]');
  await expect(page.locator('#agent-mode-label')).toHaveText('Ask');

  await page.fill('#chat-input', 'What is OSHA type C trench slope?');
  await page.keyboard.press('Enter');

  await expect(page.locator('.msg-assistant p').last()).toContainText('Ask mode ok.');
  expect(requestPayload).not.toBeNull();
  expect(requestPayload?.chat_mode).toBe('ask');
  expect(requestPayload?.use_tools).toBe(false);
});

test('quick estimate form renders result card', async ({ page }) => {
  await page.route('**/api/predict', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        predicted_cost: 182000,
        confidence_range_low: 165000,
        confidence_range_high: 198000,
        per_lf: 121.33,
        duration_days: 14,
        breakdown: {
          material: 82000,
          labor: 54000,
          equipment: 36000,
          misc: 4000,
          overhead: 4000,
          markup: 2000,
        },
      }),
    });
  });

  await openChat(page);
  await page.click('[data-open-tool="estimate"]');
  await expect(page.locator('#tool-panel-title')).toHaveText('Quick estimate');

  await page.fill('#est-linear-feet', '1500');
  await page.click('#btn-run-estimate');

  await expect(page.locator('#estimate-result')).toContainText('Estimate result');
  await expect(page.locator('#estimate-result')).toContainText('$182,000');
  await expect(page.locator('#estimate-result')).toContainText('Generate proposal');
});

test('chat API error shows user-friendly assistant message', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Model not available. Try a different model.' }),
    });
  });

  await openChat(page);
  await page.fill('#chat-input', 'test error path');
  await page.keyboard.press('Enter');

  await expect(page.locator('.msg-assistant p').last()).toContainText('Error: Model not available. Try a different model.');
});
