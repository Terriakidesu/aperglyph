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

    await page.getByTitle('Select (V)').click();
    const targetHandle = page.locator('[data-edge-endpoint="target"]');
    const initialTargetX = await targetHandle.getAttribute('cx');
    const targetHandleBox = await targetHandle.boundingBox();
    const canvasBoxAfterConnect = await canvas.boundingBox();
    expect(targetHandleBox).not.toBeNull();
    expect(canvasBoxAfterConnect).not.toBeNull();
    await page.mouse.move((targetHandleBox?.x ?? 0) + (targetHandleBox?.width ?? 0) / 2, (targetHandleBox?.y ?? 0) + (targetHandleBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((canvasBoxAfterConnect?.x ?? 0) + 120, (canvasBoxAfterConnect?.y ?? 0) + 120);
    await page.mouse.up();
    await expect.poll(() => targetHandle.getAttribute('cx')).not.toBe(initialTargetX);

    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-node-id]')).toHaveCount(4);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
  });

  test('drops shapes from the library onto the canvas', async ({ page }) => {
    await page.locator('.template-card').first().click();
    const canvas = page.locator('svg.diagram-canvas');
    await page.locator('.shape-item[title="Drag Rectangle onto the canvas"]').dragTo(canvas);
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
    await expect(page.locator('.node-label')).toHaveText('Rectangle');
  });

  test('edits and adds fields on an ERD shape in any diagram', async ({ page }) => {
    await page.locator('.template-card').first().click();
    await page.getByTitle('Drag Entity onto the canvas').click();
    await expect(page.getByTitle('Add attribute')).toBeVisible();
    await page.getByLabel('Attribute 1 name').fill('id');
    await page.getByLabel('Attribute 1 type').fill('uuid');
    await page.getByTitle('Add attribute').click();
    await page.getByLabel('Attribute 3 name').fill('created_at');
    await expect(page.locator('[data-node-id]').first().locator('.node-field-name').last()).toHaveText('created_at');
  });

  test('connects nodes by dragging between connection ports', async ({ page }) => {
    await page.locator('.template-card').first().click();
    const canvas = page.locator('svg.diagram-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.getByTitle('Add shape').click();
    await canvas.click({ position: { x: 120, y: 160 } });
    await page.getByTitle('Add shape').click();
    await canvas.click({ position: { x: (canvasBox?.width ?? 900) - 120, y: 420 } });
    await page.getByTitle('Connector (C)').click();
    const nodes = page.locator('[data-node-id]');
    const source = nodes.nth(0).locator('[data-connection-port="right"]');
    const target = nodes.nth(1).locator('[data-connection-port="left"]');
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move((sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2, (sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2 + 14, (targetBox?.y ?? 0) + (targetBox?.height ?? 0) / 2 + 8, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('[data-edge-id]')).toHaveCount(1);
    const targetHandle = page.locator('[data-edge-endpoint="target"]');
    const targetHandleBox = await targetHandle.boundingBox();
    const targetPortBox = await target.boundingBox();
    expect(targetHandleBox).not.toBeNull();
    expect(targetPortBox).not.toBeNull();
    expect(Math.abs((targetHandleBox?.x ?? 0) + (targetHandleBox?.width ?? 0) / 2 - ((targetPortBox?.x ?? 0) + (targetPortBox?.width ?? 0) / 2))).toBeLessThan(2);
    expect(Math.abs((targetHandleBox?.y ?? 0) + (targetHandleBox?.height ?? 0) / 2 - ((targetPortBox?.y ?? 0) + (targetPortBox?.height ?? 0) / 2))).toBeLessThan(2);
  });

  test('supports ERD field-row anchors and table column variants', async ({ page }) => {
    await page.getByRole('button', { name: 'Entity relationship Model your data system 3 entities · 2 relations' }).click();
    const nodes = page.locator('[data-node-id]');
    await expect(nodes).toHaveCount(6);

    await nodes.first().click();
    await page.getByLabel('Attribute 1 name').fill('AccountID');
    await expect(nodes.first().locator('.node-field-name').first()).toHaveText('AccountID');
    await page.getByTitle('Add attribute').click();
    await expect(page.getByLabel('Attribute 5 name')).toHaveValue('new_field');
    await page.getByLabel('Attribute 5 name').fill('CreatedAt');
    await expect(nodes.first().locator('.node-field-name').last()).toHaveText('CreatedAt');
    const layout = page.getByLabel('Entity table layout');
    await layout.selectOption('key-field');
    await page.locator('.entity-layout-properties .toggle-button').click();
    await expect(nodes.first().locator('.node-field-column-header')).toHaveText(['Key', 'Field']);

    const initialEdges = await page.locator('[data-edge-id]').count();
    await page.getByTitle('Connector (C)').click();
    await nodes.nth(0).locator('[data-port="field-0-right"]').dispatchEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 });
    await nodes.nth(1).locator('[data-port="field-1-left"]').dispatchEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 });
    await expect(page.locator('[data-edge-id]')).toHaveCount(initialEdges + 1);
    await expect(page.locator('.edge-visible').last()).toHaveAttribute('d', /M -200 -111\.5/);
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

  test('edits and commits the complete label after a double click', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Add rectangle').click();
    const node = page.locator('[data-node-id]').first();
    await node.dblclick();
    const editor = page.locator('.canvas-text-editor');
    await expect(editor).toBeVisible();
    await editor.pressSequentially('Multiple words');
    await expect(editor).toHaveValue('Multiple words');
    await editor.press('Enter');
    await expect(node.locator('.node-label')).toHaveText('Multiple words');
  });

  test('aligns the inline editor with an ERD title', async ({ page }) => {
    await page.getByRole('button', { name: 'Entity relationship Model your data system 3 entities · 2 relations' }).click();
    const node = page.locator('[data-node-id]').first();
    await node.dblclick();
    const editor = page.locator('.canvas-text-editor');
    const inputBox = await editor.boundingBox();
    const titleBox = await node.locator('.node-entity-title').boundingBox();
    expect(inputBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(Math.abs((inputBox?.x ?? 0) + (inputBox?.width ?? 0) / 2 - ((titleBox?.x ?? 0) + (titleBox?.width ?? 0) / 2))).toBeLessThan(2);
    expect(Math.abs((inputBox?.y ?? 0) + (inputBox?.height ?? 0) / 2 - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0) / 2))).toBeLessThan(3);
    await editor.press('Escape');
  });

  test('deletes a saved project from the workspace', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    const card = page.locator('.recent-card').filter({ hasText: 'Untitled diagram' }).first();
    await expect(card).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await card.getByRole('button', { name: 'Delete Untitled diagram' }).click();
    await expect(card).toHaveCount(0);
  });
});
