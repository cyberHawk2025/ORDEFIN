const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(new URL('../electron/investment-store.mjs', `file://${__filename}`), 'utf8');
test('edição rejeita alterações vazias', () => assert.match(src, /Object\.keys\(patch\)\.length === 0/));
test('edição não ignora movimentação bancária ausente', () => assert.match(src, /old\.accountId != null && !movement/));
test('edição confere conta bancária vinculada', () => assert.match(src, /movement\.account_id\) !== Number\(old\.accountId\)/));
