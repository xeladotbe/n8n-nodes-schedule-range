# n8n-nodes-schedule-range

An n8n community node that adds an optional **Start Date** / **End Date**
range to each rule of a recurring schedule. It behaves like n8n's built-in
Schedule Trigger, but ticks outside a rule's own range are silently
skipped - no item is emitted, no error is thrown, and the workflow doesn't
need to be manually activated/deactivated around a date range.

Built with [`@n8n/node-cli`](https://www.npmjs.com/package/@n8n/node-cli),
n8n's official tooling for community nodes.

## Why

n8n's native Schedule Trigger has no concept of "only run between these two
dates". Common cases where that's missing:

- Ramp up polling frequency only in the days before something is expected
  to happen (e.g. a domain becoming available again), without touching the
  workflow by hand.
- A seasonal or campaign-limited automation that should stop firing after a
  known end date without a separate cleanup step.
- Running a low-frequency "baseline" rule indefinitely and a high-frequency
  rule only during a known critical stretch - in the same node, since
  ranges are per rule, not global.

## Features

- Same rule types as the native Schedule Trigger: seconds, minutes, hours,
  days, weeks (by weekday), months, or a raw cron expression.
- Each rule gets its own optional Start Date / End Date. A rule with
  neither set behaves exactly like the native trigger - always active.
- Multiple rules can run side by side in one node, each with an
  independent range (e.g. a daily rule that's always on, plus an hourly
  rule scoped to a two-week stretch).
- Range boundaries are inclusive on both ends and account for the few
  milliseconds of scheduler jitter a cron tick can arrive with, so a tick
  meant for the exact boundary second isn't dropped by a timing accident.
- Manual "test step" always fires immediately, regardless of any range -
  same behaviour as the native trigger.
- Zero runtime dependencies: cron parsing and next-run computation
  (`CronEngine.ts`) are implemented from scratch rather than pulling in the
  `cron` package, per n8n's community-node guidelines (runtime
  dependencies aren't allowed).

## Install

This package is not yet published to the npm registry, so the in-app
**Settings → Community Nodes → Install** flow (which installs by package
name from npm) doesn't apply yet. Until then, install manually from a
built tarball:

```bash
# On the machine running n8n (or copied in via `docker cp`):
docker cp n8n-nodes-schedule-range-0.1.0.tgz n8n:/tmp/
docker exec -it n8n sh
cd ~/.n8n/nodes
npm install /tmp/n8n-nodes-schedule-range-0.1.0.tgz
exit
docker restart n8n
```

`~/.n8n/nodes` is n8n's manual community-node install location - it's part
of the same persistent volume as your workflows, so this survives
container recreation. Requires `N8N_COMMUNITY_PACKAGES_ENABLED=true` in
your n8n environment.

## Usage

1. Add the **Schedule Trigger (with Range)** node as your workflow's
   trigger.
2. Add one or more **Trigger Rules**, configured exactly like the native
   Schedule Trigger (seconds / minutes / hours / days / weeks / months /
   raw cron expression).
3. Within a rule, optionally set **Start Date** and/or **End Date**. Leave
   either empty for an open-ended range on that side. Leave both empty
   for a rule that's always active.
4. Activate the workflow. A rule whose Start Date is not strictly before
   its End Date, or whose cron expression is malformed, is rejected at
   activation time with a clear error - not silently at the first tick.

Outside a rule's range, its underlying schedule still computes its next
occurrence internally, but no execution is created and no item leaves the
node for that tick - so downstream nodes never run for it. Other rules on
the same node with their own (or no) range are unaffected.

## Development

This project uses n8n's official node tooling (`@n8n/node-cli`):

```bash
npm install
npm run dev      # starts a local n8n instance with this node loaded, hot-reloading
npm test         # runs the Jest suite (CronEngine.ts, RangeSchedule.ts - both pure, no n8n dependency)
npm run lint     # n8n's community-node linter
npm run build    # compiles to dist/
```

The scheduling logic lives in two dependency-free modules, unit-tested in
isolation from n8n itself:

- `CronEngine.ts` - cron expression parsing and next-run-time computation,
  including timezone handling.
- `RangeSchedule.ts` - the per-rule Start/End Date range logic, and
  translating a Trigger Rule into a cron expression for `CronEngine`.

## Compatibility

Verified against n8n 2.33.7, self-hosted, internal task runner mode
(`n8n-workflow` API version 1).

## Scope limitations

The custom cron engine covers everything this node itself generates, plus
the common cases for hand-written cron expressions: numeric lists, ranges,
steps, and wildcards across 5 or 6 fields. It does not support month/weekday
name abbreviations (e.g. `JAN`, `MON`) or special characters like `L`, `W`,
or `#` - use numeric values instead.

## License

MIT
