import nodeWindows from 'node-windows';
import fs from 'fs';
import path from 'path';

const { Service } = nodeWindows;
const packageJson = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')
);

const servicePath = fs.realpathSync(path.join(import.meta.dirname, '..', 'src/index.js'));

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
