# Analytics contract

UA571C.com uses Google Analytics 4 measurement ID `G-T97SY9N13B` to measure the terminal journey and its interactive controls.

## Runtime and privacy boundary

- `src/analytics.mjs` is the only code allowed to load `gtag.js` or send events.
- Analytics loads automatically only on `ua571c.com` and `www.ua571c.com`. Local development, test runs, and hosting previews stay silent.
- The shared runtime strips query strings and fragments from page locations. Same-site referrers retain only origin and path; external referrers retain only their origin.
- Event names and parameters are allowlisted. Arrays, objects, non-finite numbers, unexpected keys, and values over 100 characters are rejected or normalized before transmission.
- Google Signals and ad-personalization signals are disabled in the tag configuration.
- No free text, URL query, browser storage, synthesized audio state, or fault stack is sent. Configuration values are the fixed fictional selector choices visible in the interface.
- Per-round firing ticks are never events. A firing burst produces one start and one end event, with at most the bounded number of fictional rounds used.
- By product direction, the site does not display a consent prompt or preference control. Standard GA4 collection therefore begins automatically on the approved production hosts.

The Content Security Policy permits only Google's tag loader plus the two GA4 collection endpoints used by this implementation. The 404 page imports the same runtime and reports a fixed `/404` page location so arbitrary missing paths cannot enter analytics.

## Event taxonomy

| Event | Trigger | Parameters |
| --- | --- | --- |
| `page_view` | Main terminal or 404 view | GA page title plus sanitized location/referrer |
| `terminal_boot_completed` | Boot ends automatically or is skipped | `completion_method`, `elapsed_msec` |
| `terminal_configuration_changed` | A selector is clicked or cycled | `control_name`, `selected_value`, `input_method` |
| `terminal_view_changed` | Configuration/live view is explicitly switched | `view_name`, `input_method` |
| `terminal_test_started` | Diagnostic routine begins | `test_routine`, `input_method` |
| `terminal_test_completed` | Diagnostic routine completes | `test_routine` |
| `terminal_firing_started` | A manual or automatic burst begins | `engagement_mode`, `input_method` |
| `terminal_firing_ended` | A firing burst stops | `engagement_mode`, `stop_reason`, `rounds_fired` |
| `terminal_auto_engage_changed` | Automatic engagement starts or stops | `enabled`, `input_method` |
| `terminal_reloaded` | The system is reloaded and cooled | `input_method` |
| `terminal_sound_changed` | Synthesized terminal sound is toggled | `enabled`, `input_method` |
| `terminal_fullscreen_changed` | Fullscreen is entered or exited | `fullscreen_state`, `input_method` |
| `terminal_help_opened` | Command help opens | `input_method` |
| `terminal_fault` | Ammunition, thermal, or fullscreen fault occurs | `fault_type` |
| `orientation_interlock_shown` | A coarse-pointer device enters portrait | `orientation` |
| `orientation_interlock_cleared` | The device returns to landscape | `orientation` |

## GA4 property setup

Code deployment sends custom parameters, but GA4 reporting requires separate property definitions. Audit the property for existing definitions before creating these event-scoped custom dimensions:

`completion_method`, `control_name`, `selected_value`, `input_method`, `view_name`, `test_routine`, `engagement_mode`, `stop_reason`, `enabled`, `fullscreen_state`, `fault_type`, and `orientation`.

Register `elapsed_msec` and `rounds_fired` as event-scoped custom metrics. `terminal_firing_started` and `terminal_test_completed` are the strongest candidates for key events because they represent core interaction and successful diagnostic completion; key-event selection remains an analytics-property decision rather than a code-side assumption.

## Verification

Run:

```sh
npm run check
npm run test:browser
```

The tests cover production-host gating, queue shape, measurement ID, one manual page view, URL/referrer sanitization, event/parameter allowlists, and local silence. After deployment, verify the loaded script, `_ga` cookie, and `/g/collect` requests in an unblocked production browser, then confirm events and parameters in GA4 Realtime or DebugView. Source, tests, and deployed files alone do not prove that GA4 accepted a live event.
