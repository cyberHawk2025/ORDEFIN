import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const fail = (message) => { console.error('FALHA:', message); process.exitCode = 1 }
const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
if (vite.includes('.figma/')) fail('Vite ainda depende de .figma')
if (!vite.includes("base: './'")) fail('Vite precisa usar caminhos relativos no Electron')
const main = readFileSync(join(root, 'electron/main.cjs'), 'utf8')
if (!main.includes("app.getPath('userData')")) fail('SQLite não está no diretório do usuário')
if (!/contextIsolation\s*:\s*true/.test(main) || !/nodeIntegration\s*:\s*false/.test(main)) fail('Isolamento Electron ausente')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (pkg.build?.asar !== true) fail('ASAR não habilitado')
const forbidden = /\.(sqlite|sqlite3|db|xlsx|xls|bak)$/i
function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'release', 'test-results'].includes(ent.name)) continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) walk(p)
    else if (forbidden.test(ent.name)) fail(`Arquivo de dados no projeto: ${p}`)
  }
}
walk(root)
if (!existsSync(join(root, 'dist/index.html'))) console.warn('AVISO: dist/index.html ainda não existe; execute npm run build.')
if (!process.exitCode) console.log('Pré-verificações estáticas aprovadas. Ainda é obrigatório testar o EXE no Windows e a Binance em execução.')
