/**
 * Тонкий клиент Home Assistant REST API.
 *
 * Отдельный модуль, а не пара строк в месте вызова: сюда со временем поедут и
 * другие сущности windows-mqtt, и им всем нужны одни и те же вещи — базовый
 * адрес, токен, таймаут и то, что сетевой сбой не должен ронять вызывающего.
 *
 * Сущности, созданные через /api/states, живут до перезапуска Home Assistant и
 * восстанавливаются следующей же публикацией. Это нормальный способ отдавать
 * состояние снаружи, но означает, что публиковать надо периодически, а не один
 * раз при старте.
 */

const DEFAULTS = {
  enabled: false,
  url: '',
  token: '',
  timeoutMs: 5000,
};

function mergeHaConfig(raw) {
  return { ...DEFAULTS, ...(raw ?? {}) };
}

class HomeAssistantApi {
  constructor(config, log) {
    this.config = mergeHaConfig(config);
    this.log = log ?? (() => {});
    // Ошибки сети сыплются пачками: HA перезагружается — и на каждый тик
    // экспорта прилетает одно и то же. Логируем смену состояния, а не каждый
    // отказ, иначе лог станет бесполезным.
    this.lastError = '';
  }

  get enabled() {
    return Boolean(this.config.enabled && this.config.url && this.config.token);
  }

  _url(path) {
    return `${this.config.url.replace(/\/+$/, '')}${path}`;
  }

  _report(error) {
    if (error === this.lastError) return;
    this.lastError = error;
    if (error) this.log(`home assistant: ${error}`, 'error');
    else this.log('home assistant: back online');
  }

  /**
   * Записать состояние сущности. Возвращает true при успехе.
   *
   * Ничего не бросает: экспорт состояния — фоновая работа, и падать из-за
   * недоступного HA модуль windows не должен.
   */
  async setState(entityId, state, attributes = {}) {
    if (!this.enabled) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(this._url(`/api/states/${entityId}`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        // HA обрезает состояние на 255 символах и отвергает запрос целиком,
        // если оно длиннее; заголовки сессий бывают и длиннее.
        body: JSON.stringify({ state: String(state ?? '').slice(0, 255), attributes }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this._report(`${entityId}: HTTP ${res.status}`);
        return false;
      }
      this._report('');
      return true;
    } catch (e) {
      this._report(`${entityId}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Пачкой, последовательно: одновременных запросов тут не нужно. */
  async setStates(entities) {
    let ok = 0;
    for (const e of entities ?? []) {
      if (await this.setState(e.entityId, e.state, e.attributes)) ok += 1;
    }
    return ok;
  }
}

module.exports = { DEFAULTS, mergeHaConfig, HomeAssistantApi };
