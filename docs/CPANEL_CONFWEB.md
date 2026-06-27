# Deploy No Servidor Confweb/cPanel

Este guia e para colocar o Busca Vendas - Confweb no servidor do dominio:

```text
buscavendas.confweb.com.br
```

## O Que Ja Foi Validado

- O IP ativo do servidor e `51.161.115.176`.
- `ftp.confweb.com.br` tambem aponta para `51.161.115.176`.
- O subdominio responde no servidor quando o host e informado manualmente.
- O FTP recebido cai direto no diretorio publico do subdominio.
- O acesso FTP nao liberou SSH nem API administrativa do cPanel.

Por isso, use o FTP apenas para arquivos publicos ou pacote temporario privado dentro do painel. Para rodar o app completo, crie uma aplicacao Node pelo cPanel.

## DNS

No DNS do dominio, crie ou confirme:

```text
Tipo: A
Nome: buscavendas
Valor: 51.161.115.176
```

Depois da propagacao, o dominio final sera:

```text
https://buscavendas.confweb.com.br
```

## Pasta Correta

Nao coloque o codigo-fonte direto dentro do `public_html/buscavendas` se ele ficar publico.

Preferencia:

```text
/home/confwe06/apps/busca-vendas-confweb
```

Banco persistente:

```text
/home/confwe06/data/busca-vendas-confweb/busca-vendas.sqlite
```

Se o nome do usuario do cPanel for diferente de `confwe06`, ajuste os caminhos.

## Setup Node.js App

No cPanel, abra **Setup Node.js App** e crie uma aplicacao:

```text
Node version: 22.x ou superior
Application mode: Production
Application root: apps/busca-vendas-confweb
Application URL: buscavendas.confweb.com.br
Application startup file: server/index.mjs
```

Depois clique em criar/salvar.

## Variaveis De Ambiente

Configure no painel Node.js App:

```env
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
```

Tambem configure como segredos:

```env
ADMIN_PASSWORD=sua-senha-admin
SESSION_SECRET=uma-string-longa-aleatoria
OXYLABS_USERNAME=seu-usuario-oxylabs
OXYLABS_PASSWORD=sua-senha-oxylabs
```

Gere `SESSION_SECRET` com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Instalar E Buildar

Pelo terminal do cPanel, dentro da pasta do app:

```bash
npm install --include=dev
npm run build
```

Se for usar scraping local via Playwright, rode tambem:

```bash
npx playwright install chromium
```

Se o servidor nao permitir Chromium, mantenha a Oxylabs como fonte principal.

## Reiniciar E Testar

No cPanel, clique em **Restart** na aplicacao Node.

Teste:

```text
https://buscavendas.confweb.com.br/api/health
```

Resposta esperada:

```json
{"ok":true}
```

Depois acesse o site, entre com o admin e configure:

- Contato comercial.
- Planos.
- Oxylabs.
- Mercado Livre OAuth, se a API oficial for liberada.

## Backup

Faca backup recorrente destes itens:

```text
/home/confwe06/data/busca-vendas-confweb/busca-vendas.sqlite
/home/confwe06/apps/busca-vendas-confweb/.env
```

Nao envie `.env`, banco SQLite real, senhas ou tokens para GitHub.

## Observacao Importante

O FTP recebido publica direto no subdominio. Para eu ligar tudo sozinho sem voce abrir o cPanel, preciso de um destes acessos:

- Login principal do cPanel com permissao para **Setup Node.js App**.
- SSH/SFTP com permissao de criar pasta privada, instalar npm e reiniciar Node.

Com apenas FTP publico, da para subir arquivos estaticos, mas nao da para iniciar o backend Node nem garantir banco persistente.
