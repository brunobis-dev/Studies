/* Leitor de QR pela câmera. Usa BarcodeDetector quando existe (Android/Chrome) e jsQR no resto (iPhone). */
const Scanner = (() => {
  let stream = null, running = false, detector = null, rafId = 0;

  /** Extrai o ID da faixa do texto lido. Aceita o formato das nossas cartas e links do Spotify. */
  function parsePayload(text) {
    if (!text) return null;
    text = text.trim();
    let m = text.match(/^HNT1:([A-Za-z0-9]{22})$/i);
    if (m) return m[1];
    m = text.match(/spotify[:/]track[:/]([A-Za-z0-9]{22})/i);
    if (m) return m[1];
    m = text.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/i);
    if (m) return m[1];
    return null;
  }

  async function start(videoEl, canvasEl, onResult, onBadCode) {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este navegador não libera a câmera. Abra pelo Safari/Chrome com https.');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    running = true;

    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch { detector = null; }
    }
    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    let lastBad = '', busy = false, frame = 0;

    const tick = async () => {
      if (!running) return;
      rafId = requestAnimationFrame(tick);
      if (busy || videoEl.readyState < 2 || (frame++ % 3)) return; // ~20 leituras/s
      busy = true;
      try {
        let raw = null;
        if (detector) {
          const codes = await detector.detect(videoEl);
          raw = codes[0] && codes[0].rawValue;
        } else {
          // recorta o quadrado central (onde fica a moldura) e reduz para acelerar
          const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
          const side = Math.min(vw, vh) * 0.8;
          const size = 480;
          canvasEl.width = size; canvasEl.height = size;
          ctx.drawImage(videoEl, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
          const img = ctx.getImageData(0, 0, size, size);
          const code = jsQR(img.data, size, size, { inversionAttempts: 'dontInvert' });
          raw = code && code.data;
        }
        if (raw) {
          const id = parsePayload(raw);
          if (id) { stop(videoEl); onResult(id, raw); return; }
          if (raw !== lastBad) { lastBad = raw; onBadCode && onBadCode(raw); }
        }
      } catch (e) { /* frame ruim, segue */ }
      finally { busy = false; }
    };
    tick();
  }

  function stop(videoEl) {
    running = false;
    cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (videoEl) videoEl.srcObject = null;
  }

  return { start, stop, parsePayload };
})();
