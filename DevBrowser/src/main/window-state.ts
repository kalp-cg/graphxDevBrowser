import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface WindowState extends Partial<Rectangle> {
  maximized?: boolean;
}

const file = () => path.join(app.getPath('userData'), 'window-state.json');

/** The last size and position, if that spot is still on a connected display. */
export function loadWindowState(defaults: { width: number; height: number }): WindowState & { width: number; height: number } {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8')) as WindowState;
    const w = Number(s.width), h = Number(s.height);
    if (!(w >= 640 && h >= 500)) return defaults;
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      const visible = screen.getAllDisplays().some(d => {
        const b = d.workArea;
        return s.x! + 80 < b.x + b.width && s.x! + w - 80 > b.x && s.y! >= b.y - 20 && s.y! + 80 < b.y + b.height;
      });
      if (visible) return { width: w, height: h, x: s.x, y: s.y, maximized: s.maximized };
    }
    return { width: w, height: h, maximized: s.maximized };
  } catch {
    return defaults;
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const state: WindowState = { ...(win.isMaximized() ? {} : win.getBounds()), maximized: win.isMaximized() };
    if (win.isMaximized()) Object.assign(state, loadPrevious());
    try {
      fs.writeFileSync(file(), JSON.stringify(state));
    } catch {
      // not worth failing over
    }
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', save);
}

function loadPrevious(): WindowState {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as WindowState;
  } catch {
    return {};
  }
}
