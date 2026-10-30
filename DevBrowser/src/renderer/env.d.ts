import type { DevBrowserAPI } from '../preload/api';

declare global {
  /** The version in package.json, injected at build time. */
  const __APP_VERSION__: string;

  interface Window {
    devBrowserAPI?: DevBrowserAPI;
  }
}

// Electron's <webview> tag (enabled with webviewTag: true in the main window).
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
      };
    }
  }
}
