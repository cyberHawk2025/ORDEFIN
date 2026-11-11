const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(new URL('../electron/investment-store.mjs', `file://${__filename}`), 'utf8');
test('edição sem mudança efetiva é rejeitada', () => assert.match(src, /Nenhuma alteração efetiva informada/));
test('movimentação órfã é rejeitada', () => assert.match(src, /old\.accountId == null && movement/));
test('atualização de movimentação exige exatamente uma linha', () => assert.match(src, /movementResult\.changes !== 1/));
