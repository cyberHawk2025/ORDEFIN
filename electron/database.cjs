// Schema changes are atomic; existing databases receive a consistent SQLite snapshot first.

const { DatabaseSync } = require("node:sqlite")

const fs = require("node:fs")

const path = require("node:path")

function initialize(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY, description TEXT NOT NULL, category TEXT NOT NULL,
    type TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0), date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'despesa');
    CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, opening_balance REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS transfers (id INTEGER PRIMARY KEY, source_account_id INTEGER NOT NULL REFERENCES accounts(id), destination_account_id INTEGER NOT NULL REFERENCES accounts(id), amount REAL NOT NULL CHECK(amount > 0), date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', CHECK(source_account_id <> destination_account_id));
    CREATE TABLE IF NOT EXISTS credit_cards (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, credit_limit REAL NOT NULL CHECK(credit_limit >= 0));
    CREATE TABLE IF NOT EXISTS card_payments (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES credit_cards(id), account_id INTEGER REFERENCES accounts(id), amount REAL NOT NULL CHECK(amount > 0), date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY, action TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS account_adjustments (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), amount REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS btc_history (time INTEGER PRIMARY KEY, price REAL NOT NULL);`)
}

function migrate(db) {
  const columns = db.prepare("PRAGMA table_info(transactions)").all()

  if (!columns.some((c) => c.name === "kind"))
    db.exec(
      "ALTER TABLE transactions ADD COLUMN kind TEXT NOT NULL DEFAULT 'despesa'",
    )

  if (!columns.some((c) => c.name === "card_id"))
    db.exec(
      "ALTER TABLE transactions ADD COLUMN card_id INTEGER REFERENCES credit_cards(id)",
    )

  if (!columns.some((c) => c.name === "account_id"))
    db.exec(
      "ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)",
    )

  const cardColumns = db.prepare("PRAGMA table_info(credit_cards)").all()

  for (const field of ["issuer", "brand", "last_four"])
    if (!cardColumns.some((c) => c.name === field))
      db.exec(`ALTER TABLE credit_cards ADD COLUMN ${field} TEXT`)

  if (!cardColumns.some((c) => c.name === "card_mode"))
    db.exec(
      "ALTER TABLE credit_cards ADD COLUMN card_mode TEXT NOT NULL DEFAULT 'credito'",
    )

  if (!cardColumns.some((c) => c.name === "account_id"))
    db.exec(
      "ALTER TABLE credit_cards ADD COLUMN account_id INTEGER REFERENCES accounts(id)",
    )

  if (!columns.some((c) => c.name === "debit_card_id"))
    db.exec(
      "ALTER TABLE transactions ADD COLUMN debit_card_id INTEGER REFERENCES credit_cards(id)",
    )

  // Preserva o saldo de instalações antigas: despesas já vinculadas eram debitadas imediatamente.

  // Despesas sem conta permanecem pendentes até confirmação do pagamento.

  if (!columns.some((c) => c.name === "paid")) {
    db.exec(
      "ALTER TABLE transactions ADD COLUMN paid INTEGER NOT NULL DEFAULT 0",
    )

    db.exec(
      "UPDATE transactions SET paid=1 WHERE kind='despesa' AND account_id IS NOT NULL",
    )
  }

  db.exec(`CREATE TABLE IF NOT EXISTS investment_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS investment_legacy (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS investment_movements (operation_id TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), adjustment_id INTEGER UNIQUE REFERENCES account_adjustments(id), date TEXT NOT NULL, amount TEXT NOT NULL, mode TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '');
    `)
}

// Etapa 4: migração aditiva. Mantém colunas REAL para compatibilidade com a UI atual.
// As colunas *_cents são a representação inteira auditável, sincronizada por triggers.
const monetaryColumns = {
  transactions: ['amount'], accounts: ['opening_balance'],
  transfers: ['amount'], credit_cards: ['credit_limit'],
  card_payments: ['amount'], account_adjustments: ['amount'],
}

function migrateMoneyCents(db) {
  for (const [table, fields] of Object.entries(monetaryColumns)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name))
    for (const field of fields) {
      const shadow = `${field}_cents`
      if (!existing.has(shadow)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${shadow} INTEGER`)
      // SQLite REAL pode representar valores decimais com pequenas diferenças binárias.
      // Valores com frações de centavo são recusados, nunca arredondados silenciosamente.
      const invalid = db.prepare(`SELECT id, ${field} AS value FROM ${table} WHERE ${field} IS NULL OR ABS(${field} * 100 - ROUND(${field} * 100)) > 0.000001 OR ABS(${field} * 100) > 9007199254740991 LIMIT 1`).get()
      if (invalid) throw new Error(`MIGRACAO_VALOR_INVALIDO:${table}.${field}:id=${invalid.id}`)
      db.exec(`UPDATE ${table} SET ${shadow} = CAST(ROUND(${field} * 100) AS INTEGER) WHERE ${shadow} IS NULL`)
      // Bloqueia novas gravações que não podem ser representadas exatamente em centavos.
      // Os triggers BEFORE preservam a atomicidade: nenhuma linha inválida é persistida.
      const valid = value => `${value} IS NOT NULL AND typeof(${value}) IN ('integer','real') AND ABS(${value} * 100) <= 9007199254740991 AND ABS(${value} * 100 - ROUND(${value} * 100)) <= 0.000001`
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${field}_validate_insert BEFORE INSERT ON ${table}
        WHEN NOT (${valid(`NEW.${field}`)}) BEGIN SELECT RAISE(ABORT, 'VALOR_MONETARIO_INVALIDO'); END`)
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${field}_validate_update BEFORE UPDATE OF ${field} ON ${table}
        WHEN NOT (${valid(`NEW.${field}`)}) BEGIN SELECT RAISE(ABORT, 'VALOR_MONETARIO_INVALIDO'); END`)
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${field}_cents_insert AFTER INSERT ON ${table}
        BEGIN UPDATE ${table} SET ${shadow}=CAST(ROUND(NEW.${field}*100) AS INTEGER) WHERE id=NEW.id; END`)
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${field}_cents_update AFTER UPDATE OF ${field} ON ${table}
        BEGIN UPDATE ${table} SET ${shadow}=CAST(ROUND(NEW.${field}*100) AS INTEGER) WHERE id=NEW.id; END`)
    }
  }
  db.exec('PRAGMA user_version=3')
}

function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const existed = fs.existsSync(file)

  const db = new DatabaseSync(file)

  try {
    // Verifica integridade antes de migrar ou gerar cópias de segurança.
    // Um arquivo danificado nunca deve ser regravado automaticamente.
    const integrity = db.prepare("PRAGMA integrity_check").all()
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("BANCO_SQLITE_CORROMPIDO: restaure um backup válido")
    }
    db.exec("PRAGMA busy_timeout=5000")
    const version = db.prepare("PRAGMA user_version").get().user_version

    if (version > 3)
      throw new Error(
        "Banco criado por versão mais recente. Atualize o aplicativo.",
      )

    if (existed && version < 3)
      db.prepare("VACUUM INTO ?").run(
        file + ".before-v3-" + Date.now() + ".sqlite",
      )

    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")

    db.exec("BEGIN IMMEDIATE")

    try {
      initialize(db)
      migrate(db)
      migrateMoneyCents(db)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    return db
  } catch (error) {
    db.close()
    throw error
  }
}

module.exports = { openDatabase }
