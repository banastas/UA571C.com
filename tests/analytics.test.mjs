import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  EVENT_PARAMETER_SCHEMA,
  MEASUREMENT_ID,
  createAnalyticsRuntime,
  isProductionHost,
  normalizeEventParameters,
  sanitizePageLocation,
  sanitizeReferrer
} from '../src/analytics.mjs';

function browserFixture(hostname = 'ua571c.com', referrer = 'https://example.com/story?private=value#fragment') {
  const scripts = [];
  const browserDocument = {
    title: 'UA 571-C Remote Sentry System',
    referrer,
    head: { append: (element) => scripts.push(element) },
    createElement: () => ({ dataset: {} }),
    querySelector: (selector) => scripts.find((script) =>
      selector === `script[data-google-analytics="${script.dataset.googleAnalytics}"]`
    ) || null
  };
  const browserWindow = {
    location: {
      hostname,
      origin: `https://${hostname}`,
      href: `https://${hostname}/?private=value#fragment`
    }
  };
  return { browserDocument, browserWindow, scripts };
}

function commands(browserWindow) {
  return (browserWindow.dataLayer || []).map((entry) => Array.from(entry));
}

test('analytics only initializes on approved production hosts', () => {
  assert.equal(isProductionHost('ua571c.com'), true);
  assert.equal(isProductionHost('WWW.UA571C.COM'), true);
  assert.equal(isProductionHost('localhost'), false);
  assert.equal(isProductionHost('ua571c.pages.dev'), false);

  const fixture = browserFixture('localhost');
  const runtime = createAnalyticsRuntime(fixture);
  assert.equal(runtime.initialize(), false);
  assert.equal(fixture.scripts.length, 0);
  assert.equal(fixture.browserWindow.dataLayer, undefined);
});

test('production initialization loads one tag and queues one sanitized page view', () => {
  const fixture = browserFixture();
  const runtime = createAnalyticsRuntime(fixture);

  assert.equal(runtime.initialize({ pagePath: '/?private=value#fragment' }), true);
  assert.equal(runtime.initialize({ pagePath: '/ignored' }), false);
  assert.equal(fixture.scripts.length, 1);
  assert.equal(fixture.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
  assert.equal(Array.isArray(fixture.browserWindow.dataLayer[0]), false, 'gtag queues its arguments object');

  const queued = commands(fixture.browserWindow);
  const config = queued.find(([command]) => command === 'config');
  const pageView = queued.find(([command, name]) => command === 'event' && name === 'page_view');
  assert.equal(config[1], MEASUREMENT_ID);
  assert.equal(config[2].send_page_view, false);
  assert.equal(config[2].allow_google_signals, false);
  assert.equal(config[2].allow_ad_personalization_signals, false);
  assert.equal(pageView[2].page_location, 'https://ua571c.com/');
  assert.equal(pageView[2].page_referrer, 'https://example.com');
  assert.equal(queued.filter(([command, name]) => command === 'event' && name === 'page_view').length, 1);
});

test('event parameters are allowlisted, bounded, and scalar', () => {
  const oversized = 'x'.repeat(140);
  assert.deepEqual(normalizeEventParameters('terminal_firing_ended', {
    engagement_mode: 'manual',
    stop_reason: oversized,
    rounds_fired: Number.POSITIVE_INFINITY,
    raw_query: '?email=person@example.com',
    nested: { unsafe: true }
  }), {
    engagement_mode: 'manual',
    stop_reason: 'x'.repeat(100)
  });
  assert.equal(normalizeEventParameters('unregistered_event', { value: 1 }), null);
});

test('runtime rejects unregistered events and strips unexpected parameters', () => {
  const fixture = browserFixture();
  const runtime = createAnalyticsRuntime(fixture);
  runtime.initialize();
  const before = commands(fixture.browserWindow).length;

  assert.equal(runtime.trackEvent('unregistered_event', { value: 1 }), false);
  assert.equal(commands(fixture.browserWindow).length, before);
  assert.equal(runtime.trackEvent('terminal_configuration_changed', {
    control_name: 'weapon',
    selected_value: 'armed',
    input_method: 'keyboard',
    private_value: 'discard me'
  }), true);

  const event = commands(fixture.browserWindow).at(-1);
  assert.deepEqual(event, ['event', 'terminal_configuration_changed', {
    control_name: 'weapon',
    selected_value: 'armed',
    input_method: 'keyboard'
  }]);
});

test('URL sanitizers remove queries, fragments, and external referrer paths', () => {
  assert.equal(sanitizePageLocation('https://ua571c.com/path?token=secret#part'), 'https://ua571c.com/path');
  assert.equal(sanitizePageLocation('javascript:alert(1)'), '');
  assert.equal(sanitizeReferrer('https://ua571c.com/config?private=yes', 'https://ua571c.com'), 'https://ua571c.com/config');
  assert.equal(sanitizeReferrer('https://example.com/private/path?token=yes', 'https://ua571c.com'), 'https://example.com');
});

test('every registered custom event is wired into the application', async () => {
  const app = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
  for (const eventName of Object.keys(EVENT_PARAMETER_SCHEMA)) {
    assert.match(app, new RegExp(`['"]${eventName}['"]`), eventName);
  }
});
