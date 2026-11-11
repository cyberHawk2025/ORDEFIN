const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ui = read('src/Investments.tsx');
const preload = read('electron/preload.cjs');
const main = read('electron/main.cjs');
test('editing investment is reachable from the history interface', () => {
 assert.match(ui, /className="investment-history-edit"/);
 assert.match(ui, />Editar<\/button>/);
 assert.match(ui, /api\.editDetails\(o\.id/);
});
test('edit details IPC channel is connected end to end', () => {
 assert.match(preload, /editDetails:\s*\(id,patch\)\s*=>\s*ipcRenderer\.invoke\('investments:editDetails'/);
 assert.match(main, /secureHandle\('investments:editDetails'/);
 assert.match(main, /investments\.editDetails\(id,patch\)/);
});
test('editing UI captures amount, fees, quantity and date', () => {
 for (const key of ['amount', 'fees', 'quantity', 'date']) assert.match(ui, new RegExp(key + ':'));
 assert.match(ui, /setBusy\(true\)/);
 assert.match(ui, /finally\s*\{\s*setBusy\(false\)/);
});
test('editing refreshes investment state and emits change event', () => {
 assert.match(ui, /setState\(updated\)/);
 assert.match(ui, /ordefin-investments-changed/);
});
