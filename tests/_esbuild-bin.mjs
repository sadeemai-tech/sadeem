// Cross-platform esbuild launcher for the self-bootstrapping test harnesses.
//
// The test suite used to call `execFileSync('./node_modules/.bin/esbuild', …)`.
// On Windows that path is a POSIX shell shim which cannot be executed directly
// (spawnSync ENOENT), so every bundling test failed before it reached a single
// assertion. Launching esbuild's JS shim with the current `node.exe` works
// identically on Windows, macOS and Linux.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Absolute path to esbuild's CLI shim (a JS file). */
export const ESBUILD_BIN = require.resolve('esbuild/bin/esbuild');

/** The executable used to run the shim (node.exe on Windows). */
export const ESBUILD_NODE = process.execPath;
