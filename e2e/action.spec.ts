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
    await page.locator('.shape-item[title="Drag Rectangle onto the canvas"]').dragTo(canvas, { targetPosition: { x: (canvasBox?.width ?? 800) - 80, y: (canvasBox?.height ?? 600) - 100 } });
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

  test('repeats manual duplicate spacing and pastes at the canvas cursor', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const canvas = page.locator('svg.diagram-canvas');
    const first = page.locator('[data-node-id]').first();
    const firstBox = await first.boundingBox();
    expect(firstBox).not.toBeNull();

    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
    const duplicate = page.locator('[data-node-id]').nth(1);
    const duplicateBox = await duplicate.boundingBox();
    expect(duplicateBox).not.toBeNull();
    const duplicateCenter = { x: (duplicateBox?.x ?? 0) + (duplicateBox?.width ?? 0) / 2, y: (duplicateBox?.y ?? 0) + (duplicateBox?.height ?? 0) / 2 };
    await page.mouse.move(duplicateCenter.x, duplicateCenter.y);
    await page.mouse.down();
    await page.mouse.move(duplicateCenter.x + 160, duplicateCenter.y, { steps: 5 });
    await page.mouse.up();
    const movedBox = await duplicate.boundingBox();
    expect(movedBox).not.toBeNull();

    await page.keyboard.press('Control+d');
    await expect(page.locator('[data-node-id]')).toHaveCount(3);
    const thirdBox = await page.locator('[data-node-id]').nth(2).boundingBox();
    expect(thirdBox).not.toBeNull();
    expect(Math.abs((thirdBox?.x ?? 0) - (movedBox?.x ?? 0) - ((movedBox?.x ?? 0) - (firstBox?.x ?? 0)))).toBeLessThan(3);

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const pastePoint = { x: (canvasBox?.x ?? 0) + 380, y: (canvasBox?.y ?? 0) + 480 };
    await page.mouse.move(pastePoint.x, pastePoint.y);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.locator('[data-node-id]')).toHaveCount(4);
    const pastedBox = await page.locator('[data-node-id]').nth(3).boundingBox();
    expect(pastedBox).not.toBeNull();
    expect(Math.abs(((pastedBox?.x ?? 0) + (pastedBox?.width ?? 0) / 2) - pastePoint.x)).toBeLessThan(4);
    expect(Math.abs(((pastedBox?.y ?? 0) + (pastedBox?.height ?? 0) / 2) - pastePoint.y)).toBeLessThan(4);
  });

  test('changes a node shape without replacing its identity or label', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const node = page.locator('[data-node-id]').first();
    const id = await node.getAttribute('data-node-id');
    const transform = await node.getAttribute('transform');
    await node.click({ button: 'right' });
    await page.getByRole('button', { name: 'Change shape…' }).click();
    await page.getByLabel('Search replacement shapes').fill('Decision');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
    await expect(page.locator('[data-node-id]').first()).toHaveAttribute('data-node-id', id ?? '');
    await expect(page.locator('[data-node-id]').first()).toHaveAttribute('transform', transform ?? '');
    await expect(page.locator('.node-label')).toHaveText('Rectangle');
    await expect(page.locator('[data-node-id] polygon')).toHaveCount(1);
  });

  test('makes grouped objects visible on the canvas', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const shape = page.getByTitle('Drag Rectangle onto the canvas');
    await shape.click();
    await shape.click();
    await expect(page.locator('[data-node-id]')).toHaveCount(2);

    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+g');
    await expect(page.locator('.group-boundary')).toHaveCount(1);
    await expect(page.locator('.group-boundary-label')).toHaveText('Group · 2 objects');
    await expect(page.locator('.contextual-group-status')).toBeVisible();

    await page.keyboard.press('Control+Shift+g');
    await expect(page.locator('.group-boundary')).toHaveCount(0);
  });

  test('drops shapes from the library onto the canvas', async ({ page }) => {
    await page.locator('.template-card').first().click();
    const canvas = page.locator('svg.diagram-canvas');
    await page.locator('.shape-item[title="Drag Rectangle onto the canvas"]').dragTo(canvas);
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
    await expect(page.locator('.node-label')).toHaveText('Rectangle');
  });

  test('keeps shape library previews within their icon boxes', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const rectanglePreview = page.locator('.shape-item[title="Drag Rectangle onto the canvas"] .shape-preview-svg');
    await expect(rectanglePreview).toHaveAttribute('viewBox', '-3 -3 38 30');
    await expect(rectanglePreview.locator('rect')).toHaveAttribute('height', '24');

    const circlePreview = page.locator('.shape-item[title="Drag Circle onto the canvas"] .shape-preview-svg');
    await expect(circlePreview.locator('ellipse')).toHaveAttribute('rx', '14');
    await expect(circlePreview.locator('ellipse')).toHaveAttribute('ry', '14');

    await page.getByLabel('Shape library category').selectOption('erd');
    await expect(page.locator('.shape-item[title="Drag Entity onto the canvas"] .shape-preview-svg text')).toHaveCount(0);
    await expect(page.locator('.shape-item[title="Drag Entity onto the canvas"] .shape-preview-svg line')).toHaveCount(3);
  });

  test('supports keyboard nudging and the command palette', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const canvas = page.locator('svg.diagram-canvas');
    const node = page.locator('[data-node-id]').first();
    const before = await node.getAttribute('transform');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => node.getAttribute('transform')).not.toBe(before);
    const afterNudge = await node.getAttribute('transform');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => node.getAttribute('transform')).not.toBe(afterNudge);

    await page.keyboard.press('Control+k');
    await expect(page.getByLabel('Search commands')).toBeVisible();
    await page.getByLabel('Search commands').fill('100%');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Search commands')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.canvas-text-editor')).toHaveCount(0);
  });

  test('searches and inserts a shape with the keyboard', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.keyboard.press('s');
    await expect(page.getByLabel('Search shapes to insert')).toBeVisible();
    await page.getByLabel('Search shapes to insert').fill('decision');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
    await expect(page.locator('.node-label')).toHaveText('Decision?');
  });

  test('selects every matching shape type from command search', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.getByTitle('Drag Circle onto the canvas').click();
    await page.getByTitle('Show outline').click();
    await page.locator('.outline-node-row').first().click();
    await page.keyboard.press('Control+k');
    await page.getByLabel('Search commands').fill('same shape type');
    await page.keyboard.press('Enter');
    await expect(page.locator('.canvas-node.selected')).toHaveCount(2);
  });

  test('exposes contextual controls, independent snapping, rename, and preferences', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await expect(page.locator('.contextual-toolbar-node')).toBeVisible();

    await page.getByLabel('Node rotation').fill('45');
    await expect(page.getByLabel('Node rotation')).toHaveValue('45');
    await page.getByLabel('Lock aspect ratio').click();
    await expect(page.getByLabel('Lock aspect ratio')).toHaveAttribute('aria-pressed', 'true');

    await page.getByLabel('Snap settings').click();
    await expect(page.getByText('Snap settings', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Snap grid size')).toBeVisible();

    await page.getByTitle('Rename document').click();
    await page.getByLabel('Document title').fill('P0 controls');
    await page.getByLabel('Document title').press('Enter');
    await expect(page.getByTitle('Rename document')).toContainText('P0 controls');

    await page.getByTitle('More editor actions').click();
    await page.getByRole('button', { name: 'Preferences' }).click();
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
  });

  test('matches multi-selection dimensions through the arrange inspector', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const rectangle = page.getByTitle('Drag Rectangle onto the canvas');
    await rectangle.click();
    await page.getByLabel('Node width').fill('260');
    await rectangle.click();
    await page.locator('svg.diagram-canvas').click({ position: { x: 640, y: 520 } });
    await page.keyboard.press('Control+a');
    await expect(page.getByTitle('Match selected widths')).toBeVisible();
    await page.getByTitle('Match selected widths').click();
    const widths = await page.locator('[data-node-id]').evaluateAll((nodes) => nodes.map((node) => node.querySelector(':scope > rect')?.getAttribute('width')));
    expect(new Set(widths).size).toBe(1);
  });

  test('resizes from the center with Alt-drag', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const node = page.locator('[data-node-id]').first();
    const before = await node.boundingBox();
    const handle = node.locator('.node-handles .handle').nth(2);
    const handleBox = await handle.boundingBox();
    expect(before).not.toBeNull();
    expect(handleBox).not.toBeNull();
    await page.keyboard.down('Alt');
    await page.mouse.move((handleBox?.x ?? 0) + 4, (handleBox?.y ?? 0) + 4);
    await page.mouse.down();
    await page.mouse.move((handleBox?.x ?? 0) + 34, (handleBox?.y ?? 0) + 24, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const after = await node.boundingBox();
    expect(after).not.toBeNull();
    expect(after?.width ?? 0).toBeGreaterThan((before?.width ?? 0) + 40);
    expect(after?.height ?? 0).toBeGreaterThan((before?.height ?? 0) + 28);
    expect(after?.x ?? 0).toBeLessThan((before?.x ?? 0) - 15);
  });

  test('flips the selected shape through the command palette and undoes it', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const node = page.locator('[data-node-id]').first();
    await page.keyboard.press('Control+k');
    await page.getByLabel('Search commands').fill('Flip selection horizontally');
    await page.getByRole('button', { name: 'Flip selection horizontally' }).click();
    await expect(node.locator('g[transform*="scale(-1 1)"]')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(node.locator('g[transform*="scale(-1 1)"]')).toHaveCount(0);
  });

  test('makes editor controls discoverable and keyboard accessible', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const selectTool = page.getByRole('button', { name: 'Select tool' });
    await expect(selectTool).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Pan canvas tool' }).click();
    await expect(page.getByRole('button', { name: 'Pan canvas tool' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.status-mode')).toContainText('Pan tool');

    const leftResize = page.getByRole('separator', { name: 'Resize left panel' });
    const beforeWidth = Number(await leftResize.getAttribute('aria-valuenow'));
    await leftResize.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await leftResize.getAttribute('aria-valuenow'))).toBe(beforeWidth + 10);

    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.page-menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Snap settings' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Snap settings' })).toHaveCount(0);
  });

  test('uses trackpad scrolling for smooth pan and pinch for zoom', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const canvas = page.locator('svg.diagram-canvas');
    const root = canvas.locator('g').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const clientX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const clientY = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const beforePan = await root.getAttribute('transform');
    const beforeZoom = await page.getByLabel('Zoom percentage').textContent();
    await canvas.dispatchEvent('wheel', { bubbles: true, cancelable: true, deltaX: 80, deltaY: 40, deltaMode: 0, clientX, clientY });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(root).not.toHaveAttribute('transform', beforePan ?? '');
    await expect(page.getByLabel('Zoom percentage')).toHaveText(beforeZoom ?? '100%');

    const pinchPrevented = await canvas.evaluate((element, point) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: point.clientX, clientY: point.clientY });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, { clientX, clientY });
    expect(pinchPrevented).toBe(true);
    await canvas.dispatchEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, deltaMode: 0, ctrlKey: true, clientX, clientY });
    await expect.poll(() => page.getByLabel('Zoom percentage').textContent()).not.toBe(beforeZoom);
  });

  test('keeps a small pinch delta anchored at the pointer', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const canvas = page.locator('svg.diagram-canvas');
    const point = await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { clientX: rect.left + rect.width * 0.72, clientY: rect.top + rect.height * 0.38 };
    });
    const readWorldPoint = () => page.evaluate(({ clientX, clientY }) => {
      const root = document.querySelector<SVGGElement>('svg.diagram-canvas > g');
      const inverse = root?.getScreenCTM()?.inverse();
      if (!inverse) return null;
      const world = new DOMPoint(clientX, clientY).matrixTransform(inverse);
      return { x: world.x, y: world.y, transform: root?.getAttribute('transform') ?? '' };
    }, point);
    const before = await readWorldPoint();
    expect(before).not.toBeNull();
    await canvas.dispatchEvent('wheel', { bubbles: true, cancelable: true, deltaY: -5, deltaMode: 0, ctrlKey: true, clientX: point.clientX, clientY: point.clientY });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const after = await readWorldPoint();
    expect(after).not.toBeNull();
    expect(after?.transform).not.toBe(before?.transform);
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(0.01);
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(0.01);
  });

  test('supports touchscreen pinch without scrolling the browser page', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const canvas = page.locator('svg.diagram-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const before = await page.evaluate(() => ({ zoom: Number(document.querySelector('[aria-label="Zoom percentage"]')?.textContent?.replace('%', '')), scrollX: globalThis.scrollX, scrollY: globalThis.scrollY }));
    const cdp = await page.context().newCDPSession(page);
    const center = { x: (box?.x ?? 0) + (box?.width ?? 0) * 0.65, y: (box?.y ?? 0) + (box?.height ?? 0) * 0.45 };
    const points = (distance: number) => [{ id: 1, x: center.x - distance, y: center.y }, { id: 2, x: center.x + distance, y: center.y }];
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(35) });
      for (const distance of [45, 55, 65, 75, 85, 95]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(120);
    } finally {
      try { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } catch { /* Already ended. */ }
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.detach();
    }
    const after = await page.evaluate(() => ({ zoom: Number(document.querySelector('[aria-label="Zoom percentage"]')?.textContent?.replace('%', '')), scrollX: globalThis.scrollX, scrollY: globalThis.scrollY }));
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.scrollX).toBe(before.scrollX);
    expect(after.scrollY).toBe(before.scrollY);
  });

  test('does not let a pending gesture overwrite a viewport command', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Canvas view').click();
    const result = await page.evaluate(async () => {
      const canvas = document.querySelector<SVGSVGElement>('svg.diagram-canvas');
      const rect = canvas?.getBoundingClientRect();
      canvas?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true, clientX: (rect?.left ?? 0) + (rect?.width ?? 0) * 0.6, clientY: (rect?.top ?? 0) + (rect?.height ?? 0) * 0.4 }));
      [...document.querySelectorAll<HTMLButtonElement>('.view-menu button')].find((button) => button.textContent?.trim() === 'Fit page')?.click();
      await new Promise(requestAnimationFrame);
      const fitted = document.querySelector<SVGGElement>('svg.diagram-canvas > g')?.getAttribute('transform');
      await new Promise((resolve) => setTimeout(resolve, 140));
      const settled = document.querySelector<SVGGElement>('svg.diagram-canvas > g')?.getAttribute('transform');
      return { fitted, settled };
    });
    expect(result.settled).toBe(result.fitted);
  });

  test('exposes common selection actions in the top bar', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await expect(page.getByLabel('Fit selection')).toBeEnabled();
    await expect(page.getByTitle('Duplicate selection · ⌘D')).toBeEnabled();
    await expect(page.getByLabel('Group selection')).toBeDisabled();
    await page.getByTitle('Duplicate selection · ⌘D').click();
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
    await page.getByLabel('Delete selection').click();
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
  });

  test('Alt-drag duplicates without applying grid snapping', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const node = page.locator('[data-node-id]').first();
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    await page.keyboard.down('Alt');
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2 + 13, (box?.y ?? 0) + (box?.height ?? 0) / 2 + 9, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
    const positions = await page.locator('[data-node-id]').evaluateAll((nodes) => nodes.map((item) => {
      const match = item.getAttribute('transform')?.match(/translate\(([-\d.]+) ([-\d.]+)/);
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    }));
    expect(positions.some((position) => position && Math.abs(position.x / 16 - Math.round(position.x / 16)) > 0.1)).toBe(true);
  });

  test('navigates through the outline, minimap, guides, and focus mode', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const canvas = page.locator('svg.diagram-canvas');
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await expect(page.locator('[data-node-id]')).toHaveCount(2);

    await page.getByTitle('Show outline').click();
    await expect(page.locator('.outline-panel')).toBeVisible();
    const outlineNodes = page.locator('.outline-node-row');
    await expect(outlineNodes).toHaveCount(2);
    await outlineNodes.first().dblclick();
    const renameInput = page.getByLabel(/Rename Rectangle/).first();
    await renameInput.fill('API');
    await renameInput.press('Enter');
    await expect(page.locator('.node-label').first()).toHaveText('API');
    await outlineNodes.first().getByTitle('Hide object').click();
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
    await page.locator('.outline-node-row').first().getByTitle('Show object').click();
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
    await page.locator('.outline-node-row').first().click();
    await page.keyboard.press('Control+k');
    await page.getByLabel('Search commands').fill('Fit selection');
    await page.keyboard.press('Enter');
    await expect(page.locator('.canvas-minimap')).toBeVisible();
    await page.locator('.canvas-ruler-top').click({ position: { x: 220, y: 10 } });
    await expect(page.locator('.canvas-guide')).toHaveCount(1);
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Focus mode', exact: true }).click();
    await expect(page.locator('.outline-panel')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('.outline-panel')).toBeVisible();
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

  test('clamps an ERD resize to its visible table rows', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Entity onto the canvas').click();
    const node = page.locator('[data-node-id]').first();
    await node.click();
    const handle = node.locator('.node-handles .handle').nth(2);
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move((handleBox?.x ?? 0) + 4, (handleBox?.y ?? 0) + 4);
    await page.mouse.down();
    await page.mouse.move((handleBox?.x ?? 0) - 220, (handleBox?.y ?? 0) - 180, { steps: 5 });
    await page.mouse.up();

    const selectionBox = node.locator('.node-handles > rect').first();
    await expect.poll(async () => Number(await selectionBox.getAttribute('height'))).toBeGreaterThanOrEqual(98);
    await expect.poll(async () => Number(await node.locator('.node-entity-title').evaluate((element) => element.closest('g')?.querySelector('rect')?.getAttribute('height') ?? '0'))).toBeGreaterThanOrEqual(88);
  });

  test('keeps circles square when editing their dimensions', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Circle onto the canvas').click();
    await page.locator('[data-node-id]').first().click();
    await expect(page.getByLabel('Lock aspect ratio')).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Node width').fill('180');
    await expect(page.getByRole('spinbutton', { name: 'Node height' })).toHaveValue('180');
  });

  test('connects nodes by dragging between connection ports', async ({ page }) => {
    await page.locator('.template-card').first().click();
    const canvas = page.locator('svg.diagram-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.locator('.shape-item[title="Drag Rectangle onto the canvas"]').dragTo(canvas, { targetPosition: { x: 120, y: 160 } });
    await page.locator('.shape-item[title="Drag Rectangle onto the canvas"]').dragTo(canvas, { targetPosition: { x: (canvasBox?.width ?? 900) - 120, y: 420 } });
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

  test('keeps both ends anchored after reconnecting a free endpoint', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const canvas = page.locator('svg.diagram-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const shape = page.locator('.shape-item[title="Drag Rectangle onto the canvas"]');
    await shape.dragTo(canvas, { targetPosition: { x: 180, y: 250 } });
    await shape.dragTo(canvas, { targetPosition: { x: 650, y: 250 } });

    await page.getByTitle('Connector (C)').click();
    const nodes = page.locator('[data-node-id]');
    const sourcePort = nodes.nth(0).locator('[data-connection-port="right"]');
    const targetPort = nodes.nth(1).locator('[data-connection-port="left"]');
    const sourcePortBox = await sourcePort.boundingBox();
    const targetPortBox = await targetPort.boundingBox();
    const sourceNodeBox = await nodes.nth(0).boundingBox();
    const targetNodeBox = await nodes.nth(1).boundingBox();
    expect(sourcePortBox).not.toBeNull();
    expect(targetPortBox).not.toBeNull();
    expect(sourceNodeBox).not.toBeNull();
    expect(targetNodeBox).not.toBeNull();

    // Clicking the node bodies creates an attached edge without explicit ports,
    // which makes stale free-point geometry observable on the opposite end.
    await page.mouse.click((sourceNodeBox?.x ?? 0) + (sourceNodeBox?.width ?? 0) / 2, (sourceNodeBox?.y ?? 0) + (sourceNodeBox?.height ?? 0) / 2);
    await page.mouse.click((targetNodeBox?.x ?? 0) + (targetNodeBox?.width ?? 0) / 2, (targetNodeBox?.y ?? 0) + (targetNodeBox?.height ?? 0) / 2);
    await expect(page.locator('[data-edge-id]')).toHaveCount(1);

    await page.getByTitle('Select (V)').click();
    const endpoint = page.locator('[data-edge-endpoint="target"]');
    const endpointBox = await endpoint.boundingBox();
    expect(endpointBox).not.toBeNull();
    const freePoint = { x: (canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) - 100, y: (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0) - 100 };
    await page.mouse.move((endpointBox?.x ?? 0) + (endpointBox?.width ?? 0) / 2, (endpointBox?.y ?? 0) + (endpointBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move(freePoint.x, freePoint.y, { steps: 6 });
    await page.mouse.up();

    const freeEndpointBox = await endpoint.boundingBox();
    expect(freeEndpointBox).not.toBeNull();
    const targetAnchor = { x: (targetPortBox?.x ?? 0) + (targetPortBox?.width ?? 0) / 2, y: (targetPortBox?.y ?? 0) + (targetPortBox?.height ?? 0) / 2 };
    await page.mouse.move((freeEndpointBox?.x ?? 0) + (freeEndpointBox?.width ?? 0) / 2, (freeEndpointBox?.y ?? 0) + (freeEndpointBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move(targetAnchor.x + 14, targetAnchor.y + 8, { steps: 6 });
    await page.mouse.up();

    const sourceHandle = page.locator('[data-edge-endpoint="source"]');
    const sourceHandleBox = await sourceHandle.boundingBox();
    const targetHandleBox = await endpoint.boundingBox();
    expect(sourceHandleBox).not.toBeNull();
    expect(targetHandleBox).not.toBeNull();
    expect(Math.abs((sourceHandleBox?.x ?? 0) + (sourceHandleBox?.width ?? 0) / 2 - ((sourcePortBox?.x ?? 0) + (sourcePortBox?.width ?? 0) / 2))).toBeLessThan(2);
    expect(Math.abs((sourceHandleBox?.y ?? 0) + (sourceHandleBox?.height ?? 0) / 2 - ((sourcePortBox?.y ?? 0) + (sourcePortBox?.height ?? 0) / 2))).toBeLessThan(2);
    expect(Math.abs((targetHandleBox?.x ?? 0) + (targetHandleBox?.width ?? 0) / 2 - targetAnchor.x)).toBeLessThan(2);
    expect(Math.abs((targetHandleBox?.y ?? 0) + (targetHandleBox?.height ?? 0) / 2 - targetAnchor.y)).toBeLessThan(2);
  });

  test('reconnects an attached endpoint to a curved opposite node anchor', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const canvas = page.locator('svg.diagram-canvas');
    await page.locator('.shape-item[title="Drag Circle onto the canvas"]').dragTo(canvas, { targetPosition: { x: 180, y: 250 } });
    await page.locator('.shape-item[title="Drag Rectangle onto the canvas"]').dragTo(canvas, { targetPosition: { x: 650, y: 250 } });

    await page.getByTitle('Connector (C)').click();
    const nodes = page.locator('[data-node-id]');
    const sourcePort = nodes.nth(0).locator('[data-connection-port="right"]');
    const targetPort = nodes.nth(1).locator('[data-connection-port="left"]');
    const sourcePortBox = await sourcePort.boundingBox();
    const targetPortBox = await targetPort.boundingBox();
    expect(sourcePortBox).not.toBeNull();
    expect(targetPortBox).not.toBeNull();
    const sourceAnchor = { x: (sourcePortBox?.x ?? 0) + (sourcePortBox?.width ?? 0) / 2, y: (sourcePortBox?.y ?? 0) + (sourcePortBox?.height ?? 0) / 2 };
    await page.mouse.click(sourceAnchor.x, sourceAnchor.y);
    await page.mouse.click((targetPortBox?.x ?? 0) + (targetPortBox?.width ?? 0) / 2, (targetPortBox?.y ?? 0) + (targetPortBox?.height ?? 0) / 2);
    await expect(page.locator('[data-edge-id]')).toHaveCount(1);

    await page.getByTitle('Select (V)').click();
    const endpoint = page.locator('[data-edge-endpoint="target"]');
    const endpointBox = await endpoint.boundingBox();
    expect(endpointBox).not.toBeNull();
    await page.mouse.move((endpointBox?.x ?? 0) + (endpointBox?.width ?? 0) / 2, (endpointBox?.y ?? 0) + (endpointBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move(sourceAnchor.x + 14, sourceAnchor.y + 8, { steps: 6 });
    await page.mouse.up();

    const reconnectedBox = await endpoint.boundingBox();
    expect(reconnectedBox).not.toBeNull();
    expect(Math.abs((reconnectedBox?.x ?? 0) + (reconnectedBox?.width ?? 0) / 2 - sourceAnchor.x)).toBeLessThan(2);
    expect(Math.abs((reconnectedBox?.y ?? 0) + (reconnectedBox?.height ?? 0) / 2 - sourceAnchor.y)).toBeLessThan(2);
  });

  test('preserves the preview anchor after reconnecting from an offset attachment', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    const canvas = page.locator('svg.diagram-canvas');
    await page.locator('.shape-item[title="Drag Circle onto the canvas"]').dragTo(canvas, { targetPosition: { x: 180, y: 250 } });
    await page.locator('.shape-item[title="Drag Rectangle onto the canvas"]').dragTo(canvas, { targetPosition: { x: 650, y: 250 } });

    await page.getByTitle('Connector (C)').click();
    const nodes = page.locator('[data-node-id]');
    const sourcePort = nodes.nth(0).locator('[data-connection-port="right"]');
    const targetPort = nodes.nth(1).locator('[data-connection-port="left"]');
    const sourcePortBox = await sourcePort.boundingBox();
    const targetPortBox = await targetPort.boundingBox();
    const targetNodeBox = await nodes.nth(1).boundingBox();
    expect(sourcePortBox).not.toBeNull();
    expect(targetPortBox).not.toBeNull();
    expect(targetNodeBox).not.toBeNull();
    const sourceAnchor = { x: (sourcePortBox?.x ?? 0) + (sourcePortBox?.width ?? 0) / 2, y: (sourcePortBox?.y ?? 0) + (sourcePortBox?.height ?? 0) / 2 };
    const targetPortCenter = { x: (targetPortBox?.x ?? 0) + (targetPortBox?.width ?? 0) / 2, y: (targetPortBox?.y ?? 0) + (targetPortBox?.height ?? 0) / 2 };
    const offsetDrop = { x: (targetNodeBox?.x ?? 0) + 6, y: (targetNodeBox?.y ?? 0) + (targetNodeBox?.height ?? 0) * 0.88 };
    await page.mouse.move(sourceAnchor.x, sourceAnchor.y);
    await page.mouse.down();
    await page.mouse.move(offsetDrop.x, offsetDrop.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-edge-id]')).toHaveCount(1);

    const endpoint = page.locator('[data-edge-endpoint="target"]');
    const offsetEndpointBox = await endpoint.boundingBox();
    expect(offsetEndpointBox).not.toBeNull();
    expect(Math.abs((offsetEndpointBox?.y ?? 0) + (offsetEndpointBox?.height ?? 0) / 2 - targetPortCenter.y)).toBeGreaterThan(4);

    await page.getByTitle('Select (V)').click();
    const startBox = await endpoint.boundingBox();
    expect(startBox).not.toBeNull();
    await page.mouse.move((startBox?.x ?? 0) + (startBox?.width ?? 0) / 2, (startBox?.y ?? 0) + (startBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move(sourceAnchor.x + 14, sourceAnchor.y + 8, { steps: 6 });
    const previewBox = await page.locator('.connection-target-preview circle').first().boundingBox();
    expect(previewBox).not.toBeNull();
    const previewAnchor = { x: (previewBox?.x ?? 0) + (previewBox?.width ?? 0) / 2, y: (previewBox?.y ?? 0) + (previewBox?.height ?? 0) / 2 };
    await page.mouse.up();

    const committedBox = await endpoint.boundingBox();
    expect(committedBox).not.toBeNull();
    const committedAnchor = { x: (committedBox?.x ?? 0) + (committedBox?.width ?? 0) / 2, y: (committedBox?.y ?? 0) + (committedBox?.height ?? 0) / 2 };
    expect(Math.abs(committedAnchor.x - previewAnchor.x)).toBeLessThan(2);
    expect(Math.abs(committedAnchor.y - previewAnchor.y)).toBeLessThan(2);
  });

  test('quick-creates a shape from an empty connector endpoint', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const canvas = page.locator('svg.diagram-canvas');
    const source = page.locator('[data-node-id]').first().locator('[data-connection-port="right"]');
    const sourceBox = await source.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    await page.getByTitle('Connector (C)').click();
    await page.mouse.move((sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2, (sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) - 100, (canvasBox?.y ?? 0) + 140, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByText('Quick create')).toBeVisible();
    await page.locator('.quick-create-list button').filter({ hasText: 'Circle' }).click();
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
    await expect(page.locator('[data-edge-id]')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
    await expect(page.locator('[data-edge-id]')).toHaveCount(0);
  });

  test('opens connected-shape creation from a stationary connection point click', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.locator('[data-node-id]').first().locator('[data-connection-port="right"]').click();
    await expect(page.getByText('Quick create')).toBeVisible();
    await page.locator('.quick-create-list button').filter({ hasText: 'Circle' }).click();
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
    await expect(page.locator('[data-edge-id]')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-node-id]')).toHaveCount(1);
    await expect(page.locator('[data-edge-id]')).toHaveCount(0);
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

  test('imports an SQL schema and exposes ERD export actions', async ({ page }) => {
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'schema.sql',
      mimeType: 'text/sql',
      buffer: Buffer.from('CREATE TABLE customers (id uuid PRIMARY KEY); CREATE TABLE orders (customer_id uuid REFERENCES customers (id));'),
    });
    await expect(page.locator('.editor-shell')).toBeVisible();
    await expect(page.locator('.node-entity-title')).toHaveCount(2);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('button', { name: 'SQL schema (.sql)' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Export area' })).toBeVisible();
    await page.getByRole('button', { name: 'Page', exact: true }).click();
    await expect(page.getByRole('button', { name: 'PDF · all pages' })).toBeVisible();
  });

  test('opens diagnostics and focuses a semantic DFD problem', async ({ page }) => {
    await page.getByRole('button', { name: 'Data flow diagram See information in motion 3 elements · 2 flows' }).click();
    await page.locator('.canvas-node').filter({ hasText: 'Manage order' }).click();
    await page.getByLabel('Label').fill('');
    await expect(page.locator('.diagnostics-button')).toContainText('Diagnostics');
    await page.locator('.diagnostics-button').click();
    await expect(page.locator('.diagnostics-panel')).toBeVisible();
    await expect(page.locator('.diagnostic-row')).toContainText('missing a name');
    await page.locator('.diagnostic-main').first().click();
    await expect(page.locator('.diagnostics-panel')).toBeVisible();
  });

  test('edits a DFD page data dictionary', async ({ page }) => {
    await page.getByRole('button', { name: 'Data flow diagram See information in motion 3 elements · 2 flows' }).click();
    await expect(page.getByText('DFD level 0 · 0 dictionary entries')).toBeVisible();
    await page.getByRole('button', { name: 'Add data dictionary entry', exact: true }).click();
    await page.getByLabel('Data dictionary entry 1 name').fill('Order details');
    await page.getByLabel('Data dictionary entry 1 type').fill('Order');
    await page.getByLabel('Data dictionary entry 1 description').fill('Customer order submitted for processing.');
    await expect(page.getByText('DFD level 0 · 1 dictionary entries')).toBeVisible();
    await expect(page.getByLabel('Data dictionary entry 1 name')).toHaveValue('Order details');
    for (let index = 0; index < 4; index += 1) await page.getByTitle('Undo (⌘Z)').click();
    await expect(page.getByText('DFD level 0 · 0 dictionary entries')).toBeVisible();
  });

  test('creates an undoable child page from a DFD process', async ({ page }) => {
    await page.getByRole('button', { name: 'Data flow diagram See information in motion 3 elements · 2 flows' }).click();
    await page.locator('.canvas-node').filter({ hasText: 'Manage order' }).click();
    await page.getByRole('button', { name: 'Create child DFD page' }).click();
    await expect(page.locator('.page-tab')).toHaveCount(2);
    await expect(page.locator('.page-tab').last()).toContainText('Manage order');
    await page.locator('.diagnostics-button').click();
    await expect(page.locator('.diagnostics-panel')).toBeVisible();
    await expect(page.locator('.diagnostic-row')).toHaveCount(2);
    await page.getByTitle('Undo (⌘Z)').click();
    await expect(page.locator('.page-tab')).toHaveCount(1);
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
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const node = page.locator('[data-node-id]').first();
    await node.dblclick();
    const editor = page.locator('.canvas-text-editor');
    await expect(editor).toBeVisible();
    await editor.pressSequentially('Multiple words');
    await expect(editor).toHaveValue('Multiple words');
    await editor.press('Enter');
    await expect(node.locator('.node-label')).toHaveText('Multiple words');
  });

  test('opens direct text editing with Enter on the selected shape', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.locator('[data-node-id]').first().click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.canvas-text-editor')).toBeVisible();
    await page.locator('.canvas-text-editor').fill('Keyboard label');
    await page.keyboard.press('Escape');
    await expect(page.locator('.canvas-text-editor')).toHaveCount(0);
  });

  test('preserves an explicitly sized shape when editing a shorter label', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Diamond onto the canvas').click();
    const node = page.locator('[data-node-id]').first();
    await node.click();
    const height = page.getByRole('spinbutton', { name: 'Node height' });
    const initialHeight = await height.inputValue();
    await page.getByLabel('Label').fill('edited');
    await expect(height).toHaveValue(initialHeight);
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

  test('edits shared styling, wraps labels, and switches canvas theme', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    const canvas = page.locator('svg.diagram-canvas');
    const node = page.locator('[data-node-id]').first();
    await expect(page.getByLabel('Fill color picker')).toBeVisible();
    const initialBox = await node.boundingBox();
    await page.getByLabel('Text size').fill('20');
    await page.getByLabel('Label').fill('A deliberately long label that wraps onto several lines');
    const nextBox = await node.boundingBox();
    expect(nextBox?.height ?? 0).toBeGreaterThan(initialBox?.height ?? 0);
    await page.getByTitle('Page actions').click();
    await page.getByRole('button', { name: 'Use light canvas' }).click();
    await expect(canvas.locator('.canvas-background')).toHaveAttribute('fill', '#f6f7fb');
  });

  test('persists a per-shape default style and exposes paper presets', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await expect(page.getByLabel('Page size')).toBeVisible();
    await page.getByLabel('Page size').selectOption('a4');
    await expect(page.getByLabel('Page width')).toHaveValue('794');
    await page.getByLabel('Page orientation').selectOption('landscape');
    await expect(page.getByLabel('Page width')).toHaveValue('1123');
    await expect(page.locator('.page-boundary')).toHaveCount(1);

    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.getByLabel('Fill color picker').fill('#123456');
    await page.getByTitle(/Use this as the default rectangle style/).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await expect(page.locator('[data-node-id]').last().locator('rect').first()).toHaveAttribute('fill', '#123456');
  });

  test('customizes the view, library scope, and inspector layout', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await expect(page.getByText('Page settings · nothing selected')).toBeVisible();
    await expect(page.getByLabel('Grid size')).toBeVisible();

    await page.getByRole('button', { name: 'View', exact: true }).click();
    const rulersToggle = page.locator('.view-menu-toggle').filter({ hasText: 'Rulers' });
    await expect(rulersToggle).toBeVisible();
    await rulersToggle.click();
    await expect(page.locator('.canvas-ruler-top')).toBeHidden();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByLabel('Shape library category').selectOption('erd');
    await expect(page.getByTitle('Drag Entity onto the canvas')).toBeVisible();

    await page.getByTitle('Collapse left panel').click();
    await expect(page.locator('.shape-library')).toBeHidden();
    await page.getByLabel('Open workspace panel').click();
    await expect(page.locator('.shape-library')).toBeVisible();
    await page.getByTitle('Collapse properties panel').click();
    await expect(page.locator('.properties-panel')).toBeHidden();
    await page.getByLabel('Open properties panel').click();
    await expect(page.locator('.properties-panel')).toBeVisible();
    await page.getByLabel('More editor actions').click();
    await page.getByRole('button', { name: 'Inspect document', exact: true }).click();
    await expect(page.locator('.inspect-drawer')).toBeVisible();
    await page.getByLabel('Close inspector').click();

    const separator = page.getByRole('separator', { name: 'Resize right panel' });
    const separatorBox = await separator.boundingBox();
    expect(separatorBox).not.toBeNull();
    await page.mouse.move((separatorBox?.x ?? 0) + 3, (separatorBox?.y ?? 0) + 80);
    await page.mouse.down();
    await page.mouse.move((separatorBox?.x ?? 0) - 24, (separatorBox?.y ?? 0) + 80);
    await page.mouse.up();
    await expect.poll(() => page.locator('.properties-panel').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBeGreaterThan(232);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('aperglyph.editor.right-width'))).not.toBeNull();
  });

  test('creates and lists a named local snapshot', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.getByRole('button', { name: 'More editor actions' }).click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByText('Local snapshots')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept('Milestone'));
    await page.getByRole('button', { name: '+ Create named checkpoint' }).click();
    await expect(page.getByText('Milestone')).toBeVisible();
  });

  test('exports and restores the local workspace backup', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByTitle('Drag Rectangle onto the canvas').click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export workspace backup' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const chooserPromise = page.waitForEvent('filechooser');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Import workspace backup' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(downloadPath!);
    await expect(page.locator('.recent-card').filter({ hasText: 'Untitled diagram' })).toBeVisible();
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

  test('persists workspace thumbnails, favorites, rename, and trash restore', async ({ page }) => {
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    let card = page.locator('.recent-card').filter({ hasText: 'Untitled diagram' }).first();
    await expect(card.locator('.recent-preview img')).toBeVisible();
    await card.getByTitle('Favorite').click();
    await expect(card.getByTitle('Remove favorite')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept('Workspace diagram'));
    await card.getByTitle('Rename').click();
    card = page.locator('.recent-card').filter({ hasText: 'Workspace diagram' }).first();
    await expect(card).toBeVisible();
    await page.reload();
    card = page.locator('.recent-card').filter({ hasText: 'Workspace diagram' }).first();
    await expect(card.getByTitle('Remove favorite')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await card.getByTitle('Move Workspace diagram to trash').click();
    await expect(card).toHaveCount(0);
    await page.getByTitle('Show trash').click();
    const trashRow = page.locator('.trash-row').filter({ hasText: 'Workspace diagram' });
    await expect(trashRow).toBeVisible();
    await trashRow.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('.recent-card').filter({ hasText: 'Workspace diagram' })).toBeVisible();
  });
});
