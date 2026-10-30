import { beforeEach, describe, expect, it } from 'vitest';
import { useBrowserStore } from '../../src/renderer/store/useBrowserStore';

const names = () => useBrowserStore.getState().tabs.map(t => t.url.replace('http://', ''));
const open = (...urls: string[]) => urls.map(u => useBrowserStore.getState().newTab(u));

describe('tabs', () => {
  beforeEach(() => {
    const first = useBrowserStore.getState().tabs[0]!;
    useBrowserStore.setState({ tabs: [{ ...first, url: 'http://a.test', initialUrl: 'http://a.test', pinned: false }], activeId: first.id, closed: [], split: null });
  });

  it('opens a tab next to the others and makes it the active one', () => {
    const [b] = open('http://b.test');
    expect(names()).toEqual(['a.test', 'b.test']);
    expect(useBrowserStore.getState().activeId).toBe(b);
  });

  it('moves a tab by dragging it, and keeps pinned tabs together on the left', () => {
    const [b, c] = open('http://b.test', 'http://c.test');
    useBrowserStore.getState().moveTab(c!, 0);
    expect(names()).toEqual(['c.test', 'a.test', 'b.test']);
    useBrowserStore.getState().togglePin(b!);
    expect(names()).toEqual(['b.test', 'c.test', 'a.test']);                  // pinned first
    useBrowserStore.getState().moveTab(c!, 0);                                // dropped before a pinned one: still after it
    expect(names()[0]).toBe('b.test');
    useBrowserStore.getState().togglePin(b!);
    expect(useBrowserStore.getState().tabs.every(t => !t.pinned)).toBe(true);
  });

  it('duplicates next to the original and switches to the copy', () => {
    const [b] = open('http://b.test', 'http://c.test');
    useBrowserStore.getState().duplicateTab(b!);
    expect(names()).toEqual(['a.test', 'b.test', 'b.test', 'c.test']);
    expect(useBrowserStore.getState().tabs[2]!.id).toBe(useBrowserStore.getState().activeId);
  });

  it('closes the others, or those to the right, but never a pinned tab, and can bring them back', () => {
    const [b, c, d] = open('http://b.test', 'http://c.test', 'http://d.test');
    useBrowserStore.getState().togglePin(d!);                                  // d.test, a, b, c
    useBrowserStore.getState().closeToRight(b!);
    expect(names()).toEqual(['d.test', 'a.test', 'b.test']);                  // c gone; pinned d stays
    useBrowserStore.getState().closeOthers(b!);
    expect(names()).toEqual(['d.test', 'b.test']);                            // a gone; pinned d stays
    expect(useBrowserStore.getState().activeId).toBe(b);
    useBrowserStore.getState().reopenTab();
    expect(names()).toContain('a.test');
    void c;
  });

  it('switches by index and cycles, wrapping around', () => {
    open('http://b.test', 'http://c.test');
    const s = useBrowserStore.getState();
    s.activateIndex(1);
    expect(useBrowserStore.getState().tabs[0]!.id).toBe(useBrowserStore.getState().activeId);
    s.activateIndex(9);                                                       // Cmd+9 is the last tab
    expect(names()[2]).toBe('c.test');
    s.cycle(1);
    expect(useBrowserStore.getState().activeId).toBe(useBrowserStore.getState().tabs[0]!.id);
    s.cycle(-1);
    expect(useBrowserStore.getState().activeId).toBe(useBrowserStore.getState().tabs[2]!.id);
  });
});
