/* Baralho: guarda as músicas, importa (playlist / CSV / faixa), sugere ano original e gera as folhas de impressão. */
const Deck = (() => {
  const KEY = 'hnt.deck';
  let cards = [];
  try { cards = JSON.parse(localStorage.getItem(KEY)) || []; } catch { cards = []; }
  const save = () => localStorage.setItem(KEY, JSON.stringify(cards));

  const SUSPECT = /remaster|deluxe|edition|edição|greatest|best of|the very best|hits|anniversary|aniversário|collection|coletânea|coletanea|live|ao vivo|acústico|acustico|essentials|anthology|antologia|grandes sucessos|mtv|expanded|reissue|bonus/i;

  /** Tira "- Remastered 2011", "(2009 Remaster)" etc. do nome da faixa. */
  function cleanTitle(t) {
    return (t || '')
      .replace(/\s*[-–]\s*(\d{4}\s*)?(digital(ly)?\s*)?remaster(ed)?(\s*(version|\d{4}))?.*$/i, '')
      .replace(/\s*[([]\s*(\d{4}\s*)?(digital(ly)?\s*)?remaster(ed)?[^)\]]*[)\]]/i, '')
      .replace(/\s*[-–]\s*\d{4}\s*(mix|version|versão)$/i, '')
      .trim();
  }
  const yearOf = (d) => { const m = String(d || '').match(/(\d{4})/); return m ? +m[1] : null; };

  function makeCard({ id, title, artist, album, date, albumType }) {
    const rawTitle = title || '';
    const year = yearOf(date);
    const flag = SUSPECT.test(album || '') || SUSPECT.test(rawTitle) || albumType === 'compilation' || !year;
    return { id, title: cleanTitle(rawTitle), artist: artist || '', album: album || '', year, spotifyYear: year, flag, sug: null };
  }
  const fromSpotifyTrack = (t) => makeCard({
    id: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album && t.album.name,
    date: t.album && t.album.release_date,
    albumType: t.album && t.album.album_type,
  });

  /** Adiciona sem duplicar. Retorna quantas entraram. */
  function addMany(list) {
    const have = new Set(cards.map((c) => c.id));
    let n = 0;
    for (const c of list) if (c && c.id && !have.has(c.id)) { cards.push(c); have.add(c.id); n++; }
    save();
    return n;
  }

  // ---------- CSV (Exportify) ----------
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function fromCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV vazio.');
    const h = rows[0].map((x) => x.trim().toLowerCase());
    // testa os padrões em ordem de prioridade (ex.: "Artist Name(s)" antes de "Artist URI(s)")
    const find = (...tests) => { for (const t of tests) { const i = h.findIndex((x) => t.test(x)); if (i >= 0) return i; } return -1; };
    const iUri = find(/track uri/, /spotify.*(uri|id)/, /^uri$/, /track id/);
    const iName = find(/track name/, /^name$/, /^título$|^titulo$|^title$/);
    const iArt = find(/artist name/, /^artist/, /artista/);
    const iAlb = find(/album name/, /^album$/, /álbum/);
    const iDate = find(/album release date/, /release date/, /^year$|^ano$/, /date/);
    if (iUri < 0) throw new Error('Não achei a coluna "Track URI" no CSV.');
    const out = [];
    for (const r of rows.slice(1)) {
      const id = Scanner.parsePayload(r[iUri]) || (/^[A-Za-z0-9]{22}$/.test((r[iUri] || '').trim()) ? r[iUri].trim() : null);
      if (!id) continue;
      out.push(makeCard({
        id, title: r[iName], artist: (r[iArt] || '').replace(/;/g, ', '),
        album: iAlb >= 0 ? r[iAlb] : '', date: iDate >= 0 ? r[iDate] : '',
      }));
    }
    return out;
  }

  // ---------- MusicBrainz: ano de lançamento original ----------
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const luc = (s) => s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

  async function suggestYear(card) {
    const artist = card.artist.split(',')[0].trim();
    const title = card.title.replace(/\s*[-–].*$/, '').replace(/\s*\(.*?\)/g, '').trim() || card.title;
    const q = `recording:"${luc(title)}" AND artist:"${luc(artist)}"`;
    const url = 'https://musicbrainz.org/ws/2/recording?fmt=json&limit=25&query=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 503) throw Object.assign(new Error('MusicBrainz ocupado'), { retry: true });
    if (!r.ok) throw new Error('MusicBrainz ' + r.status);
    const data = await r.json();
    const nt = norm(title);
    let best = null;
    for (const rec of data.recordings || []) {
      if ((rec.score ?? 0) < 80) continue;
      const rt = norm(rec.title);
      if (!(rt === nt || rt.startsWith(nt) || nt.startsWith(rt))) continue;
      const y = yearOf(rec['first-release-date']);
      if (y && y > 1900 && (!best || y < best)) best = y;
    }
    return best;
  }

  let stopFlag = false;
  async function suggestYears(onlyFlagged, onProgress) {
    stopFlag = false;
    const list = cards.filter((c) => (onlyFlagged ? c.flag : true) && c.sug == null);
    let i = 0, found = 0;
    for (const c of list) {
      if (stopFlag) break;
      i++;
      onProgress(i, list.length, c);
      try {
        let y;
        try { y = await suggestYear(c); }
        catch (e) { if (e.retry) { await sleep(3000); y = await suggestYear(c); } else throw e; }
        c.sug = y || 0;
        if (y) found++;
        save();
      } catch (e) {
        if (i === 1) throw e;
      }
      await sleep(1100); // limite do MusicBrainz: 1 pedido/s
    }
    return { done: i, total: list.length, found };
  }
  const stop = () => { stopFlag = true; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Impressão ----------
  const PALETTE = ['#ff5fa8', '#ffd23f', '#3ee6d8', '#a98bff', '#ff8f5a', '#7df08a', '#5fb4ff', '#ff6b6b'];
  const hash = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fit = (text, s, big, mid, small) => {
    const n = text.length;
    return (n > 45 ? small : n > 24 ? mid : big) * s;
  };

  function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  /** Monta as folhas no elemento indicado: frente, verso, frente, verso… */
  function renderPrint(el, { size = 65, style = 'neon', mirror = true } = {}) {
    const usable = cards.filter((c) => c.year);
    const cols = size <= 65 ? 3 : 2;
    const rowsN = size <= 65 ? 4 : 3;
    const per = cols * rowsN;
    const s = size; // mm
    let html = '';
    for (let p = 0; p < usable.length; p += per) {
      const page = usable.slice(p, p + per);
      while (page.length < per) page.push(null);
      const grid = `style="grid-template-columns:repeat(${cols},${s}mm);grid-auto-rows:${s}mm;--s:${s}mm"`;

      html += `<div class="sheet ${style}" ${grid}>`;
      for (const c of page) {
        html += c
          ? `<div class="pcard front"><div class="rings"></div><div class="qr">${qrSvg('HNT1:' + c.id)}</div><div class="brand">MS.SONG</div></div>`
          : `<div class="pcard empty"></div>`;
      }
      html += `</div>`;

      // verso: mesma grade, com as colunas invertidas para bater com a frente ao virar a folha
      html += `<div class="sheet ${style}" ${grid}>`;
      for (let r = 0; r < rowsN; r++) {
        const rowCards = page.slice(r * cols, r * cols + cols);
        if (mirror) rowCards.reverse();
        for (const c of rowCards) {
          if (!c) { html += `<div class="pcard empty"></div>`; continue; }
          const color = PALETTE[hash(c.id) % PALETTE.length];
          const aSize = fit(c.artist, s, 0.095, 0.078, 0.064);
          const tSize = fit(c.title, s, 0.09, 0.074, 0.06);
          html += `<div class="pcard back" style="--c:${color}">
            <div class="artist" style="font-size:${aSize}mm">${esc(c.artist)}</div>
            <div class="year">${c.year}</div>
            <div class="title" style="font-size:${tSize}mm">${esc(c.title)}</div>
          </div>`;
        }
      }
      html += `</div>`;
    }
    el.innerHTML = html;
    return { cards: usable.length, sheets: Math.ceil(usable.length / per) * 2, skipped: cards.length - usable.length };
  }

  return {
    get all() { return cards; },
    save, addMany, fromSpotifyTrack, fromCSV, suggestYears, stop, renderPrint,
    remove(id) { cards = cards.filter((c) => c.id !== id); save(); },
    clear() { cards = []; save(); },
    replaceAll(list) { cards = list; save(); },
    exportJSON() { return JSON.stringify({ app: 'ms-song', version: 1, cards }, null, 1); },
    importJSON(text) {
      const d = JSON.parse(text);
      const list = Array.isArray(d) ? d : d.cards;
      if (!Array.isArray(list)) throw new Error('Arquivo inválido.');
      return addMany(list.filter((c) => c.id));
    },
  };
})();
