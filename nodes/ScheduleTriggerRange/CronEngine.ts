/**
 * A minimal, dependency-free cron engine: enough to parse a standard 5- or
 * 6-field cron expression and compute its next fire time in a given IANA
 * timezone. Written to replace the `cron` npm package, which n8n Cloud's
 * community-node linter forbids as a runtime dependency
 * (`@n8n/community-nodes/no-runtime-dependencies`).
 *
 * Scope, deliberately: numeric fields, plus the standard 3-letter
 * month/weekday name aliases (JAN-DEC, SUN-SAT) - no `L`/`W`/`#` special
 * characters. That covers every expression this node itself generates and
 * the vast majority of hand-written cron strings.
 */

import { sleep } from 'n8n-workflow';

const MONTH_NAMES: Record<string, number> = {
	JAN: 1,
	FEB: 2,
	MAR: 3,
	APR: 4,
	MAY: 5,
	JUN: 6,
	JUL: 7,
	AUG: 8,
	SEP: 9,
	OCT: 10,
	NOV: 11,
	DEC: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
	SUN: 0,
	MON: 1,
	TUE: 2,
	WED: 3,
	THU: 4,
	FRI: 5,
	SAT: 6,
};

/**
 * Case-insensitively replaces standard 3-letter month/weekday abbreviations
 * (e.g. `MON`, `dec`) with their numeric cron value, so a field like
 * `MON-FRI` or `JAN,JUL` parses the same as its numeric equivalent. Anything
 * that isn't a recognised alias (including plain numbers) passes through
 * unchanged.
 */
function replaceNamedAliases(field: string, names: Record<string, number>): string {
	return field.replace(/[A-Za-z]{3}/g, (match) => {
		const value = names[match.toUpperCase()];
		return value === undefined ? match : String(value);
	});
}

export interface ParsedCronFields {
	seconds: Set<number>;
	minutes: Set<number>;
	hours: Set<number>;
	daysOfMonth: Set<number>;
	months: Set<number>;
	daysOfWeek: Set<number>;
	/** Whether the day-of-month field was written as something other than `*` - see the OR-semantics note on {@link getNextRun}. */
	domRestricted: boolean;
	/** Whether the day-of-week field was written as something other than `*`. */
	dowRestricted: boolean;
}

/** Parses one comma-separated cron field (e.g. a list `1,3,5`, a step every-2nd, a range `9-17`, or a wildcard) into the set of values it allows. */
function parseField(
	field: string,
	min: number,
	max: number,
	aliasSevenAsZero = false,
): Set<number> {
	const result = new Set<number>();

	for (const part of field.split(',')) {
		const [rangePart, stepPart] = part.split('/');
		const step = stepPart === undefined ? 1 : Number(stepPart);
		if (!Number.isInteger(step) || step <= 0) {
			throw new Error(`Invalid step in cron field "${field}"`);
		}

		let start: number;
		let end: number;
		if (rangePart === '*') {
			start = min;
			end = max;
		} else if (rangePart.includes('-')) {
			const [s, e] = rangePart.split('-').map(Number);
			if (!Number.isInteger(s) || !Number.isInteger(e)) {
				throw new Error(`Invalid range in cron field "${field}"`);
			}
			start = s;
			end = e;
		} else {
			const v = Number(rangePart);
			if (!Number.isInteger(v)) {
				throw new Error(`Invalid value in cron field "${field}"`);
			}
			start = v;
			end = v;
		}

		for (let v = start; v <= end; v += step) {
			const normalized = aliasSevenAsZero && v === 7 ? 0 : v;
			if (normalized < min || normalized > max) {
				throw new Error(`Value ${v} in cron field "${field}" is out of range (${min}-${max})`);
			}
			result.add(normalized);
		}
	}

	return result;
}

/** Parses a full 5- or 6-field cron expression. A 5-field expression is treated as having `seconds` fixed at 0. */
export function parseCronExpression(expression: string): ParsedCronFields {
	const fields = expression
		.trim()
		.split(/\s+/)
		.filter((f) => f.length > 0);

	let normalizedFields: string[];
	if (fields.length === 6) {
		normalizedFields = fields;
	} else if (fields.length === 5) {
		normalizedFields = ['0', ...fields];
	} else {
		throw new Error(
			`Cron expression must have 5 or 6 fields (Minute Hour Day Month Weekday, with an optional leading Second), got ${fields.length}: "${expression}"`,
		);
	}

	const [second, minute, hour, dayOfMonth, month, dayOfWeek] = normalizedFields;

	return {
		seconds: parseField(second, 0, 59),
		minutes: parseField(minute, 0, 59),
		hours: parseField(hour, 0, 23),
		daysOfMonth: parseField(dayOfMonth, 1, 31),
		months: parseField(replaceNamedAliases(month, MONTH_NAMES), 1, 12),
		daysOfWeek: parseField(replaceNamedAliases(dayOfWeek, WEEKDAY_NAMES), 0, 6, true),
		domRestricted: dayOfMonth !== '*',
		dowRestricted: dayOfWeek !== '*',
	};
}

interface ZonedComponents {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
	hour: number; // 0-23
	minute: number; // 0-59
	second: number; // 0-59
}

/** Reads the wall-clock date/time that `instant` represents in `timeZone`. */
export function getZonedComponents(instant: Date, timeZone: string): ZonedComponents {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});

	const parts: Record<string, string> = {};
	for (const part of formatter.formatToParts(instant)) {
		if (part.type !== 'literal') parts[part.type] = part.value;
	}

	// Some locales render midnight as "24" under hour12: false; normalise it.
	const hour = Number(parts.hour) % 24;

	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		hour,
		minute: Number(parts.minute),
		second: Number(parts.second),
	};
}

/**
 * Converts a wall-clock date/time in `timeZone` into the real instant (UTC
 * `Date`) it corresponds to. Two-pass offset correction: guess the instant is
 * that wall time in UTC, see what wall time that guess actually renders as in
 * `timeZone`, and correct by the difference. Standard technique for this
 * without a timezone-database library; like any such approach it can be
 * ambiguous within the hour a DST transition happens, which is an accepted
 * edge case here.
 */
export function zonedComponentsToUtc(c: ZonedComponents, timeZone: string): Date {
	const guessMs = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
	const renderedAsIfUtc = getZonedComponents(new Date(guessMs), timeZone);
	const renderedMs = Date.UTC(
		renderedAsIfUtc.year,
		renderedAsIfUtc.month - 1,
		renderedAsIfUtc.day,
		renderedAsIfUtc.hour,
		renderedAsIfUtc.minute,
		renderedAsIfUtc.second,
	);
	const offsetMs = guessMs - renderedMs;
	return new Date(guessMs + offsetMs);
}

const SEARCH_ITERATION_LIMIT = 20_000;
const SEARCH_WINDOW_YEARS = 4;

/** Bumps `calendar`'s month by one and zeroes everything below it (day 1, 00:00:00). Overflow (month 13) rolls into the next year via native `Date` arithmetic. */
function incrementMonth(calendar: Date): void {
	calendar.setUTCMonth(calendar.getUTCMonth() + 1, 1);
	calendar.setUTCHours(0, 0, 0, 0);
}

/** Bumps the day by one and zeroes the time below it. Overflow past the month's last day rolls into next month correctly. */
function incrementDay(calendar: Date): void {
	calendar.setUTCDate(calendar.getUTCDate() + 1);
	calendar.setUTCHours(0, 0, 0, 0);
}

function incrementHour(calendar: Date): void {
	calendar.setUTCHours(calendar.getUTCHours() + 1, 0, 0, 0);
}

function incrementMinute(calendar: Date): void {
	calendar.setUTCMinutes(calendar.getUTCMinutes() + 1, 0, 0);
}

function incrementSecond(calendar: Date): void {
	calendar.setUTCSeconds(calendar.getUTCSeconds() + 1, 0);
}

/**
 * Finds the next time (strictly after `after`) that `cronExpression` fires,
 * interpreted as wall-clock time in `timeZone`.
 *
 * Uses the classic vixie-cron day-of-month/day-of-week OR rule: if only one
 * of the two is restricted (not `*`), it alone governs which days match; if
 * both are restricted, a day matches if it satisfies *either* one.
 *
 * Field-wise skip search: on a mismatch, jumps straight to the next
 * candidate for the coarsest mismatched field (month, then day, then hour,
 * then minute, then second) rather than scanning second by second, so a
 * yearly or monthly rule resolves in a handful of iterations, not millions.
 */
export function getNextRun(cronExpression: string, after: Date, timeZone = 'UTC'): Date {
	const parsed = parseCronExpression(cronExpression);

	const searchStartZoned = getZonedComponents(new Date(after.getTime() + 1000), timeZone);
	const calendar = new Date(
		Date.UTC(
			searchStartZoned.year,
			searchStartZoned.month - 1,
			searchStartZoned.day,
			searchStartZoned.hour,
			searchStartZoned.minute,
			searchStartZoned.second,
		),
	);

	const searchLimit = new Date(calendar.getTime());
	searchLimit.setUTCFullYear(searchLimit.getUTCFullYear() + SEARCH_WINDOW_YEARS);

	for (let i = 0; i < SEARCH_ITERATION_LIMIT; i++) {
		if (calendar > searchLimit) {
			throw new Error(
				`No matching run time found for cron expression "${cronExpression}" within ${SEARCH_WINDOW_YEARS} years - check for an impossible date (e.g. day 30 of February)`,
			);
		}

		const month = calendar.getUTCMonth() + 1;
		if (!parsed.months.has(month)) {
			incrementMonth(calendar);
			continue;
		}

		const day = calendar.getUTCDate();
		const dow = calendar.getUTCDay();
		const domMatches = parsed.daysOfMonth.has(day);
		const dowMatches = parsed.daysOfWeek.has(dow);
		const dayMatches =
			parsed.domRestricted && parsed.dowRestricted
				? domMatches || dowMatches
				: parsed.domRestricted
					? domMatches
					: parsed.dowRestricted
						? dowMatches
						: true;
		if (!dayMatches) {
			incrementDay(calendar);
			continue;
		}

		const hour = calendar.getUTCHours();
		if (!parsed.hours.has(hour)) {
			incrementHour(calendar);
			continue;
		}

		const minute = calendar.getUTCMinutes();
		if (!parsed.minutes.has(minute)) {
			incrementMinute(calendar);
			continue;
		}

		const second = calendar.getUTCSeconds();
		if (!parsed.seconds.has(second)) {
			incrementSecond(calendar);
			continue;
		}

		return zonedComponentsToUtc(
			{
				year: calendar.getUTCFullYear(),
				month: calendar.getUTCMonth() + 1,
				day: calendar.getUTCDate(),
				hour: calendar.getUTCHours(),
				minute: calendar.getUTCMinutes(),
				second: calendar.getUTCSeconds(),
			},
			timeZone,
		);
	}

	throw new Error(
		`No matching run time found for cron expression "${cronExpression}" (search iteration limit reached)`,
	);
}

/**
 * Self-rescheduling timer that fires `callback` at every occurrence of
 * `cronExpression` (in `timeZone`) until {@link stop} is called. Replaces the
 * `cron` package's `CronJob`: each fire computes and arms only the *next*
 * occurrence via {@link getNextRun}, rather than keeping an internal
 * always-on ticking loop.
 *
 * The first occurrence is computed synchronously in the constructor, so a
 * malformed cron expression throws immediately - at activation time, same as
 * this node's date-range validation - rather than failing silently on the
 * first would-be tick.
 *
 * Built on `sleep()` from `n8n-workflow` (with an `AbortSignal` for
 * cancellation) rather than raw `setTimeout`/`clearTimeout` - n8n's verified
 * community-node lint rule (`no-restricted-globals`) forbids the raw timer
 * globals so their usage stays centralised and cancellable.
 */
export class CronScheduler {
	private readonly abortController = new AbortController();

	private stopped = false;

	constructor(
		private readonly cronExpression: string,
		private readonly timeZone: string,
		private readonly callback: () => void,
	) {
		const first = getNextRun(this.cronExpression, new Date(), this.timeZone);
		void this.run(first);
	}

	private async run(next: Date): Promise<void> {
		while (!this.stopped) {
			const delayMs = Math.max(next.getTime() - Date.now(), 0);
			try {
				await sleep(delayMs, this.abortController.signal);
			} catch {
				return; // aborted via stop()
			}
			if (this.stopped) return;
			this.callback();
			// Schedule from the fired time, not `Date.now()`, so a slow callback
			// can't push later occurrences later than the cron expression intends.
			next = getNextRun(this.cronExpression, next, this.timeZone);
		}
	}

	stop(): void {
		this.stopped = true;
		this.abortController.abort();
	}
}
