const { test } = require('node:test');
const assert = require('node:assert');
const { HomeAssistantApi, mergeHaConfig } = require('../src/homeassistant/api');
const {
  slotText, buildSessionEntities, buildSummaryEntity,
} = require('../src/homeassistant/claude-sessions');

const s = (over) => ({
  id: 'x', title: 't', cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 },
  desktop: 1, monitor: 1, open: true, lastActivity: 100, ...over,
});

function fakeFetch(record) {
  return async (url, options) => {
    record.push({ url, options });
    return record.response ?? { ok: true, status: 200 };
  };
}

test('mergeHaConfig fills the defaults', () => {
  assert.strictEqual(mergeHaConfig(undefined).enabled, false);
  assert.strictEqual(mergeHaConfig({ url: 'http://ha' }).timeoutMs, 5000);
});

test('the client stays disabled until it has a url and a token', () => {
  // A half-filled config must not turn into requests to nowhere.
  assert.strictEqual(new HomeAssistantApi({ enabled: true }).enabled, false);
  assert.strictEqual(new HomeAssistantApi({ enabled: true, url: 'http://ha' }).enabled, false);
  assert.strictEqual(new HomeAssistantApi({ enabled: false, url: 'http://ha', token: 't' }).enabled, false);
  assert.strictEqual(new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' }).enabled, true);
});

test('setState posts the entity to the states endpoint', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', fakeFetch(calls));
  const api = new HomeAssistantApi({ enabled: true, url: 'http://ha:8123/', token: 'secret' });

  assert.strictEqual(await api.setState('sensor.a', 'hi', { x: 1 }), true);
  assert.strictEqual(calls[0].url, 'http://ha:8123/api/states/sensor.a');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { state: 'hi', attributes: { x: 1 } });
});

test('setState truncates a state Home Assistant would reject', async (t) => {
  // HA caps state at 255 characters and refuses the whole request beyond that;
  // session titles do get longer than this.
  const calls = [];
  t.mock.method(global, 'fetch', fakeFetch(calls));
  const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });

  await api.setState('sensor.a', 'x'.repeat(300));
  assert.strictEqual(JSON.parse(calls[0].options.body).state.length, 255);
});

test('setState reports failure instead of throwing', async (t) => {
  // Exporting state is background work: an unreachable HA must not take the
  // windows module down with it.
  t.mock.method(global, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
  const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });
  assert.strictEqual(await api.setState('sensor.a', 'hi'), false);
});

test('setState treats a non-2xx answer as failure', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 401 }));
  const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });
  assert.strictEqual(await api.setState('sensor.a', 'hi'), false);
});

test('a disabled client makes no requests at all', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', fakeFetch(calls));
  const api = new HomeAssistantApi({ enabled: false, url: 'http://ha', token: 't' });
  assert.strictEqual(await api.setState('sensor.a', 'hi'), false);
  assert.strictEqual(calls.length, 0);
});

test('the same error is logged once, not on every tick', async (t) => {
  // HA restarts and the export keeps running; repeating the same line every
  // interval would bury the log.
  const lines = [];
  t.mock.method(global, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
  const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' }, m => lines.push(m));
  await api.setState('sensor.a', '1');
  await api.setState('sensor.a', '1');
  assert.strictEqual(lines.length, 1);
});

test('setStates counts the entities that made it', async (t) => {
  let n = 0;
  t.mock.method(global, 'fetch', async () => ({ ok: n++ === 0, status: 500 }));
  const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });
  const ok = await api.setStates([
    { entityId: 'sensor.a', state: '1' },
    { entityId: 'sensor.b', state: '2' },
  ]);
  assert.strictEqual(ok, 1);
});

test('slotText marks a working session too', () => {
  // Every occupied slot gets a glyph, so the titles line up down the column.
  // The tile still does not light up for it: a running agent needs nothing.
  assert.strictEqual(slotText({ status: 'active', title: 'agent' }), '> agent');
});

test('slotText prefixes the title with an ASCII status glyph', () => {
  // openHASP's built-in font has no ▶/·/×: the panel draws empty squares for
  // them. Icons there are MDI codepoints, not unicode symbols.
  assert.strictEqual(slotText({ status: 'question', title: 'agent' }), '? agent');
  assert.strictEqual(slotText({ status: 'review', title: 'agent' }), '! agent');
});

test('slotText marks an empty slot with a dash', () => {
  // An empty string collapses the object on the panel and the list starts
  // jumping; a blank row is also indistinguishable from one that failed to
  // draw. A dash says 'nothing here' out loud.
  assert.strictEqual(slotText({ status: 'empty', title: '' }), '-');
  assert.strictEqual(slotText(undefined), '-');
});

test('buildSessionEntities pins each entity to a row, not to a session', () => {
  // The panel button is wired to a row; if the entity followed the session,
  // every change of composition would mean rewriting the panel config.
  const entities = buildSessionEntities([s({ id: 'a', title: 'one' })], 3);
  assert.deepStrictEqual(entities.map(e => e.entityId), [
    'switch.claude_session_1',
    'switch.claude_session_2',
    'switch.claude_session_3',
  ]);
  assert.strictEqual(entities[0].attributes.session_id, 'a');
  assert.strictEqual(entities[2].attributes.session_id, '');
});

test('buildSessionEntities carries the details the panel may want', () => {
  const [entity] = buildSessionEntities([s({ id: 'a', title: 'one', desktop: 2, monitor: 5 })], 1);
  assert.strictEqual(entity.attributes.desktop, 2);
  assert.strictEqual(entity.attributes.monitor, 5);
  assert.strictEqual(entity.attributes.cwd, '/p');
});

test('buildSummaryEntity counts live sessions and the ones waiting on you', () => {
  const summary = buildSummaryEntity([
    s({ id: 'a', agentState: 'active' }),
    s({ id: 'b', agentState: 'question' }),
    s({ id: 'c', agentState: 'review', agentEvent: 'stop' }),
    s({ id: 'd', agentState: 'review', agentEvent: 'stop', agentSeen: true }),
    s({ id: 'e', open: false }),
  ]);
  assert.strictEqual(summary.state, 4);
  assert.strictEqual(summary.attributes.total, 5);
  assert.strictEqual(summary.attributes.working, 1);
  // b asks a question, c stopped and was not looked at; d was looked at.
  assert.strictEqual(summary.attributes.waiting, 2);
});

test('a session turns the entity on only when it wants you', () => {
  // On means "come back to me": the agent asked something, or it stopped and
  // nobody has looked. A working session is off — it needs nothing.
  const on = st => buildSessionEntities([s({ id: 'a', ...st })], 1)[0].state;
  assert.strictEqual(on({ agentState: 'question' }), 'on');
  assert.strictEqual(on({ agentState: 'review', agentEvent: 'stop' }), 'on');
  assert.strictEqual(on({ agentState: 'idle', agentEvent: 'attention' }), 'on');
  assert.strictEqual(on({ agentState: 'active' }), 'off');
  assert.strictEqual(on({ agentState: 'idle', agentEvent: 'tool-done' }), 'off');
  assert.strictEqual(on({ agentState: 'review', agentEvent: 'stop', agentSeen: true }), 'off');
  assert.strictEqual(on({ open: false }), 'off');
});

test('an empty slot is off and carries no text', () => {
  const [, empty] = buildSessionEntities([s({ id: 'a' })], 2);
  assert.strictEqual(empty.state, 'off');
  assert.strictEqual(empty.attributes.text, '-');
});

test('the display text lives in an attribute, since the state holds the on/off flag', () => {
  const [entity] = buildSessionEntities([s({ id: 'a', title: 'one', agentState: 'question' })], 1);
  assert.strictEqual(entity.attributes.text, '? one');
  assert.strictEqual(entity.state, 'on');
});
