# TODO

- [ ] Сборка с pruned node_modules: `bundle.resources` тащит `../node_modules/**/*` целиком, вместе с devDependencies. Из 149 МБ пользователю не нужны ~65 МБ (@tauri-apps/cli 36 МБ, typescript 23 МБ, @types 6.4 МБ). Tauri v2 не умеет исключающие globs, поэтому нужен шаг сборки с `npm ci --omit=dev` в отдельное дерево либо явное перечисление нужных пакетов

# Future
- [ ] Мигрировать проект на ESM (`"type": "module"` в package.json): переписать require/module.exports в src/ и scripts/, проверить bridge-режим и standalone
- [ ] Гигиена: README (упоминания Electron, несуществующие скрипты), удалить dist/, crash.log, src/daemon/
- [ ] Восстановить модуль vad (naudiodon2 несовместим с Node 24 — нужен ресёрч замены), если ещё нужен
