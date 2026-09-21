import { expect, test } from '@playwright/test';

test.describe('diagram editing workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'New diagram' })).toBeVisible();
  });

  test('creates, moves, connects, duplicates, and undoes diagram objects', async ({ page }) => {
    await page.getByRole('button', { name: /Blank canvas/ }).click();
    await expect(page.locator('.editor-shell')).toBeVisible();

    const rectangle = page.getByRole('button', { name: /^Rectangle\s*\+$/ });
    await rectangle.click();
    const canvas = page.locator('svg.diagram-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.getByTitle('Add shape').click();
    await canvas.click({ position: { x: (canvasBox?.width ?? 800) - 80, y: (canvasBox?.height ?? 600) - 100 } });
    await expect(page.locator('[data-node-id]')).toHaveCount(2);

    const firstNode = page.locator('[data-node-id]').nth(0);
    const firstBox = await firstNode.boundingBox();
    expect(firstBox).not.toBeNull();
    await page.mouse.move((firstBox?.x ?? 0) + 40, (firstBox?.y ?? 0) + 35);
    await page.mouse.down();
    await page.mouse.move((firstBox?.x ?? 0) + 110, (firstBox?.y ?? 0) + 70);
    await page.mouse.up();

    await page.getByTitle('Connector (C)').click();
    const nodes = page.locator('[data-node-id]');
    for (let index = 0; index < 2; index += 1) {
      const box = await nodes.nth(index).boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    }
    await expect(page.locator('[data-edge-id]')).toHaveCount(1);
    await expect(page.locator('[data-edge-endpoint]')).toHaveCount(2);

    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-node-id]')).toHaveCount(4);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
  });

  test('creates and duplicates pages, then preserves the document locally', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByRole('button', { name: 'Create page' }).click();
    await expect(page.getByRole('button', { name: /Page 2/ })).toBeVisible();
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.locator('.page-tab')).toHaveCount(3);
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    await expect(page.getByRole('button', { name: /Untitled diagram/ }).first()).toBeVisible();
  });

  test('restores the editor window after a browser reload', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await expect(page.locator('.editor-shell')).toBeVisible();
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.locator('.editor-shell')).toBeVisible({ timeout: 10_000 });
  });
});
