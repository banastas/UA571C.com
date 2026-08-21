export const MEASUREMENT_ID = 'G-T97SY9N13B';

const PRODUCTION_HOSTS = new Set(['ua571c.com', 'www.ua571c.com']);
const MAX_PARAMETER_LENGTH = 100;

export const EVENT_PARAMETER_SCHEMA = Object.freeze({
  terminal_boot_completed: ['completion_method', 'elapsed_msec'],
  terminal_configuration_changed: ['control_name', 'selected_value', 'input_method'],
  terminal_view_changed: ['view_name', 'input_method'],
  terminal_test_started: ['test_routine', 'input_method'],
  terminal_test_completed: ['test_routine'],
  terminal_firing_started: ['engagement_mode', 'input_method'],
  terminal_firing_ended: ['engagement_mode', 'stop_reason', 'rounds_fired'],
  terminal_auto_engage_changed: ['enabled', 'input_method'],
  terminal_reloaded: ['input_method'],
  terminal_sound_changed: ['enabled', 'input_method'],
  terminal_fullscreen_changed: ['fullscreen_state', 'input_method'],
  terminal_help_opened: ['input_method'],
  terminal_fault: ['fault_type'],
  orientation_interlock_shown: ['orientation'],
  orientation_interlock_cleared: ['orientation']
});

export function isProductionHost(hostname = '') {
  return PRODUCTION_HOSTS.has(String(hostname).toLowerCase());
}

export function sanitizePageLocation(value, fallbackOrigin = 'https://ua571c.com') {
  try {
    const url = new URL(value, fallbackOrigin);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

export function sanitizeReferrer(value, pageOrigin) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin === pageOrigin ? `${url.origin}${url.pathname}` : url.origin;
  } catch {
    return '';
  }
}

export function normalizeEventParameters(eventName, parameters = {}) {
  const allowedKeys = EVENT_PARAMETER_SCHEMA[eventName];
  if (!allowedKeys || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null;

  const normalized = {};
  for (const key of allowedKeys) {
    const value = parameters[key];
    if (typeof value === 'string') {
      const clean = value.trim().slice(0, MAX_PARAMETER_LENGTH);
      if (clean) normalized[key] = clean;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[key] = Math.max(-1_000_000, Math.min(1_000_000, value));
    } else if (typeof value === 'boolean') {
      normalized[key] = value;
    }
  }
  return normalized;
}

export function createAnalyticsRuntime({
  browserWindow = globalThis.window,
  browserDocument = globalThis.document
} = {}) {
  let configured = false;
  let pageViewSent = false;
  let pagePath = '/';
  let pageTitle = browserDocument?.title || 'UA 571-C Remote Sentry System';

  function isProduction() {
    return isProductionHost(browserWindow?.location?.hostname);
  }

  function ensureCommandQueue() {
    if (!browserWindow) return false;
    browserWindow.dataLayer ||= [];
    if (typeof browserWindow.gtag !== 'function') {
      browserWindow.gtag = function gtag() {
        browserWindow.dataLayer.push(arguments);
      };
    }
    return true;
  }

  function safePageLocation() {
    const origin = browserWindow?.location?.origin || 'https://ua571c.com';
    return sanitizePageLocation(pagePath, origin);
  }

  function configureTag() {
    if (!isProduction() || !ensureCommandQueue()) return false;

    if (configured) return true;

    const selector = `script[data-google-analytics="${MEASUREMENT_ID}"]`;
    if (!browserDocument?.querySelector(selector)) {
      const script = browserDocument?.createElement('script');
      if (!script) return false;
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
      script.dataset.googleAnalytics = MEASUREMENT_ID;
      browserDocument.head?.append(script);
    }

    const pageOrigin = browserWindow.location.origin;
    browserWindow.gtag('js', new Date());
    browserWindow.gtag('config', MEASUREMENT_ID, {
      allow_ad_personalization_signals: false,
      allow_google_signals: false,
      page_location: safePageLocation(),
      page_referrer: sanitizeReferrer(browserDocument?.referrer, pageOrigin),
      send_page_view: false
    });
    configured = true;
    return true;
  }

  function sendPageView() {
    if (pageViewSent || !configureTag()) return false;
    browserWindow.gtag('event', 'page_view', {
      page_location: safePageLocation(),
      page_referrer: sanitizeReferrer(browserDocument?.referrer, browserWindow.location.origin),
      page_title: pageTitle
    });
    pageViewSent = true;
    return true;
  }

  function initialize(options = {}) {
    pagePath = options.pagePath || '/';
    pageTitle = options.pageTitle || browserDocument?.title || pageTitle;
    if (!configureTag()) return false;
    return sendPageView();
  }

  function trackEvent(eventName, parameters = {}) {
    if (!configureTag()) return false;
    const normalized = normalizeEventParameters(eventName, parameters);
    if (!normalized) return false;
    browserWindow.gtag('event', eventName, normalized);
    return true;
  }

  return Object.freeze({
    initialize,
    isProduction,
    trackEvent
  });
}

export const analytics = createAnalyticsRuntime();
