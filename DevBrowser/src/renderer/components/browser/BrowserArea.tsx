import React from 'react';
import { useBrowserStore } from '../../store/useBrowserStore';
import { PageView } from './PageView';

/**
 * Every tab's page, mounted for the life of the tab and never moved in the DOM (that would reload it).
 * The active tab is shown; in split view, both tabs of the pair, placed left and right with CSS order.
 */
export const BrowserArea: React.FC<{ hidden?: boolean }> = ({ hidden }) => {
  const tabs = useBrowserStore(s => s.tabs);
  const activeId = useBrowserStore(s => s.activeId);
  const split = useBrowserStore(s => s.split);

  return (
    <div style={{ flex: 1, minWidth: 0, display: hidden ? 'none' : 'flex', background: 'var(--bg-primary)' }}>
      {tabs.map(tab => {
        const pane = split ? split.indexOf(tab.id) : tab.id === activeId ? 0 : -1;
        return (
          <PageView key={tab.id} tab={tab} visible={pane >= 0} paneOrder={Math.max(pane, 0)}
            showPaneHeader={!!split} focused={tab.id === activeId} />
        );
      })}
    </div>
  );
};
