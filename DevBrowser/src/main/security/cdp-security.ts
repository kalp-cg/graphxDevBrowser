import { session } from 'electron';

export function configureSecurityDirectives(): void {
  // Enforce Content Security Policy (CSP) headers on default session
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Only apply strict CSP to application's internal UI URLs
    if (details.url.startsWith('http://localhost') || details.url.startsWith('app://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://127.0.0.1:11434 http://localhost:9000 https:; font-src 'self' data:;"
          ]
        }
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // Block permission requests by default for camera/microphone unless explicitly approved
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['clipboard-read', 'clipboard-write'];
    callback(allowed.includes(permission));
  });
}
