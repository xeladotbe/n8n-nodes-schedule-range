import {
	CronScheduler,
	getNextRun,
	getZonedComponents,
	parseCronExpression,
	zonedComponentsToUtc,
} from './CronEngine';

describe('parseCronExpression', () => {
	it('accepts a 6-field expression as-is', () => {
		const parsed = parseCronExpression('0 30 9 * * *');
		expect(parsed.seconds).toEqual(new Set([0]));
		expect(parsed.minutes).toEqual(new Set([30]));
		expect(parsed.hours).toEqual(new Set([9]));
	});

	it('treats a 5-field expression as having seconds fixed at 0', () => {
		const parsed = parseCronExpression('30 9 * * *');
		expect(parsed.seconds).toEqual(new Set([0]));
		expect(parsed.minutes).toEqual(new Set([30]));
		expect(parsed.hours).toEqual(new Set([9]));
	});

	it('throws on the wrong number of fields', () => {
		expect(() => parseCronExpression('* * *')).toThrow('must have 5 or 6 fields');
	});

	it('parses comma-separated lists', () => {
		expect(parseCronExpression('0 0 0 * * 1,3,5').daysOfWeek).toEqual(new Set([1, 3, 5]));
	});

	it('parses ranges', () => {
		expect(parseCronExpression('0 0 9-17 * * *').hours).toEqual(
			new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]),
		);
	});

	it('parses step values on a wildcard', () => {
		expect(parseCronExpression('*/15 * * * * *').seconds).toEqual(new Set([0, 15, 30, 45]));
	});

	it('parses step values on a range', () => {
		expect(parseCronExpression('0 0-10/2 * * * *').minutes).toEqual(new Set([0, 2, 4, 6, 8, 10]));
	});

	it('aliases day-of-week 7 to 0 (Sunday)', () => {
		expect(parseCronExpression('0 0 0 * * 7').daysOfWeek).toEqual(new Set([0]));
	});

	it('marks day-of-month and day-of-week as unrestricted only when literally *', () => {
		expect(parseCronExpression('0 0 0 * * *').domRestricted).toBe(false);
		expect(parseCronExpression('0 0 0 * * *').dowRestricted).toBe(false);
		expect(parseCronExpression('0 0 0 15 * *').domRestricted).toBe(true);
		expect(parseCronExpression('0 0 0 * * 1').dowRestricted).toBe(true);
	});

	it('throws on a non-numeric, non-alias field', () => {
		expect(() => parseCronExpression('0 0 0 * FOO *')).toThrow('Invalid value');
	});

	it('throws on an out-of-range value', () => {
		expect(() => parseCronExpression('0 0 25 * * *')).toThrow('out of range');
	});

	it('accepts 3-letter month names, case-insensitively', () => {
		expect(parseCronExpression('0 0 0 * jan *').months).toEqual(new Set([1]));
		expect(parseCronExpression('0 0 0 * Dec *').months).toEqual(new Set([12]));
	});

	it('accepts a range of month names', () => {
		expect(parseCronExpression('0 0 0 * JUN-AUG *').months).toEqual(new Set([6, 7, 8]));
	});

	it('accepts a comma-separated list of month names', () => {
		expect(parseCronExpression('0 0 0 * JAN,JUL *').months).toEqual(new Set([1, 7]));
	});

	it('accepts 3-letter weekday names, case-insensitively', () => {
		expect(parseCronExpression('0 0 0 * * sun').daysOfWeek).toEqual(new Set([0]));
		expect(parseCronExpression('0 0 0 * * Mon').daysOfWeek).toEqual(new Set([1]));
	});

	it('accepts a range of weekday names', () => {
		expect(parseCronExpression('0 0 0 * * MON-FRI').daysOfWeek).toEqual(
			new Set([1, 2, 3, 4, 5]),
		);
	});

	it('accepts a mix of weekday names and numbers in the same field', () => {
		expect(parseCronExpression('0 0 0 * * MON,3,FRI').daysOfWeek).toEqual(new Set([1, 3, 5]));
	});
});

describe('getZonedComponents / zonedComponentsToUtc round-trip', () => {
	it('round-trips a UTC instant through the UTC timezone unchanged', () => {
		const instant = new Date('2026-06-15T12:34:56.000Z');
		const zoned = getZonedComponents(instant, 'UTC');
		expect(zoned).toEqual({ year: 2026, month: 6, day: 15, hour: 12, minute: 34, second: 56 });
		expect(zonedComponentsToUtc(zoned, 'UTC')).toEqual(instant);
	});

	it('reads the correct wall-clock time in a positive-offset zone', () => {
		// Europe/Berlin is UTC+2 (CEST) in June.
		const instant = new Date('2026-06-15T10:00:00.000Z');
		const zoned = getZonedComponents(instant, 'Europe/Berlin');
		expect(zoned.hour).toBe(12);
	});

	it('reads the correct wall-clock time in a negative-offset zone', () => {
		// America/New_York is UTC-4 (EDT) in June.
		const instant = new Date('2026-06-15T10:00:00.000Z');
		const zoned = getZonedComponents(instant, 'America/New_York');
		expect(zoned.hour).toBe(6);
	});

	it('converts a Berlin wall-clock time back to the correct UTC instant (CEST, UTC+2)', () => {
		const utc = zonedComponentsToUtc(
			{ year: 2026, month: 6, day: 15, hour: 12, minute: 0, second: 0 },
			'Europe/Berlin',
		);
		expect(utc.toISOString()).toBe('2026-06-15T10:00:00.000Z');
	});

	it('converts a Berlin wall-clock time back to the correct UTC instant across the winter/summer boundary (CET, UTC+1)', () => {
		const utc = zonedComponentsToUtc(
			{ year: 2026, month: 1, day: 15, hour: 12, minute: 0, second: 0 },
			'Europe/Berlin',
		);
		expect(utc.toISOString()).toBe('2026-01-15T11:00:00.000Z');
	});
});

describe('getNextRun', () => {
	it('finds the next run for an every-N-seconds expression', () => {
		const after = new Date('2026-08-16T12:58:00.000Z');
		const next = getNextRun('*/3 * * * * *', after, 'UTC');
		expect(next.toISOString()).toBe('2026-08-16T12:58:03.000Z');
	});

	it('finds the next run for a daily expression at a fixed hour/minute', () => {
		const after = new Date('2026-08-16T05:00:00.000Z'); // before 06:00 the same day
		const next = getNextRun('0 0 6 * * *', after, 'UTC');
		expect(next.toISOString()).toBe('2026-08-16T06:00:00.000Z');
	});

	it('rolls over to the next day once past the fixed hour', () => {
		const after = new Date('2026-08-16T07:00:00.000Z'); // after 06:00 the same day
		const next = getNextRun('0 0 6 * * *', after, 'UTC');
		expect(next.toISOString()).toBe('2026-08-17T06:00:00.000Z');
	});

	it('rolls over month/year correctly (Dec 31 -> Jan 1)', () => {
		const after = new Date('2026-12-31T23:59:59.000Z');
		const next = getNextRun('0 0 0 * * *', after, 'UTC');
		expect(next.toISOString()).toBe('2027-01-01T00:00:00.000Z');
	});

	it('respects a weekday list (day-of-week only restricted)', () => {
		// 2026-08-16 is a Sunday; next Monday/Wednesday/Friday at 09:30 is Monday 08-17.
		const after = new Date('2026-08-16T00:00:00.000Z');
		const next = getNextRun('0 30 9 * * 1,3,5', after, 'UTC');
		expect(next.toISOString()).toBe('2026-08-17T09:30:00.000Z');
		expect(new Date(next).getUTCDay()).toBe(1); // Monday
	});

	it('applies vixie-cron OR semantics when both day-of-month and day-of-week are restricted', () => {
		// "the 1st of the month OR a Monday" - 2026-08-16 is a Sunday; the next
		// matching day is Monday 2026-08-17 (day-of-week branch), even though
		// day-of-month (1) doesn't match.
		const after = new Date('2026-08-16T00:00:00.000Z');
		const next = getNextRun('0 0 0 1 * 1', after, 'UTC');
		expect(next.toISOString()).toBe('2026-08-17T00:00:00.000Z');
	});

	it('finds Feb 29 on a leap year', () => {
		const after = new Date('2027-01-01T00:00:00.000Z');
		const next = getNextRun('0 0 0 29 2 *', after, 'UTC');
		expect(next.toISOString()).toBe('2028-02-29T00:00:00.000Z'); // 2028 is a leap year
	});

	it('throws for an impossible date (Feb 30) after exhausting the search window', () => {
		expect(() => getNextRun('0 0 0 30 2 *', new Date('2026-01-01T00:00:00Z'), 'UTC')).toThrow(
			'No matching run time found',
		);
	});

	it('computes the next run correctly against a non-UTC timezone', () => {
		// "every day at 06:00 Europe/Berlin" in June (CEST, UTC+2) is 04:00 UTC.
		const after = new Date('2026-06-15T00:00:00.000Z');
		const next = getNextRun('0 0 6 * * *', after, 'Europe/Berlin');
		expect(next.toISOString()).toBe('2026-06-15T04:00:00.000Z');
	});

	it('always returns a time strictly after "after", even exactly on a boundary', () => {
		const after = new Date('2026-08-16T12:58:03.000Z'); // itself a valid */3 tick
		const next = getNextRun('*/3 * * * * *', after, 'UTC');
		expect(next.getTime()).toBeGreaterThan(after.getTime());
		expect(next.toISOString()).toBe('2026-08-16T12:58:06.000Z');
	});
});

describe('CronScheduler', () => {
	it('fires repeatedly at the configured interval', (done) => {
		const fireTimes: number[] = [];
		const scheduler = new CronScheduler('*/1 * * * * *', 'UTC', () => {
			fireTimes.push(Date.now());
			if (fireTimes.length >= 2) {
				scheduler.stop();
				expect(fireTimes.length).toBe(2);
				expect(fireTimes[1] - fireTimes[0]).toBeGreaterThanOrEqual(900); // allow scheduler jitter
				done();
			}
		});
	}, 5000);

	it('does not fire again after stop() is called', (done) => {
		let fireCount = 0;
		const scheduler = new CronScheduler('*/1 * * * * *', 'UTC', () => {
			fireCount++;
		});
		scheduler.stop();
		setTimeout(() => {
			expect(fireCount).toBe(0);
			done();
		}, 1500);
	}, 5000);

	it('throws synchronously at construction for an unparseable expression', () => {
		expect(() => new CronScheduler('not a cron', 'UTC', () => {})).toThrow();
	});
});
