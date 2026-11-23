// tests/fixtures/v1134-render-entry.ts — V1134 image-display guard entry.
// ONE esbuild bundle that shares a single store instance with the MessageView
// under test (separate bundles would each carry their own zustand module state).
// Test-only asset: imports the REAL app sources, never re-implements them.
export { useStore } from '../../src/store';
export { MessageView } from '../../src/components/MessageView';
