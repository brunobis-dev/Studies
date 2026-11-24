# MS.Song

Sua versão do Hitster: cartas impressas com QR code + app que lê a carta e toca a música no Spotify **sem mostrar o nome**.

É um app web instalável (PWA): sem loja, sem taxa, funciona no Android e no iPhone. Não tem build nem servidor — são só arquivos estáticos.

```
index.html  styles.css  manifest.webmanifest  sw.js
js/spotify.js   login PKCE + controle do player
js/scanner.js   câmera + leitura do QR (BarcodeDetector ou jsQR)
js/deck.js      baralho, CSV do Exportify, MusicBrainz, folhas de impressão
js/app.js       telas e fluxo do jogo
vendor/         jsQR (leitura) e qrcode-generator (geração), ambos MIT
```

## 1. Publicar (GitHub Pages, grátis)

A câmera e o login do Spotify exigem **https**, então o app precisa estar online.

1. Crie um repositório no GitHub (ex.: `ms-song`) e envie estes arquivos para a raiz.
2. No repositório: **Settings › Pages › Source: Deploy from a branch › main / (root)**.
3. Em ~1 min o app fica em `https://SEU-USUARIO.github.io/ms-song/`.

(Vercel, Netlify ou Cloudflare Pages também servem — é só subir a pasta.)

## 2. Criar o app no Spotify

1. Entre em https://developer.spotify.com/dashboard com a sua conta **Premium** › **Create app**.
2. **Redirect URI**: o endereço exato do app, com a barra no final — ex.: `https://SEU-USUARIO.github.io/ms-song/`
   (a tela **Ajustes** do app mostra o valor certo com botão de copiar).
3. Em *Which API/SDKs are you planning to use?* marque **Web API**. Salve.
4. Copie o **Client ID**.
5. Em **User Management**, adicione o e-mail da sua conta (e de quem mais for usar — máximo 5 pessoas).

## 3. Instalar no celular

1. Abra o endereço do app no **Safari** (iPhone) ou **Chrome** (Android).
2. iPhone: Compartilhar › **Adicionar à Tela de Início**. Android: menu ⋮ › **Instalar app**.
3. Abra pelo ícone › **Ajustes** › cole o Client ID › Salvar › **Entrar com Spotify**.

## 4. Fazer as cartas (melhor no computador)

1. Aba **Cartas** › cole o link de uma playlist **sua** do Spotify e toque em Importar.
   Se a playlist não for sua, exporte em https://exportify.net e importe o CSV.
2. Confira os anos. Linhas com ⚠ vieram de remaster/coletânea/ao vivo. O botão **Sugerir anos** consulta o MusicBrainz e mostra o ano original — toque em “usar” para aceitar ou digite o ano à mão.
3. **Gerar folhas para imprimir** › A4, escala 100%, margens nenhuma, “gráficos de fundo” ligado.
   Imprima frente e verso virando pela **borda longa** (ou imprima as páginas ímpares, recoloque o papel e imprima as pares).
4. Recorte nas linhas pontilhadas.

O baralho fica salvo no navegador onde você o montou. Use **Backup (.json)** para guardar ou levar para outro aparelho.
O celular que joga **não precisa** do baralho: cada QR já carrega o ID da música (`HNT1:<id da faixa>`).

## 5. Jogar

1. Abra o **Spotify** no celular e dê play em qualquer coisa por um segundo (isso “acorda” o aparelho para a API).
2. No app: **Escanear carta** › a música toca no Spotify e a tela só mostra o disco girando.
3. O jogador posiciona a carta na linha do tempo, vira e confere o ano.

Dicas:
- Se o Spotify ficar muito tempo em segundo plano, o iPhone o “adormece” e ele some da lista. O app avisa e oferece reabrir.
- Para tocar numa caixa de som / PC, dê play em algo no Spotify desse aparelho antes: o app usa o Spotify que estiver ativo.
- **Ajustes › Começar em ponto aleatório** deixa o jogo mais difícil.
- O nome da música aparece na notificação/tela de bloqueio do Spotify — quem escaneia não deve puxar a barra de notificações 😉

## Limites do Spotify (regras de 2026)

App em modo desenvolvimento: dono com Premium ativo, até 5 usuários autorizados, uso pessoal. Controlar o player exige Premium.

## Testar no computador

O Spotify só aceita `http` para o endereço de loopback:
```
python3 -m http.server 8000 --bind 127.0.0.1
```
Abra `http://127.0.0.1:8000/` e cadastre esse endereço também como Redirect URI.
