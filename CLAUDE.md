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
  via `setTimeout`. This exists *instead of* the `cron` npm package on
  purpose - see "Why no dependencies" below.
- **`RangeSchedule.ts`** - pure logic: turns a Trigger Rule (the UI's
  fixedCollection shape) into a cron expression string, and the per-rule
  Start/End Date range checking (`isWithinRange`, `assertValidRange`).
- **`ScheduleTriggerRange.node.ts`** - the actual `INodeType`: UI property
  definitions and the `trigger()` method wiring the above two together.

Each `.ts` file has a co-located `.test.ts` (Jest). `CronEngine.ts` and
`RangeSchedule.ts` have zero n8n imports, so their tests run in plain
Node - no n8n instance needed. 64 tests total, all passing as of this
handoff.

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
has `"strict": false`. This was a deliberate choice, not an oversight:
n8n's verification guidelines currently state flow-control nodes (which
this is - it doesn't integrate a third-party service) aren't accepted for
Cloud verification at all, regardless of dependencies. Re-enabling cloud
support (`npx n8n-node cloud-support enable`) is only worth doing if that
policy changes.

## Known scope limits (see README's "Scope limitations" section)

`CronEngine.ts` supports numeric fields, lists, ranges, steps, `*`, and the
standard 3-letter month/weekday name aliases (`JAN`-`DEC`, `SUN`-`SAT`,
case-insensitive, via `replaceNamedAliases`) - but not special characters
(`L`, `W`, `#`) in the raw Cron Expression rule type. If extending this, add
tests to `CronEngine.test.ts` first (it already has good coverage of the
tricky cases: leap years, month/year rollover, the vixie-cron
day-of-month/day-of-week OR-semantics, and timezone conversion across a DST
boundary) - the timezone math in particular is easy to get subtly wrong.

## Still TODO before first publish

- `package.json`: replace `YOUR_GITHUB_USER` (in `homepage` and
  `repository.url`) and `YOUR_EMAIL@example.com` (in `author.email`) with
  the real values - the linter's `@n8n/community-nodes/valid-author` rule
  requires a non-empty email, and the GitHub Actions publish workflow
  needs the repo URL to match where it's actually hosted.
- No `git remote` is set up yet.
- Not yet published to npm - `.github/workflows/publish.yml` handles this
  automatically on a version tag push, once trusted-publisher access is
  configured on npmjs.com (see the workflow file's comments, or the
  starter's README section "One-time setup").

## Conventions this project follows

- Clean, modular separation of pure logic vs. n8n wiring (see
  Architecture above) - keep new logic in a plain-TS module with its own
  tests rather than inline in the `.node.ts` file where possible.
- UI property text and structure intentionally mirrors n8n's native
  Schedule Trigger where the two overlap (hints like "Must be in range
  1-59", the weekday multi-select, the Trigger-at-Hour dropdown with
  named presets) - the goal is that switching between the native trigger
  and this one feels familiar, not like relearning a UI.
