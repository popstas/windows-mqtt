const {app, Tray, ipcMain, BrowserWindow} = require('electron');
const {start, cleanup} = require('./server');
const path = require('path');
const packageJson = require('../package.json');
const {log, getModulesEnabled} = require("./helpers");

function createWindow() {
  const icon = path.join(__dirname, '..', 'assets', 'trayicon.png');
  let mainWindow = new BrowserWindow({
    icon,
    width: 800,
    height: 600,
    show: false, // Start the app hidden
    autoHideMenuBar: true, // Hide the window menu
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // nodeIntegration: true,
      nodeIntegration: false,
      // contextIsolation: false,
      contextIsolation: true,
    },
  });

  void mainWindow.loadFile('../index.html');

  // IPC handler functions
  function handleMessageFromRenderer(event, message) {
    if (message.type === 'getEnabledModules') {
      const enabledModules = getModulesEnabled();
      event.reply('message-from-main', { type: 'getEnabledModulesResponse', data: enabledModules });
      return;
    }
    // log(`frontend message: ${JSON.stringify(message)}`);
  }

  function handleLog(event, arg) {
    log(`frontend: ${arg}`);
  }

  function handleLogToFrontend(message, logLevel) {
    // log(`log-to-frontend: [${logLevel}] ${message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log-to-frontend', message, logLevel);
    }
  }

  // Register IPC handlers
  ipcMain.on('message-from-renderer', handleMessageFromRenderer);
  ipcMain.on('log', handleLog);
  ipcMain.on('log-to-frontend', handleLogToFrontend);

  mainWindow.on('closed', function () {
    // Remove IPC handlers when window is closed
    ipcMain.removeListener('message-from-renderer', handleMessageFromRenderer);
    ipcMain.removeListener('log', handleLog);
    ipcMain.removeListener('log-to-frontend', handleLogToFrontend);
    mainWindow = null;
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }

    return false;
  });

  return mainWindow;
}

function handleRendererMessage(message) {
  if (typeof message !== 'object' || !message.type) {
    return;
  }
  if (message.type === 'getEnabledModules') {
    return getModulesEnabled();
  }
  log(`frontend message: ${message}`);
}

function createTray(mainWindow) {
  const iconPath = path.join(__dirname, '..', 'assets', 'trayicon.png');
  const tray = new Tray(iconPath);
  tray.setToolTip(`windows-mqtt ${packageJson.version}`);

  tray.on('click', function () {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
  return tray;
}

void startElectron();

async function startElectron() {
  let mainWindow;
  app.on('ready', () => {
    mainWindow = createWindow();
    const tray = createTray(mainWindow);
    start({tray, mainWindow});
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    // Clean up IPC handlers before quitting
    ipcMain.removeAllListeners('message-from-renderer');
    ipcMain.removeAllListeners('log');
    ipcMain.removeAllListeners('log-to-frontend');
    // Clean up server resources
    await cleanup();
  });
}
