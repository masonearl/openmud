import { expect, test } from '@playwright/test';

test('welcome page explains browser versus desktop workflow', async ({ page }) => {
  await page.goto('/welcome.html');

  await expect(page.locator('h1')).toContainText('Welcome to openmud');
  await expect(page.locator('.hero-sub')).toContainText('browser for hosted chat, desktop app for folder sync and local tools');
  await expect(page.locator('#form-sign-in')).toBeVisible();
});

test('download page describes non-destructive mirror behavior', async ({ page }) => {
  await page.goto('/download.html');

  await expect(page.locator('.dl-note')).toContainText('The browser still works for hosted chat and cloud-backed project state');
  await expect(page.locator('.dl-list')).toContainText('Mirror sync is non-destructive');
  await expect(page.locator('.dl-list')).toContainText('does not automatically delete the app copy');
});

test('settings page shows desktop sync guidance without blank screen', async ({ page }) => {
  await page.goto('/settings.html');

  await expect(page.locator('#desktop-sync-wrap')).toBeVisible();
  await expect(page.locator('#desktop-sync-wrap')).toContainText('Desktop sync');
  await expect(page.locator('#desktop-sync-wrap')).toContainText('Desktop app only');
  await expect(page.locator('#desktop-sync-wrap')).toContainText('without deleting app files just because a mirror file is missing');
});

test('account-scoped browser storage isolates projects between users', async ({ page }) => {
  await page.goto('/welcome.html');

  const result = await page.evaluate(() => {
    const state = (window as any).openmudAccountState;
    state.setActiveUser({ id: 'user_a', email: 'a@example.com' });
    localStorage.setItem('mudrag_projects', JSON.stringify([{ id: 'p_a' }]));
    state.setActiveUser({ id: 'user_b', email: 'b@example.com' });
    const seenAsUserB = localStorage.getItem('mudrag_projects');
    localStorage.setItem('mudrag_projects', JSON.stringify([{ id: 'p_b' }]));
    state.setActiveUser({ id: 'user_a', email: 'a@example.com' });
    const seenAgainAsUserA = localStorage.getItem('mudrag_projects');
    state.setActiveUser(null);
    const seenAsAnon = localStorage.getItem('mudrag_projects');
    return { seenAsUserB, seenAgainAsUserA, seenAsAnon };
  });

  expect(result.seenAsUserB).toBeNull();
  expect(result.seenAgainAsUserA).toBe(JSON.stringify([{ id: 'p_a' }]));
  expect(result.seenAsAnon).toBeNull();
});
