/* ===== Ajuste de Ganhos ===== */
const DAYS = [
  { key: 'SEG', name: 'Segunda', re: /SEGUNDA/ },
  { key: 'TER', name: 'Terça',   re: /TER[CÇG]A/ },
  { key: 'QUA', name: 'Quarta',  re: /QUARTA/ },
  { key: 'QUI', name: 'Quinta',  re: /QUINTA/ },
  { key: 'SEX', name: 'Sexta',   re: /SEXTA/ },
  { key: 'SAB', name: 'Sábado',  re: /S[AÁ]BADO/ },
  { key: 'DOM', name: 'Domingo', re: /DOMINGO/ },
];

const $ = (id) => document.getElementById(id);
const fileInput = $('file-input');
const dropzone = $('dropzone');
const preview = $('preview');
const dzContent = $('dz-content');
const fixedInput = $('fixed-value');
const tbody = $('result-body');

let dates = Array(7).fill('');

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parseNum = (s) => {
  if (s === '' || s == null) return null;
  const n = parseFloat(String(s).replace(',', '.'));
  return isNaN(n) ? null : n;
};

/* ---------- Tabela ---------- */
function buildTable() {
  tbody.innerHTML = '';
  DAYS.forEach((d, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="c-day">${d.name}<small id="date-${i}">${dates[i]}</small></td>
      <td><input type="text" inputmode="decimal" id="val-${i}" placeholder="—" autocomplete="off"></td>
      <td class="c-net" id="net-${i}"><span class="dash">—</span></td>
      <td class="c-gross" id="gross-${i}"><span class="dash">—</span></td>`;
    tbody.appendChild(tr);
    tr.querySelector('input').addEventListener('input', calculate);
  });
}

function calculate() {
  const fixed = parseNum(fixedInput.value) || 0;
  localStorage.setItem('valorFixo', fixedInput.value);
  let totalNet = 0, totalGross = 0, count = 0;

  DAYS.forEach((_, i) => {
    const tr = tbody.children[i];
    const x = parseNum($(`val-${i}`).value);
    const netCell = $(`net-${i}`), grossCell = $(`gross-${i}`);
    tr.classList.remove('adjust', 'ok');

    if (x === null) {
      netCell.innerHTML = grossCell.innerHTML = '<span class="dash">—</span>';
      return;
    }
    if (x < fixed) {
      const y = fixed - x;        // 120 - X = Y (líquido)
      const z = y / 0.8;          // Y / 0.8 = Z (bruto)
      netCell.textContent = brl(y);
      grossCell.textContent = brl(z);
      tr.classList.add('adjust');
      totalNet += y; totalGross += z; count++;
    } else {
      netCell.innerHTML = grossCell.innerHTML = '<span class="dash">sem ajuste</span>';
      tr.classList.add('ok');
    }
  });

  $('t-days').textContent = count;
  $('t-net').textContent = brl(totalNet);
  $('t-gross').textContent = brl(totalGross);
}

/* ---------- Upload ---------- */
function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.hidden = false;
  dzContent.hidden = true;
  dropzone.classList.add('has-image');
  runOCR(url);
}

fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); dropzone.classList.remove('drag');
}));
dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
  if (item) handleFile(item.getAsFile());
});

/* ---------- OCR ---------- */
// O leitor é carregado UMA vez, logo que a página abre, e reaproveitado.
let workerPromise = null;
let ocrLogger = null;
const ocrStatus = $('ocr-status');

function setStatus(text, cls) {
  ocrStatus.textContent = text;
  ocrStatus.className = 'ocr-status ' + (cls || '');
}

function getWorker() {
  if (!workerPromise) {
    setStatus('Carregando leitor...', 'loading');
    workerPromise = (async () => {
      const w = await Tesseract.createWorker('eng', 1, {
        logger: (m) => ocrLogger && ocrLogger(m),
      });
      setStatus('Leitor pronto', 'ready');
      return w;
    })().catch((err) => {
      workerPromise = null;
      setStatus('Leitor offline', 'error');
      throw err;
    });
  }
  return workerPromise;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// mode 'clean': apaga barras coloridas (e o texto branco dentro delas) e
//               deixa o resto em tons de cinza com mais contraste.
// mode 'plain': só tons de cinza (tentativa reserva).
function prepareCanvas(img, mode) {
  const scale = Math.max(1, Math.min(1000 / img.width, 2.2));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;

  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    let v = 0.299 * r + 0.587 * g + 0.114 * b;
    if (mode === 'clean') {
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (sat > 70) v = 255;                                       // barras coloridas → branco
      else v = Math.max(0, Math.min(255, (v - 128) * 1.5 + 128));  // mais contraste
    }
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

/* ---- Leitura por barras ----
   Localiza as barras do gráfico pela cor (verde/verde-claro), descobre o
   topo de cada uma e recorta o número que fica logo acima dela.
   A posição horizontal da barra define o dia (7 colunas: SEG → DOM). */
function findBars(img) {
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const p = ctx.getImageData(0, 0, W, H).data;
  const isBar = (x, y) => {
    const k = (y * W + x) * 4;
    const r = p[k], g = p[k + 1], b = p[k + 2];
    return g > 90 && g - Math.max(r, b) > 40;
  };

  // Colunas com muitos pixels verdes = barra
  const col = new Array(W).fill(0);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (isBar(x, y)) col[x]++;

  const runs = [];
  let start = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && col[x] > H * 0.12;
    if (on && start < 0) start = x;
    if (!on && start >= 0) { if (x - start >= W * 0.04) runs.push([start, x - 1]); start = -1; }
  }

  const minRun = Math.round(H * 0.06);
  const topAt = (x) => {
    for (let y = 0; y < H - minRun; y++) {
      if (!isBar(x, y)) continue;
      let n = 0;
      for (let k = 0; k < minRun; k++) if (isBar(x, y + k)) n++;
      if (n >= minRun * 0.85) return y;
    }
    return -1;
  };

  const slotW = W / 7;
  return runs.map(([a, b]) => {
    const cx = (a + b) / 2;
    const tops = [topAt(a + 3), topAt(b - 3)].filter((t) => t >= 0);
    return { cx, top: tops.length ? Math.min(...tops) : -1, slot: Math.min(6, Math.floor(cx / slotW)) };
  }).filter((b) => b.top > 0);
}

function cropLabel(img, bar) {
  const W = img.width, H = img.height, slotW = W / 7;
  const x0 = Math.max(0, Math.round(bar.cx - slotW / 2));
  const cw = Math.min(W - x0, Math.round(slotW));
  const y1 = bar.top - 1;
  const y0 = Math.max(0, Math.round(bar.top - H * 0.04));
  const ch = y1 - y0;
  // Barra encostada no topo da imagem: o número ficou cortado/sem espaço.
  // Sem esse limite, a ampliação gerava um canvas gigante e o leitor travava.
  if (ch < 6 || cw < 6) return null;
  const s = Math.min(Math.max(2, 120 / ch), 8, 2000 / cw); // amplia para o leitor (com teto)
  const pad = 20;
  const c = document.createElement('canvas');
  c.width = Math.round(cw * s) + pad * 2;
  c.height = Math.round(ch * s) + pad * 2;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, y0, cw, ch, pad, pad, cw * s, ch * s);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = sat > 60 ? 255 : lum < 150 ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// Descarta o leitor travado e cria outro.
async function resetWorker(worker) {
  try { await worker.terminate(); } catch (_) {}
  workerPromise = null;
  return getWorker();
}

function toValue(text) {
  const t = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const m = t.match(/\d+\.\d{1,2}/);
  if (m) return parseFloat(m[0]);
  if (/^\d{3,}$/.test(t)) return parseFloat(t.slice(0, -2) + '.' + t.slice(-2)); // ponto perdido
  if (/^\d{1,2}$/.test(t)) return parseFloat(t);
  return null;
}

async function runOCR(url) {
  const progress = $('progress'), fill = $('progress-fill'), ptext = $('progress-text');
  const msg = $('ocr-msg');
  msg.hidden = true;
  progress.hidden = false;
  progress.style.display = 'flex';
  fill.style.width = '5%';
  ptext.textContent = 'Preparando leitura...';
  dates = Array(7).fill('');

  let pass = 0;
  ocrLogger = (m) => {
    if (pass && m.status === 'recognizing text') {
      fill.style.width = `${Math.round(10 + m.progress * 90)}%`;
      ptext.textContent = `Conferindo o print inteiro... ${Math.round(m.progress * 100)}%`;
    }
  };

  try {
    let [worker, img] = await Promise.all([getWorker(), loadImage(url)]);
    let values = Array(7).fill(null);

    // 1) Valor acima de cada barra (rápido e preciso)
    const bars = findBars(img);
    console.log('[Barras]', bars);
    if (bars.length) {
      const barParams = { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.,' };
      await worker.setParameters(barParams);
      for (let k = 0; k < bars.length; k++) {
        const day = DAYS[bars[k].slot];
        fill.style.width = `${Math.round(10 + (k / bars.length) * 90)}%`;
        ptext.textContent = `Lendo ${day.name}...`;
        const crop = cropLabel(img, bars[k]);
        if (!crop) { console.warn(`[${day.key}] recorte inválido, vai para a reserva`); continue; }
        try {
          const { data } = await withTimeout(worker.recognize(crop), 8000);
          const v = toValue(data.text);
          console.log(`[${day.key}]`, JSON.stringify(data.text), '→', v);
          if (v !== null) values[bars[k].slot] = v;
        } catch (e) {
          if (e.message !== 'timeout') throw e;
          console.warn(`[${day.key}] leitura travou, reiniciando leitor`);
          worker = await resetWorker(worker);
          await worker.setParameters(barParams);
        }
      }
      await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });
    }

    // 2) Reserva: leitura do print inteiro só se faltou alguma barra
    const missing = !bars.length || bars.some((b) => values[b.slot] === null);
    if (missing) {
      pass = 1;
      fill.style.width = '10%';
      ptext.textContent = 'Conferindo o print inteiro...';
      const { data } = await worker.recognize(prepareCanvas(img, 'clean'));
      console.log('[OCR completo]\n' + data.text);
      const v2 = parseText(data.text);
      values = values.map((v, i) => (v !== null ? v : v2[i]));
    }

    const found = values.filter((v) => v !== null).length;

    DAYS.forEach((_, i) => {
      $(`val-${i}`).value = values[i] !== null ? values[i].toFixed(2) : '';
      $(`date-${i}`).textContent = dates[i];
    });
    calculate();

    progress.hidden = true;
    progress.style.display = 'none'; // esconde mesmo com CSS antigo em cache
    msg.hidden = false;
    if (found) {
      msg.className = 'ocr-msg';
      msg.textContent = `✓ ${found} dia(s) encontrados. Confira os valores na tabela abaixo.`;
      $('step-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      msg.className = 'ocr-msg warn';
      msg.textContent = 'Não consegui ler os valores deste print. Tente um print mais nítido.';
    }
  } catch (err) {
    console.error(err);
    progress.hidden = true;
    progress.style.display = 'none';
    msg.hidden = false;
    msg.className = 'ocr-msg warn';
    msg.textContent = 'Erro ao ler a imagem (verifique a internet e recarregue a página).';
  }
}

function parseText(text) {
  const result = Array(7).fill(null);
  const lines = text.toUpperCase().split('\n').map((l) => l.trim()).filter(Boolean);
  const numRe = /\d{1,5}[.,]\d{2}(?!\d|\/)/g;

  // Período: 12/10/2026 a 18/10/2026 -> datas de cada dia
  const period = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (period) {
    const start = new Date(+period[3], +period[2] - 1, +period[1]);
    dates = DAYS.map((_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    });
  }

  // 1) Linha de totais acima das barras (vários valores na mesma linha)
  const totalsLine = lines.find((l) => !/\d{2}\/\d{2}/.test(l) && (l.match(numRe) || []).length >= 3);
  if (totalsLine) {
    totalsLine.match(numRe).slice(0, 7).forEach((n, i) => {
      result[i] = parseFloat(n.replace(',', '.'));
    });
  }

  // 2) Lista inferior "SEGUNDA 12/10 R$ 33.67" (mais confiável, sobrescreve)
  lines.forEach((l) => {
    const idx = DAYS.findIndex((d) => d.re.test(l));
    if (idx === -1) return;
    const clean = l.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ');
    const nums = clean.match(numRe);
    if (nums) result[idx] = parseFloat(nums[nums.length - 1].replace(',', '.'));
  });

  return result;
}

/* ---------- Ações ---------- */
$('btn-clear').addEventListener('click', () => {
  DAYS.forEach((_, i) => { $(`val-${i}`).value = ''; });
  preview.hidden = true; preview.src = '';
  dzContent.hidden = false;
  dropzone.classList.remove('has-image');
  $('ocr-msg').hidden = true;
  fileInput.value = '';
  calculate();
});

$('btn-copy').addEventListener('click', () => {
  const fixed = parseNum(fixedInput.value) || 0;
  const lines = [`Valor fixo: ${brl(fixed)}`, ''];
  DAYS.forEach((d, i) => {
    const x = parseNum($(`val-${i}`).value);
    if (x !== null && x < fixed) {
      const y = fixed - x;
      lines.push(`${d.name}${dates[i] ? ' ' + dates[i] : ''}: ganho ${brl(x)} | líquido ${brl(y)} | bruto ${brl(y / 0.8)}`);
    }
  });
  lines.push('', `Total líquido: ${$('t-net').textContent}`, `Total bruto: ${$('t-gross').textContent}`);
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Resultado copiado!'));
});

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

/* ---------- Init ---------- */
fixedInput.value = localStorage.getItem('valorFixo') || '120';
fixedInput.addEventListener('input', calculate);
buildTable();
calculate();
getWorker().catch(() => {}); // pré-carrega o leitor em segundo plano
