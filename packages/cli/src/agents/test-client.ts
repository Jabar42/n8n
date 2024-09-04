import { nanoid } from 'nanoid';
import type { AgentManager } from './agent-manager.service';
import type { Job, JobRequest, N8nMessage, WorkerMessage } from './agent-types';
import type { INodeExecutionData } from 'n8n-workflow';

const code = `
// Loop over input items and add a new field called 'myNewField' to the JSON of each one
for (const item of $input.all()) {
  item.json.myNewField = 1;
}

return $input.all();
`;

const inputData: INodeExecutionData[] = [
	{ json: { something: 'haha' } },
	{ json: { something: 'haha2' } },
];

export class TestClient {
	id: string;

	outstandingRequests: Record<JobRequest['requestId'], JobRequest> = {};

	runningJobs: Record<
		Job['id'],
		{
			id: Job['id'];
			jobType: string;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			settings: any;
		}
	> = {};

	constructor(public manager: AgentManager) {
		this.id = nanoid();
		this.manager.registerWorker(this.id, this.onMessage);

		setTimeout(this.sendRequests, 1000);
	}

	sendRequests = () => {
		const validUntil = process.hrtime.bigint() + BigInt(1000 * 1_000_000);
		const request: JobRequest = {
			jobType: 'javascript',
			workerId: this.id,
			requestId: nanoid(),
			validFor: 1000,
			validUntil,
		};
		this.outstandingRequests[request.requestId] = request;
		this.manager.jobRequested(request);

		setTimeout(this.sendRequests, 5000);
	};

	async messageManager(message: WorkerMessage.ToN8n.All) {
		await this.manager.onWorkerMessage(this.id, message);
	}

	onMessage = async (message: N8nMessage.ToWorker.All) => {
		console.log('worker', { message });
		switch (message.type) {
			case 'n8n:jobready':
				// Randomly cancel jobs to simulate another main
				// instance beating this one to the punch
				if (Math.round(Math.random())) {
					delete this.outstandingRequests[message.requestId];
					await this.sendCancelJob(message.jobId, '*shrug*');
					return;
				}
				console.log('accepted');
				await this.startJob(message.requestId, message.jobId);
				break;
			case 'n8n:jobdone':
			case 'n8n:joberror':
				console.log(message);
				break;
			case 'n8n:jobdatarequest':
				await this.processDataRequest(
					message.jobId,
					message.requestId,
					message.requestType,
					message.param,
				);
				break;
			default:
				// eslint-disable-next-line n8n-local-rules/no-plain-errors
				throw new Error('Unimplemented: ' + message.type);
		}
	};

	async processDataRequest(
		jobId: Job['id'],
		requestId: string,
		requestType: N8nMessage.ToWorker.JobDataRequest['requestType'],
		_param?: string,
	) {
		if (requestType === 'input') {
			await this.messageManager({
				type: 'worker:jobdataresponse',
				jobId,
				requestId,
				data: inputData,
			});
		} else if (requestType === 'node') {
			await this.messageManager({
				type: 'worker:jobdataresponse',
				jobId,
				requestId,
				data: [],
			});
		} else if (requestType === 'all') {
			await this.messageManager({
				type: 'worker:jobdataresponse',
				jobId,
				requestId,
				data: {
					input: inputData,
					node: [],
				},
			});
		}
	}

	async sendCancelJob(jobId: string, reason: string) {
		await this.messageManager({
			type: 'worker:jobcancel',
			jobId,
			reason,
		});
	}

	async startJob(requestId: string, jobId: string) {
		const request = this.outstandingRequests[requestId];
		delete this.outstandingRequests[requestId];
		console.log({ request });
		this.runningJobs[jobId] = {
			id: jobId,
			jobType: request.jobType,
			settings: { code },
		};
		await this.messageManager({
			type: 'worker:jobsettings',
			jobId,
			settings: this.runningJobs[jobId].settings,
		});
	}
}
