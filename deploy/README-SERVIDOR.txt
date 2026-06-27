Busca Vendas - Confweb
=======================

Conteudo enviado por FTP:

1. Raiz do subdominio
   Frontend compilado em Vite/React. Serve a tela inicial, mas a API so funciona quando o Node estiver configurado.

2. Pasta _app
   Projeto Node completo para configurar no cPanel/Setup Node.js App.

3. Arquivo _app/busca-vendas-confweb-cpanel.zip
   Mesmo projeto compactado para extrair no local definitivo do app.

Configuracao recomendada no cPanel:

Node version: 22.x ou superior
Application mode: Production
Application root: uma pasta privada, por exemplo apps/busca-vendas-confweb
Application URL: buscavendas.confweb.com.br
Application startup file: server/index.mjs

Variaveis principais:

NODE_ENV=production
PUBLIC_URL=https://buscavendas.confweb.com.br
FRONTEND_ORIGIN=https://buscavendas.confweb.com.br
CREATOR_EMAIL=alisson.confweb@gmail.com
ADMIN_EMAIL=alisson.confweb@gmail.com
SESSION_TTL_DAYS=365
DB_PATH=/home/confwe06/data/busca-vendas-confweb/busca-vendas.sqlite
SEARCH_RESPONSE_TIMEOUT_MS=85000
PLAYWRIGHT_BROWSERS_PATH=0
OXYLABS_MODE=web_unblocker
OXYLABS_ENDPOINT=https://unblock.oxylabs.io:60000
OXYLABS_GEO_LOCATION=Brazil
OXYLABS_TIMEOUT_MS=120000
OXYLABS_RENDER_WAIT_SECONDS=5
OXYLABS_PRODUCT_LIMIT=3
MELI_SITE_ID=MLB
MELI_SCRAPER_ENABLED=true

Segredos que devem ser cadastrados no painel, nunca no Git:

ADMIN_PASSWORD
SESSION_SECRET
OXYLABS_USERNAME
OXYLABS_PASSWORD
MELI_CLIENT_SECRET, se usar Mercado Livre OAuth

Comandos:

npm install --include=dev
npm run build

Depois reinicie o app Node e teste:

https://buscavendas.confweb.com.br/api/health

Resposta esperada:

{"ok":true}

DNS necessario:

buscavendas.confweb.com.br A 51.161.115.176
