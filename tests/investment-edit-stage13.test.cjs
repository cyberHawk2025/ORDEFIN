const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(new URL('../electron/investment-store.mjs', `file://${__filename}`), 'utf8');
test('edição valida modos bancários persistidos', () => assert.match(source, /\["move", "recorded"\]\.includes\(movement\.mode\)/));
test('edição recusa ajuste inesperado em operação registrada', () => assert.match(source, /movement\.mode === "recorded" && movement\.adjustment_id != null/));
test('edição verifica existência da conta associada', () => assert.match(source, /SELECT id FROM accounts WHERE id=\?/));
