import type {
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CronScheduler } from './CronEngine';
import type { IntervalRule } from './RangeSchedule';
import {
	assertValidRange,
	isWithinRange,
	parseRuleRange,
	ruleToCronExpression,
} from './RangeSchedule';

export class ScheduleTriggerRange implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Schedule Trigger (with Range)',
		name: 'scheduleTriggerRange',
		icon: { light: 'file:scheduleTriggerRange.svg', dark: 'file:scheduleTriggerRange.dark.svg' },
		group: ['trigger'],
		version: 1,
		description:
			'Triggers the workflow on a recurring schedule, but only within an optional start/end date range',
		subtitle: '={{$parameter["rule"]["interval"].length}} rule(s)',
		eventTriggerDescription: '',
		activationMessage:
			'Your schedule (with range) trigger will now trigger executions on the schedule you have defined, as long as the current date falls inside the configured range.',
		defaults: {
			name: 'Schedule Trigger (with Range)',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName:
					"Each Trigger Rule below can optionally have its own Start Date / End Date range (scroll down within a rule to find them). A rule with no dates set is always active. Ticks outside a rule's range are silently skipped - no item is emitted and no error is thrown.",
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Trigger Rules',
				name: 'rule',
				placeholder: 'Add Rule',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					sortable: true,
				},
				default: { interval: [{ field: 'days', daysInterval: 1 }] },
				options: [
					{
						name: 'interval',
						displayName: 'Interval',
						values: [
							{
								displayName: 'Days Between Triggers',
								name: 'daysInterval',
								type: 'number',
								default: 1,
								hint: 'Must be in range 1-31',
							},
							{
								displayName: 'End Date',
								name: 'endDate',
								type: 'dateTime',
								default: '',
								description:
									'Ticks from this rule after this date/time are skipped. Leave empty for no upper bound.',
							},
							{
								displayName: 'Expression',
								name: 'expression',
								type: 'string',
								default: '',
								placeholder: '0 6	*	*	*',
								hint: 'Format: ([Second	]) [Minute]	[Hour]	[Day of Month]	[Month]	[Day of Week]',
							},
							{
								displayName: 'Hours Between Triggers',
								name: 'hoursInterval',
								type: 'number',
								default: 1,
								hint: 'Must be in range 1-23',
							},
							{
								displayName: 'Minutes Between Triggers',
								name: 'minutesInterval',
								type: 'number',
								default: 1,
								hint: 'Must be in range 1-59',
							},
							{
								displayName: 'Months Between Triggers',
								name: 'monthsInterval',
								type: 'number',
								default: 1,
							},
							{
								displayName: 'Seconds Between Triggers',
								name: 'secondsInterval',
								type: 'number',
								default: 1,
								hint: 'Must be in range 1-59',
							},
							{
								displayName: 'Start Date',
								name: 'startDate',
								type: 'dateTime',
								default: '',
								description:
									'Ticks from this rule before this date/time are skipped. Leave empty for no lower bound.',
							},
							{
								displayName: 'Trigger at Day of Month',
								name: 'triggerAtDayOfMonth',
								type: 'number',
								default: 1,
								hint: "If a month doesn't have this day, the node won't trigger",
							},
							{
								displayName: 'Trigger at Hour',
								name: 'triggerAtHour',
								type: 'options',
								default: 0,
								options: [
									{
										name: 'Midnight',
										value: 0,
									},
									{
										name: '1am',
										value: 1,
									},
									{
										name: '2am',
										value: 2,
									},
									{
										name: '3am',
										value: 3,
									},
									{
										name: '4am',
										value: 4,
									},
									{
										name: '5am',
										value: 5,
									},
									{
										name: '6am',
										value: 6,
									},
									{
										name: '7am',
										value: 7,
									},
									{
										name: '8am',
										value: 8,
									},
									{
										name: '9am',
										value: 9,
									},
									{
										name: '10am',
										value: 10,
									},
									{
										name: '11am',
										value: 11,
									},
									{
										name: 'Noon',
										value: 12,
									},
									{
										name: '1pm',
										value: 13,
									},
									{
										name: '2pm',
										value: 14,
									},
									{
										name: '3pm',
										value: 15,
									},
									{
										name: '4pm',
										value: 16,
									},
									{
										name: '5pm',
										value: 17,
									},
									{
										name: '6pm',
										value: 18,
									},
									{
										name: '7pm',
										value: 19,
									},
									{
										name: '8pm',
										value: 20,
									},
									{
										name: '9pm',
										value: 21,
									},
									{
										name: '10pm',
										value: 22,
									},
									{
										name: '11pm',
										value: 23,
									},
								],
							},
							{
								displayName: 'Trigger at Minute',
								name: 'triggerAtMinute',
								type: 'number',
								default: 0,
							},
							{
								displayName: 'Trigger Interval',
								name: 'field',
								type: 'options',
								default: 'days',
								// Deliberately ordered by granularity (seconds -> ... -> cron
								// expression), matching n8n's native Schedule Trigger, rather
								// than alphabetically - alphabetical would put "Cron
								// Expression" first, which is worse UX for this field.
								// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
								options: [
									{
										name: 'Seconds',
										value: 'seconds',
									},
									{
										name: 'Minutes',
										value: 'minutes',
									},
									{
										name: 'Hours',
										value: 'hours',
									},
									{
										name: 'Days',
										value: 'days',
									},
									{
										name: 'Weeks',
										value: 'weeks',
									},
									{
										name: 'Months',
										value: 'months',
									},
									{
										name: 'Cron Expression',
										value: 'cronExpression',
									},
								],
							},
							{
								displayName: 'Trigger on Weekdays',
								name: 'weekday',
								type: 'multiOptions',
								default: [],
								options: [
									{
										name: 'Monday',
										value: 1,
									},
									{
										name: 'Tuesday',
										value: 2,
									},
									{
										name: 'Wednesday',
										value: 3,
									},
									{
										name: 'Thursday',
										value: 4,
									},
									{
										name: 'Friday',
										value: 5,
									},
									{
										name: 'Saturday',
										value: 6,
									},
									{
										name: 'Sunday',
										value: 0,
									},
								],
							},
						],
					},
				],
			},
		],
		usableAsTool: true,
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const rules = this.getNodeParameter('rule.interval', []) as IntervalRule[];

		if (rules.length === 0) {
			throw new NodeOperationError(this.getNode(), 'At least one Trigger Rule is required');
		}

		// Validate every rule's own range up front, so a bad date is caught at
		// activation time rather than silently swallowed on the first tick.
		rules.forEach((rule, index) => {
			try {
				assertValidRange(rule);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new NodeOperationError(this.getNode(), `Rule ${index + 1}: ${message}`);
			}
		});

		const emitNow = () => {
			const now = new Date();
			this.emit([
				this.helpers.returnJsonArray([
					{
						timestamp: now.toISOString(),
						'Readable date': now.toString(),
						'Readable time': now.toLocaleTimeString(),
						'Day of week': now.toLocaleDateString('en-US', { weekday: 'long' }),
						Year: now.getFullYear(),
						Month: now.getMonth() + 1,
						'Day of month': now.getDate(),
						Hour: now.getHours(),
						Minute: now.getMinutes(),
						Second: now.getSeconds(),
					},
				]),
			]);
		};

		const timezone = this.getTimezone();
		const schedulers: CronScheduler[] = [];

		rules.forEach((rule, index) => {
			const { start, end } = parseRuleRange(rule);

			// Captured per rule, so each scheduler checks only its own range - a
			// daily rule with no dates and an hourly rule scoped to a two-week
			// stretch can run side by side without interfering with each other.
			const onTick = () => {
				if (!isWithinRange(new Date(), start, end)) return;
				emitNow();
			};

			const cronExpression = ruleToCronExpression(rule);
			try {
				schedulers.push(new CronScheduler(cronExpression, timezone, onTick));
			} catch (error) {
				// Construction validates the expression synchronously (computes the
				// first fire time), so an invalid cron expression is caught here at
				// activation time - same principle as the date-range validation above.
				const message = error instanceof Error ? error.message : String(error);
				throw new NodeOperationError(this.getNode(), `Rule ${index + 1}: ${message}`);
			}
		});

		const closeFunction = async () => {
			for (const scheduler of schedulers) {
				scheduler.stop();
			}
		};

		// Manual test: fires immediately regardless of any rule's range, same as
		// n8n's native Schedule Trigger ignores its own cadence when tested by hand.
		const manualTriggerFunction = async () => {
			emitNow();
		};

		return {
			closeFunction,
			manualTriggerFunction,
		};
	}
}
