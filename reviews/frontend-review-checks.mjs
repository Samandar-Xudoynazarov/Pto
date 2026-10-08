// Offline hook harness for the real AcctTab component; no browser or live API.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as calc from '../frontend/lib/calc.js';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const swc = require('next/dist/build/swc');
await swc.loadBindings();
const source = await fs.readFile(new URL('../frontend/components/AcctTab.js', import.meta.url), 'utf8');
const { code } = await swc.transform(source, { filename: 'AcctTab.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
let slots = [], cursor = 0, effects = [], pending = [], written = [];
const same = (a,b) => a && b && a.length === b.length && a.every((x,i) => Object.is(x,b[i]));
const react = {
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
  useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
  useMemo(fn,deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
  useCallback(fn,deps) { return this.useMemo(fn,deps); },
  useEffect(fn,deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps,deps)) { slots[i] = { deps }; effects.push(fn); } },
};
// Transformed code calls hooks without a receiver.
react.useCallback = (fn,deps) => react.useMemo(() => fn,deps);
const api = (path, options) => {
  if (options?.method === 'PUT') { written.push({ path, body: options.body }); return Promise.resolve(options.body); }
  return new Promise((resolve,reject) => pending.push({path,resolve,reject}));
};
const jsx = (type,props) => ({type,props});
const mockRequire = name => {
  if (name === 'react') return react;
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
  if (name === '@/lib/api') return { api };
  if (name === '@/lib/calc') return { ...calc, today: () => '2026-10-08' };
  if (name === '@/lib/i18n') return { tr: s => s };
  if (name === '@/lib/role') return { useUser: () => ({ canAcct: true, canDay: true, canEdit: true }) };
  if (name === '@/lib/excel') return {};
  if (name === '@/lib/acct-docx') return { OY: [], totals: () => ({other:0}), rowOther: () => 0 };
  if (name === './Icon') return { default: () => null };
  throw new Error(name);
};
const exports = {};
new Function('require','exports',code)(mockRequire,exports);
const props = { data: { products: [], prods: new Map(), mats: new Map() }, notify: () => {} };
function render() { cursor = 0; const tree = exports.default(props); const run = effects; effects = []; run.forEach(fn => fn()); return tree; }
function find(tree,predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) { for (const c of tree) { const n = find(c,predicate); if (n) return n; } return null; }
  if (predicate(tree)) return tree;
  return find(tree.props?.children,predicate);
}
const report = month => ({ month, date: '2026-10-08', director: month, chief: '', accountant: '', rows: [{ productId: null, name: month, qty: month === '2026-09' ? 9 : 10, m3: 1, unitCost: 10, unitPrice: 20 }] });
const settle = async () => { await new Promise(r => setImmediate(r)); };
let tree = render();
find(tree,n => n.type === 'input' && n.props.type === 'month').props.onChange({target:{value:'2026-10'}});
tree = render();
for (const p of pending.filter(p => p.path.includes('2026-10'))) p.resolve(p.path.startsWith('/days') ? [] : { report: report('2026-10') });
await settle(); tree = render();
for (const p of pending.filter(p => p.path.includes('2026-09'))) p.resolve(p.path.startsWith('/days') ? [] : { report: report('2026-09') });
await settle(); tree = render();
const shownMonth = find(tree,n => n.type === 'input' && n.props.type === 'month').props.value;
const shownDirector = find(tree,n => n.props?.id === 'ac-dir').props.value;
assert.equal(shownMonth, '2026-10'); assert.equal(shownDirector, '2026-09');
find(tree,n => n.props?.id === 'ac-dir').props.onChange({target:{value:'Changed'}});
tree = render();
const save = find(tree,n => n.type === 'button' && n.props.onClick?.name === 'onSave');
assert.equal(save.props.disabled, false);
await save.props.onClick();
assert.equal(written[0].path, '/acct-reports/2026-10');
assert.equal(written[0].body.rows[0].name, '2026-09');
const result = { name:'accounting-month-race', outcome:'defect-reproduced-in-offline-hook-harness', selectedMonth:shownMonth, staleDataMonth:shownDirector, writtenPath:written[0].path, writtenRows:written[0].body.rows };
await fs.writeFile(new URL('./frontend-review-results.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));

// Loading a second day fails: stale first-day data must not become saveable for it.
globalThis.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true };
slots = []; cursor = 0; effects = []; pending = []; written = [];
const daySource = await fs.readFile(new URL('../frontend/components/DayTab.js', import.meta.url), 'utf8');
const dayCompiled = await swc.transform(daySource, { filename: 'DayTab.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
const dayExports = {};
new Function('require','exports',dayCompiled.code)(mockRequire,dayExports);
const dayProps = { data: { materials: [], products: [], mats: new Map(), prods: new Map(), settings: {}, orders: [] }, notify: () => {}, onSaved: () => {}, version: 0 };
function renderDay() { cursor = 0; const tree = dayExports.default(dayProps); const run = effects; effects = []; run.forEach(fn => fn()); return tree; }
tree = renderDay();
for (const p of pending) p.resolve(p.path.startsWith('/days') ? { date: '2026-10-08', note: 'FIRST-DAY-NOTE', production: [], materials: [], shipments: [] } : { materials: {}, products: {} });
await settle(); tree = renderDay(); pending = [];
find(tree,n => n.props?.id === 'day-date').props.onChange({ target: { value: '2026-10-09' } });
tree = renderDay();
for (const p of pending) p.reject(new Error('offline-review-network-error'));
await settle(); tree = renderDay();
const daySave = find(tree,n => n.type === 'button' && n.props.onClick?.name === 'save');
assert.equal(daySave.props.disabled, false);
await daySave.props.onClick();
assert.equal(written[0].path, '/days/2026-10-09');
assert.equal(written[0].body.note, 'FIRST-DAY-NOTE');
const dayResult = { name: 'daily-load-failure', outcome: 'defect-reproduced-in-offline-hook-harness', failedDay: '2026-10-09', writtenPath: written[0].path, staleNote: written[0].body.note };
await fs.writeFile(new URL('./frontend-review-results.json',import.meta.url),JSON.stringify([result,dayResult],null,2));
console.log(JSON.stringify(dayResult,null,2));
