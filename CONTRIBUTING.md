# Contribuindo

Obrigado por ajudar no Busca Vendas - Confweb.

## Fluxo Recomendado

1. Crie uma branch a partir de `main`.
2. Faca alteracoes pequenas e focadas.
3. Rode `npm run build` antes de enviar.
4. Abra um pull request explicando o que mudou e como testar.

## Padroes

- Nao commite `.env`, banco SQLite, credenciais, builds ou arquivos locais.
- Mantenha o layout alinhado a identidade visual da Confweb.
- Preserve o fluxo comercial: usuario pesquisa, cria conta, recebe 1 busca gratis e depois ve planos/CTA.
- Alteracoes no painel admin devem continuar restritas ao criador/admin.
- Ao mexer em busca, deixe claro se os dados sao reais, estimados ou fallback.

## Comandos Uteis

```bash
npm install
npm run dev
npm run build
npm start
```

## Segurança

Credenciais devem ficar em variaveis de ambiente ou no painel admin. Antes de abrir PR, revise se nao ha tokens, senhas, cookies, banco local ou dados de clientes no diff.
