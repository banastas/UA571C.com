import { test, expect, devices } from '@playwright/test';

test('boot copy is readable and the full boot surface dismisses', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot')).toBeVisible();
  await expect(page.locator('#bootLine')).toHaveText('INITIALIZING REMOTE LINK');
  await expect(page.locator('#skipBoot')).toHaveText('[ ESC ] SKIP INITIALIZATION');
  await expect(page.locator('#boot')).toHaveCSS('font-family', /GRiD TypeBlock 9x12/);
  await page.locator('#boot').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#boot')).toBeHidden();
  await expect(page.locator('#terminalUi')).toBeVisible();
});

test.describe('desktop terminal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#skipBoot').click();
    await expect(page.locator('#terminalUi')).toBeVisible();
    await expect(page.locator('#boot')).toBeHidden();
  });

  test('boots, fires directly from SAFE, reloads, runs diagnostics, and opens commands', async ({ page }) => {
    const browserErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', error => browserErrors.push(error.message));

    await expect(page.locator('#ammoOutput')).toHaveText('500');
    await expect(page.locator('#weaponOptions .selected')).toHaveText('SAFE');

    await page.keyboard.down('Space');
    await page.waitForTimeout(260);
    await page.keyboard.up('Space');
    await expect(page.locator('#telemetryView')).toBeVisible();
    await expect(page.locator('#configurationView')).toBeHidden();
    await expect.poll(async () => Number(await page.locator('#ammoOutput').textContent())).toBeLessThan(500);
    await expect(page.locator('#weaponOptions .selected')).toHaveText('ARMED');
    await expect(page.locator('#iffOptions .selected')).toHaveText('ENGAGED');

    await page.keyboard.press('KeyR');
    await expect(page.locator('#ammoOutput')).toHaveText('500');

    await page.keyboard.press('KeyT');
    await expect(page.locator('#activityOutput')).toContainText('TEST COMPLETE', { timeout: 4_000 });

    await page.keyboard.press('Shift+/');
    await expect(page.locator('#helpDialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#helpDialog')).toBeHidden();
    expect(browserErrors).toEqual([]);

    if (process.env.CAPTURE_PREVIEWS) {
      await page.locator('.terminal-frame').screenshot({ path: 'preview-config.png' });
    }
  });

  test('every terminal screen uses a readable GRiD face', async ({ page }) => {
    await expect(page.locator('#configurationView .configuration')).toHaveCSS('font-family', /GRiD TypeBlock 9x12/);

    await page.keyboard.press('KeyV');
    await expect(page.locator('#telemetryView .readouts')).toHaveCSS('font-family', /GRiD TypeBlock 24x32/);
    await expect(page.locator('#telemetryView .ammo-copy p')).toHaveCSS('font-family', /GRiD TypeBlock 9x12/);

    await page.keyboard.press('Shift+/');
    await expect(page.locator('#helpDialog')).toBeVisible();
    await expect(page.locator('#helpDialog')).toHaveCSS('font-family', /GRiD TypeBlock 9x12/);
    await expect(page.locator('#helpTitle')).toHaveText('KEYBOARD COMMANDS');
    await expect(page.locator('#helpDialog')).toContainText('Cycle the corresponding selector');
    await expect(page.locator('#helpDialog')).toContainText('Fan-made interactive screen study');
    if (process.env.UA571C_CAPTURE_CONTROLS) {
      await page.locator('#helpDialog').screenshot({ path: '/tmp/ua571c-controls.png' });
    }
  });

  test('core controls expose accessible names', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'SAFE' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ARMED' })).toBeVisible();
    await page.keyboard.press('KeyV');
    await expect(page.getByRole('button', { name: /AUTO ENGAGE/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /SHOW COMMANDS/ })).toBeVisible();
  });

  test('E arms the SAFE sentry and starts automatic engagement', async ({ page }) => {
    await expect(page.locator('#weaponOptions .selected')).toHaveText('SAFE');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#weaponOptions .selected')).toHaveText('ARMED');
    await expect(page.locator('#telemetryView')).toBeVisible();
    await expect(page.locator('#engageControl')).toHaveText('[ E ] CEASE AUTO');
    await expect(page.locator('#activityOutput')).toContainText('AUTO SEARCH');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#engageControl')).toHaveText('[ E ] AUTO ENGAGE');
  });

  test('film-facing telemetry labels stay on their intended lines and inside the screen', async ({ page }) => {
    await page.keyboard.press('KeyV');
    await expect(page.locator('#telemetryView')).toBeVisible();

    const layout = await page.evaluate(() => {
      const screen = document.querySelector('#telemetryView').getBoundingClientRect();
      const textInsideScreen = (selector) => {
        const element = document.querySelector(selector);
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        return rect.left >= screen.left && rect.right <= screen.right &&
          rect.top >= screen.top && rect.bottom <= screen.bottom;
      };
      const firstLineRectCount = (selector) => {
        const node = document.querySelector(selector).firstChild;
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects().length;
      };

      return {
        ammoInside: textInsideScreen('.ammo-copy p'),
        timeInside: textInsideScreen('.time-readout p'),
        roundelsInside: [...document.querySelectorAll('#telemetryView .roundel')]
          .every((roundel) => {
            const rect = roundel.getBoundingClientRect();
            return rect.left >= screen.left && rect.right <= screen.right;
          }),
        timeFirstLineRects: firstLineRectCount('.time-readout p'),
        roundelWidth: document.querySelector('#telemetryView .roundel').getBoundingClientRect().width,
        roundelGlyphsInside: [...document.querySelectorAll('#telemetryView .roundel')]
          .every((roundel) => {
            const circle = roundel.getBoundingClientRect();
            const glyph = roundel.querySelector('span').getBoundingClientRect();
            return glyph.left >= circle.left && glyph.right <= circle.right &&
              glyph.top >= circle.top && glyph.bottom <= circle.bottom;
          }),
        rpmLabel: document.querySelector('.rpm-label').textContent,
        rpmGap: (() => {
          const glyphs = [...document.querySelectorAll('.rpm-label span')]
            .map((glyph) => glyph.getBoundingClientRect());
          return glyphs[2].left - glyphs[1].right;
        })(),
      };
    });

    expect(layout.ammoInside).toBe(true);
    expect(layout.timeInside).toBe(true);
    expect(layout.roundelsInside).toBe(true);
    expect(layout.timeFirstLineRects).toBe(1);
    expect(layout.roundelWidth).toBeGreaterThanOrEqual(90);
    expect(layout.roundelGlyphsInside).toBe(true);
    expect(layout.rpmLabel).toBe('R(M)');
    expect(layout.rpmGap).toBeLessThan(4);
  });

  test('time counter compacts the fixed-width decimal cell at every value', async ({ page }) => {
    await page.keyboard.press('KeyV');
    await expect(page.locator('#timeOutput')).toHaveText('33.33');

    const decimalLayout = async () => page.locator('#timeOutput').evaluate((output) => {
      const decimal = output.querySelector('.time-decimal').getBoundingClientRect();
      const fraction = output.querySelector('#timeFraction').getBoundingClientRect();
      const fontSize = Number.parseFloat(getComputedStyle(output).fontSize);
      return {
        fractionOffset: fraction.left - decimal.left,
        fontSize,
        accessibleValue: output.getAttribute('aria-label'),
      };
    });

    let layout = await decimalLayout();
    expect(layout.fractionOffset).toBeLessThan(layout.fontSize * .45);
    expect(layout.accessibleValue).toBe('33.33 seconds of ammunition remaining');

    await page.locator('#fireControl').evaluate((button) => {
      for (let round = 0; round < 42; round += 1) {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
      }
    });
    await expect(page.locator('#timeOutput')).toHaveText('30.53');
    layout = await decimalLayout();
    expect(layout.fractionOffset).toBeLessThan(layout.fontSize * .45);
    expect(layout.accessibleValue).toBe('30.53 seconds of ammunition remaining');
  });

  test('critical warning appears at 50 rounds and alternates polarity', async ({ page }) => {
    await page.keyboard.press('Digit2');
    await page.keyboard.press('KeyV');
    await page.locator('#fireControl').evaluate((button) => {
      for (let round = 0; round < 254; round += 1) {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
      }
    });

    await expect(page.locator('#ammoOutput')).toHaveText('246');
    await expect(page.locator('#timeOutput')).toHaveText('16.40');
    if (process.env.CAPTURE_PREVIEWS) {
      // Capture the exact film-reference moment as an in-progress burst.
      await page.locator('#rpmGauge').evaluate((gauge) => gauge.style.height = '25%');
      await page.waitForTimeout(160);
      await page.locator('.terminal-frame').screenshot({ path: 'preview.png' });
    }

    await page.locator('#fireControl').evaluate((button) => {
      for (let round = 0; round < 196; round += 1) {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
      }
    });

    await expect(page.locator('#ammoOutput')).toHaveText('050');
    await expect(page.locator('#timeOutput')).toHaveText('3.33');
    await expect(page.locator('#criticalWarning')).toBeVisible();
    await expect(page.locator('#criticalWarning span')).toHaveCSS('animation-name', 'critical-polarity');
  });
});

test('touch controls fire and the terminal remains within the mobile viewport', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto('/');
  await page.locator('#skipBoot').tap();
  await expect(page.locator('#terminalUi')).toBeVisible();
  await expect(page.locator('#boot')).toBeHidden();
  await page.locator('#weaponOptions [data-value="ARMED"]').tap();
  await page.locator('[data-command="view"]').tap();
  await page.locator('#fireControl').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await page.waitForTimeout(180);
  await page.locator('#fireControl').dispatchEvent('pointerup', { pointerType: 'touch' });
  await expect.poll(async () => Number(await page.locator('#ammoOutput').textContent())).toBeLessThan(500);

  const frame = await page.locator('.terminal-frame').boundingBox();
  const compactDecimal = await page.locator('#timeOutput').evaluate((output) => {
    const decimal = output.querySelector('.time-decimal').getBoundingClientRect();
    const fraction = output.querySelector('#timeFraction').getBoundingClientRect();
    const fontSize = Number.parseFloat(getComputedStyle(output).fontSize);
    return fraction.left - decimal.left < fontSize * .45;
  });
  const viewport = page.viewportSize();
  expect(frame).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(compactDecimal).toBe(true);
  expect(browserErrors).toEqual([]);
  if (process.env.CAPTURE_PREVIEWS) {
    await page.locator('.terminal-frame').screenshot({ path: 'preview-mobile.png' });
  }
  await context.close();
});

for (const deviceName of ['iPhone 13', 'iPad Pro 11']) {
  test(`${deviceName} portrait mode requires landscape`, async ({ browser }) => {
    const context = await browser.newContext({ ...devices[deviceName] });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('#orientationLock')).toBeVisible();
    await expect(page.locator('#orientationLock')).toContainText('ROTATE DEVICE');
    await expect(page.locator('#orientationLock')).toContainText('LANDSCAPE MODE REQUIRED');
    await expect(page.locator('#orientationLock .orientation-device')).toBeVisible();
    await expect(page.locator('#orientationLock .orientation-mark')).toHaveCount(0);
    await expect(page.locator('.stage')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-display-orientation', 'portrait');
    if (process.env.UA571C_CAPTURE_ORIENTATION && deviceName === 'iPhone 13') {
      await page.screenshot({ path: '/tmp/ua571c-orientation.png' });
    }

    const portrait = page.viewportSize();
    await page.setViewportSize({ width: portrait.height, height: portrait.width });
    await expect(page.locator('#orientationLock')).toBeHidden();
    await expect(page.locator('.stage')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-display-orientation', 'landscape');
    await context.close();
  });
}

test('synchronized orientation state controls one unambiguous rotation warning', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    document.documentElement.dataset.displayOrientation = 'portrait';
  });
  await expect(page.locator('#orientationLock')).toBeVisible();
  await expect(page.locator('#orientationLock .orientation-device')).toBeVisible();
  await expect(page.locator('#orientationLock .orientation-mark')).toHaveCount(0);
  await expect(page.locator('.stage')).toBeHidden();

  await page.evaluate(() => {
    document.documentElement.dataset.displayOrientation = 'landscape';
  });
  await expect(page.locator('#orientationLock')).toBeHidden();
  await expect(page.locator('.stage')).toBeVisible();
});

test('shallow touch landscape never exposes the portrait interlock', async ({ browser }) => {
  const context = await browser.newContext({
    ...devices['iPhone 13 landscape'],
    viewport: { width: 782, height: 360 }
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-display-orientation', 'landscape');
  await expect(page.locator('#orientationLock')).toBeHidden();
  await expect(page.locator('.stage')).toBeVisible();

  const layout = await page.evaluate(() => {
    const frame = document.querySelector('.terminal-frame').getBoundingClientRect();
    const operator = document.querySelector('.operator-panel').getBoundingClientRect();
    const hint = document.querySelector('.outside-hint').getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      visualViewport: {
        width: window.visualViewport?.width,
        height: window.visualViewport?.height
      },
      frame: { left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom, width: frame.width },
      operator: { left: operator.left, right: operator.right, top: operator.top, bottom: operator.bottom, width: operator.width },
      hint: { left: hint.left, right: hint.right, top: hint.top, bottom: hint.bottom },
      scrollY,
      overflowX: document.documentElement.scrollWidth - innerWidth
    };
  });

  expect(layout.frame.left).toBeGreaterThanOrEqual(0);
  expect(layout.frame.right).toBeLessThanOrEqual(layout.viewport.width + 0.5);
  expect(layout.frame.top).toBeGreaterThanOrEqual(0);
  expect(layout.hint.bottom).toBeLessThanOrEqual(layout.viewport.height + 0.5);
  expect(layout.operator.width).toBeCloseTo(layout.frame.width, 0);
  expect(layout.scrollY).toBe(0);
  expect(layout.overflowX).toBeLessThanOrEqual(0);
  expect(browserErrors).toEqual([]);
  await context.close();
});

test('rotating to portrait safely ceases automatic engagement', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('#skipBoot').tap();
  await page.locator('#engageControl').tap();
  await expect(page.locator('#engageControl')).toHaveText('[ E ] CEASE AUTO');

  const landscape = page.viewportSize();
  await page.setViewportSize({ width: landscape.height, height: landscape.width });
  await expect(page.locator('#orientationLock')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-display-orientation', 'portrait');
  await expect(page.locator('#engageControl')).toHaveText('[ E ] AUTO ENGAGE');
  await expect(page.locator('#activityDot')).not.toHaveClass(/active/);
  await context.close();
});

test('telemetry remains unclipped at the reported Safari viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1482, height: 971 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('#skipBoot').click();
  await expect(page.locator('#boot')).toBeHidden();
  await page.keyboard.press('KeyV');
  await expect(page.locator('#telemetryView')).toBeVisible();

  const bounds = await page.evaluate(() => {
    const screen = document.querySelector('#telemetryView').getBoundingClientRect();
    const textBounds = (selector) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(selector));
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      screen: { left: screen.left, right: screen.right, top: screen.top, bottom: screen.bottom },
      ammo: textBounds('.ammo-copy p'),
      time: textBounds('.time-readout p'),
    };
  });

  for (const label of [bounds.ammo, bounds.time]) {
    expect(label.left).toBeGreaterThanOrEqual(bounds.screen.left);
    expect(label.right).toBeLessThanOrEqual(bounds.screen.right);
    expect(label.top).toBeGreaterThanOrEqual(bounds.screen.top);
    expect(label.bottom).toBeLessThanOrEqual(bounds.screen.bottom);
  }
  await context.close();
});
