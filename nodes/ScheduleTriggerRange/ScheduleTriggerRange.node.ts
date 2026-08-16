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
	isInTriggerWeek,
	isWithinRange,
	parseRuleRange,
	ruleToCronExpression,
} from './RangeSchedule';

/**
 * Collapsed-panel title for each Trigger Rule: the user's own Custom Name if
 * set, otherwise a summary of the rule's actual configuration (e.g. "Every 3
 * Days", "Cron: 0 6 * * *") - rather than n8n's generic default of "Interval
 * 1", "Interval 2", etc. Evaluated by the editor against `$collection.item.value`
 * (this entry's own field values), so it must stay a single expression string,
 * not a plain-TS helper - it can't be unit tested outside n8n's editor.
 */
const RULE_ITEM_TITLE_EXPRESSION =
	"={{ $collection.item.value.ruleName ? $collection.item.value.ruleName : " +
	"$collection.item.value.field === 'seconds' ? 'Every ' + ($collection.item.value.secondsInterval || 1) + ' Second' + (($collection.item.value.secondsInterval || 1) === 1 ? '' : 's') : " +
	"$collection.item.value.field === 'minutes' ? 'Every ' + ($collection.item.value.minutesInterval || 1) + ' Minute' + (($collection.item.value.minutesInterval || 1) === 1 ? '' : 's') : " +
	"$collection.item.value.field === 'hours' ? 'Every ' + ($collection.item.value.hoursInterval || 1) + ' Hour' + (($collection.item.value.hoursInterval || 1) === 1 ? '' : 's') : " +
	"$collection.item.value.field === 'days' ? 'Every ' + ($collection.item.value.daysInterval || 1) + ' Day' + (($collection.item.value.daysInterval || 1) === 1 ? '' : 's') : " +
	"$collection.item.value.field === 'weeks' ? 'Every ' + ($collection.item.value.weeksInterval || 1) + ' Week' + (($collection.item.value.weeksInterval || 1) === 1 ? '' : 's') : " +
	"$collection.item.value.field === 'months' ? 'Every ' + ($collection.item.value.monthsInterval || 1) + ' Month' + (($collection.item.value.monthsInterval || 1) === 1 ? '' : 's') : " +
	"$collection.item.value.field === 'cronExpression' ? 'Cron: ' + ($collection.item.value.expression || '(empty)') : " +
	"'Trigger Rule' }}";

// Trigger nodes must not set `usableAsTool` at all - n8n's verified
// community-node scanner rejects it even as `false` ("Trigger nodes cannot
// be invoked as AI tools and doing so pollutes the tool picker"). This is
// more specific than our local generic rule below, which doesn't know this
// node is a trigger.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
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
					"Each Trigger Rule below can optionally have its own Start Date / End Date window (under 'Window', scroll down within a rule to find it). A rule with no dates set is always active. Ticks outside a rule's window are silently skipped - no item is emitted and no error is thrown.",
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
					// Falls back to the rule's own configuration (e.g. "Every 3 Days",
					// "Cron: 0 6 * * *") when Custom Name is left empty, rather than
					// the generic "Interval 1" n8n would otherwise show.
					fixedCollection: {
						itemTitle: RULE_ITEM_TITLE_EXPRESSION,
					},
				},
				default: { interval: [{ field: 'days', daysInterval: 1 }] },
				options: [
					{
						name: 'interval',
						displayName: 'Interval',
						// Alphabetical by displayName - n8n's verified community-node
						// scanner enforces this and ignores inline eslint-disable
						// comments, so a deliberately different UX order isn't an
						// option here. "Trigger Interval" and "Rule Name" are labelled
						// "Cadence" and "Custom Name" instead - genuine, equally clear
						// synonyms that happen to sort first, so the field that controls
						// which others are visible still appears at the top instead of
						// buried mid-list; "Range" is "Window" for the same reason, so
						// the optional date bounds land near the bottom. displayOptions.show
						// still keeps each field visible only for its relevant Cadence.
						values: [
							{
								displayName: 'Cadence',
								name: 'field',
								type: 'options',
								default: 'days',
								// Alphabetical by name - see the note on `values` above.
								options: [
									{
										name: 'Cron Expression',
										value: 'cronExpression',
									},
									{
										name: 'Days',
										value: 'days',
									},
									{
										name: 'Hours',
										value: 'hours',
									},
									{
										name: 'Minutes',
										value: 'minutes',
									},
									{
										name: 'Months',
										value: 'months',
									},
									{
										name: 'Seconds',
										value: 'seconds',
									},
									{
										name: 'Weeks',
										value: 'weeks',
									},
								],
							},
							{
								displayName: 'Custom Name',
								name: 'ruleName',
								type: 'string',
								default: '',
								placeholder: 'e.g. Business Hours',
								description:
									"Optional label shown for this rule instead of its auto-generated summary (e.g. \"Every 3 Days\"). Leave empty to use the summary.",
							},
							{
								displayName: 'Days Between Triggers',
								name: 'daysInterval',
								type: 'number',
								displayOptions: {
									show: {
										field: ['days'],
									},
								},
								default: 1,
								hint: 'Must be in range 1-31',
							},
							{
								displayName: 'Expression',
								name: 'expression',
								type: 'string',
								displayOptions: {
									show: {
										field: ['cronExpression'],
									},
								},
								default: '',
								placeholder: 'eg. 0 15 * 1 sun',
								hint: 'Format: ([Second	]) [Minute]	[Hour]	[Day of Month]	[Month]	[Day of Week]',
							},
							{
								displayName: 'Hours Between Triggers',
								name: 'hoursInterval',
								type: 'number',
								displayOptions: {
									show: {
										field: ['hours'],
									},
								},
								default: 1,
								hint: 'Must be in range 1-23',
							},
							{
								displayName: 'Minutes Between Triggers',
								name: 'minutesInterval',
								type: 'number',
								displayOptions: {
									show: {
										field: ['minutes'],
									},
								},
								default: 5,
								hint: 'Must be in range 1-59',
							},
							{
								displayName: 'Months Between Triggers',
								name: 'monthsInterval',
								type: 'number',
								displayOptions: {
									show: {
										field: ['months'],
									},
								},
								default: 1,
							},
							{
								displayName: 'Seconds Between Triggers',
								name: 'secondsInterval',
								type: 'number',
								displayOptions: {
									show: {
										field: ['seconds'],
									},
								},
								default: 30,
								hint: 'Must be in range 1-59',
							},
							{
								displayName: 'Trigger at Day of Month',
								name: 'triggerAtDayOfMonth',
								type: 'number',
								displayOptions: {
									show: {
										field: ['months'],
									},
								},
								default: 1,
								hint: "If a month doesn't have this day, the node won't trigger",
							},
							{
								displayName: 'Trigger at Hour',
								name: 'triggerAtHour',
								type: 'options',
								displayOptions: {
									show: {
										field: ['days', 'weeks', 'months'],
									},
								},
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
								displayOptions: {
									show: {
										field: ['hours', 'days', 'weeks', 'months'],
									},
								},
								default: 0,
							},
							{
								displayName: 'Trigger on Weekdays',
								name: 'weekday',
								type: 'multiOptions',
								displayOptions: {
									show: {
										field: ['weeks'],
									},
								},
								default: [0],
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
							{
								displayName: 'Weeks Between Triggers',
								name: 'weeksInterval',
								type: 'number',
								displayOptions: {
									show: {
										field: ['weeks'],
									},
								},
								default: 1,
								hint: 'Runs every week when left at 1',
							},
							{
								displayName: 'Window',
								name: 'range',
								type: 'collection',
								placeholder: 'Add Date',
								default: {},
								options: [
									{
										displayName: 'Start Date',
										name: 'startDate',
										type: 'dateTime',
										default: '',
										description:
											'Ticks from this rule before this date/time are skipped. Leave unset for no lower bound.',
									},
									{
										displayName: 'End Date',
										name: 'endDate',
										type: 'dateTime',
										default: '',
										description:
											'Ticks from this rule after this date/time are skipped. Leave unset for no upper bound.',
									},
								],
							},
							{
								displayName:
									'You can find help generating your cron expression <a href="https://crontab.guru/examples.html" target="_blank">here</a>',
								name: 'notice_cron_help',
								type: 'notice',
								displayOptions: {
									show: {
										field: ['cronExpression'],
									},
								},
								default: '',
							},
						],
					},
				],
			},
		],
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
				const now = new Date();
				if (!isWithinRange(now, start, end)) return;
				if (rule.field === 'weeks' && !isInTriggerWeek(now, rule.weeksInterval ?? 1)) return;
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
