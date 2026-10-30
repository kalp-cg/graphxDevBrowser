import { describe, expect, it } from 'vitest';
import { append, asText, levelOf, MAX_ENTRIES, visible, type ConsoleEntry } from '../../src/shared/domain/console';

const e = (message: string, level: ConsoleEntry['level'] = 'log', tabId = 't1') => ({ tabId, level, message, source: 'app.js', line: 1, at: 1000 });

describe('console list', () => {
  it('maps chromium levels', () => {
    expect([0, 1, 2, 3].map(levelOf)).toEqual(['log', 'log', 'warning', 'error']);
  });

  it('counts a repeated message instead of listing it again', () => {
    let list: ConsoleEntry[] = [];
    list = append(list, e('boom', 'error'), 1);
    list = append(list, e('boom', 'error'), 2);
    list = append(list, e('boom', 'error'), 3);
    list = append(list, e('other', 'error'), 4);
    list = append(list, e('boom', 'error'), 5);
    expect(list.map(x => [x.message, x.count])).toEqual([['boom', 3], ['other', 1], ['boom', 1]]);
    expect(append(list, e('boom', 'error', 't2'), 6)).toHaveLength(4);       // another tab is another message
  });

  it('never grows without bound', () => {
    let list: ConsoleEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 50; i++) list = append(list, e(`m${i}`), i);
    expect(list).toHaveLength(MAX_ENTRIES);
    expect(list.at(-1)!.message).toBe(`m${MAX_ENTRIES + 49}`);
  });

  it('filters by level, tab and text', () => {
    let list: ConsoleEntry[] = [];
    list = append(list, e('hello'), 1);
    list = append(list, e('careful', 'warning'), 2);
    list = append(list, e('Cannot read properties of undefined', 'error'), 3);
    list = append(list, e('other tab fails', 'error', 't2'), 4);
    const f = { level: 'all' as const, tabId: null, text: '' };
    expect(visible(list, f)).toHaveLength(4);
    expect(visible(list, { ...f, level: 'error' }).map(x => x.message)).toEqual(['Cannot read properties of undefined', 'other tab fails']);
    expect(visible(list, { ...f, tabId: 't2' }).map(x => x.message)).toEqual(['other tab fails']);
    expect(visible(list, { ...f, text: 'UNDEFINED' })).toHaveLength(1);
  });

  it('copies as text', () => {
    expect(asText(append([], e('x', 'error'), 1))).toMatch(/ERROR x {2}\(app\.js:1\)/);
  });
});
