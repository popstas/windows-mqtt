import { spawnSync } from 'node:child_process';

// Остановка установленного приложения перед деплоем.
//
// Раньше здесь стоял `taskkill /IM windows-mqtt.exe /T /F`. Флаг /T ходит по
// ParentProcessId и уносит всё дерево — а если WindowsTerminal когда-то
// поднялся из-под приложения (`wt.exe -w -1` запускает его, когда терминала
// ещё нет), то он в этом дереве и есть. Деплой закрывал пользователю все
// вкладки терминала, включая открытые руками, к приложению отношения не
// имеющие.
//
// `detached: true` при спавне от этого не спасает: на Windows он заводит новую
// группу процессов, но ParentProcessId остаётся прежним, а /T смотрит именно на
// него.
//
// Поэтому убиваем ровно двоих: само приложение и его node-сайдкар. Сайдкар
// опознаётся по командной строке — Tauri запускает его как
// `node <resourceRoot>\src\index.js`, и путь установки отличает его от всех
// прочих node в системе (их обычно десяток: Cursor, языковые серверы, наши
// собственные вызовы).
function nodeSidecarPids(resourceRoot) {
  // Contains, а не -like: в -like обратный слеш не спецсимвол, зато спецсимволы
  // там `*`, `?` и `[`, так что путь пришлось бы экранировать наполовину.
  // Сравнение в нижнем регистре — букву диска Windows отдаёт то так, то этак.
  // Одинарные кавычки в пути удваиваем: внутри '...' это их экранирование.
  const needle = resourceRoot.toLowerCase().replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" `
    + `| Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${needle}') } `
    + `| ForEach-Object { $_.ProcessId }`;
  const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  if (res.status !== 0 || !res.stdout) return [];
  return res.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => /^\d+$/.test(s));
}

function stopApp(resourceRoot) {
  // Сайдкар ищем до того, как убить родителя: после смерти приложения он
  // осиротеет, но командная строка у него не изменится — просто так надёжнее,
  // если PowerShell окажется медленнее taskkill.
  const pids = nodeSidecarPids(resourceRoot);

  // Без /T: только сам процесс приложения.
  spawnSync('taskkill', ['/IM', 'windows-mqtt.exe', '/F'], { stdio: 'inherit' });

  // Сайдкар обычно успевает уйти сам следом за родителем, и taskkill по мёртвому
  // PID печатает ошибку — не по делу, деплой при этом в порядке. Поэтому вывод
  // перехватываем и показываем, только если процесс был жив и убить его не
  // вышло: вот это уже помешает установщику заменить файлы.
  let killed = 0;
  for (const pid of pids) {
    const res = spawnSync('taskkill', ['/PID', pid, '/F'], { encoding: 'utf8' });
    if (res.status === 0) {
      killed += 1;
      continue;
    }
    const err = `${res.stderr || ''}${res.stdout || ''}`;
    if (!/no running instance|не найден|not found/i.test(err)) {
      process.stderr.write(err);
    }
  }

  return killed;
}

export { stopApp, nodeSidecarPids };
