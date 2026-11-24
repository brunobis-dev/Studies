# MS.Song — contexto do projeto

Versão pessoal do jogo **Hitster** (Jumbo): cartas impressas com QR code + um app que lê o QR e toca a música no Spotify **sem mostrar título/artista**. Os jogadores adivinham o ano e montam uma linha do tempo; o verso da carta impressa mostra ano, artista e música.

Dono: Bruno (dev, fala português do Brasil — responda e comente o código em pt-BR). Projeto pessoal, uso entre amigos.

## Decisões já tomadas (não mudar sem perguntar)

- **App web instalável (PWA)**, não app nativo: evita a taxa da Apple (US$ 99/ano). Instala pelo Safari/Chrome → "Adicionar à Tela de Início".
- **JavaScript puro, sem build, sem framework, sem npm em runtime.** São arquivos estáticos servidos por GitHub Pages (ou Vercel/Netlify). Não introduzir bundler/React sem pedido explícito.
- **Sem backend.** Login no Spotify via **Authorization Code + PKCE** no navegador; tokens em `localStorage`.
- **Spotify Premium obrigatório** (o Bruno tem). A reprodução é feita mandando o app oficial do Spotify (no celular, PC ou caixa de som) tocar a faixa via Web API (Spotify Connect). O app web NÃO toca áudio sozinho.
- Cartas: 300 músicas, 150 nacionais + 150 internacionais (lista em `lista-300-musicas.csv`, se estiver no repo).

## Estrutura

```
index.html            3 telas (Jogar / Cartas / Ajustes) + overlay do scanner + modal + área de impressão
styles.css            tema escuro neon + CSS de impressão (.sheet / .pcard, @page A4 margem 0)
manifest.webmanifest  PWA (start_url e scope "./")
sw.js                 service worker: rede primeiro, cache como reserva; ignora requisições de outros domínios
js/spotify.js         módulo global `Spotify`: PKCE, refresh de token, wrapper `api()`, player e catálogo
js/scanner.js         módulo global `Scanner`: câmera + BarcodeDetector (Android) ou jsQR (iPhone); parsePayload()
js/deck.js            módulo global `Deck`: baralho em localStorage, import CSV (Exportify), MusicBrainz, renderPrint()
js/app.js             IIFE com toda a UI: navegação, fluxo do jogo, tela de cartas, ajustes
vendor/jsQR.js        jsQR 1.4.0 (global `jsQR`) — leitura de QR
vendor/qrcode.js      qrcode-generator 2.0.4 (global `qrcode`) — geração do SVG do QR
icons/                ícones PWA (gerados com PIL)
```

Os scripts são carregados em ordem no fim do `index.html` (vendor → spotify → scanner → deck → app) e se comunicam por globais. Se mudar para ES modules, ajuste todos de uma vez.

## Chaves de localStorage

| chave | conteúdo |
|---|---|
| `hnt.clientId` | Client ID do app no painel do Spotify (32 hex) |
| `hnt.token` | `{access_token, refresh_token, expires_at}` |
| `hnt.pkceVerifier`, `hnt.pkceState` | temporários durante o login |
| `hnt.randomStart`, `hnt.vibrate` | `'1'`/`'0'` |
| `hnt.excerptPos` | início do trecho (fração 0–0,74 da faixa) ou `'random'`; só vale com `hnt.randomStart = '1'` (modo Trecho) |
| `hnt.deck` | array de cartas `{id, title, artist, album, year, spotifyYear, flag, checked?, sug}` |

## Formato do QR

Conteúdo: `HNT1:<id da faixa no Spotify, 22 caracteres>` — de propósito NÃO é um link, para que a câmera comum do celular não revele a música. `Scanner.parsePayload()` também aceita `spotify:track:<id>` e links `open.spotify.com/track/<id>`. **Não mude o formato**: cartas já impressas dependem dele.

## Fluxo do jogo (app.js → playTrack)

1. Scanner lê o QR → `playTrack(id)`.
2. `GET /me/player/devices` → `pickDevice()`: ativo > tipo Smartphone > primeiro (não há escolha manual de dispositivo; `hnt.deviceId` antigo é apagado ao iniciar).
3. Sem dispositivo → modal "Abra o Spotify" (deep link `spotify:`) e espera o app voltar a ficar visível.
4. Opcional: início aleatório (`GET /tracks/{id}` para duração).
5. `PUT /me/player/play?device_id=…` com `{uris:[…], position_ms}` + `PUT /me/player/repeat?state=off`.
6. Erros: 404 → dispositivo dormiu; 403 → não é Premium ou o e-mail não está em User Management; 401 → força refresh do token.

## Regras do Spotify (mudaram em fev/2026 — confirme na doc se algo falhar)

- Apps em **Development Mode**: dono precisa de Premium ativo; **1 Client ID por desenvolvedor**; **até 5 usuários** autorizados (cadastrar e-mail em *User Management* no dashboard).
- Endpoints de player (`/me/player/*`) continuam disponíveis; exigem Premium.
- Itens de playlist: o código tenta `/playlists/{id}/items` e cai para `/playlists/{id}/tracks`; aceita `it.item || it.track`. Só funciona para playlists do próprio usuário (ou colaborativas).
- **Redirect URI** precisa bater EXATAMENTE (com barra final). O app mostra o valor certo em Ajustes (`Spotify.redirectUri()` = origin + pathname sem `index.html`).
- `http` só é aceito para loopback: usar `http://127.0.0.1:PORTA/` (não `localhost`) e cadastrar também no dashboard.
- Scopes: `user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative`.

## Como rodar localmente

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# abrir http://127.0.0.1:8000/
```
**Não abrir o `index.html` direto (file://)**: câmera, login, service worker e `crypto.subtle` não funcionam fora de https/localhost.

Para testar no celular é preciso https: GitHub Pages, ou um túnel (`npx localtunnel`, `cloudflared tunnel`, ngrok) — e cadastrar essa URL como Redirect URI.

## O que já foi testado (headless Chrome, sem Spotify real)

- Navegação entre telas, sem erros no console.
- Import de CSV do Exportify (cabeçalhos `Track URI`, `Track Name`, `Artist Name(s)`, `Album Name`, `Album Release Date`); flags ⚠ de remaster/coletânea.
- Geração das folhas de impressão (A4, 3×4 cartas de 65 mm; verso espelhado por linha) e PDF.
- Fluxo completo de scan → play com câmera falsa (vídeo da carta impressa) e API do Spotify mockada: jsQR leu o QR impresso e os comandos play/repeat/pause/seek saíram corretos.

## O que NÃO foi testado (primeiros suspeitos se algo quebrar)

1. **Login real no Spotify** (troca do code por token, refresh).
2. **Login dentro do PWA instalado no iPhone**: o redirect do Spotify pode voltar para o Safari em vez do app instalado, e aí o `localStorage` é outro → erro "O login voltou em outra janela". Contorno possível: fazer o login no Safari antes de instalar, ou detectar `navigator.standalone` e orientar.
3. **Câmera no iPhone em modo standalone** (getUserMedia).
4. **MusicBrainz** a partir do navegador (CORS, limite de 1 req/s; o código espera 1,1 s entre chamadas).
5. Endpoint de itens de playlist após as mudanças de 2026.
6. `window.print()` dentro do PWA no iPhone — a recomendação é gerar as cartas no computador.

## Checklist de diagnóstico

- Abrir o DevTools (no celular: Safari > Desenvolver no Mac, ou `chrome://inspect` no Android) e olhar Console + Network.
- `INVALID_CLIENT: Invalid redirect URI` → Redirect URI diferente do cadastrado (barra final, http vs https, `index.html`).
- `403` no play → conta sem Premium ou e-mail fora de User Management.
- `404 NO_ACTIVE_DEVICE` → abrir o app do Spotify e dar play em algo antes.
- Mudou JS/CSS e nada muda no celular → service worker com cache antigo: aumentar `VERSION` em `sw.js` (ex.: `hnt-v2`) ou limpar dados do site.
- Botões sem reação → erro de JS antes do `app.js` terminar; ver o console.

## Próximas funcionalidades planejadas

- **"Importar lista"**: ler `lista-300-musicas.csv` (colunas `n,ano,artista,musica,origem,genero,conferir_ano`), buscar cada música via `GET /search?type=track&q=track:… artist:…`, escolher o melhor resultado e criar as cartas usando o **ano da lista** (não o do Spotify). Mostrar as não encontradas para correção manual. Respeitar rate limit (429 + `Retry-After`).
- Receitas em JSON (`receita-*.json`) descrevem a distribuição de décadas/gêneros/origem da lista — usadas só para gerar listas novas, não pelo app.

## Convenções

- Textos da interface em pt-BR.
- Sem dependências novas sem necessidade; se precisar, copiar o arquivo para `vendor/` (o app deve funcionar sem CDN).
- Ao mudar arquivos servidos, atualizar a lista `SHELL` e a `VERSION` em `sw.js`.
