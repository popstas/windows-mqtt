const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveClaudeProject,
  formatHotkeyCaret,
  attachProjectHotkeys,
} = require('../src/picker/claude-project-helpers');

const projects = [
  { name: 'home', cwd: '/home/popstas/projects/text/obsidian/home', hotkey: 'Ctrl+F11' },
  { name: 'expertizeme', cwd: '/home/popstas/projects/text/obsidian/ExpertizeMe', hotkey: 'Ctrl+F12' },
];

test('resolves by name', () => {
  assert.deepEqual(
    resolveClaudeProject(projects, { name: 'home' }),
    { name: 'home', cwd: '/home/popstas/projects/text/obsidian/home', hotkey: 'Ctrl+F11' }
  );
});

test('forwards optional profile from the project entry', () => {
  const withProfile = [
    { name: 'home', cwd: '/home/popstas/projects/text/obsidian/home', hotkey: 'Ctrl+F11', profile: 'home' },
  ];
  assert.deepEqual(
    resolveClaudeProject(withProfile, { name: 'home' }),
    {
      name: 'home',
      cwd: '/home/popstas/projects/text/obsidian/home',
      hotkey: 'Ctrl+F11',
      profile: 'home',
    }
  );
});

test('omits profile when the entry has none', () => {
  const out = resolveClaudeProject(projects, { name: 'home' });
  assert.equal(out.profile, undefined);
});

test('resolves by cwd', () => {
  assert.equal(
    resolveClaudeProject(projects, { cwd: '/home/popstas/projects/text/obsidian/ExpertizeMe' }).name,
    'expertizeme'
  );
});

test('returns null for unknown name', () => {
  assert.equal(resolveClaudeProject(projects, { name: 'nope' }), null);
});

test('returns null for empty payload', () => {
  assert.equal(resolveClaudeProject(projects, {}), null);
  assert.equal(resolveClaudeProject(projects, null), null);
  assert.equal(resolveClaudeProject(undefined, { name: 'home' }), null);
});

test('formatHotkeyCaret turns Ctrl+ into caret', () => {
  assert.equal(formatHotkeyCaret('Ctrl+F12'), '^F12');
  assert.equal(formatHotkeyCaret('ctrl+F11'), '^F11');
  assert.equal(formatHotkeyCaret('Control+F10'), '^F10');
  assert.equal(formatHotkeyCaret(''), '');
  assert.equal(formatHotkeyCaret('Alt+F12'), 'Alt+F12');
});

test('attachProjectHotkeys stamps matching cwd sessions', () => {
  const out = attachProjectHotkeys(
    [
      { id: 'a', cwd: '/home/popstas/projects/text/obsidian/home', title: 'home' },
      { id: 'b', cwd: '/other', title: 'x' },
    ],
    projects,
  );
  assert.equal(out[0].hotkey, '^F11');
  assert.equal(out[1].hotkey, undefined);
});
