const {app, Tray, ipcMain, BrowserWindow} = require('electron');
const {start} = require('./server');
const path = require('path');
const packageJson = require('../package.json');
const {log, getModulesEnabled} = require("./helpers");

function createWindow() {
  let mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // Start the app hidden
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // nodeIntegration: true,
      nodeIntegration: false,
      // contextIsolation: false,
      contextIsolation: true,
    },
  });

  void mainWindow.loadFile('../index.html');

  mainWindow.on('closed', function () {
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

  // Основной процесс слушает сообщение
  ipcMain.on('message-from-renderer', (event, arg) => {
    event.reply('message-from-main', 'Привет, это основной процесс!');
    return handleRendererMessage(arg);
  });
  ipcMain.on('log', (event, arg) => {
    log(`frontend: ${arg}`);
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
}
