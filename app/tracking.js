import { readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url'

const hitRatePerPortal = {}

export function countVisit (reqParamsVariant) {
	if (Object.prototype.hasOwnProperty.call(hitRatePerPortal, reqParamsVariant)) {
		hitRatePerPortal[reqParamsVariant] += 1
	}
}

function setHitRatePerPortal (labels, via, prefix = '') {
	if (labels.length === 0) {
		hitRatePerPortal[prefix.slice(1)] = 0
		return
	}
	const [firstLabel, ...restLabels] = labels
	const variants = Object.keys(via[firstLabel])

	variants.forEach(variant => {
		setHitRatePerPortal(restLabels, via, `${prefix}-${variant}`)
	})
}

function sendRequestCountsToApi () {
	const data = JSON.stringify({
		series: Object.keys(hitRatePerPortal).map(portal => ({
			metric: 'portal.hit.rates',
			points: [
				{
					timestamp: Math.floor(Date.now() / 1000),
					value: hitRatePerPortal[portal],
				},
			],
			tags: [`portal:${portal}`, `environment:${process.env.TRACKING_ENVIRONMENT}`],
		})),
	})

	fetch(process.env.TRACKING_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(data, 'utf8').toString(),
			[process.env.TRACKING_API_KEY_NAME]: process.env.TRACKING_API_KEY,
		},
		body: data,
	})
		.then(response => response.text())
		.then(responseData => {
			console.info('Hit rates sent to Monitoring API', responseData)
			Object.keys(hitRatePerPortal).forEach(portal => {
				hitRatePerPortal[portal] = 0
			})
		})
		.catch(error => {
			console.error('Error sending request counts to API:', error)
		})
}

export function initTracking () {
	const clientConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../resources/clients.json', import.meta.url)), 'utf-8'))
	setHitRatePerPortal(clientConfig.variantLabels, clientConfig.via)

	const interval = process.env.TRACKING_TRANSFER_INTERVAL * 1000 || 3600000
	setInterval(sendRequestCountsToApi, interval)
}
