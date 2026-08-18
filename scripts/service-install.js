import nodeWindows from 'node-windows';
import fs from 'fs';
import path from 'path';

const { Service } = nodeWindows;
const packageJson = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')
);

const serviceWorkdir = fs.realpathSync(path.join(import.meta.dirname, '..'));
const servicePath = path.join(serviceWorkdir, 'src/index.js');

// Create a new service object.
// Приведение к any: @types/node-windows не знает про workingDirectory, хотя
// рантайм его читает (node_modules/node-windows/lib/daemon.js:431).
const svc = new Service(/** @type {any} */ ({
  name: packageJson.name,
  description: packageJson.description,
  script: servicePath,
  workingDirectory: serviceWorkdir,
}));

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function () {
  svc.start();
  console.log('Service started');
});

// svc.logOnAs.account = 'popstas';
// svc.logOnAs.password = '';

svc.install();
