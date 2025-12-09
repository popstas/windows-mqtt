const Service = require('node-windows').Service;
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

const servicePath = fs.realpathSync(path.join(__dirname, '..', 'src/index.js'));

const svc = new Service({
  name: packageJson.name,
  script: servicePath,
});

// Listen for the "uninstall" event, so we know when it's done.
svc.on('uninstall', function () {
  console.log('Uninstall complete.');
  console.log('The service exists: ', svc.exists);
});

// Uninstall the service.
svc.uninstall();
