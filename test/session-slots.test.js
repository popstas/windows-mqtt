const { test } = require('node:test');
const assert = require('node:assert');
const { orderSessions, slotStatus, buildSlots, sessionIdForSlot } = require('../src/picker/session-slots');

const s = (over) => ({
  id: 'x', title: 't', cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 },
  desktop: 1, monitor: 1, open: true, lastActivity: 100, ...over,
});

test('buildSlots carries what the agent last said, and leaves it blank for an empty slot', () => {
  const [filled, empty] = buildSlots([s({ agentSummary: 'Оба сделано.' })], 2);
  assert.strictEqual(filled.summary, 'Оба сделано.');
  assert.strictEqual(empty.summary, '');
});

test('buildSlots carries the ready-made description, not its own glue', () => {
  // Склейку «сводка, а у работающей — последняя» считает windows11-manager:
  // здесь она только переезжает в слот, чтобы пикер и панель не разошлись.
  const [filled, empty] = buildSlots([s({
    agentSummary: '', agentLastSummary: 'Готовлю бриф', agentDescription: 'Готовлю бриф',
  })], 2);
  assert.strictEqual(filled.description, 'Готовлю бриф');
  assert.strictEqual(empty.description, '');
});

test('orderSessions puts live sessions first', () => {
  const out = orderSessions([
    s({ id: 'closed', open: false, lastActivity: 999 }),
    s({ id: 'live-d2', desktop: 2 }),
    s({ id: 'live-d1', desktop: 1 }),
  ], 'name');
  assert.deepStrictEqual(out.map(x => x.id), ['live-d1', 'live-d2', 'closed']);
});

test('orderSessions sorts live sessions by the picker sort mode', () => {
  const out = orderSessions([
    s({ id: 'old', lastActivity: 100 }),
    s({ id: 'fresh', lastActivity: 900 }),
  ], 'recent');
  assert.deepStrictEqual(out.map(x => x.id), ['fresh', 'old']);
});

test('orderSessions sorts closed sessions by the same sort mode', () => {
  const out = orderSessions([
    s({ id: 'old', open: false, lastActivity: 100 }),
    s({ id: 'recent', open: false, lastActivity: 900 }),
  ], 'recent');
  assert.deepStrictEqual(out.map(x => x.id), ['recent', 'old']);
});

test('orderSessions defaults to cost like the picker', () => {
  const out = orderSessions([
    s({ id: 'cheap', agentCostUsd: 1 }),
    s({ id: 'pricey', agentCostUsd: 40 }),
  ]);
  assert.deepStrictEqual(out.map(x => x.id), ['pricey', 'cheap']);
});

test('slotStatus reports what the agent is doing', () => {
  assert.strictEqual(slotStatus(s({ agentState: 'active' })), 'active');
  assert.strictEqual(slotStatus(s({ agentState: 'question' })), 'question');
});

test('slotStatus treats both "stopped" shapes as needing review', () => {
  // stop and fail write review; the "waiting for your input" notice says the
  // same thing a minute later and the hook records it as idle.
  assert.strictEqual(slotStatus(s({ agentState: 'review', agentEvent: 'stop' })), 'review');
  assert.strictEqual(slotStatus(s({ agentState: 'idle', agentEvent: 'attention' })), 'review');
});

test('slotStatus clears review once the window has been looked at', () => {
  assert.strictEqual(
    slotStatus(s({ agentState: 'review', agentEvent: 'stop', agentSeen: true })), 'idle');
  assert.strictEqual(
    slotStatus(s({ agentState: 'idle', agentEvent: 'attention', agentSeen: true })), 'idle');
});

test('slotStatus lets being seen mute a pending question', () => {
  // The agent is still blocked, but a tile that keeps calling after you have
  // already been to the session stops meaning anything.
  assert.strictEqual(
    slotStatus(s({ agentState: 'question', agentEvent: 'attention', agentSeen: true })), 'idle');
});

test('slotStatus keeps an unseen question calling', () => {
  assert.strictEqual(
    slotStatus(s({ agentState: 'question', agentEvent: 'attention', agentSeen: false })), 'question');
});

test('slotStatus marks a closed session closed whatever state lingers', () => {
  assert.strictEqual(slotStatus(s({ open: false, agentState: 'active' })), 'closed');
});

test('slotStatus calls a missing session empty', () => {
  assert.strictEqual(slotStatus(undefined), 'empty');
});

test('buildSlots always returns the requested number of rows', () => {
  // The panel draws a fixed number of lines; a short list must not leave the
  // last rows showing whatever was there before.
  const slots = buildSlots([s({ id: 'a' })], 9);
  assert.strictEqual(slots.length, 9);
  assert.strictEqual(slots[0].id, 'a');
  assert.strictEqual(slots[8].status, 'empty');
  assert.strictEqual(slots[8].title, '');
});

test('buildSlots numbers slots from one', () => {
  const slots = buildSlots([], 3);
  assert.deepStrictEqual(slots.map(x => x.slot), [1, 2, 3]);
});

test('buildSlots drops sessions that do not fit', () => {
  const many = Array.from({ length: 20 }, (_, i) => s({ id: `s${i}`, bounds: { x: i, y: 0, width: 1, height: 1 } }));
  assert.strictEqual(buildSlots(many, 9).length, 9);
});

test('buildSlots prefers the disambiguated label over the raw title', () => {
  const slots = buildSlots([s({ id: 'a', title: 'agent', label: 'agent (aaaa)' })], 1);
  assert.strictEqual(slots[0].title, 'agent (aaaa)');
});

test('sessionIdForSlot maps a panel row back to its session', () => {
  const slots = buildSlots([s({ id: 'a' }), s({ id: 'b', bounds: { x: 5, y: 0, width: 1, height: 1 } })], 9);
  assert.strictEqual(sessionIdForSlot(slots, 1), 'a');
  assert.strictEqual(sessionIdForSlot(slots, '2'), 'b');
});

test('sessionIdForSlot returns null for an empty or unknown row', () => {
  // Tapping a blank row must do nothing rather than focus whatever was last there.
  const slots = buildSlots([s({ id: 'a' })], 9);
  assert.strictEqual(sessionIdForSlot(slots, 5), null);
  assert.strictEqual(sessionIdForSlot(slots, 99), null);
  assert.strictEqual(sessionIdForSlot(slots, 'nope'), null);
});
