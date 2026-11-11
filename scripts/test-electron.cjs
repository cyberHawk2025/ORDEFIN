const { _electron: electron } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright",
)

const path = require("node:path"),
  fs = require("node:fs"),
  os = require("node:os"),
  assert = require("node:assert/strict")

;(async () => {
  const dir =
    process.env.ORDEFIN_TEST_PROFILE ||
    fs.mkdtempSync(path.join(os.tmpdir(), "ordefin-ui-"))
  fs.mkdirSync(dir, { recursive: true })
  let app

  const env = { ...process.env, ORDEFIN_DATA_DIR: dir, ORDEFIN_TEST_MODE: "1" }
  delete env.ELECTRON_RUN_AS_NODE

  async function launch() {
    return electron.launch({
      executablePath:
        process.env.ORDEFIN_EXE ||
        path.resolve("node_modules/electron/dist/electron.exe"),
      args: process.env.ORDEFIN_EXE ? [] : ["."],
      timeout: 30000,
      env,
    })
  }

  try {
    app = await launch()
    let page = await app.firstWindow()
    page.setDefaultTimeout(20000)
    const errors = []
    page.on("pageerror", (e) => errors.push(e.message))

    await page
      .getByRole("button", { name: "Meus investimentos", exact: true })
      .waitFor()

    const account = await page.evaluate(() =>
      window.finora.addAccount({
        name: "Conta do teste isolado",
        opening_balance: 1000,
      }),
    )

    await page
      .getByRole("button", { name: "Meus investimentos", exact: true })
      .click()

    await page
      .getByRole("heading", { name: "Registrar investimento", exact: true })
      .waitFor()

    await page
      .getByLabel("Valor aplicado, sem taxas (R$)", { exact: true })
      .fill("10000")

    assert.equal(
      await page
        .getByLabel("Valor aplicado, sem taxas (R$)", { exact: true })
        .inputValue(),
      "100,00",
    )

    await page.getByLabel(/^Tipo/).selectOption('CDB');
    await page.getByLabel(/^Rentabilidade/).selectOption('fixed');
    await page.getByLabel(/^Taxa contratada/).fill('abc');
    await page.getByRole('button',{name:'Salvar operação',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Número inválido'}).waitFor();
    assert.equal((await page.evaluate(()=>window.ordefinInvestments.load())).operations.length,0);
    await page.getByLabel(/^Tipo/).selectOption('Criptomoeda');
    await page
      .getByLabel("Quantidade efetiva (opcional)", { exact: true })
      .fill("2")

    await page
      .getByLabel(/Conta vinculada \(opcional\)/)
      .selectOption(String(account.id))

    await page.getByLabel(/Movimentação no saldo/).selectOption("move")

    await page
      .getByRole("button", { name: "Salvar operação", exact: true })
      .click()

    await page
      .getByText("Operação salva no banco e incluída nos backups.", {
        exact: true,
      })
      .waitFor()

    let state = await page.evaluate(() => window.ordefinInvestments.load())
    assert.equal(state.operations.length, 1)

    assert.equal(
      (await page.evaluate(() => window.finora.listAccounts()))[0].balance,
      900,
    )

    await page.getByLabel(/^Operação/).selectOption({ index: 1 })

    await page
      .getByLabel("Quantidade vendida / principal resgatado", { exact: true })
      .fill("1")

    await page
      .getByLabel("Valor bruto recebido (R$)", { exact: true })
      .fill("6000")

    await page
      .getByRole("button", { name: "Salvar operação", exact: true })
      .click()

    await page.waitForFunction(
      async () =>
        (await window.ordefinInvestments.load()).operations.length === 2,
    )

    assert.equal(
      (await page.evaluate(() => window.finora.listAccounts()))[0].balance,
      960,
    )

    await page.evaluate(async (accountId) => {
      const pending=await window.finora.addTransaction({description:'Despesa de regressão',category:'Outros',type:'Conta fixa',kind:'despesa',amount:10,date:'2026-10-17',account_id:accountId});
      const id=pending.id;
      if((await window.finora.listAccounts()).find(a=>a.id===accountId).balance!==960)throw Error('Despesa pendente alterou saldo');
      await window.finora.setTransactionPaid({id,paid:true,account_id:accountId});
      if((await window.finora.listAccounts()).find(a=>a.id===accountId).balance!==950)throw Error('Pagamento incorreto');
      await window.finora.setTransactionPaid({id,paid:false});
      if((await window.finora.listAccounts()).find(a=>a.id===accountId).balance!==960)throw Error('Estorno incorreto');
    },account.id);
    const backupPath=path.join(dir,'verification-backup.sqlite');
    await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},backupPath);
    assert.equal(await page.evaluate(()=>window.finora.saveBackup()),true);
    const {DatabaseSync}=require('node:sqlite');const backup=new DatabaseSync(backupPath,{readOnly:true});
    assert.equal(JSON.parse(backup.prepare('SELECT payload FROM investment_state').get().payload).operations.length,2);
    assert.equal(backup.prepare('SELECT count(*) n FROM investment_movements').get().n,2);backup.close();
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click()

    await page.getByRole("button", { name: "Escuro", exact: true }).click()
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    )

    await page
      .getByRole("button", { name: "Meus investimentos", exact: true })
      .click()

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].showInactive(),
    )

    await page.screenshot({
      path: "test-results/investments-dark.png",
      fullPage: true,
    })

    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click()
    await page.getByRole("button", { name: "Claro", exact: true }).click()

    await page
      .getByRole("button", { name: "Meus investimentos", exact: true })
      .click()
    await page.screenshot({
      path: "test-results/investments-light.png",
      fullPage: true,
    })

    assert.deepEqual(errors, [])
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    page.setDefaultTimeout(20000)
    await page
      .getByRole("button", { name: "Meus investimentos", exact: true })
      .click()

    state = await page.evaluate(() => window.ordefinInvestments.load())
    assert.equal(state.operations.length, 2)
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "light",
    )
    assert.equal(
      (await page.evaluate(() => window.finora.listAccounts()))[0].balance,
      960,
    )

    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click()
    await page.getByRole("button", { name: "Automático", exact: true }).click()
    assert.equal(
      await page.evaluate(() => localStorage.getItem("ordefin-appearance")),
      "system",
    )

    console.log(
      "PASS: Electron purchase/sale UI, cents mask, bank 1000→900→960, light/dark/system themes, restart persistence, no renderer errors.",
    )
  } finally {
    if (app) await app.close()
    if (!process.env.ORDEFIN_TEST_PROFILE)
      fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
