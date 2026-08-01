const { test } = require('node:test');
const assert = require('node:assert');
const {
  topics, slotConfig, summaryConfig, discoveryMessages, stateMessages, removalMessages,
} = require('../src/homeassistant/discovery');

const BASE = 'home/room/pc';

test('every entity points at the same device, so Home Assistant groups them', () => {
  // This is the whole reason for moving off the REST API: /api/states writes
  // past the registry, and entities without a registry entry cannot belong to
  // a device.
  const slot = slotConfig(BASE, 1);
  const summary = summaryConfig(BASE);
  assert.deepStrictEqual(slot.device.identifiers, ['claude_wt']);
  assert.deepStrictEqual(summary.device.identifiers, ['claude_wt']);
  assert.strictEqual(slot.device.name, 'claude-wt');
});

test('a slot keeps its entity_id across a change of transport', () => {
  // The panel buttons name these entities; renaming them because the plumbing
  // changed would break the panel for no reason.
  assert.strictEqual(slotConfig(BASE, 3).object_id, 'claude_session_3');
  assert.strictEqual(summaryConfig(BASE).object_id, 'claude_sessions');
});

test('a slot has a unique id, which is what makes it renameable in the UI', () => {
  assert.strictEqual(slotConfig(BASE, 3).unique_id, 'claude_wt_slot_3');
  assert.notStrictEqual(slotConfig(BASE, 3).unique_id, slotConfig(BASE, 4).unique_id);
});

test('state and attributes ride the same topic', () => {
  // Two topics per slot would mean two publishes and a window where the flag
  // and the details disagree.
  const c = slotConfig(BASE, 2);
  assert.strictEqual(c.state_topic, `${BASE}/claude/slot/2`);
  assert.strictEqual(c.json_attributes_topic, c.state_topic);
  assert.strictEqual(c.value_template, '{{ value_json.state }}');
});

test('a slot is switchable, and pressing it reaches us', () => {
  const c = slotConfig(BASE, 2);
  assert.strictEqual(c.command_topic, `${BASE}/claude/slot/2/set`);
  // Home Assistant must not assume it knows the outcome: what the switch shows
  // is decided by what happens in the window, not by the press.
  assert.strictEqual(c.optimistic, false);
  assert.strictEqual(c.assumed_state, true);
});

test('every entity is tied to one availability topic', () => {
  // With windows-mqtt down, no slot number means anything; unavailable is
  // honest, a frozen last state is not.
  const t = topics(BASE);
  assert.strictEqual(slotConfig(BASE, 1).availability_topic, t.availability);
  assert.strictEqual(summaryConfig(BASE).availability_topic, t.availability);
});

test('discoveryMessages announces availability and one config per entity, all retained', () => {
  const msgs = discoveryMessages(BASE, 9);
  assert.strictEqual(msgs.length, 1 + 1 + 9);
  assert.ok(msgs.every(m => m.retain), 'configs must survive a Home Assistant restart');
  assert.strictEqual(msgs[0].payload, 'online');
  assert.ok(msgs.some(m => m.topic === 'homeassistant/switch/claude_wt/slot_9/config'));
  assert.ok(msgs.some(m => m.topic === 'homeassistant/sensor/claude_wt/summary/config'));
});

test('stateMessages routes each entity to its own topic', () => {
  const msgs = stateMessages(BASE, [
    { state: 4, attributes: { total: 5 } },
    { state: 'on', attributes: { slot: 1, text: '? one' } },
    { state: 'off', attributes: { slot: 2, text: 'two' } },
  ]);
  assert.deepStrictEqual(msgs.map(m => m.topic), [
    `${BASE}/claude/summary`,
    `${BASE}/claude/slot/1`,
    `${BASE}/claude/slot/2`,
  ]);
});

test('a state payload carries the flag and the details together', () => {
  const [msg] = stateMessages(BASE, [{ state: 'on', attributes: { slot: 1, text: '? one', cwd: '/p' } }]);
  assert.deepStrictEqual(JSON.parse(msg.payload), { state: 'on', slot: 1, text: '? one', cwd: '/p' });
  assert.strictEqual(msg.retain, true);
});

test('a numeric state survives the trip as a string', () => {
  // The summary state is a count; the value_template reads it out of JSON, so
  // it must be there in a shape Home Assistant can parse.
  const [msg] = stateMessages(BASE, [{ state: 4, attributes: {} }]);
  assert.strictEqual(JSON.parse(msg.payload).state, '4');
});

test('removalMessages empties both the config and the state of a dropped slot', () => {
  // An empty retained config is how Home Assistant is told to forget an
  // entity; without it, shrinking the slot count leaves ghosts forever.
  const msgs = removalMessages(BASE, 10, 11);
  assert.deepStrictEqual(msgs.map(m => m.topic), [
    'homeassistant/switch/claude_wt/slot_10/config',
    `${BASE}/claude/slot/10`,
    'homeassistant/switch/claude_wt/slot_11/config',
    `${BASE}/claude/slot/11`,
  ]);
  assert.ok(msgs.every(m => m.payload === '' && m.retain));
});
