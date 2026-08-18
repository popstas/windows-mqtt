/**
 * Работает ли на машине OBS — по процессу, а не по окну.
 *
 * Раньше это спрашивали у windows11-manager: `findWindow({title: '^OBS'})`.
 * Один вызов стоил зависимости `file:../windows11-manager`, а та — junction на
 * соседний репозиторий в `node_modules`, который приходилось обходить сборке,
 * отдельно копировать деплою и который не читался вовсе через сетевой логон
 * ssh. Процесс отвечает на тот же вопрос и не тянет за собой ничего.
 *
 * Заодно это ответ точнее: окно с заголовком `^OBS` бывает и у чужой
 * программы, а свёрнутого в трей OBS окна может не быть вовсе — при том, что
 * WebSocket у него слушает.
 */

import { execSync } from 'node:child_process';

const OBS_PROCESS = 'obs64.exe';

/**
 * Есть ли в выводе `tasklist` строка про этот процесс.
 *
 * Разбор отдельно от запуска: запуск на не-Windows не проверить вовсе, а форма
 * вывода — единственное, что здесь можно сломать правкой.
 *
 * Сверяется первое поле CSV, а не весь вывод: имя процесса встречается и в
 * заголовке окна, и в пути, и поиск подстрокой сказал бы «работает» на чужой
 * строке. Регистр не различается — Windows его не различает, а печатает
 * tasklist так, как имя записано на диске.
 */
function parseTasklist(out, name) {
  const wanted = String(name).toLowerCase();
  return String(out)
    .split(/\r?\n/)
    .some((line) => {
      const m = line.match(/^"([^"]*)"/);
      return m ? m[1].toLowerCase() === wanted : false;
    });
}

/**
 * Работает ли процесс с таким именем.
 *
 * Спрашивается фильтром по имени (`/FI`), а не перечислением всех процессов:
 * пока OBS закрыт — то есть почти всегда — вопрос повторяется раз в пять
 * секунд, и полный список стоил бы на порядок дороже.
 *
 * Любой отказ — «не работает». На не-Windows программы `tasklist` нет вовсе, и
 * это норма, а не сбой: модуль просто не полезет подключаться. Падение стоило
 * бы всего процесса — модули грузятся в общий.
 */
function processRunning(name = OBS_PROCESS, run = defaultRun) {
  try {
    return parseTasklist(run(`tasklist /FI "IMAGENAME eq ${name}" /NH /FO CSV`), name);
  } catch {
    return false;
  }
}

function defaultRun(cmd) {
  return execSync(cmd, { encoding: 'utf8', timeout: 5000, windowsHide: true });
}

export { OBS_PROCESS, parseTasklist, processRunning };
