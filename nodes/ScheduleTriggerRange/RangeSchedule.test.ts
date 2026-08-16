import {
	assertValidRange,
	flooredToSecond,
	isInTriggerWeek,
	isWithinRange,
	parseRuleRange,
	ruleToCronExpression,
} from './RangeSchedule';

describe('flooredToSecond', () => {
	it('strips milliseconds', () => {
		expect(flooredToSecond(new Date('2026-08-16T12:58:30.015Z'))).toEqual(
			new Date('2026-08-16T12:58:30.000Z'),
		);
	});

	it('leaves an already-whole second unchanged', () => {
		expect(flooredToSecond(new Date('2026-08-16T12:58:30.000Z'))).toEqual(
			new Date('2026-08-16T12:58:30.000Z'),
		);
	});
});

describe('ruleToCronExpression', () => {
	it('builds a seconds expression', () => {
		expect(ruleToCronExpression({ field: 'seconds', secondsInterval: 15 })).toBe('*/15 * * * * *');
	});

	it('defaults seconds interval to 1 when unset', () => {
		expect(ruleToCronExpression({ field: 'seconds' })).toBe('*/1 * * * * *');
	});

	it('builds a minutes expression', () => {
		expect(ruleToCronExpression({ field: 'minutes', minutesInterval: 5 })).toBe('0 */5 * * * *');
	});

	it('builds an hours expression with trigger minute', () => {
		expect(ruleToCronExpression({ field: 'hours', hoursInterval: 2, triggerAtMinute: 30 })).toBe(
			'0 30 */2 * * *',
		);
	});

	it('builds a days expression with hour and minute', () => {
		expect(
			ruleToCronExpression({
				field: 'days',
				daysInterval: 1,
				triggerAtHour: 6,
				triggerAtMinute: 0,
			}),
		).toBe('0 0 6 */1 * *');
	});

	it('builds a months expression with day-of-month', () => {
		expect(
			ruleToCronExpression({
				field: 'months',
				monthsInterval: 1,
				triggerAtDayOfMonth: 15,
				triggerAtHour: 9,
			}),
		).toBe('0 0 9 15 */1 *');
	});

	it('passes a raw cron expression through unchanged', () => {
		expect(ruleToCronExpression({ field: 'cronExpression', expression: '0 6 * * 1-5' })).toBe(
			'0 6 * * 1-5',
		);
	});

	it('throws when a cron expression rule has no expression', () => {
		expect(() => ruleToCronExpression({ field: 'cronExpression' })).toThrow(
			'Cron Expression is empty',
		);
	});

	describe('weeks', () => {
		it('sorts and joins selected weekdays into the day-of-week field', () => {
			expect(
				ruleToCronExpression({
					field: 'weeks',
					weekday: [5, 1, 3],
					triggerAtHour: 9,
					triggerAtMinute: 30,
				}),
			).toBe('0 30 9 * * 1,3,5');
		});

		it('supports Sunday as 0', () => {
			expect(ruleToCronExpression({ field: 'weeks', weekday: [0] })).toBe('0 0 0 * * 0');
		});

		it('throws when no weekday is selected', () => {
			expect(() => ruleToCronExpression({ field: 'weeks', weekday: [] })).toThrow(
				'Select at least one weekday',
			);
		});

		it('throws when weekday is missing entirely', () => {
			expect(() => ruleToCronExpression({ field: 'weeks' })).toThrow('Select at least one weekday');
		});
	});
});

describe('parseRuleRange', () => {
	it('parses both dates when set', () => {
		const { start, end } = parseRuleRange({
			range: {
				startDate: '2026-11-10T00:00:00.000Z',
				endDate: '2026-11-30T00:00:00.000Z',
			},
		});
		expect(start).toEqual(new Date('2026-11-10T00:00:00.000Z'));
		expect(end).toEqual(new Date('2026-11-30T00:00:00.000Z'));
	});

	it('returns null for unset dates', () => {
		expect(parseRuleRange({})).toEqual({ start: null, end: null });
	});
});

describe('isWithinRange', () => {
	const start = new Date('2026-11-10T00:00:00Z');
	const end = new Date('2026-11-30T00:00:00Z');

	it('is true with no bounds at all', () => {
		expect(isWithinRange(new Date('2026-01-01T00:00:00Z'), null, null)).toBe(true);
	});

	it('is false before the start bound', () => {
		expect(isWithinRange(new Date('2026-08-15T12:00:00Z'), start, end)).toBe(false);
	});

	it('is true inside the range', () => {
		expect(isWithinRange(new Date('2026-11-15T12:00:00Z'), start, end)).toBe(true);
	});

	it('is false after the end bound', () => {
		expect(isWithinRange(new Date('2026-12-01T12:00:00Z'), start, end)).toBe(false);
	});

	it('is inclusive at the exact start instant', () => {
		expect(isWithinRange(start, start, end)).toBe(true);
	});

	it('is inclusive at the exact end instant', () => {
		expect(isWithinRange(end, start, end)).toBe(true);
	});

	it('is still inclusive when the tick fires a few ms after the end instant (cron jitter)', () => {
		// Reproduces the observed real-world case: a tick meant for the exact
		// end second fires a handful of ms late. Without second-flooring this
		// would incorrectly read as "after the range".
		const jitteredTick = new Date(end.getTime() + 15);
		expect(isWithinRange(jitteredTick, start, end)).toBe(true);
	});

	it('is still inclusive when the tick fires a few ms after the start instant (cron jitter)', () => {
		const jitteredTick = new Date(start.getTime() + 5);
		expect(isWithinRange(jitteredTick, start, end)).toBe(true);
	});

	it('is false once a full second has passed beyond the end instant', () => {
		const trueNextTick = new Date(end.getTime() + 1000);
		expect(isWithinRange(trueNextTick, start, end)).toBe(false);
	});

	it('is true with only a start bound, arbitrarily far in the future', () => {
		expect(isWithinRange(new Date('2099-01-01T00:00:00Z'), start, null)).toBe(true);
	});

	it('is true with only an end bound, arbitrarily far in the past', () => {
		expect(isWithinRange(new Date('1999-01-01T00:00:00Z'), null, end)).toBe(true);
	});
});

describe('isInTriggerWeek', () => {
	it('is always true when weeksInterval is 1', () => {
		expect(isInTriggerWeek(new Date('2026-08-16T00:00:00Z'), 1)).toBe(true);
		expect(isInTriggerWeek(new Date('2026-08-23T00:00:00Z'), 1)).toBe(true);
	});

	it('is always true when weeksInterval is 0 or negative (treated as "every week")', () => {
		expect(isInTriggerWeek(new Date('2026-08-16T00:00:00Z'), 0)).toBe(true);
		expect(isInTriggerWeek(new Date('2026-08-16T00:00:00Z'), -1)).toBe(true);
	});

	it('with weeksInterval 2, alternates true/false on consecutive weeks', () => {
		// 1970-01-01T00:00:00Z (the epoch) starts week index 0, which is "on".
		const weekOn = new Date('1970-01-01T00:00:00Z');
		const weekOff = new Date(weekOn.getTime() + 7 * 24 * 60 * 60 * 1000);
		const weekOnAgain = new Date(weekOn.getTime() + 14 * 24 * 60 * 60 * 1000);

		expect(isInTriggerWeek(weekOn, 2)).toBe(true);
		expect(isInTriggerWeek(weekOff, 2)).toBe(false);
		expect(isInTriggerWeek(weekOnAgain, 2)).toBe(true);
	});

	it('stays consistent for any date within the same 7-day block', () => {
		const start = new Date('1970-01-01T00:00:00Z');
		const midWeek = new Date('1970-01-04T12:00:00Z');
		expect(isInTriggerWeek(start, 3)).toBe(isInTriggerWeek(midWeek, 3));
	});
});

describe('assertValidRange', () => {
	it('does not throw when only a start date is set', () => {
		expect(() =>
			assertValidRange({ range: { startDate: '2026-11-10T00:00:00Z' } }),
		).not.toThrow();
	});

	it('does not throw when only an end date is set', () => {
		expect(() => assertValidRange({ range: { endDate: '2026-11-30T00:00:00Z' } })).not.toThrow();
	});

	it('does not throw when neither is set', () => {
		expect(() => assertValidRange({})).not.toThrow();
	});

	it('does not throw when start is strictly before end', () => {
		expect(() =>
			assertValidRange({
				range: {
					startDate: '2026-11-10T00:00:00Z',
					endDate: '2026-11-30T00:00:00Z',
				},
			}),
		).not.toThrow();
	});

	it('throws when start equals end', () => {
		expect(() =>
			assertValidRange({
				range: {
					startDate: '2026-11-10T00:00:00Z',
					endDate: '2026-11-10T00:00:00Z',
				},
			}),
		).toThrow('Start Date must be before End Date');
	});

	it('throws when start is after end', () => {
		expect(() =>
			assertValidRange({
				range: {
					startDate: '2026-11-30T00:00:00Z',
					endDate: '2026-11-10T00:00:00Z',
				},
			}),
		).toThrow('Start Date must be before End Date');
	});
});

describe('scenario: localhor.st style setup - daily always-on rule alongside a scoped hourly rule', () => {
	const dailyRule: { range?: { startDate?: string; endDate?: string } } = {}; // no range: always on
	const hourlyRuleRange = {
		start: new Date('2026-11-10T00:00:00Z'),
		end: new Date('2026-11-30T00:00:00Z'),
	};

	it('the daily rule fires regardless of date', () => {
		const { start, end } = parseRuleRange(dailyRule);
		expect(isWithinRange(new Date('2026-08-15T00:00:00Z'), start, end)).toBe(true);
		expect(isWithinRange(new Date('2026-11-15T00:00:00Z'), start, end)).toBe(true);
		expect(isWithinRange(new Date('2026-12-15T00:00:00Z'), start, end)).toBe(true);
	});

	it('the hourly rule only fires inside its own November range', () => {
		expect(
			isWithinRange(new Date('2026-08-15T00:00:00Z'), hourlyRuleRange.start, hourlyRuleRange.end),
		).toBe(false);
		expect(
			isWithinRange(new Date('2026-11-15T00:00:00Z'), hourlyRuleRange.start, hourlyRuleRange.end),
		).toBe(true);
		expect(
			isWithinRange(new Date('2026-12-15T00:00:00Z'), hourlyRuleRange.start, hourlyRuleRange.end),
		).toBe(false);
	});
});
