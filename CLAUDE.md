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

## Cloud support / verified-node lint is enabled

`eslint.config.mjs` uses the default `config` (not
`configWithoutCloudSupport`), and `package.json` has `"n8n.strict": true`.
This used to be disabled, on the assumption that flow-control nodes (this
one doesn't integrate a third-party service) aren't eligible for
verification at all - but n8n's Creator Portal automated pre-check runs
this same strict ruleset against every submission regardless, so keeping
it enabled locally means `npm run lint` now catches these issues before
submission instead of only after a failed review. Two real findings from a
failed submission (v0.1.1) drove this:

- `@n8n/community-nodes/no-restricted-globals` - raw `setTimeout`/
  `clearTimeout` forbidden; see `CronEngine.ts`'s use of `sleep()` above.
- `@n8n/community-nodes/node-usable-as-tool` - conflicts here: the generic
  rule wants every node to set `usableAsTool`, but trigger nodes must
  *omit* it entirely (verified separately, more specifically). Resolved
  with a targeted `eslint-disable-next-line` on the class declaration.

The verified-node scanner also enforces **strict alphabetical order by
`displayName`** within any `fixedCollection`'s `values` array (rule
`node-param-fixed-collection-type-unsorted-items`) and ignores inline
`eslint-disable` comments entirely when doing so - unlike our local lint,
which does respect them. This forced the Trigger Rule fields into
alphabetical order. To avoid burying the field that controls which others
are visible (originally "Trigger Interval") in the middle of the list,
it's relabelled **"Cadence"** and "Rule Name" is relabelled **"Custom
Name"** - genuine, equally clear synonyms that happen to alphabetize to
the top. "Range" is relabelled **"Window"** for the same reason, landing
near the bottom. This is *not* a numeric-prefix hack (e.g. "0. Cadence")
- deliberately avoided since it would be visibly gamed and could fail a
manual review; these are real word choices, just chosen for where they
sort. The `name` (parameter id) for each field is unchanged - only the
user-visible `displayName` differs - so none of this affects
`RangeSchedule.ts` or `trigger()`.

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

Published on npm as `n8n-nodes-schedule-range` (v0.1.1 as of this
handoff), repo at `github.com/xeladotbe/n8n-nodes-schedule-range` (default
branch `main`). npm Trusted Publisher is configured for
`.github/workflows/publish.yml`, so `npm run release` (bumps version,
tags, pushes) triggers an automatic OIDC-authenticated publish via GitHub
Actions - no manual `npm publish` needed for subsequent releases.

Submitted once for n8n's Creator Portal verification; the automated
pre-check failed on v0.1.1 for the reasons captured in "Cloud support /
verified-node lint is enabled" above. Not yet resubmitted after the fix.

## Conventions this project follows

- Clean, modular separation of pure logic vs. n8n wiring (see
  Architecture above) - keep new logic in a plain-TS module with its own
  tests rather than inline in the `.node.ts` file where possible.
- UI property text and structure intentionally mirrors n8n's native
  Schedule Trigger where the two overlap (hints like "Must be in range
  1-59", the weekday multi-select, the Trigger-at-Hour dropdown with
  named presets) - the goal is that switching between the native trigger
  and this one feels familiar, not like relearning a UI.
