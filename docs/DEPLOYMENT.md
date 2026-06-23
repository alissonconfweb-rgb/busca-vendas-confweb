# Guia De Deploy

Este projeto roda como uma aplicacao Node.js unica: o backend serve a API e tambem entrega o frontend compilado em `dist`.

## Checklist Antes De Subir

1. Crie um `.env` a partir de `.env.example`.
2. Configure `SESSION_SECRET`, `CREATOR_EMAIL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
3. Defina `PUBLIC_URL` com o dominio final em HTTPS.
4. Se usar SQLite, garanta disco persistente e configure `DB_PATH`.
5. Rode `npm install`, `npm run build` e `npm start`.
6. Acesse `/api/health` e confirme `{"ok":true}`.
7. Entre com o admin e configure contatos comerciais, planos e integracoes.

## Render

O arquivo `render.yaml` ja esta pronto para Blueprint.

Passos:

1. No Render, crie um novo Blueprint apontando para o repositorio GitHub.
2. Configure as variaveis marcadas como secret:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `OXYLABS_USERNAME`
   - `OXYLABS_PASSWORD`
   - `MELI_CLIENT_SECRET`, se usar Mercado Livre OAuth.
3. Aguarde o build.
4. Abra `https://seu-app.onrender.com/api/health`.

Observacao importante: se usar SQLite em producao, configure um disco persistente. Sem disco persistente, usuarios, pesquisas, configuracoes e tickets podem ser perdidos em redeploy/restart.

No Render, discos persistentes ficam disponiveis apenas em servicos pagos. Depois de ativar o plano pago:

1. Abra o servico no Render.
2. Va em **Disks**.
3. Crie um disco com mount path:

```text
/var/data
```

4. Configure a variavel:

```env
DB_PATH=/var/data/busca-vendas.sqlite
```

5. Redeploy o servico.

## VPS Ou Servidor Dedicado

Exemplo com Ubuntu e PM2:

```bash
git clone https://github.com/alissonconfweb-rgb/busca-vendas-confweb.git
cd busca-vendas-confweb
cp .env.example .env
npm install --include=dev
npm run build
npm install -g pm2
pm2 start server/index.mjs --name busca-vendas-confweb
pm2 save
```

Use Nginx como proxy reverso:

```nginx
server {
  server_name busca-vendas.seudominio.com.br;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Depois instale SSL com Certbot ou pelo painel do provedor.

## cPanel

Funciona apenas se o cPanel oferecer:

- Node.js `22.5` ou superior.
- Permissao para instalar pacotes npm.
- Permissao para executar Chromium/Playwright, caso use scraping/Oxylabs com renderizacao.
- Escrita em disco para a pasta `data`.

Passos comuns no cPanel:

1. Abra **Setup Node.js App**.
2. Crie uma app com:
   - Application root: pasta do projeto.
   - Application startup file: `server/index.mjs`.
   - Node version: `22.x` ou superior.
3. Configure as variaveis de ambiente do `.env.example`.
4. No terminal do cPanel, rode:

```bash
npm install --include=dev
npx playwright install chromium
npm run build
```

5. Reinicie a aplicacao pelo painel.
6. Teste `https://seudominio.com.br/api/health`.

Se o cPanel nao permitir Node 22 ou Chromium, use VPS, Render, Railway, Fly.io ou outro provedor Node com suporte a processos persistentes.

## Dominio Proprio

1. Aponte o DNS para o provedor escolhido.
2. Ative HTTPS.
3. Configure `PUBLIC_URL=https://seudominio.com.br`.
4. Se usar Mercado Livre OAuth, cadastre exatamente:

```text
https://seudominio.com.br/api/meli/callback
```

5. Reinicie o servidor apos alterar variaveis.

## Atualizacao De Versao

```bash
git pull origin main
npm install --include=dev
npm run build
pm2 restart busca-vendas-confweb
```

No cPanel, use o botao de reiniciar app depois do build.

## Backup

Backup minimo:

```text
data/busca-vendas.sqlite
.env
```

Nao envie esses arquivos para o GitHub.
