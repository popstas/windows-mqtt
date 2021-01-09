const Service = require('node-windows').Service;
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

const serviceWorkdir = fs.realpathSync(path.join(__dirname, '..'));
const servicePath = path.join(serviceWorkdir, 'index.js');

// Create a new service object
const svc = new Service({
  name: packageJson.name,
  description: packageJson.description,
  script: servicePath,
  workingDirectory: serviceWorkdir,
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function () {
  svc.start();
  console.log('Service started');
});

// svc.logOnAs.account = 'popstas';
// svc.logOnAs.password = '';

svc.install();
