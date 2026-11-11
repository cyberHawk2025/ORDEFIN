const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY,name TEXT,opening_balance REAL DEFAULT 0);
CREATE TABLE transactions(id INTEGER PRIMARY KEY,kind TEXT,amount REAL,account_id INTEGER,paid INTEGER NOT NULL DEFAULT 0);
CREATE TABLE account_adjustments(account_id INTEGER,amount REAL);
CREATE TABLE card_payments(account_id INTEGER,amount REAL);
CREATE TABLE transfers(source_account_id INTEGER,destination_account_id INTEGER,amount REAL);
INSERT INTO accounts VALUES(1,'Santander',0),(2,'Nubank',0);
INSERT INTO transactions VALUES(1,'receita',1000,1,0),(2,'receita',500,2,0),(3,'despesa',200,1,0);`);
const sql = `SELECT a.id, a.opening_balance
+ COALESCE((SELECT SUM(amount) FROM account_adjustments WHERE account_id=a.id),0)
+ COALESCE((SELECT SUM(CASE WHEN t.kind='receita' THEN t.amount ELSE -t.amount END)
FROM transactions t WHERE t.account_id=a.id AND (t.kind='receita' OR t.paid=1)),0)
- COALESCE((SELECT SUM(amount) FROM card_payments WHERE account_id=a.id),0)
+ COALESCE((SELECT SUM(amount) FROM transfers WHERE destination_account_id=a.id),0)
- COALESCE((SELECT SUM(amount) FROM transfers WHERE source_account_id=a.id),0) balance
FROM accounts a ORDER BY id`;
const balances = () => db.prepare(sql).all().map(x => x.balance);
assert.deepEqual(balances(), [1000,500]);
db.exec('UPDATE transactions SET paid=1 WHERE id=3');
assert.deepEqual(balances(), [800,500]);
db.exec('UPDATE transactions SET paid=0 WHERE id=3');
assert.deepEqual(balances(), [1000,500]);
db.exec('UPDATE transactions SET paid=1,account_id=2 WHERE id=3');
assert.deepEqual(balances(), [1000,300]);
db.exec('INSERT INTO transfers VALUES(1,2,100)');
assert.deepEqual(balances(), [900,400]);
assert.equal(balances().reduce((a,b)=>a+b,0),1300);
console.log('OK: pendente, pago, estorno, duas contas, transferência e total.');
