export type IntervalUnit =
	| 'seconds'
	| 'minutes'
	| 'hours'
	| 'days'
	| 'weeks'
	| 'months'
	| 'cronExpression';

export interface IntervalRule {
	field: IntervalUnit;
	secondsInterval?: number;
	minutesInterval?: number;
	hoursInterval?: number;
	daysInterval?: number;
	weekday?: number[];
	monthsInterval?: number;
	triggerAtDayOfMonth?: number;
	triggerAtHour?: number;
	triggerAtMinute?: number;
	expression?: string;
	startDate?: string;
	endDate?: string;
}

/**
 * Turns one interval rule from the node UI into a 6-field cron expression
 * (seconds minutes hours day-of-month month day-of-week), the format the
 * `cron` npm package expects. Mirrors n8n's own Schedule Trigger UI so the
 * mental model carries over 1:1.
 */
export function ruleToCronExpression(rule: IntervalRule): string {
	const hour = rule.triggerAtHour ?? 0;
	const minute = rule.triggerAtMinute ?? 0;

	switch (rule.field) {
		case 'cronExpression':
			if (!rule.expression) {
				throw new Error('Cron Expression is empty');
			}
			return rule.expression;
		case 'seconds':
			return `*/${rule.secondsInterval ?? 1} * * * * *`;
		case 'minutes':
			return `0 */${rule.minutesInterval ?? 1} * * * *`;
		case 'hours':
			return `0 ${minute} */${rule.hoursInterval ?? 1} * * *`;
		case 'days':
			return `0 ${minute} ${hour} */${rule.daysInterval ?? 1} * *`;
		case 'weeks': {
			if (!rule.weekday || rule.weekday.length === 0) {
				throw new Error('Select at least one weekday for a weekly rule');
			}
			const days = [...rule.weekday].sort((a, b) => a - b).join(',');
			return `0 ${minute} ${hour} * * ${days}`;
		}
		case 'months':
			return `0 ${minute} ${hour} ${rule.triggerAtDayOfMonth ?? 1} */${rule.monthsInterval ?? 1} *`;
		default:
			throw new Error(`Unknown interval field: ${rule.field as string}`);
	}
}

/**
 * Parses a rule's own Start Date / End Date (either may be unset) into real
 * Date objects. Centralised so the trigger method and its up-front
 * validation parse identically.
 */
export function parseRuleRange(rule: Pick<IntervalRule, 'startDate' | 'endDate'>): {
	start: Date | null;
	end: Date | null;
} {
	return {
		start: rule.startDate ? new Date(rule.startDate) : null,
		end: rule.endDate ? new Date(rule.endDate) : null,
	};
}

/**
 * Rounds a Date down to the start of its second. Cron ticks fire a few
 * milliseconds after the nominal second (scheduler/event-loop jitter, not a
 * bug in `cron` itself) - without this, a tick meant to be exactly at an
 * `endDate` boundary reads as a few ms *after* it and gets excluded, even
 * though every rule's own granularity is whole seconds.
 */
export function flooredToSecond(date: Date): Date {
	return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/**
 * True if `now` falls inside the [start, end] range (either bound
 * optional/open-ended). Both `now` and the bounds are compared at
 * whole-second resolution (see {@link flooredToSecond}) so a tick that is a
 * few milliseconds late still counts as landing exactly on its second -
 * making the window inclusive on both ends in practice, not just in theory.
 */
export function isWithinRange(now: Date, start: Date | null, end: Date | null): boolean {
	const flooredNow = flooredToSecond(now);
	if (start && flooredNow < flooredToSecond(start)) return false;
	if (end && flooredNow > flooredToSecond(end)) return false;
	return true;
}

/** Throws a plain Error if a rule's own start/end range is inverted (start >= end). */
export function assertValidRange(rule: Pick<IntervalRule, 'startDate' | 'endDate'>): void {
	const { start, end } = parseRuleRange(rule);
	if (start && end && start >= end) {
		throw new Error('Start Date must be before End Date');
	}
}
