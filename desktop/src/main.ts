import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { pathToFileURL } from 'node:url';

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

let mainWindow: BrowserWindow | null = null;
let serverHandle: ServerHandle | null = null;

/**
 * Resolve the path to the compiled harness server module. In dev (running via
 * `npm run dev` inside desktop/) it sits two levels up at ../dist/server/index.js.
 * In a packaged build it's at resources/harness/dist/server/index.js — see the
 * extraResources entry in package.json.
 */
function resolveHarnessEntry(): string {
  if (!app.isPackaged) {
    return path.resolve(__dirname, '..', '..', 'dist', 'server', 'index.js');
  }
  // electron-builder unpacks extraResources to process.resourcesPath/harness
  return path.join(process.resourcesPath, 'harness', 'dist', 'server', 'index.js');
}

function resolveWebDist(): string | undefined {
  if (!app.isPackaged) {
    const dev = path.resolve(__dirname, '..', '..', 'web', 'dist');
    return fs.existsSync(dev) ? dev : undefined;
  }
  const prod = path.join(process.resourcesPath, 'harness', 'web', 'dist');
  return fs.existsSync(prod) ? prod : undefined;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('could not allocate port')));
      }
    });
  });
}

async function startHarnessServer(): Promise<ServerHandle> {
  const entry = resolveHarnessEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      `harness server not built. Expected at ${entry}. Run \`npm run build\` in the repo root.`
    );
  }
  // Dynamic import so the Electron bundle doesn't need to statically know
  // about the harness package. Loaded via file URL because the harness is
  // compiled as an ESM module ("type": "module" in its package.json).
  const mod = await import(pathToFileURL(entry).href);
  const serve: (opts: {
    port?: number;
    host?: string;
    webDist?: string;
  }) => Promise<ServerHandle> = mod.serve;
  if (typeof serve !== 'function') {
    throw new Error('harness module did not export serve()');
  }
  const port = await findFreePort();
  return serve({ port, host: '127.0.0.1', webDist: resolveWebDist() });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Run…',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-run')
        },
        { type: 'separator' },
        {
          label: 'Open ~/.agent-harness',
          click: () => {
            const home = process.env.AGENT_HARNESS_HOME
              ? process.env.AGENT_HARNESS_HOME
              : path.join(app.getPath('home'), '.agent-harness');
            void shell.openPath(home);
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'agent-harness on GitHub',
          click: () => {
            void shell.openExternal('https://github.com/anthropics/agent-harness');
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Agent Harness',
    backgroundColor: '#1e3a8a',
    // hiddenInset: macOS shows traffic-light controls over the content (no
    // native title bar strip), so the blue Sentinel header can occupy the
    // full top of the window. The renderer side adds left padding under the
    // controls and marks the header draggable via -webkit-app-region.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in the default browser, not inside the window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!serverHandle) {
    try {
      serverHandle = await startHarnessServer();
    } catch (err) {
      dialog.showErrorBox(
        'Failed to start harness server',
        (err as Error).message ?? String(err)
      );
      app.quit();
      return;
    }
  }
  await mainWindow.loadURL(serverHandle.url);
}

app.whenReady().then(async () => {
  buildMenu();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (serverHandle) {
    e.preventDefault();
    const handle = serverHandle;
    serverHandle = null;
    try {
      await handle.close();
    } catch {
      /* ignore */
    }
    app.quit();
  }
});
