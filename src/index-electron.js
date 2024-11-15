const { app, Tray, Menu, BrowserWindow } = require('electron');
const { start } = require('./server');
const path = require('path');
const os = require('os');

function createWindow() {
  let mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // Start the app hidden
    webPreferences: {
      nodeIntegration: true,
    },
  });

  mainWindow.loadFile('../index.html');

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

  return mainWindow;
}

function createTray(mainWindow) {
  const filename = os.platform() === 'win32' ? 'trayicon.ico' : 'trayicon.png';
  const iconPath = path.join(__dirname, '..', 'assets', filename);
  const tray = new Tray(iconPath); // Path to your tray icon
  tray.setToolTip('windows-mqtt');

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
