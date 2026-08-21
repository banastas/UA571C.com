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

test('analytics stays completely silent on localhost', async ({ page }) => {
  const googleRequests = [];
  page.on('request', (request) => {
    if (/google-analytics|googletagmanager/.test(request.url())) googleRequests.push(request.url());
  });

  await page.goto('/?private=value#fragment');
  await page.locator('#skipBoot').click();
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyV');

  const runtime = await page.evaluate(() => ({
    dataLayer: window.dataLayer,
    gtagType: typeof window.gtag
  }));
  expect(runtime.dataLayer).toBeUndefined();
  expect(runtime.gtagType).toBe('undefined');
  expect(googleRequests).toEqual([]);
});

test('production runtime queues sanitized page and terminal events', async ({ browser, request }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.route('https://www.googletagmanager.com/**', async (route) => {
    await route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  await page.route('https://ua571c.com/**', async (route) => {
    const url = new URL(route.request().url());
    const localResponse = await request.get(`http://127.0.0.1:4173${url.pathname}`);
    await route.fulfill({ response: localResponse });
  });

  await page.goto('https://ua571c.com/?private=value#fragment');
  await page.locator('#skipBoot').click();
  await page.locator('#weaponOptions [data-value="ARMED"]').click();
  await page.keyboard.press('KeyV');
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);
  await page.keyboard.up('Space');
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Shift+/');

  const queued = await page.evaluate(() => window.dataLayer.map((entry) => Array.from(entry)));
  const config = queued.find(([command]) => command === 'config');
  const events = queued.filter(([command]) => command === 'event');
  const eventNames = events.map(([, name]) => name);
  const firingEnded = events.find(([, name]) => name === 'terminal_firing_ended');

  expect(config[1]).toBe('G-T97SY9N13B');
  expect(config[2].page_location).toBe('https://ua571c.com/');
  expect(config[2].page_location).not.toContain('private');
  expect(config[2].send_page_view).toBe(false);
  expect(eventNames).toEqual(expect.arrayContaining([
    'page_view',
    'terminal_boot_completed',
    'terminal_configuration_changed',
    'terminal_view_changed',
    'terminal_firing_started',
    'terminal_firing_ended',
    'terminal_reloaded',
    'terminal_help_opened'
  ]));
  expect(firingEnded[2].rounds_fired).toBeGreaterThan(0);
  await context.close();
});

test('production 404 reports one canonical page view instead of the requested path', async ({ browser, request }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.route('https://www.googletagmanager.com/**', async (route) => {
    await route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  await page.route('https://ua571c.com/**', async (route) => {
    const url = new URL(route.request().url());
    const localPath = url.pathname === '/missing/private-value' ? '/404.html' : url.pathname;
    const localResponse = await request.get(`http://127.0.0.1:4173${localPath}`);
    await route.fulfill({ response: localResponse });
  });

  await page.goto('https://ua571c.com/missing/private-value?email=person@example.com#fragment');
  await expect(page.getByRole('heading', { name: 'Remote Link Lost' })).toBeVisible();
  const queued = await page.evaluate(() => window.dataLayer.map((entry) => Array.from(entry)));
  const pageViews = queued.filter(([command, name]) => command === 'event' && name === 'page_view');

  expect(pageViews).toHaveLength(1);
  expect(pageViews[0][2].page_location).toBe('https://ua571c.com/404');
  expect(JSON.stringify(pageViews[0])).not.toContain('person@example.com');
  expect(JSON.stringify(pageViews[0])).not.toContain('private-value');
  await context.close();
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

    const warningSpacing = await page.evaluate(() => {
      const copyAbove = document.querySelector('.orientation-panel p').getBoundingClientRect();
      const deviceStage = document.querySelector('.orientation-device-stage').getBoundingClientRect();
      const copyBelow = document.querySelector('.orientation-panel strong').getBoundingClientRect();
      return {
        above: deviceStage.top - copyAbove.bottom,
        below: copyBelow.top - deviceStage.bottom
      };
    });
    expect(warningSpacing.above).toBeGreaterThanOrEqual(12);
    expect(warningSpacing.below).toBeGreaterThanOrEqual(12);

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

test('configuration scales inside a wide, shallow Safari landscape', async ({ browser }) => {
  const context = await browser.newContext({
    ...devices['iPhone 13 landscape'],
    viewport: { width: 874, height: 390 }
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto('/');
  await page.locator('#skipBoot').tap();
  await expect(page.locator('#configurationView')).toBeVisible();
  await expect(page.locator('#orientationLock')).toBeHidden();

  const layout = await page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const textRect = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = range.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };

    const header = document.querySelector('#configurationView .system-header');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      frame: rect(document.querySelector('.terminal-frame')),
      hint: rect(document.querySelector('.outside-hint')),
      header: rect(header),
      headerText: textRect(header.querySelector('h1')),
      cells: [...document.querySelectorAll('#configurationView .config-cell')].map((cell) => {
        const heading = cell.querySelector('h2');
        return {
          outer: rect(cell),
          heading: rect(heading),
          headingText: textRect(heading),
          options: [...cell.querySelectorAll('button')].map((button) => ({
            outer: rect(button),
            text: textRect(button)
          }))
        };
      }),
      scrollY,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      overflowY: document.documentElement.scrollHeight - innerHeight
    };
  });

  const expectInside = (inner, outer) => {
    expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.5);
    expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
    expect(inner.top).toBeGreaterThanOrEqual(outer.top - 0.5);
    expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 0.5);
  };

  expect(layout.frame.top).toBeGreaterThanOrEqual(0);
  expect(layout.hint.bottom).toBeLessThanOrEqual(layout.viewport.height + 0.5);
  expectInside(layout.headerText, layout.header);
  layout.cells.forEach((cell) => {
    expectInside(cell.headingText, cell.heading);
    expectInside(cell.headingText, cell.outer);
    cell.options.forEach((option) => {
      expectInside(option.text, option.outer);
      expectInside(option.text, cell.outer);
    });
  });
  expect(layout.scrollY).toBe(0);
  expect(layout.overflowX).toBeLessThanOrEqual(0);
  expect(layout.overflowY).toBeLessThanOrEqual(0);
  expect(browserErrors).toEqual([]);
  await context.close();
});

test('live telemetry scales inside a wide, shallow Safari landscape', async ({ browser }) => {
  const context = await browser.newContext({
    ...devices['iPhone 13 landscape'],
    viewport: { width: 874, height: 390 }
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto('/');
  await page.locator('#skipBoot').tap();
  await page.locator('[data-command="view"]').tap();
  await expect(page.locator('#telemetryView')).toBeVisible();
  await expect(page.locator('#orientationLock')).toBeHidden();

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const textRect = (selector) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(selector));
      const box = range.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };

    return {
      viewport: { width: innerWidth, height: innerHeight },
      frame: rect('.terminal-frame'),
      hint: rect('.outside-hint'),
      header: rect('.telemetry-header'),
      headerText: textRect('.telemetry-header h2'),
      ammoCopy: textRect('.ammo-copy p'),
      ammoOutput: rect('.ammo-readout output'),
      ammoOutputText: textRect('.ammo-readout output'),
      timeCopy: textRect('.time-readout p'),
      timeOutput: rect('.time-readout output'),
      timeOutputText: textRect('.time-readout output'),
      meters: [...document.querySelectorAll('.meter')].map((meter) => {
        const outer = meter.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(meter.querySelector('p'));
        const label = range.getBoundingClientRect();
        return {
          outer: { left: outer.left, right: outer.right, top: outer.top, bottom: outer.bottom },
          label: { left: label.left, right: label.right, top: label.top, bottom: label.bottom }
        };
      }),
      scrollY,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      overflowY: document.documentElement.scrollHeight - innerHeight
    };
  });

  const expectInside = (inner, outer) => {
    expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.5);
    expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
    expect(inner.top).toBeGreaterThanOrEqual(outer.top - 0.5);
    expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 0.5);
  };

  expect(layout.frame.top).toBeGreaterThanOrEqual(0);
  expect(layout.hint.bottom).toBeLessThanOrEqual(layout.viewport.height + 0.5);
  expectInside(layout.headerText, layout.header);
  expectInside(layout.ammoOutputText, layout.ammoOutput);
  expectInside(layout.timeOutputText, layout.timeOutput);
  expect(layout.ammoCopy.right).toBeLessThanOrEqual(layout.ammoOutput.left + 0.5);
  expect(layout.timeCopy.right).toBeLessThanOrEqual(layout.timeOutput.left + 0.5);
  layout.meters.forEach(({ label, outer }) => expectInside(label, outer));
  expect(layout.scrollY).toBe(0);
  expect(layout.overflowX).toBeLessThanOrEqual(0);
  expect(layout.overflowY).toBeLessThanOrEqual(0);
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
