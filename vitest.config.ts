import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        // Extension-host modules import the `vscode` API; alias it to a mock.
        alias: {
            vscode: fileURLToPath(new URL('./test/vscode.mock.ts', import.meta.url)),
        },
    },
});
