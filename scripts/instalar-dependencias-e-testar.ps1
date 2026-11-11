$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
Write-Host 'ORDEFIN - instalacao e testes no Windows Sandbox' -ForegroundColor Cyan
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js nao encontrado.' }
npm.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'npm.cmd nao encontrado.' }
npm.cmd ping
if ($LASTEXITCODE -ne 0) { throw 'Registro npm indisponivel.' }
if (-not (Test-Path 'package.json') -or -not (Test-Path 'pnpm-lock.yaml')) { throw 'Execute a partir do ZIP completo do ORDEFIN.' }
$pnpmCmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
  Write-Host 'Instalando pnpm 10 (compativel com lockfile v9)...'
  npm.cmd install --global pnpm@10
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar pnpm.' }
}
pnpm.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'pnpm nao encontrado.' }
pnpm.cmd install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependencias.' }
node -e "require('decimal.js'); require('fflate'); console.log('decimal.js e fflate OK')"
if ($LASTEXITCODE -ne 0) { throw 'Dependencias nao carregaram.' }
pnpm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam: verificar relatorio.' }
pnpm.cmd run check:types
if ($LASTEXITCODE -ne 0) { throw 'Verificacao de tipos falhou.' }
Write-Host 'Instalacao e verificacoes concluidas!' -ForegroundColor Green
