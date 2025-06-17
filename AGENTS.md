# AGENTS Instructions

This repo contains a Node/Electron project for controlling a PC via MQTT.

## Overview of the Code
- `src/server.js` starts the MQTT client, loads modules and subscribes to topics.
- `src/index.js` launches the server headless. `src/index-electron.js` wraps the server in an Electron tray app.
- Modules live in `src/modules`. Each module exports an async function that sets up MQTT topic subscriptions and returns `{subscriptions, ...}`.
- Configuration is loaded from `config.yml` using `src/config.js`.
- Scripts in `scripts/` install or remove the project as a Windows service.
- `index.html` and assets provide the tray UI when running with Electron.
- Example custom commands are in `commands.example.yml`.

## Getting Started
1. Run `npm install` to install dependencies.
2. Copy a `config.yml` and run `npm start` for headless mode or `npm run start-electron` for the tray UI.
3. Explore `src/modules` to learn how features are implemented. Use `src/modules/_module.js` as a template for new modules.

## Commit Style
Use short commit messages following the Angular style (e.g. `feat(module): description`, `fix: description`). Recent history shows examples like:
```
feat(windows): reload configs
fix: set electron window icon, hide menu
```

## Further Tips
- Read `README.md` for details on each module and available MQTT topics.
- Review `package.json` for useful scripts such as `start-electron` and Windows service helpers.

## Module Structure
Modules are kept in `src/modules`. Each module exports an async function with
the signature `(mqtt, config, log)`. Inside it you usually build MQTT topic
names using `config.base`, start any watchers or timers and return an object
containing:

```js
{
  subscriptions: [
    { topics: [config.base + '/status'], handler: onStatus }
  ],
  onStart,      // optional
  onStop        // optional
}
```

Handlers receive `(topic, message)` and can publish or perform actions.

## Creating a New Module
1. Copy `src/modules/_module.js` to `src/modules/yourModule.js`.
2. Add configuration for `modules.yourModule` in `config.yml` so it loads on
   start.
3. Implement your subscriptions and callbacks. Refer to the `Extend` section in
   `README.md` for a minimal example.

