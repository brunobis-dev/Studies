/* Telas, navegação e fluxo do jogo. */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const SET = {
    random: 'hnt.randomStart',   // '1' = modo Trecho
    pos: 'hnt.excerptPos',       // início do trecho (0..1 da faixa) ou 'random'
    vibrate: 'hnt.vibrate',
  };
  const opt = (k, def) => { const v = localStorage.getItem(k); return v == null ? def : v === '1'; };

  // ---------- utilidades de interface ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  function modal(text, actions = [{ label: 'OK' }]) {
    return new Promise((resolve) => {
      $('#modal-text').textContent = text;
      const box = $('#modal-actions'); box.innerHTML = '';
      actions.forEach((a, i) => {
        const b = document.createElement('button');
        b.className = 'btn' + (a.primary ? ' primary' : '');
        b.textContent = a.label;
        b.onclick = () => { $('#modal').classList.add('hidden'); a.run && a.run(); resolve(a.value ?? i); };
        box.appendChild(b);
      });
      $('#modal').classList.remove('hidden');
    });
  }
  const msg = (el, text, err = false) => { el.textContent = text; el.classList.toggle('err', err); };

  // ---------- navegação ----------
  function go(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'cards') renderTable();
    if (view === 'rules') {
      const n = Deck.all.length;
      $('#rules-deck-count').textContent = n + (n === 1 ? ' música no baralho' : ' músicas no baralho');
    }
    if (view === 'settings') refreshSettings();
    updateHomeMode();
    window.scrollTo(0, 0);
  }
  // Tela inicial (capa do jogo) ganha o fundo com brilho rosa.
  function updateHomeMode() {
    const onPlay = $('#view-play').classList.contains('active');
    document.body.classList.toggle('home-mode', onPlay && !game.trackId);
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) go(g.dataset.goto);
    const a = e.target.closest('[data-action="login"]');
    if (a) Spotify.login().catch((err) => modal(err.message));
  });

  // =====================================================
  // JOGAR
  // =====================================================
  const game = { trackId: null, startMs: 0, playing: false, deviceId: null };

  function refreshPlayView() {
    const playing = !!game.trackId && Spotify.isLoggedIn();
    $('#play-home').classList.toggle('hidden', playing);
    $('#play-playing').classList.toggle('hidden', !playing);
    updateHomeMode();
  }

  // "Jogar agora": configura o que faltar e depois abre a câmera.
  $('#btn-play-now').onclick = () => {
    if (!Spotify.getClientId()) {
      return modal('Falta configurar o Client ID do Spotify.', [
        { label: 'Ir para Configurações', primary: true, run: () => go('settings') }, { label: 'Cancelar' },
      ]);
    }
    if (!Spotify.isLoggedIn()) {
      return modal('Entre com o Spotify para tocar as músicas das cartas.', [
        { label: 'Entrar com Spotify', primary: true, run: () => Spotify.login().catch((err) => modal(err.message)) },
        { label: 'Cancelar' },
      ]);
    }
    openScanner();
  };

  $('#btn-rules').onclick = () => go('rules');

  async function refreshDeviceChip() {
    if (!Spotify.isLoggedIn()) { $('#device-name').textContent = 'desconectado'; return []; }
    try {
      const list = await Spotify.devices();
      const chosen = pickDevice(list);
      $('#device-name').textContent = chosen ? chosen.name : 'abra o Spotify';
      return list;
    } catch (e) {
      $('#device-name').textContent = e.code === 'NO_LOGIN' ? 'desconectado' : 'sem conexão';
      return [];
    }
  }

  // Escolha automática: o Spotify ativo > um celular > o primeiro da lista.
  function pickDevice(list) {
    return list.find((d) => d.is_active)
      || list.find((d) => d.type === 'Smartphone')
      || list[0] || null;
  }

  async function noDeviceDialog() {
    const r = await modal(
      'Não encontrei nenhum Spotify aberto.\n\n1. Abra o app do Spotify neste celular\n2. Dê play em qualquer música por um segundo\n3. Volte para cá e toque em "Tentar de novo"',
      [{ label: 'Abrir Spotify', primary: true, value: 'open' }, { label: 'Tentar de novo', value: 'retry' }, { label: 'Cancelar', value: 'cancel' }],
    );
    if (r === 'open') { location.href = 'spotify:'; return 'wait'; }
    return r;
  }

  async function playTrack(id) {
    game.trackId = id;
    refreshPlayView();
    $('#play-status').textContent = 'Carregando…';
    $('#disc').classList.add('paused');

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const list = await Spotify.devices();
        const dev = pickDevice(list);
        if (!dev) {
          const r = await noDeviceDialog();
          if (r === 'cancel') return resetGame();
          if (r === 'wait') { await waitForReturn(); }
          continue;
        }
        game.deviceId = dev.id;
        $('#device-name').textContent = dev.name;

        let start = 0;
        if (opt(SET.random, false)) {
          try {
            const t = await Spotify.track(id);
            const d = t.duration_ms || 180000;
            const pos = getExcerptPos();
            if (pos === 'random') {
              const lo = Math.min(30000, d * 0.15), hi = Math.max(lo, d - 45000);
              start = lo + Math.random() * (hi - lo);
            } else {
              // trecho escolhido na onda; garante pelo menos 30 s de música depois do início
              start = Math.min(pos * d, Math.max(0, d - 30000));
            }
          } catch { start = 0; }
        }
        game.startMs = start;
        await Spotify.play(id, dev.id, start);
        Spotify.repeatOff(dev.id);
        setPlaying(true);
        return;
      } catch (e) {
        if (e.code === 'NO_LOGIN') { resetGame(); return modal(e.message); }
        if (e.status === 404) { // dispositivo dormiu / não está ativo
          const r = await noDeviceDialog();
          if (r === 'cancel') return resetGame();
          if (r === 'wait') await waitForReturn();
          continue;
        }
        if (e.status === 403) {
          resetGame();
          return modal('O Spotify recusou o comando (403).\n\nConfira se a conta é Premium e se o seu e-mail está em "User Management" no painel do app.\n\nDetalhe: ' + e.message);
        }
        resetGame();
        return modal('Não consegui tocar: ' + e.message);
      }
    }
    resetGame();
  }

  const waitForReturn = () => new Promise((res) => {
    const h = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', h); setTimeout(res, 600); } };
    document.addEventListener('visibilitychange', h);
  });

  function setPlaying(on) {
    game.playing = on;
    $('#disc').classList.toggle('paused', !on);
    $('#btn-toggle').textContent = on ? '⏸' : '▶';
    $('#play-status').textContent = on ? 'Tocando… que ano é essa?' : 'Pausado';
  }
  function resetGame() {
    game.trackId = null; game.playing = false;
    refreshPlayView();
  }

  $('#btn-toggle').onclick = async () => {
    try {
      if (game.playing) { await Spotify.pause(game.deviceId); setPlaying(false); }
      else { await Spotify.resume(game.deviceId); setPlaying(true); }
    } catch (e) { toast(e.status === 404 ? 'O Spotify desconectou — escaneie de novo.' : e.message); }
  };
  $('#btn-restart').onclick = async () => {
    try { await Spotify.play(game.trackId, game.deviceId, game.startMs); setPlaying(true); }
    catch (e) { toast(e.message); }
  };
  $('#btn-fwd').onclick = async () => {
    try {
      const st = await Spotify.state();
      const pos = (st && st.progress_ms) || 0;
      await Spotify.seek(pos + 15000, game.deviceId);
    } catch (e) { toast(e.message); }
  };

  // ---------- scanner ----------
  async function openScanner() {
    if (!Spotify.isLoggedIn()) return modal('Entre com o Spotify primeiro.');
    // pausa a música anterior para ninguém ouvir o começo da próxima por engano
    if (game.playing) { Spotify.pause(game.deviceId).catch(() => {}); setPlaying(false); }
    $('#scanner').classList.remove('hidden');
    $('#scan-hint').textContent = 'Procurando QR code…';
    try {
      await Scanner.start($('#video'), $('#scan-canvas'), (id) => {
        $('#scanner').classList.add('hidden');
        if (opt(SET.vibrate, true) && navigator.vibrate) navigator.vibrate(80);
        playTrack(id);
      }, () => { $('#scan-hint').textContent = 'Esse QR não é de uma carta do jogo.'; });
    } catch (e) {
      $('#scanner').classList.add('hidden');
      Scanner.stop($('#video'));
      if (e.name === 'NotAllowedError') {
        return modal('A câmera foi bloqueada.\n\niPhone: Ajustes › Safari › Câmera › Permitir.\nAndroid: toque no cadeado ao lado do endereço › Permissões › Câmera.\nPC: clique no ícone da câmera na barra de endereço › Permitir.');
      }
      if (e.name === 'NotReadableError') {
        return modal('A câmera está sendo usada por outro programa (Teams, Zoom, OBS…).\n\nFeche esse programa e tente de novo.');
      }
      // Sem câmera (comum em PC): oferece tocar uma carta do baralho para dar para testar/jogar mesmo assim.
      const noCam = e.name === 'NotFoundError' || e.name === 'OverconstrainedError';
      const cards = Deck.all;
      const text = (noCam ? 'Não encontrei nenhuma câmera neste aparelho.' : 'Não consegui abrir a câmera: ' + e.message)
        + (cards.length
          ? '\n\nSem câmera, dá para tocar uma música aleatória do seu baralho.'
          : '\n\nUse o celular para ler as cartas, ou monte um baralho (Regras e mais › Montar e imprimir cartas) para testar sem câmera.');
      const r = await modal(text, cards.length
        ? [{ label: 'Tocar carta aleatória', primary: true, value: 'deck' }, { label: 'Cancelar', value: 'cancel' }]
        : [{ label: 'OK', value: 'cancel' }]);
      if (r === 'deck') playTrack(cards[Math.floor(Math.random() * cards.length)].id);
    }
  }
  $('#btn-home').onclick = () => {
    if (game.playing) Spotify.pause(game.deviceId).catch(() => {});
    resetGame();
  };
  $('#btn-next').onclick = openScanner;
  $('#btn-scan-cancel').onclick = () => { Scanner.stop($('#video')); $('#scanner').classList.add('hidden'); };
  $('#device-chip').onclick = () => go('settings');

  // =====================================================
  // CARTAS
  // =====================================================
  function renderTable() {
    const tb = $('#deck-table tbody');
    const cards = Deck.all;
    $('#deck-count').textContent = cards.length + (cards.length === 1 ? ' música' : ' músicas');
    if (!cards.length) { tb.innerHTML = `<tr><td colspan="3" class="hint">Nenhuma música ainda.</td></tr>`; return; }
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    tb.innerHTML = cards.map((c) => {
      let sug = '';
      if (c.sug > 0 && c.sug !== c.year) sug = `<span class="sug" data-use="${c.id}" data-y="${c.sug}">Original: ${c.sug} · usar</span>`;
      else if (c.sug > 0) sug = `<span class="sug same">✓ confere</span>`;
      else if (c.sug === 0) sug = `<span class="alb">sem sugestão</span>`;
      const warn = c.flag && !c.checked ? '⚠ ' : '';
      return `<tr class="${c.flag && !c.checked ? 'flag' : ''}" data-id="${c.id}">
        <td class="year"><input type="number" inputmode="numeric" min="1900" max="2100" value="${c.year || ''}" data-year="${c.id}"></td>
        <td><div class="t">${warn}${esc(c.title)}</div><div class="a">${esc(c.artist)}</div>
            <div class="alb">${esc(c.album)}${c.spotifyYear ? ' · Spotify: ' + c.spotifyYear : ''}</div>${sug}</td>
        <td><button class="del" data-del="${c.id}" title="Remover">×</button></td></tr>`;
    }).join('');
  }
  const findCard = (id) => Deck.all.find((c) => c.id === id);

  $('#deck-table').addEventListener('change', (e) => {
    const id = e.target.dataset.year; if (!id) return;
    const c = findCard(id); const y = parseInt(e.target.value, 10);
    c.year = y >= 1900 && y <= 2100 ? y : null; c.checked = true;
    Deck.save(); renderTable();
  });
  $('#deck-table').addEventListener('click', (e) => {
    const del = e.target.dataset.del;
    if (del) { Deck.remove(del); renderTable(); return; }
    const use = e.target.dataset.use;
    if (use) { const c = findCard(use); c.year = +e.target.dataset.y; c.checked = true; Deck.save(); renderTable(); }
  });

  const playlistIdFrom = (s) => { const m = (s || '').match(/playlist[/:]([A-Za-z0-9]{22})/); return m ? m[1] : null; };

  $('#btn-import-pl').onclick = async () => {
    const el = $('#import-msg');
    const id = playlistIdFrom($('#in-playlist').value);
    if (!id) return msg(el, 'Cole o link de uma playlist (open.spotify.com/playlist/…).', true);
    if (!Spotify.isLoggedIn()) return msg(el, 'Entre com o Spotify em Configurações para importar playlists.', true);
    msg(el, 'Importando…');
    try {
      const tracks = await Spotify.playlistTracks(id, (n, t) => msg(el, `Importando… ${n}/${t}`));
      if (!tracks.length) return msg(el, 'A playlist veio vazia. O Spotify só libera playlists criadas por você — se não for sua, use o CSV do Exportify.', true);
      const n = Deck.addMany(tracks.map(Deck.fromSpotifyTrack));
      msg(el, `${n} músicas adicionadas (${tracks.length - n} já estavam).`);
      $('#in-playlist').value = '';
      renderTable();
    } catch (e) {
      msg(el, e.status === 403 || e.status === 404
        ? 'O Spotify não liberou essa playlist (só funciona com playlists suas). Use o CSV do Exportify.'
        : 'Erro: ' + e.message, true);
    }
  };

  $('#in-csv').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const el = $('#import-msg');
    try {
      const list = Deck.fromCSV(await f.text());
      const n = Deck.addMany(list);
      msg(el, `${n} músicas adicionadas do CSV (${list.length - n} repetidas).`);
      renderTable();
    } catch (err) { msg(el, err.message, true); }
    e.target.value = '';
  };

  $('#btn-add-track').onclick = async () => {
    const el = $('#import-msg');
    const id = Scanner.parsePayload($('#in-track').value);
    if (!id) return msg(el, 'Cole o link de uma faixa (open.spotify.com/track/…).', true);
    if (!Spotify.isLoggedIn()) return msg(el, 'Entre com o Spotify em Configurações primeiro.', true);
    try {
      const t = await Spotify.track(id);
      const n = Deck.addMany([Deck.fromSpotifyTrack(t)]);
      msg(el, n ? `Adicionada: ${t.name}` : 'Essa música já está no baralho.');
      $('#in-track').value = '';
      renderTable();
    } catch (err) { msg(el, 'Erro: ' + err.message, true); }
  };

  async function runMB(onlyFlagged) {
    const el = $('#mb-msg');
    $('#btn-mb-stop').hidden = false;
    $('#btn-mb-flagged').disabled = $('#btn-mb-all').disabled = true;
    try {
      const r = await Deck.suggestYears(onlyFlagged, (i, t, c) => {
        msg(el, `Buscando ${i}/${t}: ${c.title}`);
        if (i % 5 === 0) renderTable();
      });
      msg(el, r.total ? `Pronto: sugestão encontrada para ${r.found} de ${r.done}. Toque em “usar” para aceitar.` : 'Nada para buscar (já buscadas ou nenhuma com ⚠).');
    } catch (e) {
      msg(el, 'Não consegui falar com o MusicBrainz: ' + e.message, true);
    } finally {
      $('#btn-mb-stop').hidden = true;
      $('#btn-mb-flagged').disabled = $('#btn-mb-all').disabled = false;
      renderTable();
    }
  }
  $('#btn-mb-flagged').onclick = () => runMB(true);
  $('#btn-mb-all').onclick = () => runMB(false);
  $('#btn-mb-stop').onclick = () => Deck.stop();

  $('#btn-export').onclick = () => {
    const blob = new Blob([Deck.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ms-song-baralho.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#in-json').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = Deck.importJSON(await f.text()); msg($('#import-msg'), `${n} músicas restauradas.`); renderTable(); }
    catch (err) { msg($('#import-msg'), 'Backup inválido: ' + err.message, true); }
    e.target.value = '';
  };
  $('#btn-clear').onclick = async () => {
    const r = await modal('Apagar todas as músicas do baralho? (As cartas já impressas continuam funcionando.)',
      [{ label: 'Apagar', primary: true, value: 'yes' }, { label: 'Cancelar', value: 'no' }]);
    if (r === 'yes') { Deck.clear(); renderTable(); }
  };

  $('#btn-print').onclick = () => {
    const noYear = Deck.all.filter((c) => !c.year).length;
    const r = Deck.renderPrint($('#print-area'), {
      size: +$('#sel-size').value,
      style: $('#sel-style').value,
      mirror: $('#chk-mirror').checked,
    });
    if (!r.cards) return modal('Nenhuma música com ano definido para imprimir.');
    if (noYear) toast(`${noYear} música(s) sem ano ficaram de fora.`, 4000);
    setTimeout(() => window.print(), 300);
  };

  // =====================================================
  // AJUSTES
  // =====================================================
  async function refreshSettings() {
    $('#in-client').value = Spotify.getClientId();
    $('#redirect-uri').textContent = Spotify.redirectUri();
    $(`input[name="mode"][value="${opt(SET.random, false) ? 'random' : 'full'}"]`).checked = true;
    $('#chk-vibrate').checked = opt(SET.vibrate, true);
    const logged = Spotify.isLoggedIn();
    $('#btn-login').classList.toggle('hidden', logged);
    $('#btn-logout').classList.toggle('hidden', !logged);
    const acct = $('#acct');
    const status = $('#spotify-status');
    // Sem login, o painel do Spotify já vem aberto (é o que falta configurar).
    setSpotifyPanel(!logged);
    if (!logged) {
      msg(acct, 'Não conectado.');
      status.textContent = Spotify.getClientId() ? 'Entrar' : 'Configurar';
    } else {
      status.textContent = 'Conectado';
      Spotify.me().then((m) => {
        msg(acct, 'Conectado como ' + (m.display_name || m.id) + '.');
        if (m.product === 'premium') status.textContent = 'Premium';
      }).catch((e) => msg(acct, 'Conectado, mas houve um erro: ' + e.message, true));
      refreshDeviceChip();
    }
  }
  function setSpotifyPanel(open) {
    $('#spotify-panel').hidden = !open;
    $('#row-spotify').setAttribute('aria-expanded', String(open));
  }
  $('#row-spotify').onclick = () => setSpotifyPanel($('#spotify-panel').hidden);

  // ---------- ondas sonoras do modo de jogo ----------
  const WAVE_N = 46;   // número de barrinhas
  const EX_W = 0.26;   // largura da seleção do trecho (fração da faixa)
  const EX_MAX = 1 - EX_W;
  const EX_PRESETS = { start: 0, middle: EX_MAX / 2, end: EX_MAX };

  function getExcerptPos() {
    const v = localStorage.getItem(SET.pos);
    if (v == null || v === 'random') return 'random';
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(EX_MAX, Math.max(0, n)) : 'random';
  }

  function buildWaves() {
    const h = Array.from({ length: WAVE_N }, (_, i) => {
      const env = 0.45 + 0.55 * Math.sin((i / (WAVE_N - 1)) * Math.PI); // mais alto no meio
      const wob = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
      return Math.round(18 + 82 * env * wob);
    });
    $$('.wave').forEach((w) => {
      w.innerHTML = h.map((v) => `<i style="height:${v}%"></i>`).join('');
      if (w.dataset.wave === 'random') w.insertAdjacentHTML('beforeend', '<span class="bracket"></span>');
    });
    $$('.wave[data-wave="full"] i').forEach((b, i) => b.classList.toggle('on', i < 9));
    renderExcerpt();
  }

  function renderExcerpt() {
    const pos = getExcerptPos();
    const rnd = pos === 'random';
    const left = rnd ? EX_MAX / 2 : pos;
    const wave = $('#excerpt-wave');
    wave.classList.toggle('rnd', rnd);
    const br = wave.querySelector('.bracket');
    br.style.left = `calc(${left * 100}% - 6px)`;
    br.style.width = `calc(${EX_W * 100}% + 12px)`;
    wave.querySelectorAll('i').forEach((b, i) => {
      const c = i / (WAVE_N - 1);
      b.classList.toggle('on', c >= left && c <= left + EX_W);
    });
    wave.setAttribute('aria-valuenow', String(Math.round((left / EX_MAX) * 100)));
    $('#excerpt-desc').textContent = rnd
      ? 'Cada música começa num ponto sorteado. Arraste a seleção para fixar um trecho.'
      : `A música começa em ${Math.round(left * 100)}% da faixa. Arraste para mudar.`;
    const chip = rnd ? 'random'
      : Object.keys(EX_PRESETS).find((k) => Math.abs(EX_PRESETS[k] - pos) < 0.01) || '';
    $$('.excerpt-chips button').forEach((b) => b.classList.toggle('active', b.dataset.pos === chip));
  }

  function setExcerptPos(p) {
    localStorage.setItem(SET.pos, p === 'random' ? 'random' : String(Math.round(p * 1000) / 1000));
    // mexer no trecho já escolhe o modo Trecho
    $('input[name="mode"][value="random"]').checked = true;
    localStorage.setItem(SET.random, '1');
    renderExcerpt();
  }

  // Arrastar a seleção (dedo ou mouse). Tocar fora dela leva a seleção até o ponto tocado.
  {
    const wave = $('#excerpt-wave');
    let drag = null;
    const moveTo = (e) => {
      if (!drag) return;
      const x = (e.clientX - drag.rect.left) / drag.rect.width;
      setExcerptPos(Math.min(EX_MAX, Math.max(0, x - drag.grab)));
    };
    wave.addEventListener('pointerdown', (e) => {
      const rect = wave.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const cur = getExcerptPos();
      const left = cur === 'random' ? EX_MAX / 2 : cur;
      const grab = x >= left && x <= left + EX_W ? x - left : EX_W / 2;
      drag = { rect, grab };
      wave.setPointerCapture(e.pointerId);
      wave.classList.add('dragging');
      moveTo(e);
      e.preventDefault();
    });
    wave.addEventListener('pointermove', moveTo);
    ['pointerup', 'pointercancel'].forEach((t) => wave.addEventListener(t, () => {
      drag = null; wave.classList.remove('dragging');
    }));
    wave.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -0.02, ArrowDown: -0.02, ArrowRight: 0.02, ArrowUp: 0.02 }[e.key];
      if (!step) return;
      const cur = getExcerptPos();
      setExcerptPos(Math.min(EX_MAX, Math.max(0, (cur === 'random' ? EX_MAX / 2 : cur) + step)));
      e.preventDefault();
    });
    $$('.excerpt-chips button').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        const k = b.dataset.pos;
        setExcerptPos(k === 'random' ? 'random' : EX_PRESETS[k]);
      };
    });
  }
  buildWaves();
  $('#btn-save-client').onclick = () => {
    const v = $('#in-client').value.trim();
    if (!/^[a-f0-9]{32}$/i.test(v)) return toast('O Client ID tem 32 caracteres (letras e números).');
    if (v !== Spotify.getClientId()) Spotify.logout();
    Spotify.setClientId(v); toast('Client ID salvo.'); refreshSettings(); refreshPlayView();
  };
  $('#btn-copy-uri').onclick = async () => {
    try { await navigator.clipboard.writeText(Spotify.redirectUri()); toast('Copiado!'); }
    catch { toast('Selecione e copie manualmente.'); }
  };
  $('#btn-logout').onclick = () => { Spotify.logout(); resetGame(); refreshSettings(); refreshDeviceChip(); };
  $$('input[name="mode"]').forEach((r) => {
    r.onchange = () => localStorage.setItem(SET.random, r.value === 'random' ? '1' : '0');
  });
  $('#chk-vibrate').onchange = (e) => localStorage.setItem(SET.vibrate, e.target.checked ? '1' : '0');

  // =====================================================
  // INÍCIO
  // =====================================================
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Spotify.isLoggedIn()) refreshDeviceChip();
  });

  // A escolha manual de dispositivo ("Onde tocar") foi removida; apaga o valor antigo, se houver.
  localStorage.removeItem('hnt.deviceId');

  (async () => {
    try {
      const r = await Spotify.handleRedirect();
      if (r) toast('Conectado ao Spotify!');
    } catch (e) { modal(e.message); }
    refreshPlayView();
    refreshDeviceChip();
  })();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
