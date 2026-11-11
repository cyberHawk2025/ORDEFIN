import moneyBalance from "./money-balance.cjs"
import {
  portfolio,
  validateOperation,
  assetKey,
  decimal,
  localDate,
  validDate,
  amount,
} from "../shared/investments.mjs"

export function createInvestmentStore(db) {
  const read = () => {
    const r = db
      .prepare("SELECT payload FROM investment_state WHERE id=1")
      .get()
    return r ? JSON.parse(r.payload) : null
  }

  const write = (state) =>
    db.prepare(
      "INSERT INTO investment_state(id,payload,revision) VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=investment_state.revision+1",
    ).run(JSON.stringify(state))

  function initialize(legacy = {}) {
    if (read()) return read()
    db.exec("BEGIN IMMEDIATE")
    try {
      for (const [key, payload] of Object.entries(legacy)) {
        if (
          !["ordefin-investments-v1", "ordefin-investments-v2"].includes(key) ||
          typeof payload !== "string" ||
          payload.length > 10000000
        )
          throw Error("Arquivo legado inválido")
        db.prepare(
          "INSERT OR IGNORE INTO investment_legacy(key,payload) VALUES(?,?)",
        ).run(key, payload)
      }

      const state = {
        version: 1,
        operations: [],
        quotes: {},
        observations: [],
        warnings: [],
      }

      if (legacy["ordefin-investments-v2"]) {
        const entries = JSON.parse(legacy["ordefin-investments-v2"])
        if (!Array.isArray(entries))
          throw Error("Carteira antiga inválida; dados preservados")
        for (const e of entries) {
          const fixed = ["CDB / CDI", "Tesouro / renda fixa"].includes(
            e.category,
          )
          const category =
            e.category === "CDB / CDI"
              ? "CDB"
              : e.category === "Tesouro / renda fixa"
                ? "Outro"
                : e.category
          const op = {
            id: "v94-" + e.id,
            type: "buy",
            asset: {
              category,
              symbol: e.symbol || e.name || category,
              ...(fixed ? { rateType: "unknown", contract: e.id } : {}),
            },
            date: e.date,
            amount: String(e.invested),
            fees: "0",
            quantity: fixed ? null : String(e.quantity),
            estimated: true,
            legacy: e,
          }
          validateOperation(op)
          state.operations.push(op)
        }
        portfolio(state.operations)
        state.warnings.push(
          "Aportes da V94 preservados. Quantidades antigas marcadas como estimadas; taxas genéricas antigas não são usadas para valorar renda fixa.",
        )
      }

      if (legacy["ordefin-investments-v1"])
        state.warnings.push(
          "Existe arquivo legado v1 preservado no backup SQLite e no armazenamento original; formato ainda exige revisão antes de importar.",
        )
      write(state)
      db.exec("COMMIT")
      return state
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  }

  function add(op) {
    validateOperation(op)
    db.exec("BEGIN IMMEDIATE")
    try {
      const state = read()
      if (!state) throw Error("Abra a carteira antes de registrar")
      const old = state.operations.find((x) => x.id === op.id)
      if (old) {
        if (JSON.stringify(old) !== JSON.stringify(op))
          throw Error("Identificador já usado")
        db.exec("COMMIT")
        return state
      }
      portfolio([...state.operations, op])
      if (op.accountId != null) {
        if (!db.prepare("SELECT id FROM accounts WHERE id=?").get(op.accountId))
          throw Error("Conta inexistente")

        if (!["move", "recorded"].includes(op.bankMode))
          throw Error("Informe se o saldo já reflete a operação")

        const value =
          op.type === "buy"
            ? decimal(op.amount).plus(op.fees).negated()
            : decimal(op.amount).minus(op.fees)

        if (!value.mul(100).isInteger() || value.abs().gt("90071992547409"))
          throw Error(
            "Movimentação bancária requer centavos exatos e valor representável",
          )

        // Verifica o saldo dentro da mesma transação IMMEDIATE que registra o aporte.
        // Modo "recorded" não movimenta a conta novamente.
        if (op.bankMode === "move" && value.isNegative()) {
          const cents = moneyBalance.balanceCents(db, op.accountId)
          const debitCents = value.negated().mul(100)
          if (cents === null || !Number.isSafeInteger(cents) ||
              debitCents.gt(cents)) throw Error("SALDO_INSUFICIENTE")
        }

        let adjustment = null

        if (op.bankMode === "move")
          adjustment = Number(
            db
              .prepare(
                "INSERT INTO account_adjustments(account_id,amount,created_at) VALUES(?,?,?)",
              )
              .run(op.accountId, value.toNumber(), op.date).lastInsertRowid,
          )

        db.prepare(
          "INSERT INTO investment_movements(operation_id,account_id,adjustment_id,date,amount,mode,reference) VALUES(?,?,?,?,?,?,?)",
        ).run(
          op.id,
          op.accountId,
          adjustment,
          op.date,
          value.toString(),
          op.bankMode,
          String(op.bankReference || ""),
        )
      }
      state.operations.push(op)
      write(state)
      db.exec("COMMIT")
      return state
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  }

  function editDetails(id, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw Error("Alterações inválidas")
    const allowed = ["amount", "fees", "quantity", "date"]
    if (Object.keys(patch).length === 0) throw Error("Nenhuma alteração informada")
    if (Object.keys(patch).some(k => !allowed.includes(k))) throw Error("Campo não permitido")
    db.exec("BEGIN IMMEDIATE")
    try {
      const state = read()
      if (!state) throw Error("Carteira não inicializada")
      const index = state.operations.findIndex(o => o.id === id)
      if (index < 0) throw Error("Operação não encontrada")
      const old = state.operations[index]
      const updated = { ...old, ...patch }
      for (const field of ["amount", "fees"]) {
        const value = decimal(updated[field])
        if (!value.isFinite() || (field === "amount" ? value.lte(0) : value.lt(0)) ||
            !value.mul(100).isInteger() || value.mul(100).abs().gt(Number.MAX_SAFE_INTEGER))
          throw Error("Valor ou taxa inválida: informe centavos exatos")
        updated[field] = value.toString()
      }
      if (updated.quantity !== null) {
        const q = decimal(updated.quantity)
        if (!q.isFinite() || q.lte(0)) throw Error("Quantidade inválida")
        updated.quantity = q.toString()
      }
      if (Object.hasOwn(patch, "quantity")) updated.estimated = false
      // Não criar revisões nem movimentações para uma edição sem mudança efetiva.
      if (["amount", "fees", "quantity", "date"].every(field =>
        String(updated[field]) === String(old[field])))
        throw Error("Nenhuma alteração efetiva informada")
      validateOperation(updated)
      portfolio(state.operations.map((o, i) => i === index ? updated : o))
      const movement = db.prepare("SELECT * FROM investment_movements WHERE operation_id=?").get(id)
      if (old.accountId != null && !movement) throw Error("Movimentação bancária vinculada não encontrada")
      if (old.accountId == null && movement) throw Error("Movimentação bancária inesperada para operação sem conta")
      if (movement) {
        if (!["move", "recorded"].includes(movement.mode)) throw Error("Modo bancário inválido")
        if (movement.mode === "recorded" && movement.adjustment_id != null) throw Error("Operação já registrada possui ajuste bancário inesperado")
        if (!db.prepare("SELECT id FROM accounts WHERE id=?").get(movement.account_id)) throw Error("Conta bancária vinculada inexistente")
        if (old.accountId != null && Number(movement.account_id) !== Number(old.accountId)) throw Error("Conta vinculada inconsistente")
        const signed = old.type === "buy" ? decimal(updated.amount).plus(updated.fees).negated() : decimal(updated.amount).minus(updated.fees)
        if (!signed.mul(100).isInteger()) throw Error("Movimentação exige centavos exatos")
        if (movement.mode === "move") {
          if (movement.adjustment_id == null) throw Error("Ajuste bancário ausente")
          const delta = signed.minus(decimal(movement.amount)).mul(100)
          const balance = moneyBalance.balanceCents(db, movement.account_id)
          if (!Number.isSafeInteger(balance) || !delta.isInteger() || delta.abs().gt(Number.MAX_SAFE_INTEGER)) throw Error("Saldo fora do limite seguro")
          if (delta.isNegative() && delta.negated().gt(balance)) throw Error("SALDO_INSUFICIENTE")
          const result = db.prepare("UPDATE account_adjustments SET amount=?,created_at=? WHERE id=? AND account_id=?")
            .run(signed.toNumber(), updated.date, movement.adjustment_id, movement.account_id)
          if (result.changes !== 1) throw Error("Ajuste bancário não encontrado")
        }
        const movementResult = db.prepare("UPDATE investment_movements SET amount=?,date=? WHERE operation_id=?")
          .run(signed.toString(), updated.date, id)
        if (movementResult.changes !== 1) throw Error("Movimentação bancária não atualizada")
      }
      state.operations[index] = updated
      write(state)
      db.exec("COMMIT")
      return state
    } catch (e) { db.exec("ROLLBACK"); throw e }
  }

  function editAmount(id, value) { return editDetails(id, { amount: value }) }

  function saveQuote(asset, q) {
    if (!q || !Number.isFinite(q.fetchedAt) || !q.source)
      throw Error("Cotação inválida")
    amount(q.price)
    if (!validDate(q.date) || q.date > localDate())
      throw Error("Data de avaliação inválida")
    const state = read()
    state.quotes[assetKey(asset)] = q
    write(state)
    return state
  }

  function observe() {
    const state = read()
    const p = portfolio(state.operations, state.quotes).filter((p) => !p.closed)
    if (
      !p.length ||
      p.some(
        (p) =>
          p.value == null ||
          p.quote.stale ||
          Date.now() - p.quote.fetchedAt > 86400000,
      )
    )
      return state
    const value = p.reduce((s, p) => s.plus(p.value), decimal(0))
    const cost = p.reduce((s, p) => s.plus(p.cost), decimal(0))
    const point = {
      date: localDate(),
      time: Date.now(),
      value: value.toString(),
      cost: cost.toString(),
      result: value.minus(cost).toString(),
      source:
        "Avaliações disponíveis na consulta; datas individuais preservadas",
      quotes: state.quotes,
    }
    state.observations = [
      ...state.observations.filter((p) => p.date !== point.date),
      point,
    ].slice(-3650)
    write(state)
    return state
  }

  // Exclusão explícita somente da carteira de testes; demais áreas permanecem intactas.
  function resetPortfolio(confirmation) {
    if (confirmation !== "ZERAR INVESTIMENTOS") throw Error("Confirmação inválida")
    db.exec("BEGIN IMMEDIATE")
    try {
      const state = read()
      if (!state) throw Error("Carteira não inicializada")
      const movements = db.prepare("SELECT * FROM investment_movements").all()
      for (const movement of movements) {
        if (movement.mode === "move") {
          if (movement.adjustment_id == null) throw Error("Ajuste bancário vinculado ausente; limpeza cancelada")
          const adjustment = db.prepare("SELECT id FROM account_adjustments WHERE id=? AND account_id=?").get(movement.adjustment_id, movement.account_id)
          if (!adjustment) throw Error("Ajuste bancário não encontrado; limpeza cancelada")
        } else if (movement.mode !== "recorded" || movement.adjustment_id != null) {
          throw Error("Movimentação inconsistente; limpeza cancelada")
        }
      }
      for (const movement of movements) {
        if (movement.mode === "move") {
          const result = db.prepare("DELETE FROM account_adjustments WHERE id=? AND account_id=?").run(movement.adjustment_id, movement.account_id)
          if (result.changes !== 1) throw Error("Falha ao reverter ajuste bancário")
        }
      }
      db.prepare("DELETE FROM investment_movements").run()
      const cleared = { version: 1, operations: [], quotes: {}, observations: [], warnings: [] }
      write(cleared)
      db.exec("COMMIT")
      return cleared
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }

  // Remove apenas as operações do ativo identificado pela chave completa.
  // A reversão bancária segue as mesmas salvaguardas do reset da carteira.
  function deleteAsset(key, confirmation) {
    if (typeof key !== "string" || !key || key.length > 512) throw Error("Ativo inválido")
    if (confirmation !== "EXCLUIR ATIVO") throw Error("Confirmação inválida")
    db.exec("BEGIN IMMEDIATE")
    try {
      const state = read()
      if (!state) throw Error("Carteira não inicializada")
      const target = state.operations.filter(op => assetKey(op.asset) === key)
      if (!target.length) throw Error("Ativo não encontrado na carteira")
      const ids = new Set(target.map(op => op.id))
      const movements = db.prepare("SELECT * FROM investment_movements").all().filter(m => ids.has(m.operation_id))
      for (const m of movements) {
        if (m.mode === "move") {
          if (m.adjustment_id == null || !db.prepare("SELECT id FROM account_adjustments WHERE id=? AND account_id=?").get(m.adjustment_id, m.account_id))
            throw Error("Ajuste bancário vinculado não encontrado; exclusão cancelada")
        } else if (m.mode !== "recorded" || m.adjustment_id != null) {
          throw Error("Movimentação bancária inconsistente; exclusão cancelada")
        }
      }
      for (const m of movements) {
        if (m.mode === "move") {
          const result = db.prepare("DELETE FROM account_adjustments WHERE id=? AND account_id=?").run(m.adjustment_id, m.account_id)
          if (result.changes !== 1) throw Error("Falha ao reverter ajuste bancário")
        }
        const result = db.prepare("DELETE FROM investment_movements WHERE operation_id=?").run(m.operation_id)
        if (result.changes !== 1) throw Error("Falha ao excluir movimentação vinculada")
      }
      state.operations = state.operations.filter(op => !ids.has(op.id))
      // Preserva cotações compartilhadas e todos os demais investimentos.
      portfolio(state.operations)
      write(state)
      db.exec("COMMIT")
      return state
    } catch (error) { db.exec("ROLLBACK"); throw error }
  }

  // Exclui uma única operação, atomicamente, sem afetar os demais lançamentos.
  function deleteOperation(id, confirmation) {
    if (typeof id !== "string" || !id || id.length > 512) throw Error("Identificador de operação inválido")
    if (confirmation !== "EXCLUIR OPERACAO") throw Error("Confirmação inválida")
    db.exec("BEGIN IMMEDIATE")
    try {
      const state = read()
      if (!state) throw Error("Carteira não inicializada")
      const target = state.operations.find(op => op.id === id)
      if (!target) throw Error("Operação não encontrada")
      const remaining = state.operations.filter(op => op.id !== id)
      // Revalida a sequência inteira: uma compra usada por venda posterior não pode desaparecer.
      try { portfolio(remaining) } catch (error) {
        throw Error("Exclusão bloqueada: a operação é necessária para manter a carteira consistente. " + String(error))
      }
      const movements = db.prepare("SELECT * FROM investment_movements WHERE operation_id=?").all(id)
      for (const m of movements) {
        if (m.mode === "move") {
          if (m.adjustment_id == null || !db.prepare("SELECT id FROM account_adjustments WHERE id=? AND account_id=?").get(m.adjustment_id, m.account_id))
            throw Error("Ajuste bancário vinculado não encontrado; exclusão cancelada")
        } else if (m.mode !== "recorded" || m.adjustment_id != null) {
          throw Error("Movimentação bancária inconsistente; exclusão cancelada")
        }
      }
      for (const m of movements) {
        if (m.mode === "move") {
          const result = db.prepare("DELETE FROM account_adjustments WHERE id=? AND account_id=?").run(m.adjustment_id, m.account_id)
          if (result.changes !== 1) throw Error("Falha ao reverter ajuste bancário")
        }
        const result = db.prepare("DELETE FROM investment_movements WHERE operation_id=?").run(m.operation_id)
        if (result.changes !== 1) throw Error("Falha ao excluir movimentação vinculada")
      }
      state.operations = remaining
      write(state)
      db.exec("COMMIT")
      return state
    } catch (error) { db.exec("ROLLBACK"); throw error }
  }

  function complete(id, quantity) {
    const state = read()
    const op = state.operations.find((o) => o.id === id)
    if (!op || op.type !== "buy" || op.quantity != null)
      throw Error("Somente aportes sem quantidade podem ser completados")
    amount(quantity)
    op.quantity = String(quantity)
    op.estimated = false
    portfolio(state.operations)
    write(state)
    return state
  }

  return { read, initialize, add, editAmount, editDetails, saveQuote, observe, complete, resetPortfolio, deleteAsset, deleteOperation }
}
