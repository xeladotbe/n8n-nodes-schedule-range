# Project context for Claude Code

n8n community node: **Schedule Trigger (with Range)**. Like n8n's native
Schedule Trigger, but each Trigger Rule can have its own optional Start
Date / End Date - ticks outside that window are silently skipped.

## Architecture

Three files under `nodes/ScheduleTriggerRange/`, deliberately split so the
logic is testable without n8n itself:

- **`CronEngine.ts`** - a hand-written, dependency-free cron engine:
  parses 5/6-field cron expressions, computes next-run times, handles IANA
  timezones (via `Intl`, no library), and `CronScheduler` self-reschedules
  via `sleep()` from `n8n-workflow` (with an `AbortSignal` for
  cancellation) rather than raw `setTimeout`/`clearTimeout` - n8n's
  verified community-node lint rule (`no-restricted-globals`) forbids the
  raw timer globals. This exists *instead of* the `cron` npm package on
  purpose - see "Why no dependencies" below.
- **`RangeSchedule.ts`** - pure logic: turns a Trigger Rule (the UI's
  fixedCollection shape) into a cron expression string, the per-rule
  Start/End Date window checking (`isWithinRange`, `assertValidRange`),
  and the "every N weeks" check (`isInTriggerWeek` - plain cron has no
  field for week-of-year, so `weeksInterval` is applied separately at tick
  time rather than baked into the generated cron string).
- **`ScheduleTriggerRange.node.ts`** - the actual `INodeType`: UI property
  definitions and the `trigger()` method wiring the above two together.

Each `.ts` file has a co-located `.test.ts` (Jest). `RangeSchedule.ts` has
zero n8n imports, so its tests run in plain Node - no n8n instance needed.
`CronEngine.ts` (and its test file) import `sleep` from `n8n-workflow` for
the reason above, but this is just a type/utility import, not a running
n8n instance - its tests still run standalone. 74 tests total, all passing
as of this handoff.

## Commands

```bash
npm test          # Jest - run this after any change to CronEngine.ts / RangeSchedule.ts
npm run lint       # n8n's community-node linter - keep this at 0 errors, 0 warnings
npm run lint:fix   # autofixes what it can
npm run build      # tsc + copies icon assets to dist/
npm run dev        # starts a local n8n with this node loaded + hot reload - use this over
                    # manual .tgz-build-and-docker-cp for day-to-day development
```

## Why no runtime dependencies

n8n's community-node linter (`@n8n/community-nodes/no-runtime-dependencies`)
forbids a `dependencies` entry in `package.json`. The node originally used
the `cron` npm package; `CronEngine.ts` is a from-scratch replacement, kept
deliberately narrow in scope (numeric cron fields only - no month/weekday
names, no `L`/`W`/`#`) since that covers everything this node itself
generates plus the vast majority of hand-written expressions.

## Why cloud support is disabled

`eslint.config.mjs` uses `configWithoutCloudSupport`, and `package.json`
has `"strict": false`. This is a deliberate choice: n8n's Creator Portal
verification was attempted once (see "Verification attempt" below) and
abandoned as not worth the trade-offs for a small utility node, so the
stricter cloud/verified ruleset isn't worth enforcing locally either -
`configWithoutCloudSupport` matches what's actually being optimized for
(good UX, not verification eligibility).

Two findings from that attempt were kept anyway, since they're correct
independent of verification:

- `CronScheduler` (`CronEngine.ts`) uses `sleep()` from `n8n-workflow`
  (with an `AbortSignal` for cancellation) instead of raw
  `setTimeout`/`clearTimeout`. Functionally equivalent, just cleaner.
- `usableAsTool` is not set on the node class at all (trigger nodes can't
  be used as AI tools; n8n's own rule wanting every node to set it doesn't
  know that, hence the `eslint-disable-next-line` on the class
  declaration).

Everything else from that attempt - alphabetical field ordering and the
"Cadence"/"Custom Name"/"Window" relabelling used to work around it - was
reverted. See git history (commit "Fix n8n Creator Portal verification
failures" and its revert) if resuming verification later.

## Verification attempt

Submitted once to n8n's Creator Portal for community-node verification
(v0.1.1). The automated pre-check failed; fixing it required alphabetizing
the Trigger Rule fields (the verified scanner enforces this and ignores
`eslint-disable` comments) and relabelling fields to work around burying
the field-visibility selector mid-list, plus n8n also requires a short
screen-recorded demo video per submission. Decided the effort/UX trade-off
wasn't worth it for a small utility node - not currently pursuing
verification. The package remains fully installable via
`npm install n8n-nodes-schedule-range` or n8n's community-node installer
regardless of verified status.

## Known scope limits (see README's "Scope limitations" section)

`CronEngine.ts` supports numeric fields, lists, ranges, steps, `*`, and the
standard 3-letter month/weekday name aliases (`JAN`-`DEC`, `SUN`-`SAT`,
case-insensitive, via `replaceNamedAliases`) - but not special characters
(`L`, `W`, `#`) in the raw Cron Expression rule type. If extending this, add
tests to `CronEngine.test.ts` first (it already has good coverage of the
tricky cases: leap years, month/year rollover, the vixie-cron
day-of-month/day-of-week OR-semantics, and timezone conversion across a DST
boundary) - the timezone math in particular is easy to get subtly wrong.

## Publishing status

Published on npm as `n8n-nodes-schedule-range` (v0.1.2 as of this
handoff), repo at `github.com/xeladotbe/n8n-nodes-schedule-range` (default
branch `main`). npm Trusted Publisher is configured for
`.github/workflows/publish.yml`, so `npm run release` (bumps version,
tags, pushes) triggers an automatic OIDC-authenticated publish via GitHub
Actions - no manual `npm publish` needed for subsequent releases.

Not submitted for n8n's Creator Portal verification - see "Verification
attempt" above for why.

## Conventions this project follows

- Clean, modular separation of pure logic vs. n8n wiring (see
  Architecture above) - keep new logic in a plain-TS module with its own
  tests rather than inline in the `.node.ts` file where possible.
- UI property text and structure intentionally mirrors n8n's native
  Schedule Trigger where the two overlap (hints like "Must be in range
  1-59", the weekday multi-select, the Trigger-at-Hour dropdown with
  named presets) - the goal is that switching between the native trigger
  and this one feels familiar, not like relearning a UI.
