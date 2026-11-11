# ORDEFIN 16.40 — Limpeza pré-setup

Base: versão 16.39 (código funcional preservado).

## Removido
- Documentos históricos VALIDACAO-*.md e AUDITORIA-*.md.
- Configuração de Git (.gitignore, .gitattributes) e workflow de GitHub (.github).
- Scripts auxiliares antigos diagnostico-etapa14.cjs e audit-centavos.cjs, não referenciados nos scripts do package.json.

## Preservado deliberadamente
- src/, electron/, services/, shared/: código-fonte e serviços.
- package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.json, vite.config.ts, index.html: dependências e configuração.
- tests/: testes de regressão para executar ANTES do setup; NÃO são empacotados no EXE conforme a lista build.files do package.json.
- scripts/: ferramentas de verificação e build, incluindo check-release.mjs, test-electron.cjs e check-live-sources.mjs.
- README.md: instruções de projeto.

## Atenção — ícones do instalador ausentes
O package.json exige build/programa.ico e build/instalador.ico, mas nenhum deles estava no ZIP 16.39. É necessário adicionar esses arquivos antes de executar desktop:build, ou alterar conscientemente a configuração de ícones. Não foram criados ícones fictícios.

## Validação
- ZIP íntegro; arquivos de código copiados sem alterações.
- Os testes e o build precisam ser executados no Windows com dependências instaladas.

Comandos: pnpm.cmd install --frozen-lockfile; pnpm.cmd run check:types; pnpm.cmd test; pnpm.cmd run build; pnpm.cmd run check:release; pnpm.cmd run desktop:build.
