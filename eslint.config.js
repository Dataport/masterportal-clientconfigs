import { defineConfig } from 'eslint/config'
import mainConfig from '@dataport/eslint-config-geodev'
import nodeConfig from '@dataport/eslint-config-geodev/node'

export default defineConfig([
	{
		ignores: ['dist/'],
	},
	{
		files: ['**/*.js'],
		extends: [mainConfig, nodeConfig],
		rules: {
			'no-cond-assign': 'off',
		},
	},
	{
		files: ['portal/*/config.js'],
		rules: {
			// This files require `const Config = ...`
			'no-unused-vars': 'off',
		},
	},
])
