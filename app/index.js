import 'dotenv/config'
import { URL, fileURLToPath } from 'node:url'
import { readFileSync, statSync } from 'node:fs'
import express from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import jwkToPem from 'jwk-to-pem'
import { fillTemplate, fillTemplateText } from './templater.js'
import { initTracking, countVisit } from './tracking.js'

//
// Auxiliary functions
//
function checkPath(path) {
	return !!path.match(/^[a-zA-Z0-9][a-zA-Z0-9-]+$/)
}
function genericTemplateHandler(req, res, filename, baseURL, varianted = true, mode = 'text') {
	const template = readFileSync(fileURLToPath(new URL(filename, baseURL)), 'utf-8')
	const clientConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../resources/clients.json', import.meta.url)), 'utf-8'))
	const opts = {
		role: req.auth?.client ?? 'guest',
		roles: req.auth?.clients ?? [],
	}
	if(varianted) {
		opts.variant = req.params.variant
		if(Array.isArray(clientConfig.variantLabels)) {
			opts.variants = Object.fromEntries((req.params.variant?.split('-') || []).map((it, idx) => [ clientConfig.variantLabels[idx] ?? `variant-${idx + 1}`, it ]))
			// Check that there are no more keys than variant labels
			if(Object.keys(opts.variants).length > clientConfig.variantLabels.length) {
				res.sendStatus(404)
				return
			}
			// Check if root-level key for each variant label exists
			if(!clientConfig.variantLabels.every(label => clientConfig.via?.[label]?.[opts.variants[label]])) {
				res.sendStatus(404)
				return
			}
		} else {
			// Check if root-level variant key exists
			if(!clientConfig.via?.variant?.[opts.variant]) {
				res.sendStatus(404)
				return
			}
		}
	}
	res.send({
		text: it => fillTemplateText(it, clientConfig, opts),
		json: it => fillTemplate(JSON.parse(it), clientConfig, opts),
	}[mode](template))
}

//
// Fetch Keycloak address
//
const jwksUrl = await fetch(`${process.env.KEYCLOAK_ADDRESS}/.well-known/openid-configuration`)
	.then(stream => stream.json())
	.then(({ jwks_uri }) => jwks_uri)

//
// Express basic configuration
//
const app = express()
app.set('strict routing', true)
app.use(cookieParser())
app.use((req, res, next) => {
	res.set('Access-Control-Allow-Origin', '*')
	next()
})
app.use(async (req, res, next) => {
	if(!req.cookies.token) {
		next()
		return
	}
	try {
		const decodedToken = jwt.decode(req.cookies.token, { complete: true })
		const kid = decodedToken.header.kid
		const jwks = await fetch(jwksUrl).then(stream => stream.json())
		const jwk = jwks.keys.find(jwk => jwk.kid === kid)
		const publicKey = jwkToPem(jwk)
		req.auth = jwt.verify(req.cookies.token, publicKey)
		next()
	} catch(e) {
		console.log(e)
		delete req.cookies.token
		next()
	}
})
app.use(express.static('dist'))

if(process.env.VARIANT_ONLY == true) {
	// Rewrite to portal (variant-only)
	app.use((req, res, next) => {
		if(req.url.startsWith('/resources/')) {
			next()
			return
		}
		if(req.url.startsWith('/portal/')) {
			res.redirect(308, req.url.slice(7))
			return
		}
		req.url = `/portal${req.url}`
		next()
	})
} else {
	// Redirect for landing page
	app.get('/', (req, res) => {
		res.redirect(308, '/portal/')
	})
}

//
// Resources folder
//
app.use('/resources/', (req, res, next) => {
	req.resourcesURL = new URL('../resources/', import.meta.url)
	next()
})
app.get('/resources/services-internet.json', (req, res) => {
	genericTemplateHandler(req, res, 'services-internet.json', req.resourcesURL, false, 'json')
})
app.get('/resources/rest-services-internet.json', (req, res) => {
	genericTemplateHandler(req, res, 'rest-services-internet.json', req.resourcesURL, false, 'json')
})
app.get('/resources/style_v3.json', (req, res) => {
	genericTemplateHandler(req, res, 'style_v3.json', req.resourcesURL, false, 'json')
})

// Fallback route
app.use('/resources', express.static('resources'))

//
// Portal folder
//
app.get('/:portal', (req, res) => {
	if(!checkPath(req.params.portal)) {
		res.sendStatus(404)
		return
	}
	res.redirect(308, `/${req.params.portal}/`)
})
app.use('/:portal/', (req, res, next) => {
	if(!checkPath(req.params.portal)) {
		res.sendStatus(404)
		return
	}
	req.portalURL = new URL(`${req.params.portal}/`, new URL('../portal/', import.meta.url))
	try {
		const stats = statSync(fileURLToPath(req.portalURL))
		if(!stats.isDirectory()) throw new Error()
	} catch(e) {
		res.sendStatus(404)
		return
	}
	next()
})

// Fix paths build with ../../-relative URLs
app.use('/:portal/mastercode', (req, res) => {
	res.redirect(308, `/mastercode/${req.url}`)
})
app.get('/:portal/favicon.ico', (req, res) => {
	res.redirect(308, '/favicon.ico')
})

// Set tracking via monitoring software if configured
if(process.env.TRACKING_API_KEY_NAME && process.env.TRACKING_API_URL && process.env.TRACKING_API_KEY) {
	initTracking()
}

// Portal file handler
function indexHandler(req, res) {
	countVisit(req.params.variant)
	genericTemplateHandler(req, res, 'index.html', req.portalURL, true, 'text')
}
function configJsHandler(req, res) {
	genericTemplateHandler(req, res, 'config.js', req.portalURL, true, 'text')
}
function configJsonHandler(req, res) {
	genericTemplateHandler(req, res, 'config.json', req.portalURL, true, 'json')
}

// Variant-free portal
app.get('/:portal/', indexHandler)
app.get('/:portal/config.js', configJsHandler)
app.get('/:portal/config.json', configJsonHandler)

// Fallback route
app.use('/:portal', express.static('portal'))

// Variant-based portal
app.get('/:portal/:variant', (req, res) => {
	if(!checkPath(req.params.variant)) {
		res.sendStatus(404)
		return
	}
	res.redirect(308, `/${req.params.portal}/${req.params.variant}/`)
})
app.use('/:portal/:variant/', (req, res, next) => {
	if(!checkPath(req.params.variant)) {
		res.sendStatus(404)
		return
	}
	next()
})
app.get('/:portal/:variant/', indexHandler)
app.get('/:portal/:variant/config.js', configJsHandler)
app.get('/:portal/:variant/config.json', configJsonHandler)

if(process.env.NODE_ENV === 'development') {
	app.listen(9000, () => {
		console.info('App is running at PORT: 9000')
	})
} else {
	app.listen(80, () => {
		console.info('App is running at PORT: 80')
	})
}
