// Offline review probes. No database connection or real account is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import app from '../backend/src/app.js';
import { Day, Material, Movement, Inventory, Settings, AuditLog, AcctReport } from '../backend/src/models.js';
import { stockReport } from '../backend/src/stock.js';
import { planOrders } from '../backend/src/plan.js';
import { hashPassword, verifyPassword, issueToken, readToken } from '../backend/src/auth.js';
import { audit } from '../backend/src/audit.js';

const results = [];
function record(name, details) { results.push({ name, ...details }); }
const id = '111111111111111111111111';
const pid = '222222222222222222222222';
const iid = '333333333333333333333333';
const user = { _id: '444444444444444444444444', username: 'offline-review', role: 'pto' };
const req = (body = {}, params = {}) => ({ body, params, user });
function response() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } }; }
function handler(path, method) {
  const route = app.router.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  assert.ok(route, path);
  return route.stack.at(-1).handle;
}
function query(value) {
  return { select() { return this; }, sort() { return this; }, lean: async () => value, then(a, b) { return Promise.resolve(value).then(a, b); } };
}
let opening = { date: '2026-10-01', materials: { [id]: 10 }, products: { [pid]: 10 } };
let moves = [];
let days = [];
let logs = [];
Settings.findOne = async () => ({ opening });
Day.find = () => query(structuredClone(days));
Movement.find = (q) => query(structuredClone(moves.filter(m => (!q.date?.$lte || m.date <= q.date.$lte) && (!q.date?.$gte || m.date >= q.date.$gte))));
Material.findById = () => query({ _id: id, name: 'Test material', unit: 'kg', stock: true, price: 1 });
Movement.create = async (data) => { const d = new Movement(data); await d.validate(); moves.push(d.toObject()); return d; };
AuditLog.create = async (data) => { logs.push(data); return data; };

const hash = await hashPassword('review-password');
assert.equal(await verifyPassword('review-password', hash), true);
assert.equal(await verifyPassword('wrong', hash), false);
const token = issueToken(user);
assert.equal(readToken(token).u, user._id);
assert.equal(readToken(token + 'x'), null);
record('password-and-token', { outcome: 'passed' });

const normal = stockReport(opening, [{ date: '2026-10-02', production: [{ productId: pid, fact: 5 }], shipments: [{ productId: pid, qty: 3 }] }], '2026-10-01', '2026-10-08', [{ date: '2026-10-03', materialId: id, qty: 4, type: 'out' }]);
assert.equal(normal.materials[id].end, 6);
assert.equal(normal.products[pid].end, 12);
record('stock-basic-arithmetic', { outcome: 'passed' });

const invalid = new Day({ date: '2026-99-99' });
await invalid.validate();
await new AcctReport({ month: '2026-99' }).validate();
record('invalid-calendar-values', { outcome: 'defect-reproduced', accepted: ['2026-99-99', '2026-99'] });

const r1 = response(), r2 = response();
const out = handler('/api/movements', 'post');
await Promise.all([out(req({ type: 'out', materialId: id, date: '2026-10-08', qty: 7, person: 'Test' }), r1), out(req({ type: 'out', materialId: id, date: '2026-10-08', qty: 7, person: 'Test' }), r2)]);
assert.equal(r1.statusCode, 201); assert.equal(r2.statusCode, 201);
record('concurrent-material-outflows', { outcome: 'defect-reproduced-with-in-memory-db-stubs', initial: 10, accepted: [7, 7], remaining: 10 - moves.reduce((s,m) => s + m.qty, 0) });

opening = { date: '2026-10-01', materials: { [id]: 0 }, products: {} };
moves = [{ date: '2026-10-08', type: 'in', materialId: id, qty: 10 }];
const backdated = response();
await out(req({ type: 'out', materialId: id, date: '2026-10-02', qty: 7, person: 'Test' }), backdated);
assert.equal(backdated.statusCode, 201);
record('backdated-outflow', { outcome: 'defect-reproduced-with-in-memory-db-stubs', balanceAtDate: stockReport(opening, [], '2026-10-02', '2026-10-02', moves).materials[id].end });

logs = [];
await audit(req(), { action: 'update', entity: 'inventory', entityId: iid, label: 'Inventory approved' });
assert.equal(logs.length, 0);
record('inventory-approval-audit', { outcome: 'defect-reproduced', auditEntries: logs.length });

// Exercise Mongoose's actual save update generation with an offline collection adapter.
opening = { date: '2026-10-01', materials: { [id]: 10 }, products: {} };
moves = [];
const original = { _id: iid, __v: 0, no: 1, date: '2026-10-08', status: 'draft', lines: [{ materialId: id, system: 0, actual: 8, price: 1 }] };
const updates = [];
Inventory.findById = async () => Inventory.hydrate(structuredClone(original));
Inventory.collection.updateOne = async (filter, update) => { updates.push({ filter, update }); return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }; };
Movement.insertMany = async (rows) => { moves.push(...rows); return rows; };
const inv1 = response(), inv2 = response();
await Promise.all([handler('/api/inventories/:id/approve', 'post')(req({}, { id: iid }), inv1), handler('/api/inventories/:id/approve', 'post')(req({}, { id: iid }), inv2)]);
assert.equal(moves.length, 2);
record('inventory-double-approval', { outcome: 'defect-reproduced-with-in-memory-db-stubs', adjustments: moves.map(m => m.qty), finalBalance: stockReport(opening, [], '2026-10-08', '2026-10-08', moves).materials[id].end, actual: 8, mongooseUpdates: updates });

const excelPath = new URL('../frontend/lib/excel.js', import.meta.url);
const calcUrl = new URL('../frontend/lib/calc.js', import.meta.url).href;
const excelSource = (await fs.readFile(excelPath, 'utf8')).replace('from "./calc"', `from ${JSON.stringify(calcUrl)}`);
const { dayFigures } = await import('data:text/javascript;base64,' + Buffer.from(excelSource).toString('base64'));
const prodOpening = { date: '2026-10-01', products: { [pid]: 10 }, materials: {} };
const expected = stockReport(prodOpening, [], '2026-10-08', '2026-10-08', [], [{ type: 'brak', date: '2026-10-08', productId: pid, qty: 2 }]).products[pid].end;
const exported = dayFigures({ production: [], shipments: [], materials: [] }, new Map(), new Map([[pid, 10]])).prodEnd.get(pid);
assert.equal(expected, 8); assert.equal(exported, 10);
record('excel-writeoff-mismatch', { outcome: 'defect-reproduced', actualStock: expected, exportedStock: exported });

let persisted;
Day.findOne = () => query(null);
Day.findOneAndUpdate = async (filter, update) => { const d = new Day({ ...update.$set }); await d.validate(); persisted = d; return d; };
const dayResponse = response();
await handler('/api/days/:date', 'put')(req({ shipments: [{ productId: pid, qty: 50 }], production: [], materials: [] }, { date: '2026-10-08' }), dayResponse);
assert.equal(persisted.shipments[0].qty, 50);
record('daily-shipment-without-stock-validation', { outcome: 'defect-reproduced-with-in-memory-db-stubs', acceptedShipment: 50 });

const saveDay = handler('/api/days/:date', 'put');
const sameDay = { date: '2026-10-08' };
await saveDay(req({ production: [{ productId: pid, fact: 20 }], note: '' }, sameDay), response());
await saveDay(req({ production: [{ productId: pid, fact: 10 }], note: 'Second user edited only the note' }, sameDay), response());
assert.equal(persisted.production[0].fact, 10);
record('daily-stale-editor-overwrite', { outcome: 'defect-reproduced-with-in-memory-db-stubs', firstSavedFact: 20, overwrittenFact: persisted.production[0].fact });

const reservedPlan = planOrders({ today:'2026-10-08', products:[{id:pid, forms:10, cycleDays:1, volume:1}], stock:{[pid]:10}, orders:[{id:'ready', productId:pid, qty:10, shipped:0, status:'tayyor'}, {id:'active', productId:pid, qty:10, shipped:0, status:'yangi'}] });
assert.equal(reservedPlan.orders[0].fromStock,10);
record('ready-order-stock-reused', { outcome:'defect-reproduced', readyUnshipped:10, totalStock:10, anotherOrderAllocated:reservedPlan.orders[0].fromStock, anotherOrderToProduce:reservedPlan.orders[0].toProduce });

for (let i = 1; i <= 20; i++) {
  const plan = planOrders({ today: '2026-10-08', products: [{ id: pid, forms: 3, cycleDays: 1, volume: 2 }], orders: [{ id: 'order', productId: pid, qty: i, status: 'yangi', deadline: '2026-11-01' }], settings: { concretePerDay: 4, workDays: [1,2,3,4,5,6], holidays: [] } });
  assert.equal(plan.days.flatMap(d => d.items).reduce((s,x) => s+x.qty, 0), i);
  assert.ok(plan.days.every(d => d.concrete <= 4 && d.items.reduce((s,x) => s+x.qty, 0) <= 3));
}
record('planner-capacity-and-quantity-20-cases', { outcome: 'passed' });
await fs.writeFile(new URL('./review-check-results.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
