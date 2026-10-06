import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSave } from '../src/core/save';

const cloud = vi.hoisted(() => ({ uid: 'player-a' as string | null, changed: () => {}, profile: vi.fn(), share: vi.fn() }));
vi.mock('../src/platform/cloud', () => ({
  cloudAvailable: () => true, cloudSession: () => cloud.uid ? { userId: cloud.uid, accessToken: 'test' } : null,
  cloudUser: () => cloud.uid ? { name: cloud.uid, provider: 'google' } : null,
  cloudProfile: () => cloud.profile(cloud.uid),
  onCloudChange: (fn: () => void) => { cloud.changed = fn; return () => { cloud.changed = () => {}; }; },
  refreshAuthProviders: async () => null,
}));
vi.mock('../src/platform/signin', () => ({
  friendCodeSeen: () => {},
  friendRewardStatus: async () => ({ ok: true, coins: 0, gems: 0, rewards: [], claimed: false, friends: 0 }),
}));
vi.mock('../src/platform/invite', () => ({ PLAY_URL: 'https://example.test/play', shareInvite: (code: unknown) => cloud.share(code) }));
vi.mock('../src/platform/native', () => ({ inNativeApp: () => false }));
vi.mock('../src/audio/sfx', () => ({ sfx: { click: () => {} } }));
import { openAccountPanel } from '../src/ui/account';

class TestElement extends EventTarget {
  innerHTML = '';
  className = '';
  value = '';
  children: TestElement[] = [];
  private queried = new Map<string, TestElement>();
  querySelector(selector: string): TestElement | null {
    if (selector === 'input') return null;
    if (!this.queried.has(selector)) this.queried.set(selector, new TestElement());
    return this.queried.get(selector)!;
  }
  appendChild(el: TestElement) { this.children.push(el); }
  remove() {}
}
let ui: TestElement;
let panel: TestElement;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function click(action: string) {
  const event = new Event('click');
  Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { a: action } }) } });
  panel.dispatchEvent(event);
}
function open() {
  openAccountPanel({ save: defaultSave(), persist: () => {}, reload: () => {} }, () => {}, 'friend');
  panel = ui.children.at(-1)!.querySelector('.panel')!;
}

beforeEach(() => {
  cloud.uid = 'player-a';
  cloud.profile.mockReset();
  cloud.share.mockReset().mockResolvedValue('canceled');
  ui = new TestElement();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { getElementById: () => ui, createElement: () => new TestElement() });
});
afterEach(() => { click('back'); vi.unstubAllGlobals(); });

describe('friend-code account identity', () => {
  it('immediately clears the previous account code before sharing after a switch', async () => {
    cloud.profile.mockResolvedValueOnce({ code: 'AAA2345' });
    open();
    await settle();
    expect(panel.innerHTML).toContain('AAA2345');
    cloud.profile.mockImplementationOnce(() => new Promise(() => {}));
    cloud.uid = 'player-b';
    cloud.changed();
    expect(panel.innerHTML).not.toContain('AAA2345');
    click('share');
    expect(cloud.share).toHaveBeenCalledWith(null);
  });
  it('ignores a late old account profile after the new profile has loaded', async () => {
    let resolveA!: (profile: { code: string }) => void;
    cloud.profile.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    open();
    cloud.profile.mockResolvedValueOnce({ code: 'BBB2345' });
    cloud.uid = 'player-b';
    cloud.changed();
    await settle();
    expect(panel.innerHTML).toContain('BBB2345');
    resolveA({ code: 'AAA2345' });
    await settle();
    expect(panel.innerHTML).toContain('BBB2345');
    expect(panel.innerHTML).not.toContain('AAA2345');
    click('share');
    expect(cloud.share).toHaveBeenCalledWith('BBB2345');
  });
});
