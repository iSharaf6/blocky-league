import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  impact: vi.fn(async (_o: unknown) => undefined),
  pattern: vi.fn(async (_o: unknown) => undefined),
  selection: vi.fn(async () => undefined),
  notify: vi.fn(async (_o: unknown) => undefined),
  prepare: vi.fn(async () => undefined),
  then: vi.fn(),
}));

// Capacitor's plugin proxy exposes every property, including `then`. Returning it directly through a promise
// would make even correctly registered haptics hang, so exercise that actual bridge behaviour here.
vi.mock('@capacitor/core', () => ({ registerPlugin: () => bridge }));

describe('native haptics dispatch', () => {
  let api: typeof import('../src/platform/haptics');
  const doc = { hidden: false };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge.pattern.mockResolvedValue(undefined);
    doc.hidden = false;
    vi.stubEnv('VITE_PORTAL', 'none');
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    vi.stubGlobal('document', doc);
    api = await import('../src/platform/haptics');
    api.setHapticsLevel('full');
    await vi.waitFor(() => expect(bridge.prepare).toHaveBeenCalledOnce());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reaches the native bridge and sends the continuous shot buzz without awaiting the plugin proxy', async () => {
    api.buzz('shot');
    await vi.waitFor(() => expect(bridge.impact).toHaveBeenCalledWith({
      style: 'medium', intensity: 1, count: undefined, apart: undefined, duration: 70,
    }));
    expect(bridge.then).not.toHaveBeenCalled();
  });

  it('acknowledges a gameplay button immediately without swallowing its actual pass contact', async () => {
    api.buzz('button');
    api.buzz('pass');
    await vi.waitFor(() => expect(bridge.impact).toHaveBeenCalledTimes(2));
    expect(bridge.impact).toHaveBeenNthCalledWith(1, {
      style: 'light', intensity: 0.8, count: undefined, apart: undefined, duration: 40,
    });
    expect(bridge.impact).toHaveBeenNthCalledWith(2, {
      style: 'light', intensity: 0.85, count: undefined, apart: undefined, duration: undefined,
    });
    expect(bridge.then).not.toHaveBeenCalled();
  });

  it.each(['quiet', 'off', 'light', 'hidden'] as const)('does not acknowledge a gameplay button when %s', async (change) => {
    if (change === 'quiet') api.setHapticsQuiet(true);
    else if (change === 'hidden') doc.hidden = true;
    else api.setHapticsLevel(change);
    api.buzz('button');
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.impact).not.toHaveBeenCalled();
  });

  it('falls back to impacts when an older installed native build has no pattern method', async () => {
    bridge.pattern.mockRejectedValueOnce(new Error('unimplemented'));
    api.buzz('goal');
    await vi.waitFor(() => expect(bridge.impact).toHaveBeenCalledWith({
      style: 'heavy', intensity: 1, count: 2, apart: 110, duration: undefined,
    }));
    expect(bridge.notify).toHaveBeenCalledWith({ type: 'success' });
  });

  it.each(['quiet', 'off', 'light', 'hidden'] as const)('drops a pending shot when %s changes before bridge dispatch', async (change) => {
    api.buzz('shot');
    if (change === 'quiet') api.setHapticsQuiet(true);
    else if (change === 'hidden') doc.hidden = true;
    else api.setHapticsLevel(change);
    // The bridge is already primed; let its pending dispatch and prepare callbacks run.
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.impact).not.toHaveBeenCalled();
  });

  it('does not let a rejected pattern bypass an ad that starts while it is pending', async () => {
    bridge.pattern.mockImplementationOnce(async () => {
      api.setHapticsQuiet(true);
      throw new Error('unimplemented');
    });
    api.buzz('goal');
    await vi.waitFor(() => expect(bridge.pattern).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(bridge.impact).not.toHaveBeenCalled();
    expect(bridge.notify).not.toHaveBeenCalled();
  });
});
