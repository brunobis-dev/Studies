/* Spotify: login (Authorization Code + PKCE, sem servidor) e chamadas da Web API. */
const Spotify = (() => {
  const SCOPES = [
    'user-modify-playback-state',
    'user-read-playback-state',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' ');
  const LS = {
    client: 'hnt.clientId',
    token: 'hnt.token',
    verifier: 'hnt.pkceVerifier',
    state: 'hnt.pkceState',
  };

  const redirectUri = () => {
    // Endereço da própria página, sem "index.html", query ou hash.
    const u = new URL(location.href);
    let path = u.pathname.replace(/index\.html$/, '');
    if (!path.endsWith('/')) path += '/';
    return u.origin + path;
  };

  const getClientId = () => (localStorage.getItem(LS.client) || (window.HNT_CONFIG && HNT_CONFIG.clientId) || '').trim();
  const setClientId = (id) => localStorage.setItem(LS.client, id.trim());

  const loadToken = () => { try { return JSON.parse(localStorage.getItem(LS.token)); } catch { return null; } };
  const saveToken = (t) => localStorage.setItem(LS.token, JSON.stringify(t));
  const isLoggedIn = () => !!(loadToken() && loadToken().refresh_token);
  const logout = () => localStorage.removeItem(LS.token);

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = (len) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const v = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(v, (x) => chars[x % chars.length]).join('');
  };

  async function login() {
    const clientId = getClientId();
    if (!clientId) throw new Error('Configure o Client ID em Configurações.');
    const verifier = randomString(64);
    const state = randomString(16);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    localStorage.setItem(LS.verifier, verifier);
    localStorage.setItem(LS.state, state);
    const p = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES,
      state,
    });
    location.assign('https://accounts.spotify.com/authorize?' + p);
  }

  async function tokenRequest(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: getClientId(), ...params }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error_description || data.error || 'Falha ao obter token');
    const old = loadToken() || {};
    const t = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || old.refresh_token,
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
    };
    saveToken(t);
    return t;
  }

  /** Chamar ao abrir a página: conclui o login se voltamos do Spotify. Retorna true/false/null. */
  async function handleRedirect() {
    const u = new URL(location.href);
    const code = u.searchParams.get('code');
    const err = u.searchParams.get('error');
    if (!code && !err) return null;
    const clean = () => history.replaceState(null, '', redirectUri() + u.hash);
    if (err) { clean(); throw new Error('Login cancelado: ' + err); }
    const verifier = localStorage.getItem(LS.verifier);
    if (!verifier || u.searchParams.get('state') !== localStorage.getItem(LS.state)) {
      clean();
      throw new Error('O login voltou em outra janela. Abra o app e tente de novo.');
    }
    try {
      await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
    } finally {
      localStorage.removeItem(LS.verifier);
      localStorage.removeItem(LS.state);
      clean();
    }
    return true;
  }

  let refreshing = null;
  async function accessToken() {
    const t = loadToken();
    if (!t) throw Object.assign(new Error('Entre com o Spotify primeiro.'), { code: 'NO_LOGIN' });
    if (Date.now() < t.expires_at) return t.access_token;
    refreshing = refreshing || tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
      .finally(() => { refreshing = null; });
    try { return (await refreshing).access_token; }
    catch (e) { logout(); throw Object.assign(new Error('Sessão expirou, entre de novo.'), { code: 'NO_LOGIN' }); }
  }

  async function api(path, { method = 'GET', body, query } = {}) {
    const url = new URL('https://api.spotify.com/v1' + path);
    if (query) Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    const doFetch = async () => fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + await accessToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let r = await doFetch();
    if (r.status === 401) { const t = loadToken(); if (t) { t.expires_at = 0; saveToken(t); } r = await doFetch(); }
    if (r.status === 429) {
      const wait = (+r.headers.get('Retry-After') || 2) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      r = await doFetch();
    }
    if (r.status === 204 || r.status === 202) return null;
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) {
      const e = new Error((data && data.error && data.error.message) || ('Erro ' + r.status));
      e.status = r.status;
      e.reason = data && data.error && data.error.reason;
      throw e;
    }
    return data;
  }

  // ---------- Player ----------
  const devices = async () => (await api('/me/player/devices')).devices || [];
  const play = (trackId, deviceId, positionMs = 0) => api('/me/player/play', {
    method: 'PUT', query: { device_id: deviceId || null },
    body: { uris: ['spotify:track:' + trackId], position_ms: Math.max(0, Math.floor(positionMs)) },
  });
  const resume = (deviceId) => api('/me/player/play', { method: 'PUT', query: { device_id: deviceId || null } });
  const pause = (deviceId) => api('/me/player/pause', { method: 'PUT', query: { device_id: deviceId || null } });
  const seek = (ms, deviceId) => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.max(0, Math.floor(ms)), device_id: deviceId || null } });
  const state = () => api('/me/player');
  const repeatOff = (deviceId) => api('/me/player/repeat', { method: 'PUT', query: { state: 'off', device_id: deviceId || null } }).catch(() => {});

  // ---------- Catálogo ----------
  const me = () => api('/me');
  const track = (id) => api('/tracks/' + id);

  /** Itens de uma playlist sua. Tenta o endpoint novo (/items) e cai para o antigo (/tracks). */
  async function playlistTracks(playlistId, onProgress) {
    const out = [];
    for (const ep of ['items', 'tracks']) {
      try {
        let offset = 0, total = Infinity;
        out.length = 0;
        while (offset < total) {
          const page = await api(`/playlists/${playlistId}/${ep}`, { query: { limit: 50, offset } });
          total = page.total ?? 0;
          for (const it of page.items || []) {
            const t = it.item || it.track;
            if (t && t.id && (t.type === 'track' || !t.type) && !t.is_local) out.push(t);
          }
          offset += 50;
          onProgress && onProgress(Math.min(offset, total), total);
          if (!page.next) break;
        }
        return out;
      } catch (e) {
        if (ep === 'tracks' || (e.status !== 404 && e.status !== 410)) throw e;
      }
    }
    return out;
  }

  return {
    redirectUri, getClientId, setClientId, login, handleRedirect, isLoggedIn, logout,
    devices, play, resume, pause, seek, state, repeatOff, me, track, playlistTracks,
  };
})();
