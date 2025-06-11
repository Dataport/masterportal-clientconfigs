function getByPath (obj, path) {
	return path.reduce((acc, it) => acc?.[it], obj)
}

function translatePath (s) {
	const parts = s.split('.')
	return parts.flatMap(part => {
		const [first, ...indices] = part.split('[')
		return [first, ...indices.map(i => i.slice(0, -1))]
	})
}

function splitCommandParameter (s) {
	let bc = 0
	let start
	const res = []
	for (let i = 0; i < s.length; i++) {
		switch (s[i]) {
			case '(':
				if (bc === 0) {
					start = i + 1
				}
				bc++
				break
			case ')':
				bc--
				if (bc === 0) {
					res.push(s.slice(start, i))
				}
				break
		}
	}
	return res
}

function checkCommand (op, s, config, opts) {
	const opPrefix = `${op} `
	if (!s.startsWith(opPrefix)) return false
	return splitCommandParameter(s.slice(opPrefix.length))
		.map(par => getTemplate(par, config, opts))
}

// This function is long, but not complex...
// eslint-disable-next-line complexity
function getTemplate (s, config, opts) {
	switch (s) {
		case 'otherwise': return true
		case 'true': return true
		case 'false': return false
		case 'role': return opts.role
		case 'roles': return opts.roles
		case 'variant': return opts.variant
	}
	if (s.startsWith("'") && s.endsWith("'")) {
		return s.slice(1, -1)
	}
	let res
	if (!isNaN(res = +s)) {
		return res
	}
	if (res = s.match(/^opt\((?<via>.+)\)$/)) {
		return opts[res.groups.via] || opts.variants?.[res.groups.via]
	}
	if (res = s.match(/^env\((?<env>.+)\)$/)) {
		return process.env[res.groups.env]
	}
	if (res = s.match(/^via\((?<via>.+)\) (?<template>.+)$/)) {
		const viaMap = config.via?.[res.groups.via]
		const viaValue = opts[res.groups.via] || opts.variants?.[res.groups.via]
		return getTemplate(res.groups.template, viaMap?.[viaValue] ?? viaMap?.fallback, opts)
	}
	if (res = checkCommand('not', s, config, opts)) return !res[0]
	if (res = checkCommand('eq', s, config, opts)) return res[0] === res[1]
	if (res = checkCommand('neq', s, config, opts)) return res[0] !== res[1]
	if (res = checkCommand('and', s, config, opts)) return res[0] && res[1]
	if (res = checkCommand('or', s, config, opts)) return res[0] || res[1]
	if (res = checkCommand('elem', s, config, opts)) return Array.isArray(res[1]) && res[1].includes(res[0])
	const path = translatePath(s)
	return getByPath(config, path)
}

export function fillTemplateText (s, config, opts) {
	const exactMatch = s.match(/^{{ ([^}]+?) }}$/)
	if (exactMatch) {
		return getTemplate(exactMatch[1], config, opts)
	}

	const textMatches = s.matchAll(/{{ (.+?) }}/g)
	for (const [from, target] of textMatches) {
		s = s.replace(from, getTemplate(target, config, opts))
	}
	return s
}

function checkTemplate (s, config, opts) {
	const res = s.match(/^{{ (?<target>.+) }}$/)
	return res ? getTemplate(res.groups.target, config, opts) : null
}

export function fillTemplate (template, config, opts) {
	if (Array.isArray(template)) {
		return template
			.map(it => fillTemplate(it, config, opts))
			.filter(it => !(typeof it === 'object' && Object.keys(it).length === 0))
	}
	if (typeof template === 'object' && template !== null) {
		for (const [k, v] of Object.entries(template)) {
			const res = checkTemplate(k, config, opts)
			if (res) {
				return fillTemplate(v, config, opts)
			} else if (res !== null) {
				delete template[k]
			}
		}
		return Object.fromEntries(Object.entries(template)
			.map(([k, v]) => ([k, fillTemplate(v, config, opts)]))
			.filter(([k, v]) => !(typeof v === 'object' && Object.keys(v).length === 0)))
	}
	if (typeof template === 'string') {
		return fillTemplateText(template, config, opts)
	}
	return template
}
