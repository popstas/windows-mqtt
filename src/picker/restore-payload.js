/**
 * Тело просьбы о восстановлении — от панели и от пикера.
 *
 * С панели прилетает сырая строка (или пустота, что значит «самый свежий»), от
 * ccfzf-picker — объект `{id, sessionIds}`. Без разбора JSON id снимка стал бы
 * литералом `{"id":"snap-1"}`, и восстановление молча не находило бы ничего:
 * ошибки у него на такой вход нет, есть пустой результат.
 *
 * Тот же приём, что у claudeFocusSlot, и по той же причине.
 */
function parseRestorePayload(message) {
  const raw = String(message ?? '').trim();
  if (!raw) return { id: 'last', sessionIds: [] };
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const ids = Array.isArray(parsed?.sessionIds)
        ? parsed.sessionIds.filter(v => typeof v === 'string' && v)
        : [];
      const id = typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : 'last';
      return { id, sessionIds: ids };
    } catch {
      // Не JSON, хотя начинается с фигурной скобки: снимка с таким id всё
      // равно нет, и «самый свежий» здесь честнее отказа.
      return { id: 'last', sessionIds: [] };
    }
  }
  return { id: raw, sessionIds: [] };
}

module.exports = {parseRestorePayload};
