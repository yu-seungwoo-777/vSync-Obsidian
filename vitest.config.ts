import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		exclude: ['node_modules/**', 'dist/**'],
		environment: 'node',
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'text-summary'],
			exclude: [
				'esbuild.config.mjs',
				'vitest.config.ts',
				'tests/**',
				'node_modules/**',
				'dist/**',
			],
		},
	},
	resolve: {
		alias: {
			// obsidian 패키지가 main/module을 지정하지 않아 Vite가 해석하지 못함
			// 테스트 mock으로 대체
			obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
		},
	},
});
