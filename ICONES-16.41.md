# Ícones ORDEFIN 16.41

- `build/instalador.ico`: gerado a partir da primeira imagem fornecida, utilizado no setup e desinstalador (NSIS).
- `build/programa.ico`: gerado a partir da segunda imagem fornecida, utilizado no executável do programa e, por padrão, no atalho criado pelo instalador.

A configuração de `package.json` já referencia esses arquivos. Não houve mudanças no código-fonte nem na configuração de empacotamento.

## Validação Windows

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run check:types
pnpm.cmd test
pnpm.cmd run build
pnpm.cmd run check:release
pnpm.cmd run desktop:build
```

Verifique visualmente o ícone do arquivo de setup, o atalho da área de trabalho, o menu Iniciar e o executável instalado. O Windows pode manter ícones antigos em cache; para evitar confusão, teste numa instalação limpa.
