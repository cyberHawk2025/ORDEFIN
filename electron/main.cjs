const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { balanceCentsSql, centsToReais } = require('./money-balance.cjs');
let db;
// Bloqueia invocações IPC originadas de frames não confiáveis.
function assertTrustedSender(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) throw new Error('IPC_FRAME_NAO_AUTORIZADO');
  const origin = frame.url;
  if (!app.isPackaged && process.env.FINORA_DEV_SERVER === '1') {
    if (origin !== 'http://127.0.0.1:5173/') throw new Error('IPC_ORIGEM_NAO_AUTORIZADA');
  } else {
    const expected = require('node:url').pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
    if (origin !== expected) throw new Error('IPC_ORIGEM_NAO_AUTORIZADA');
  }
}
function secureHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}
const { openDatabase } = require('./database.cjs');
const { toCents: cents, fromCents } = require('./money.cjs');
const money = value => fromCents(cents(value));
const validMoney = value => typeof value === 'number' && Number.isFinite(value) && require('./money.cjs').isMoney(value);
function logActivity(action, message) { db.prepare('INSERT INTO activity_log(action,message) VALUES(?,?)').run(action,message); }
function cardPaymentPreview(id) {
  const t=db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
  if(!t) throw new Error('Lançamento não encontrado');
  if(t.card_id == null || t.kind !== 'despesa') return {hasPayments:false,refund:0,overpayment:0};
  const data=db.prepare(`SELECT
    COALESCE((SELECT SUM(amount) FROM transactions WHERE card_id=? AND kind='despesa'),0) purchases,
    COALESCE((SELECT SUM(amount) FROM card_payments WHERE card_id=?),0) payments`).get(t.card_id,t.card_id);
  const remaining=cents(data.purchases)-cents(t.amount);
  const overpayment=Math.max(0,cents(data.payments)-remaining);
  return {hasPayments:cents(data.payments)>0,refund:money(Math.min(cents(t.amount),cents(data.payments))),overpayment:overpayment/100,cardId:t.card_id};
}
function checkTransaction(t) {
  if (!t || typeof t.description !== 'string' || !t.description.trim() || typeof t.category !== 'string' ||
      !['Cartão','Empréstimo','Conta fixa'].includes(t.type) || !validMoney(t.amount) || t.amount < 0 ||
      !['receita','despesa',undefined].includes(t.kind) || (t.card_id != null && (!Number.isSafeInteger(t.card_id) || t.card_id <= 0)) || (t.card_id != null && (t.kind === 'receita' || t.account_id != null)) || (t.account_id != null && (!Number.isSafeInteger(t.account_id) || t.account_id <= 0)) || (t.debit_card_id != null && (!Number.isSafeInteger(t.debit_card_id) || t.debit_card_id <= 0)) || (t.debit_card_id != null && (t.card_id != null || t.kind === 'receita')) || typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error('Lançamento inválido');
}
function validateCardTransaction(t) {
  if(t.card_id!=null){const c=db.prepare('SELECT card_mode FROM credit_cards WHERE id=?').get(t.card_id);if(!c||c.card_mode==='debito')throw new Error('CARTAO_SEM_CREDITO');}
  if(t.debit_card_id!=null){const c=db.prepare('SELECT card_mode,account_id FROM credit_cards WHERE id=?').get(t.debit_card_id);if(!c||c.card_mode==='credito'||c.account_id!==t.account_id||t.card_id!=null||t.kind==='receita')throw new Error('CARTAO_DEBITO_INVALIDO');}
}
app.setName('ORDEFIN');
// Development and tests never open the production profile.
if (process.env.ORDEFIN_DATA_DIR) {
  if (!path.isAbsolute(process.env.ORDEFIN_DATA_DIR)) throw new Error('ORDEFIN_DATA_DIR deve ser absoluto');
  app.setPath('userData', process.env.ORDEFIN_DATA_DIR);
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'ORDEFIN-development'));
}
function configurePortugueseMenu() {
  const template = [
    { label: 'Arquivo', submenu: [
      { label: 'Fechar janela', accelerator: 'Ctrl+W', role: 'close' },
      { type: 'separator' },
      { label: 'Sair do ORDEFIN', accelerator: 'Alt+F4', role: 'quit' }
    ] },
    { label: 'Editar', submenu: [
      { label: 'Desfazer', role: 'undo' }, { label: 'Refazer', role: 'redo' },
      { type: 'separator' }, { label: 'Recortar', role: 'cut' },
      { label: 'Copiar', role: 'copy' }, { label: 'Colar', role: 'paste' },
      { label: 'Selecionar tudo', role: 'selectAll' }
    ] },
    { label: 'Exibir', submenu: [
      { label: 'Recarregar', role: 'reload' },
      { type: 'separator' },
      { label: 'Aumentar zoom', role: 'zoomIn' },
      { label: 'Diminuir zoom', role: 'zoomOut' },
      { label: 'Restaurar zoom', role: 'resetZoom' },
      { type: 'separator' }, { label: 'Tela cheia', role: 'togglefullscreen' }
    ] },
    { label: 'Janela', submenu: [ { label: 'Minimizar', role: 'minimize' }, { label: 'Fechar', role: 'close' } ] },
    { label: 'Ajuda', submenu: [ { label: 'Sobre o ORDEFIN', click: () => dialog.showMessageBox({
      type: 'info', title: 'Sobre o ORDEFIN', message: 'ORDEFIN',
      detail: 'Sua vida financeira em ordem.\nAplicativo de controle financeiro.'
    }) } ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(async () => {
  configurePortugueseMenu();
  db = openDatabase(path.join(app.getPath('userData'), 'finora.sqlite'));
  const { createInvestmentStore } = await import('./investment-store.mjs');
  const { createFinancialService } = await import('../services/financial.mjs');
  const { createOfficialService } = await import('../services/official.mjs');
  const investments=createInvestmentStore(db), market=createFinancialService(), official=createOfficialService();
  secureHandle('investments:load', (_event,legacy) => investments.initialize(legacy));
  secureHandle('investments:complete', (_event,id,quantity) => investments.complete(id,quantity));
  secureHandle('investments:add', (_event,op) => investments.add(op));
  secureHandle('investments:editAmount', (_event,id,value) => investments.editAmount(id,value));
  secureHandle('investments:editDetails', (_event,id,patch) => investments.editDetails(id,patch));
  secureHandle('investments:manual', (_event,asset,q) => investments.saveQuote(asset,{...q,source:'Informado pelo usuário · '+String(q.source||''),fetchedAt:Date.now(),kind:'manual',stale:true}));
  secureHandle('investments:quote', async (_event,asset,date) => {
    const provider=asset.category==='Fundo'||asset.category.startsWith('Tesouro')?official:market;
    const q=await provider.getQuote(asset,date);
    if(!date)investments.saveQuote(asset,q);
    return q;
  });
  secureHandle('investments:history', (_event,asset,fromDate) => market.history(asset,fromDate));
  secureHandle('investments:observe', () => investments.observe());
  secureHandle('investments:resetPortfolio', (_event, confirmation) => investments.resetPortfolio(confirmation));
  secureHandle('investments:deleteAsset', (_event, key, confirmation) => investments.deleteAsset(key, confirmation));
  secureHandle('investments:deleteOperation', (_event, id, confirmation) => investments.deleteOperation(id, confirmation));
  secureHandle('transactions:list', () => db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all());
  // Pagamento real: estado persistente e conta debitada exatamente uma vez.
  secureHandle('transactions:setPaid', (_event, data) => {
    if(!Number.isSafeInteger(data?.id) || data.id<=0 || typeof data.paid!=='boolean') throw new Error('Pagamento inválido');
    const old=db.prepare('SELECT * FROM transactions WHERE id=?').get(data.id);
    if(!old || old.kind!=='despesa') throw new Error('Despesa não encontrada');
    let accountId=old.account_id;
    if(data.paid && old.card_id==null) {
      if(data.account_id!=null) {
        if(!Number.isSafeInteger(data.account_id) || !db.prepare('SELECT id FROM accounts WHERE id=?').get(data.account_id)) throw new Error('Conta inexistente');
        accountId=data.account_id;
      }
      if(accountId==null) throw new Error('Selecione a conta que realizou o pagamento');
    }
    // Para compras no crédito, o saldo só muda pelo pagamento da fatura.
    db.prepare('UPDATE transactions SET paid=?,account_id=? WHERE id=?').run(data.paid?1:0,accountId,data.id);
    logActivity('pagamento', `Despesa ${data.paid?'paga':'pendente'}: ${old.description}`);
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(data.id);
  });
  secureHandle('transactions:add', (_event, t) => {
    checkTransaction(t);
    validateCardTransaction(t);
    const result = db.prepare('INSERT INTO transactions(description,category,type,amount,date,kind,account_id,card_id,debit_card_id) VALUES(?,?,?,?,?,?,?,?,?)').run(t.description.trim(), t.category, t.type, t.amount, t.date, t.kind || 'despesa', t.account_id ?? null, t.card_id ?? null,t.debit_card_id??null);
    logActivity('criado', `Lançamento criado: ${t.description.trim()} — R$ ${money(t.amount).toFixed(2)}`);
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(result.lastInsertRowid);
  });
  secureHandle('transactions:update', (_event, t) => {
    if(!Number.isSafeInteger(t?.id)||t.id<=0)throw new Error('ID inválido');
    checkTransaction(t);
    validateCardTransaction(t);
    const existing=db.prepare('SELECT * FROM transactions WHERE id=?').get(t.id);
    if(!existing)throw new Error('Lançamento não encontrado');
    db.prepare('UPDATE transactions SET description=?,category=?,type=?,amount=?,date=?,kind=?,account_id=?,card_id=?,debit_card_id=? WHERE id=?')
      .run(t.description.trim(),t.category,t.type,t.amount,t.date,t.kind||'despesa',t.account_id??null,t.card_id??null,t.debit_card_id??null,t.id);
    logActivity('editado', `Lançamento editado: ${existing.description} (R$ ${money(existing.amount).toFixed(2)}) → ${t.description.trim()} (R$ ${money(t.amount).toFixed(2)})`);
    return db.prepare('SELECT * FROM transactions WHERE id=?').get(t.id);
  });
  secureHandle('activity:list', () => db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 100').all());
  secureHandle('transactions:deletePreview', (_event,id) => {
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('ID inválido');
    return cardPaymentPreview(id);
  });
  secureHandle('transactions:delete', (_event, id, refundPayment=false) => {
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('ID inválido');
    db.exec('BEGIN IMMEDIATE');
    try {
      const t=db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
      if(!t)throw new Error('Lançamento não encontrado');
      const preview=cardPaymentPreview(id);
      if(preview.overpayment>0 && !refundPayment)throw new Error('ESTORNO_NECESSARIO');
      let refunded=0;
      if(refundPayment && preview.hasPayments){
        // Payments are aggregated by card; unwind newest first, up to the purchase amount.
        let remaining=cents(preview.refund);
        const payments=db.prepare('SELECT * FROM card_payments WHERE card_id=? ORDER BY date DESC,id DESC').all(t.card_id);
        for(const payment of payments){
          if(remaining<=0)break;
          const take=Math.min(remaining,cents(payment.amount));
          if(take===cents(payment.amount))db.prepare('DELETE FROM card_payments WHERE id=?').run(payment.id);
          else db.prepare('UPDATE card_payments SET amount=? WHERE id=?').run((cents(payment.amount)-take)/100,payment.id);
          remaining-=take; refunded+=take;
        }
      }
      db.prepare('DELETE FROM transactions WHERE id=?').run(id);
      logActivity('excluido',`Lançamento excluído: ${t.description} — R$ ${money(t.amount).toFixed(2)}${refunded?`; pagamento estornado: R$ ${(refunded/100).toFixed(2)}`:''}`);
      db.exec('COMMIT');
      return {deleted:true,refunded:refunded/100};
    }catch(error){db.exec('ROLLBACK');throw error;}
  });
  secureHandle('transactions:importLegacy', (_event, rows) => {
    if (!Array.isArray(rows) || rows.length > 100000) throw new Error('Importação inválida');
    const insert = db.prepare('INSERT OR IGNORE INTO transactions(id,description,category,type,amount,date,kind) VALUES(?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    try { for (const t of rows) { checkTransaction(t); if (!Number.isSafeInteger(t.id) || t.id <= 0) continue; insert.run(t.id,t.description,t.category,t.type,t.amount,t.date,t.kind || 'despesa'); } db.exec('COMMIT'); }
    catch (err) { db.exec('ROLLBACK'); throw err; }
    return db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all();
  });
  secureHandle('transactions:importExcel', (_event, rows) => {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 20000) throw new Error('Quantidade de linhas inválida');
    const insert = db.prepare('INSERT INTO transactions(description,category,type,amount,date,kind,account_id) VALUES(?,?,?,?,?,?,NULL)');
    db.exec('BEGIN');
    try {
      for (const t of rows) {
        checkTransaction(t);
        insert.run(t.description.trim(),t.category,t.type,t.amount,t.date,t.kind || 'despesa');
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return rows.length;
  });
  secureHandle('accounts:list', () => db.prepare(`SELECT a.*, (${balanceCentsSql('a')}) AS balance_cents FROM accounts a ORDER BY a.name`).all().map(a => ({...a, balance: centsToReais(a.balance_cents)})));
  secureHandle('accounts:update', (_e, a) => {
    if (!Number.isSafeInteger(a?.id) || a.id <= 0 || typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 100 || !validMoney(a.opening_balance) || a.opening_balance < 0) throw new Error('CONTA_INVALIDA');
    if (!db.prepare('SELECT id FROM accounts WHERE id=?').get(a.id)) throw new Error('CONTA_INEXISTENTE');
    if (db.prepare('SELECT id FROM accounts WHERE LOWER(name)=LOWER(?) AND id<>?').get(a.name.trim(),a.id)) throw new Error('CONTA_DUPLICADA');
    db.prepare('UPDATE accounts SET name=?, opening_balance=? WHERE id=?').run(a.name.trim(),money(a.opening_balance),a.id);
    logActivity('editado',`Conta editada: ${a.name.trim()} — saldo inicial R$ ${money(a.opening_balance).toFixed(2)}`);
    return db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
  });
  secureHandle('accounts:setCurrentBalance', (_e, a) => {
    if (!Number.isSafeInteger(a?.id) || a.id<=0 || typeof a.name!=='string' || !a.name.trim() || a.name.trim().length>100 || !validMoney(a.balance) || a.balance<0) throw new Error('CONTA_INVALIDA');
    const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
    if(!account) throw new Error('CONTA_INEXISTENTE');
    if(db.prepare('SELECT id FROM accounts WHERE LOWER(name)=LOWER(?) AND id<>?').get(a.name.trim(),a.id)) throw new Error('CONTA_DUPLICADA');
    const current=db.prepare(`SELECT (${balanceCentsSql('a')}) AS balance_cents FROM accounts a WHERE a.id=?`).get(a.id).balance_cents;
    const delta=fromCents(cents(a.balance)-current);
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE accounts SET name=? WHERE id=?').run(a.name.trim(),a.id);
      if(cents(delta)!==0) db.prepare('INSERT INTO account_adjustments(account_id,amount) VALUES(?,?)').run(a.id,money(delta));
      logActivity('editado',`Saldo de ${a.name.trim()} ajustado para R$ ${money(a.balance).toFixed(2)} (correção R$ ${money(delta).toFixed(2)})`);
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
    return true;
  });
  secureHandle('accounts:delete', (_e, id) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('CONTA_INVALIDA');
    const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
    if (!account) throw new Error('CONTA_INEXISTENTE');
    const usage=db.prepare(`SELECT
      (SELECT COUNT(*) FROM transactions WHERE account_id=?) AS transactions,
      (SELECT COUNT(*) FROM card_payments WHERE account_id=?) AS payments,
      (SELECT COUNT(*) FROM account_adjustments WHERE account_id=?) AS adjustments,
      (SELECT COUNT(*) FROM transfers WHERE source_account_id=? OR destination_account_id=?) AS transfers`).get(id,id,id,id,id);
    if (usage.transactions || usage.payments || usage.transfers || usage.adjustments) throw new Error('CONTA_COM_MOVIMENTACOES');
    db.prepare('DELETE FROM accounts WHERE id=?').run(id);
    logActivity('excluido',`Conta excluída: ${account.name}`);
    return true;
  });
  secureHandle('cards:payments', () => db.prepare(`SELECT p.*,c.name AS card_name,a.name AS account_name FROM card_payments p JOIN credit_cards c ON c.id=p.card_id LEFT JOIN accounts a ON a.id=p.account_id ORDER BY p.date DESC,p.id DESC`).all());
  secureHandle('cards:paymentUpdate', (_e, p) => {
    if (!Number.isSafeInteger(p?.id) || p.id <= 0 || !validMoney(p.amount) || p.amount <= 0) throw new Error('PAGAMENTO_INVALIDO');
    const old=db.prepare('SELECT * FROM card_payments WHERE id=?').get(p.id);
    if (!old) throw new Error('PAGAMENTO_INEXISTENTE');
    const balance=db.prepare(`SELECT (${balanceCentsSql('a')}) AS balance_cents FROM accounts a WHERE a.id=?`).get(old.account_id);
    if (balance && balance.balance_cents+cents(old.amount)<cents(p.amount)) throw new Error('SALDO_INSUFICIENTE');
    const card=db.prepare(`SELECT COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE card_id=? AND kind='despesa'),0) purchases_cents, COALESCE((SELECT SUM(amount_cents) FROM card_payments WHERE card_id=?),0) payments_cents`).get(old.card_id,old.card_id);
    if (cents(p.amount)>card.purchases_cents-card.payments_cents+cents(old.amount)) throw new Error('PAGAMENTO_EXCEDE_DIVIDA');
    db.prepare('UPDATE card_payments SET amount=? WHERE id=?').run(money(p.amount),p.id);
    logActivity('editado',`Pagamento do cartão corrigido: R$ ${money(old.amount).toFixed(2)} → R$ ${money(p.amount).toFixed(2)}`);
    return true;
  });
  secureHandle('cards:paymentDelete', (_e,id) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('PAGAMENTO_INVALIDO');
    const p=db.prepare('SELECT * FROM card_payments WHERE id=?').get(id);
    if (!p) throw new Error('PAGAMENTO_INEXISTENTE');
    db.prepare('DELETE FROM card_payments WHERE id=?').run(id);
    logActivity('excluido',`Pagamento de cartão estornado: R$ ${money(p.amount).toFixed(2)}`);
    return true;
  });
  secureHandle('accounts:add', (_e, a) => {
    if (typeof a?.name !== 'string' || !a.name.trim() || a.name.trim().length > 100 || !validMoney(a.opening_balance)) throw new Error('Conta inválida');
    if (db.prepare('SELECT id FROM accounts WHERE LOWER(name)=LOWER(?)').get(a.name.trim())) throw new Error('CONTA_DUPLICADA');
    const r=db.prepare('INSERT INTO accounts(name,opening_balance) VALUES(?,?)').run(a.name.trim(),a.opening_balance);
    return db.prepare('SELECT * FROM accounts WHERE id=?').get(r.lastInsertRowid);
  });
  secureHandle('transfers:list', () => db.prepare('SELECT * FROM transfers ORDER BY date DESC,id DESC').all());
  secureHandle('transfers:add', (_e, t) => {
    if (!Number.isSafeInteger(t?.source_account_id) || !Number.isSafeInteger(t?.destination_account_id) || t.source_account_id===t.destination_account_id || !validMoney(t.amount) || t.amount<=0 || typeof t.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error('Transferência inválida');
    const source=db.prepare(`SELECT (${balanceCentsSql('a')}) AS balance_cents FROM accounts a WHERE a.id=?`).get(t.source_account_id);
    if (!source || !db.prepare('SELECT id FROM accounts WHERE id=?').get(t.destination_account_id)) throw new Error('CONTA_INEXISTENTE');
    if (source.balance_cents < cents(t.amount)) throw new Error('SALDO_INSUFICIENTE');
    const r=db.prepare('INSERT INTO transfers(source_account_id,destination_account_id,amount,date,note) VALUES(?,?,?,?,?)').run(t.source_account_id,t.destination_account_id,t.amount,t.date,String(t.note||'').slice(0,250));
    return db.prepare('SELECT * FROM transfers WHERE id=?').get(r.lastInsertRowid);
  });
  // Only the first eight digits leave the renderer; never send/store the full PAN.
  secureHandle('cards:identify', async (_event, prefix) => {
    if (typeof prefix !== 'string' || !/^\d{8}$/.test(prefix)) return {issuer:'',brand:'',source:'invalid'};
    // A consulta recebe SOMENTE o BIN/IIN, nunca o numero completo do cartao.
    // Bases publicas podem nao ter o emissor; tentar 8 e depois 6 digitos.
    for (const bin of [prefix, prefix.slice(0,6)]) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let response;
        try { response = await fetch(`https://lookup.binlist.net/${bin}`, {signal:controller.signal, headers:{Accept:'application/json'}}); }
        finally {clearTimeout(timeout);}
        if (!response.ok) continue;
        const data = await response.json();
        const issuer = String(data?.bank?.name || '').trim().slice(0,100);
        const brand = String(data?.scheme || '').trim().slice(0,40);
        if (issuer || brand) return {issuer,brand,source:'bin'};
      } catch { /* Sem conexao ou provedor indisponivel: permitir cadastro manual. */ }
    }
    return {issuer:'',brand:'',source:'unavailable'};
  });
  secureHandle('cards:list', () => db.prepare(`SELECT c.*, COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.card_id=c.id AND t.kind='despesa'),0) AS purchases_cents, COALESCE((SELECT SUM(p.amount_cents) FROM card_payments p WHERE p.card_id=c.id),0) AS payments_cents FROM credit_cards c ORDER BY c.name`).all().map(c => { const usedCents=Math.max(0,c.purchases_cents-c.payments_cents); return {...c, purchases:centsToReais(c.purchases_cents), payments:centsToReais(c.payments_cents), used:centsToReais(usedCents), available:centsToReais(cents(c.credit_limit)-usedCents)}; }));
  secureHandle('cards:add', (_e,c) => {
    if (typeof c?.name !== 'string' || !c.name.trim() || c.name.trim().length>100 || !validMoney(c.credit_limit) || c.credit_limit<0) throw new Error('CARTAO_INVALIDO');
    if (db.prepare('SELECT id FROM credit_cards WHERE LOWER(name)=LOWER(?)').get(c.name.trim())) throw new Error('CARTAO_DUPLICADO');
    if(!['debito','credito','ambos'].includes(c.card_mode))throw new Error('FUNCAO_INVALIDA');
    if(c.card_mode!=='credito'&&(!Number.isSafeInteger(c.account_id)||!db.prepare('SELECT id FROM accounts WHERE id=?').get(c.account_id)))throw new Error('CONTA_OBRIGATORIA');
    if(c.card_mode==='debito'&&c.credit_limit!==0)throw new Error('DEBITO_SEM_LIMITE');
    const r=db.prepare('INSERT INTO credit_cards(name,credit_limit,issuer,brand,last_four,card_mode,account_id) VALUES(?,?,?,?,?,?,?)').run(c.name.trim(),c.credit_limit,String(c.issuer||'').slice(0,100),String(c.brand||'').slice(0,40),/^\d{4}$/.test(c.last_four||'')?c.last_four:null,c.card_mode,c.card_mode==='credito'?null:c.account_id);
    return db.prepare('SELECT * FROM credit_cards WHERE id=?').get(r.lastInsertRowid);
  });
  secureHandle('cards:updateIdentity', (_e, c) => {
    if (!Number.isSafeInteger(c?.id) || c.id <= 0 || typeof c.issuer !== 'string' ||
        typeof c.brand !== 'string' || typeof c.name !== 'string' ||
        !c.name.trim() || c.name.trim().length > 100 || c.issuer.length > 100 || c.brand.length > 40)
      throw new Error('DADOS_CARTAO_INVALIDOS');
    const exists=db.prepare('SELECT id FROM credit_cards WHERE id=?').get(c.id);
    if (!exists) throw new Error('CARTAO_INEXISTENTE');
    const duplicate=db.prepare('SELECT id FROM credit_cards WHERE LOWER(name)=LOWER(?) AND id<>?').get(c.name.trim(),c.id);
    if (duplicate) throw new Error('CARTAO_DUPLICADO');
    db.prepare('UPDATE credit_cards SET name=?, issuer=?, brand=? WHERE id=?')
      .run(c.name.trim(),c.issuer.trim(),c.brand.trim(),c.id);
    return db.prepare('SELECT * FROM credit_cards WHERE id=?').get(c.id);
  });
  secureHandle('cards:updateMode', (_e,c) => {
    if(!Number.isSafeInteger(c?.id)||!['debito','credito','ambos'].includes(c.card_mode))throw new Error('FUNCAO_INVALIDA');
    if(!db.prepare('SELECT id FROM credit_cards WHERE id=?').get(c.id))throw new Error('CARTAO_INEXISTENTE');
    if(c.card_mode!=='credito'&&(!Number.isSafeInteger(c.account_id)||!db.prepare('SELECT id FROM accounts WHERE id=?').get(c.account_id)))throw new Error('CONTA_OBRIGATORIA');
    const cr=db.prepare('SELECT COUNT(*) n FROM transactions WHERE card_id=?').get(c.id).n+db.prepare('SELECT COUNT(*) n FROM card_payments WHERE card_id=?').get(c.id).n;
    const dbt=db.prepare('SELECT COUNT(*) n FROM transactions WHERE debit_card_id=?').get(c.id).n;
    if((c.card_mode==='debito'&&cr)||(c.card_mode==='credito'&&dbt))throw new Error('CARTAO_COM_MOVIMENTACOES');
    const old=db.prepare('SELECT account_id FROM credit_cards WHERE id=?').get(c.id);
    if(dbt && old.account_id!==c.account_id)throw new Error('CONTA_COM_MOVIMENTACOES');
    db.prepare('UPDATE credit_cards SET card_mode=?,account_id=? WHERE id=?').run(c.card_mode,c.card_mode==='credito'?null:c.account_id,c.id);
    return db.prepare('SELECT * FROM credit_cards WHERE id=?').get(c.id);
  });
  secureHandle('cards:delete', (_e, id) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('CARTAO_INVALIDO');
    const card=db.prepare('SELECT * FROM credit_cards WHERE id=?').get(id);
    if (!card) throw new Error('CARTAO_INEXISTENTE');
    const linked=db.prepare('SELECT (SELECT COUNT(*) FROM transactions WHERE card_id=? OR debit_card_id=?) AS purchases, (SELECT COUNT(*) FROM card_payments WHERE card_id=?) AS payments').get(id,id,id);
    if (linked.purchases || linked.payments) throw new Error('CARTAO_COM_MOVIMENTACOES');
    db.prepare('DELETE FROM credit_cards WHERE id=?').run(id);
    logActivity('excluido', `Cartão excluído: ${card.name} (sem movimentações vinculadas)`);
    return true;
  });
  secureHandle('cards:updateNumber', (_e, c) => {
    if (!Number.isSafeInteger(c?.id) || c.id<=0 || !/^\d{4}$/.test(c?.last_four||'') ||
        typeof c.issuer!=='string' || typeof c.brand!=='string' || c.issuer.length>100 || c.brand.length>40)
      throw new Error('DADOS_CARTAO_INVALIDOS');
    if (!db.prepare('SELECT id FROM credit_cards WHERE id=?').get(c.id)) throw new Error('CARTAO_INEXISTENTE');
    db.prepare('UPDATE credit_cards SET last_four=?,issuer=?,brand=? WHERE id=?').run(c.last_four,c.issuer.trim(),c.brand.trim(),c.id);
    return db.prepare('SELECT * FROM credit_cards WHERE id=?').get(c.id);
  });
  secureHandle('cards:updateLimit', (_e,c) => {
    if (!Number.isSafeInteger(c?.id) || !Number.isFinite(c?.credit_limit) || c.credit_limit < 0) throw new Error('CARTAO_INVALIDO');
    const current=db.prepare(`SELECT c.id, COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE card_id=c.id AND kind='despesa'),0)-COALESCE((SELECT SUM(amount_cents) FROM card_payments WHERE card_id=c.id),0) AS used_cents FROM credit_cards c WHERE id=?`).get(c.id);
    if (!current) throw new Error('CARTAO_INEXISTENTE');
    if (cents(c.credit_limit) < Math.max(0,current.used_cents)) throw new Error('LIMITE_INFERIOR');
    db.prepare('UPDATE credit_cards SET credit_limit=? WHERE id=?').run(c.credit_limit,c.id);
    return db.prepare('SELECT * FROM credit_cards WHERE id=?').get(c.id);
  });
  secureHandle('cards:pay', (_e,p) => {
    if (!Number.isSafeInteger(p?.card_id) || !validMoney(p.amount) || p.amount<=0 || typeof p.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || (p.account_id != null && !Number.isSafeInteger(p.account_id))) throw new Error('PAGAMENTO_INVALIDO');
    const card=db.prepare(`SELECT c.card_mode,c.credit_limit, COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE card_id=c.id AND kind='despesa'),0)-COALESCE((SELECT SUM(amount_cents) FROM card_payments WHERE card_id=c.id),0) AS used_cents FROM credit_cards c WHERE id=?`).get(p.card_id);
    if (!card || cents(p.amount)>card.used_cents) throw new Error('PAGAMENTO_EXCEDE_DIVIDA');
    if(card?.card_mode==='debito')throw new Error('CARTAO_SOMENTE_DEBITO');
    if (p.account_id != null) {
      const account=db.prepare(`SELECT (${balanceCentsSql('a')}) AS balance_cents FROM accounts a WHERE a.id=?`).get(p.account_id);
      if (!account || account.balance_cents<cents(p.amount)) throw new Error('SALDO_INSUFICIENTE');
    }
    return db.prepare('INSERT INTO card_payments(card_id,account_id,amount,date) VALUES(?,?,?,?)').run(p.card_id,p.account_id??null,p.amount,p.date).lastInsertRowid;
  });
  secureHandle('btc:list', () => db.prepare('SELECT time, price FROM btc_history ORDER BY time DESC LIMIT 168').all().reverse());
  secureHandle('btc:add', (_event, snapshot) => {
    if (!Number.isFinite(snapshot?.price) || snapshot.price <= 0 || !Number.isSafeInteger(snapshot.time)) throw new Error('Cotação inválida');
    db.prepare('INSERT OR REPLACE INTO btc_history(time,price) VALUES(?,?)').run(snapshot.time,snapshot.price);
    db.exec('DELETE FROM btc_history WHERE time NOT IN (SELECT time FROM btc_history ORDER BY time DESC LIMIT 168)');
  });
  secureHandle('backup:restore', async () => {
    const {canceled,filePaths}=await dialog.showOpenDialog({title:'Restaurar backup do ORDEFIN',properties:['openFile'],filters:[{name:'Backup SQLite',extensions:['sqlite','db']}]});
    if(canceled||!filePaths?.length)return false;
    const source=filePaths[0];
    const check=new DatabaseSync(source,{readOnly:true});
    try {
      const result=check.prepare('PRAGMA integrity_check').get();
      if(!result||Object.values(result)[0]!=='ok')throw new Error('Backup SQLite inválido.');
      const names=new Set(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
      if(!['accounts','transactions','credit_cards','card_payments'].every(x=>names.has(x)))throw new Error('Este arquivo não é um backup do ORDEFIN.');
    }finally{check.close();}
    const choice=await dialog.showMessageBox({type:'warning',buttons:['Cancelar','Restaurar e reiniciar'],defaultId:0,cancelId:0,title:'Confirmar restauração',message:'Todos os registros atuais serão substituídos pelo backup selecionado.',detail:'Uma cópia de segurança dos dados atuais será criada antes da substituição.'});
    if(choice.response!==1)return false;
    const target=path.join(app.getPath('userData'),'finora.sqlite');
    const safety=path.join(app.getPath('userData'),`finora-antes-restauracao-${Date.now()}.sqlite`);
    db.prepare('VACUUM INTO ?').run(safety);
    const staged=path.join(app.getPath('userData'),`restauracao-${Date.now()}.sqlite`);
    // Snapshot consistente mesmo se o backup de origem estiver em modo WAL.
    // Copiar apenas o arquivo .sqlite poderia omitir transacoes ainda no -wal.
    const backupDb = new DatabaseSync(source, { readOnly: true });
    try { backupDb.prepare('VACUUM INTO ?').run(staged); }
    finally { backupDb.close(); }
    db.close();
    try {
      for(const ext of ['-wal','-shm']){try{fs.unlinkSync(target+ext)}catch(e){if(e.code!=='ENOENT')throw e;}}
      fs.copyFileSync(staged,target);
      fs.unlinkSync(staged);
    }catch(e){fs.copyFileSync(safety,target);throw e;}
    app.relaunch();app.exit(0);
    return true;
  });
  secureHandle('backup:save', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({ title:'Salvar backup do ORDEFIN', defaultPath:'ORDEFIN-backup.sqlite', filters:[{name:'Banco SQLite',extensions:['sqlite']}] });
    if (canceled || !filePath) return false;
    // SQLite VACUUM INTO refuses to overwrite existing files.
    // Write a new snapshot first and only then replace the destination.
    const tmp = path.join(app.getPath('temp'), `finora-backup-${process.pid}-${Date.now()}.sqlite`);
    try {
      db.prepare('VACUUM INTO ?').run(tmp);
      fs.copyFileSync(tmp, filePath);
      return true;
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
  const win = new BrowserWindow({ show: process.env.ORDEFIN_TEST_MODE !== '1', title: 'ORDEFIN', icon: path.join(__dirname,'../build/programa.ico'), width: 1440, height: 920, minWidth: 1000, minHeight: 680,
    webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
  win.on('page-title-updated', (event) => { event.preventDefault(); win.setTitle('ORDEFIN'); });
  const dev = !app.isPackaged && process.env.FINORA_DEV_SERVER === '1';
  if (dev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname,'../dist/index.html'));
  // Nunca permita que uma navegação remota substitua a UI local com acesso ao IPC.
  // Em desenvolvimento, somente o servidor local explicitamente configurado é confiável.
  const trustedUrl = dev ? 'http://127.0.0.1:5173/' : null;
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (dev ? targetUrl !== trustedUrl : targetUrl !== require('node:url').pathToFileURL(path.join(__dirname, '../dist/index.html')).href) {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
app.on('window-all-closed', () => { if (db) db.close(); if (process.platform !== 'darwin') app.quit(); });
