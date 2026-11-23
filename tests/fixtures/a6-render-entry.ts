// tests/fixtures/a6-render-entry.ts — A6 harness entry: ONE bundle that shares
// a single store instance across the renderer components under test (separate
// bundles would each carry their own zustand store module state).
export { useStore, PROVIDER_PRESETS } from '../../src/store';
export { providerModelIds } from '../../src/lib/providerSlice';
export { ModelPicker } from '../../src/components/ModelPicker';
