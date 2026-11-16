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
let isoDates = Array(7).fill('');

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

function setStartDate(yyyyMmDd) {
  const startInput = $('start-date');
  if (startInput && startInput.value !== yyyyMmDd) startInput.value = yyyyMmDd;
  if (!yyyyMmDd) {
    dates = Array(7).fill('');
    isoDates = Array(7).fill('');
  } else {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    DAYS.forEach((_, i) => {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      const yy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      isoDates[i] = `${yy}-${mm}-${dd}`;
      dates[i] = `${dd}/${mm}`;
    });
  }
  DAYS.forEach((_, i) => {
    const el = $(`date-${i}`);
    if (el) el.textContent = dates[i];
  });
  updateAutoPreview();
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
  updateAutoPreview();
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

async function extractHeaderDate(worker, img) {
  try {
    const W = img.width, H = Math.round(img.height * 0.28);
    if (W < 20 || H < 20) return;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H, 0, 0, W, H);
    const { data } = await withTimeout(worker.recognize(c), 5000);
    const period = data.text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (period) {
      setStartDate(`${period[3]}-${period[2]}-${period[1]}`);
    }
  } catch (_) {}
}

async function runOCR(url) {
  const progress = $('progress'), fill = $('progress-fill'), ptext = $('progress-text');
  const msg = $('ocr-msg');
  msg.hidden = true;
  progress.hidden = false;
  progress.style.display = 'flex';
  fill.style.width = '5%';
  ptext.textContent = 'Preparando leitura...';

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
    } else {
      ptext.textContent = 'Lendo data do período...';
      await extractHeaderDate(worker, img);
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
    setStartDate(`${period[3]}-${period[2]}-${period[1]}`);
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

/* ---------- Automação do Painel (iBoltt) ---------- */
function getAutoPayload() {
  const fixed = parseNum(fixedInput.value) || 0;
  const id_empresa = ($('id-empresa')?.value || '3307').trim();
  const driver_id = ($('driver-id')?.value || '').trim();
  const subject = ($('subject')?.value || '').trim();
  const lancamentos = [];

  DAYS.forEach((d, i) => {
    const x = parseNum($(`val-${i}`)?.value);
    if (x !== null && x < fixed) {
      const y = fixed - x;
      const z = y / 0.8; // Sempre valor Bruto
      lancamentos.push({
        dia: d.name,
        data: isoDates[i] || '',
        dataBr: dates[i] || '',
        valor: z.toFixed(2),
      });
    }
  });

  return {
    tipo: 'AJUSTE_GARANTIDO_IBOLTT',
    id_empresa,
    driver_id,
    subject,
    lancamentos,
  };
}

function updateAutoPreview() {
  const box = $('auto-preview');
  if (!box) return;
  const payload = getAutoPayload();
  localStorage.setItem('idEmpresa', payload.id_empresa);
  localStorage.setItem('driverId', payload.driver_id);
  localStorage.setItem('subject', payload.subject);

  if (!payload.lancamentos.length) {
    box.innerHTML = '<span class="dash">Nenhum dia abaixo do garantido até o momento.</span>';
    return;
  }

  const semData = payload.lancamentos.some((l) => !l.data);
  const itemsHtml = payload.lancamentos.map((l) => {
    const dtLabel = l.data ? l.data.split('-').reverse().join('/') : '⚠️ escolha a Segunda-feira';
    return `<div class="auto-preview-item">
      <span>${l.dia} (${dtLabel})</span>
      <b>R$ ${l.valor} (Bruto)</b>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div style="margin-bottom:8px;color:var(--muted);font-size:0.84rem;">
      Motorista: <b style="color:var(--text)">${payload.driver_id || '⚠️ informe o driver_id'}</b> •
      Empresa: <b style="color:var(--text)">${payload.id_empresa}</b> •
      ${payload.lancamentos.length} lançamento(s) avulso(s)
      ${semData ? '<span style="color:var(--amber);display:block;">⚠️ Selecione a Data da Segunda-feira acima para definir as datas exatas.</span>' : ''}
    </div>
    <div class="auto-preview-list">${itemsHtml}</div>
  `;
}

// Gera o script que roda dentro do painel iBoltt (via Favorito ou Console)
function buildPanelScript(embeddedPayload = null) {
  const injected = embeddedPayload ? JSON.stringify(embeddedPayload) : 'null';
  const code = `(async()=>{
const EMBED=${injected};
const KEY='iboltt_pendentes_v1';
const URL_CRIAR='https://iboltt.com/reports/forms/lancamento_avulso.php';

const lerBotoes=(root=document)=>[...root.querySelectorAll('button[onclick^="abrirModal"]')].map(el=>{
  const m=el.getAttribute('onclick').match(/abrirModal\\((\\d+),\\s*'([^']+)',\\s*'([^']+)'\\)/);
  if(!m)return null;
  const[,id,dh,val]=m;
  return{id,dh,val,num:parseFloat(String(val).replace(',','.')),el};
}).filter(Boolean);

const aplicarDatas=async(pacote,botoes,idsIgnorar=new Set())=>{
  const usados=new Set(idsIgnorar);
  let ok=0,err=0,naoAchou=0;
  for(const item of pacote.lancamentos){
    const alvo=parseFloat(item.valor);
    let cand=botoes.find(b=>!usados.has(b.id)&&Math.abs(b.num-alvo)<0.01&&!b.dh.startsWith(item.data));
    if(!cand)cand=botoes.find(b=>!usados.has(b.id)&&Math.abs(b.num-alvo)<0.01);
    if(!cand){naoAchou++;continue;}
    usados.add(cand.id);
    const h=(cand.dh.split('T')[1]||'12:00');
    const ndh=item.data+'T'+h;
    try{
      const r=await fetch('editar_lancamento_avulso.php',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
        body:new URLSearchParams({id:cand.id,acao:'editar',created_at:ndh,credit:cand.val}).toString()
      });
      const j=await r.json();
      if(j&&j.sucesso){
        ok++;
        const c=document.getElementById('data-'+cand.id);
        if(c)c.innerText=item.data.split('-').reverse().join('/')+' '+h+':00';
        const btnVivo=document.querySelector('button[onclick*="abrirModal('+cand.id+',"]');
        if(btnVivo)btnVivo.setAttribute('onclick',"abrirModal("+cand.id+", '"+ndh+"', '"+cand.val+"')");
      }else{err++;}
    }catch(e){err++;}
  }
  return{ok,err,naoAchou};
};

let pendente=null;
try{pendente=JSON.parse(localStorage.getItem(KEY)||'null');}catch(_){}
const botoesTela=lerBotoes(document);

if(pendente&&pendente.jaCriados&&botoesTela.length){
  const resumoPend=pendente.lancamentos.map(l=>l.dia+' ('+l.data.split('-').reverse().join('/')+'): R$ '+l.valor).join('\\n');
  if(confirm('Encontrei '+pendente.lancamentos.length+' lançamento(s) recém-criados para o motorista '+pendente.driver_id+':\\n\\n'+resumoPend+'\\n\\nDeseja aplicar as datas na tabela agora?')){
    const res=await aplicarDatas(pendente,botoesTela);
    localStorage.removeItem(KEY);
    return alert('Datas atualizadas!\\nSucesso: '+res.ok+'\\nErros: '+res.err+(res.naoAchou?'\\nNão encontrados na tabela: '+res.naoAchou:''));
  }
  localStorage.removeItem(KEY);
}

let pacote=EMBED;
if(!pacote){
  try{
    const txt=await navigator.clipboard.readText();
    const parsed=JSON.parse(txt);
    if(parsed&&parsed.tipo==='AJUSTE_GARANTIDO_IBOLTT')pacote=parsed;
  }catch(_){}
}
if(!pacote){
  const colado=prompt('Cole aqui (Ctrl+V) o pacote copiado na calculadora de Ajuste de Ganhos:');
  if(!colado)return;
  try{pacote=JSON.parse(colado);}catch(e){return alert('Dados inválidos. Clique em "Copiar Pacote de Lançamento" na calculadora.');}
}
if(!pacote||!pacote.lancamentos||!pacote.lancamentos.length)return alert('Nenhum lançamento no pacote.');

if(!pacote.driver_id){
  const inpDriver=document.querySelector('[name="driver_id"],#driver_id');
  pacote.driver_id=(inpDriver&&inpDriver.value)||prompt('Informe o ID do Motorista (driver_id):')||'';
  if(!pacote.driver_id)return;
}

const listaTxt=pacote.lancamentos.map(l=>'• '+l.dia+' ('+l.data.split('-').reverse().join('/')+') → R$ '+l.valor).join('\\n');
if(!confirm('🚀 Automação Garantido iBoltt\\nMotorista (driver_id): '+pacote.driver_id+' | Empresa: '+pacote.id_empresa+'\\n\\n'+listaTxt+'\\n\\nConfirmar criação dos lançamentos avulsos e ajuste de datas?'))return;

const idsAntes=new Set(botoesTela.map(b=>b.id));
let okCriar=0,errCriar=0,ultimoHtml='';
for(const item of pacote.lancamentos){
  try{
    const r=await fetch(URL_CRIAR,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
      body:new URLSearchParams({
        id_empresa:pacote.id_empresa||'3307',
        driver_id:pacote.driver_id,
        value:item.valor,
        subject:pacote.subject||'',
        statusE:'ok'
      }).toString(),
      credentials:'include'
    });
    if(r.ok){okCriar++;ultimoHtml=await r.text();}else{errCriar++;}
  }catch(e){errCriar++;}
}

if(!okCriar)return alert('Erro ao criar os lançamentos avulsos. Verifique se você está logado no painel iBoltt.');

let novosBotoes=[];
if(ultimoHtml){
  const docPost=new DOMParser().parseFromString(ultimoHtml,'text/html');
  novosBotoes=lerBotoes(docPost).filter(b=>!idsAntes.has(b.id));
}
if(novosBotoes.length<pacote.lancamentos.length&&botoesTela.length){
  try{
    const rPag=await fetch(location.href,{credentials:'include',cache:'no-store'});
    const docPag=new DOMParser().parseFromString(await rPag.text(),'text/html');
    const daPag=lerBotoes(docPag).filter(b=>!idsAntes.has(b.id));
    if(daPag.length>novosBotoes.length)novosBotoes=daPag;
  }catch(_){}
}

if(novosBotoes.length>=pacote.lancamentos.length){
  const res=await aplicarDatas(pacote,novosBotoes);
  localStorage.removeItem(KEY);
  alert('✅ Processo completo concluído!\\n\\nLançamentos criados: '+okCriar+'\\nDatas ajustadas: '+res.ok+(res.err?'\\nErros na data: '+res.err:''));
  if(botoesTela.length)location.reload();
}else{
  localStorage.setItem(KEY,JSON.stringify({...pacote,jaCriados:true}));
  alert('✅ '+okCriar+' lançamento(s) avulso(s) criados com sucesso!\\n\\nAgora vá na aba/painel de editar datas, filtre/atualize a tabela do motorista '+pacote.driver_id+' e clique neste mesmo Favorito para aplicar as datas automaticamente!');
}
})();`;
  return code;
}

function validateAutoInputs() {
  const payload = getAutoPayload();
  if (!payload.lancamentos.length) {
    toast('Nenhum dia precisa de ajuste.');
    return null;
  }
  if (!payload.driver_id) {
    $('driver-id').focus();
    toast('Informe o ID do Motorista (driver_id).');
    return null;
  }
  if (payload.lancamentos.some((l) => !l.data)) {
    $('start-date').focus();
    toast('Selecione a Data da Segunda-feira.');
    return null;
  }
  return payload;
}

/* ---------- Ações ---------- */
$('btn-clear').addEventListener('click', () => {
  DAYS.forEach((_, i) => { $(`val-${i}`).value = ''; });
  preview.hidden = true; preview.src = '';
  dzContent.hidden = false;
  dropzone.classList.remove('has-image');
  $('ocr-msg').hidden = true;
  fileInput.value = '';
  setStartDate('');
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
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Resumo copiado!'));
});

$('btn-copy-auto').addEventListener('click', () => {
  const payload = validateAutoInputs();
  if (!payload) return;
  navigator.clipboard.writeText(JSON.stringify(payload)).then(() => {
    toast('⚡ Pacote copiado! Clique no favorito "🚀 Lançar Garantido" no painel.');
  });
});

$('btn-copy-script').addEventListener('click', () => {
  const payload = validateAutoInputs();
  if (!payload) return;
  const script = buildPanelScript(payload);
  navigator.clipboard.writeText(script).then(() => {
    toast('📋 Script completo copiado! Cole no Console (F12) do painel.');
  });
});

/* ---------- Automação de Diárias (Dashboard -> Agenda Garantidos -> Lançamento Avulso) ---------- */
function buildDiariasScript() {
  return `(async()=>{
const URL_AGENDA='https://iboltt.com/reports/extrato_agenda_garantidos.php';
const URL_CRIAR='https://iboltt.com/reports/forms/lancamento_avulso.php';
const KEY_PEND='iboltt_pendentes_v1';

const oldModal=document.getElementById('iboltt-diarias-overlay');
if(oldModal)oldModal.remove();

const hojeIso=()=>{
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
};

const detectarDataPagina=()=>{
  const inp=document.querySelector('input[type="date"]');
  if(inp&&/^\\d{4}-\\d{2}-\\d{2}$/.test(inp.value))return inp.value;
  return hojeIso();
};

const detectarLojaPagina=()=>{
  const txt=(location.href+' '+document.title+' '+(document.querySelector('h1,h2,h3,header')?.innerText||'')).toUpperCase();
  if(txt.includes('OSASCO')||txt.includes('6398'))return '6398';
  return '6172';
};

const sugerirValor=(loja,dataIso)=>{
  if(!dataIso)return '87.50';
  const[a,m,d]=dataIso.split('-').map(Number);
  const sem=new Date(a,m-1,d).getDay(); // 0=Dom, 1=Seg ... 5=Sex, 6=Sab
  if(sem>=1&&sem<=4)return '87.50';
  if(loja==='6398')return '112.50'; // Sex, Sab, Dom em Osasco
  if(sem===0||sem===6)return '137.50'; // Sab, Dom no SP Market
  return '87.50';
};

const lerModalDashboard=()=>{
  const modal=document.querySelector('#modalPrestadoresCorridas');
  if(!modal)return[];
  const map=new Map();
  modal.querySelectorAll('tr').forEach(tr=>{
    const tds=[...tr.querySelectorAll('td')];
    if(tds.length<2)return;
    let id='',nome='';
    for(const td of tds){
      const limpo=td.textContent.trim();
      if(!id&&/^\\d{4,7}$/.test(limpo)&&!td.querySelector('.badge')){
        id=limpo;
      }else if(!nome&&/[A-Za-zÀ-ÿ]{3,}/.test(limpo)&&!/^\\d+$/.test(limpo)){
        nome=limpo;
      }
    }
    if(id&&!map.has(id)){
      map.set(id,{driver_id:id,nome:nome||('Motorista '+id)});
    }
  });
  return[...map.values()];
};

const consultarAgenda=async(codEmpresa,dataIso)=>{
  const lojas=codEmpresa==='AMBAS'?['6172','6398']:[codEmpresa];
  const porMotorista=new Map();
  for(const loja of lojas){
    const r=await fetch(URL_AGENDA,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
      body:new URLSearchParams({dataInicio:dataIso,dataFim:dataIso,codEmpresa:loja}).toString(),
      credentials:'include'
    });
    const html=await r.text();
    const doc=new DOMParser().parseFromString(html,'text/html');
    const tabela=doc.querySelector('table.table-bordered.table-striped tbody')||doc.querySelector('table tbody');
    if(!tabela)continue;
    tabela.querySelectorAll('tr').forEach(tr=>{
      const tds=tr.querySelectorAll('td');
      if(tds.length<8)return;
      const nomeAg=tds[1].textContent.replace(/\\(.*?\\)/g,'').trim();
      const mId=tds[2].textContent.match(/\\b(\\d{4,7})\\b/);
      if(!mId)return;
      const driver_id=mId[1];
      const empresaNome=tds[3].textContent.trim();
      const horario=tds[5].textContent.trim();
      const confHtml=tds[7].innerHTML.toLowerCase();
      const confirmado=confHtml.includes('simbutton')||tds[7].textContent.trim().toLowerCase()==='sim';
      if(!porMotorista.has(driver_id)){
        porMotorista.set(driver_id,{driver_id,nome:nomeAg,turnos:[],confirmados:[]});
      }
      const item=porMotorista.get(driver_id);
      item.turnos.push({horario,confirmado,empresaNome});
      if(confirmado&&!item.confirmados.includes(horario)){
        item.confirmados.push(horario);
      }
    });
  }
  return porMotorista;
};

const overlay=document.createElement('div');
overlay.id='iboltt-diarias-overlay';
overlay.style.cssText='position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif;color:#eef5f0;';
overlay.innerHTML=\`
  <div style="background:#111915;border:1px solid rgba(43,212,106,0.35);border-radius:16px;max-width:880px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.6);overflow:hidden;">
    <div style="padding:16px 20px;background:#16221c;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;">
      <div>
        <strong style="font-size:1.15rem;color:#2bd46a;">⚡ Automação de Diárias — Coco Bambu (iBoltt)</strong>
        <div id="ib-substatus" style="font-size:0.82rem;color:#8fa398;margin-top:2px;">Cruzando Prestadores c/ Diárias no Dia × Agenda de Garantidos...</div>
      </div>
      <button id="ib-close" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:600;">✕ Fechar</button>
    </div>

    <div style="padding:14px 20px;background:#131d18;border-bottom:1px solid rgba(255,255,255,0.08);display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:end;">
      <div>
        <label style="font-size:0.75rem;color:#8fa398;display:block;margin-bottom:4px;">Loja (Agenda Garantidos)</label>
        <select id="ib-loja" style="width:100%;padding:8px 10px;border-radius:8px;background:#0b110e;color:#fff;border:1px solid rgba(255,255,255,0.15);">
          <option value="6172">COCO BAMBU SP MARKET (6172)</option>
          <option value="6398">COCO BAMBU OSASCO (6398)</option>
          <option value="AMBAS">Pesquisar nas 2 Lojas (6172 + 6398)</option>
        </select>
      </div>
      <div>
        <label style="font-size:0.75rem;color:#8fa398;display:block;margin-bottom:4px;">Data da Diária</label>
        <input type="date" id="ib-data" style="width:100%;padding:8px 10px;border-radius:8px;background:#0b110e;color:#fff;border:1px solid rgba(255,255,255,0.15);color-scheme:dark;">
      </div>
      <div>
        <label style="font-size:0.75rem;color:#8fa398;display:block;margin-bottom:4px;">Valor Bruto 1 Diária (R$)</label>
        <div style="display:flex;gap:4px;">
          <input type="number" id="ib-valor" step="0.01" style="width:100%;padding:8px 10px;border-radius:8px;background:#0b110e;color:#6ef0b4;font-weight:700;border:1px solid rgba(43,212,106,0.4);">
        </div>
        <div style="display:flex;gap:4px;margin-top:4px;">
          <button type="button" class="ib-preset" data-val="87.50" style="flex:1;font-size:0.72rem;padding:3px 4px;border-radius:5px;border:1px solid rgba(255,255,255,0.15);background:#1b2821;color:#eef5f0;cursor:pointer;">87.50</button>
          <button type="button" class="ib-preset" data-val="112.50" style="flex:1;font-size:0.72rem;padding:3px 4px;border-radius:5px;border:1px solid rgba(255,255,255,0.15);background:#1b2821;color:#eef5f0;cursor:pointer;">112.50</button>
          <button type="button" class="ib-preset" data-val="137.50" style="flex:1;font-size:0.72rem;padding:3px 4px;border-radius:5px;border:1px solid rgba(255,255,255,0.15);background:#1b2821;color:#eef5f0;cursor:pointer;">137.50</button>
        </div>
      </div>
      <div>
        <label style="font-size:0.75rem;color:#8fa398;display:block;margin-bottom:4px;">ID Empresa / Assunto</label>
        <div style="display:flex;gap:6px;">
          <input type="text" id="ib-emp-lanc" value="3307" title="id_empresa no lançamento avulso" style="width:70px;padding:8px;border-radius:8px;background:#0b110e;color:#fff;border:1px solid rgba(255,255,255,0.15);">
          <input type="text" id="ib-subject" placeholder="Assunto (opc.)" style="flex:1;padding:8px;border-radius:8px;background:#0b110e;color:#fff;border:1px solid rgba(255,255,255,0.15);">
        </div>
      </div>
      <div>
        <button type="button" id="ib-refresh" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(43,212,106,0.4);background:rgba(43,212,106,0.12);color:#6ef0b4;font-weight:600;cursor:pointer;">🔄 Consultar Agenda</button>
      </div>
    </div>

    <div id="ib-table-wrap" style="padding:16px 20px;overflow-y:auto;flex:1;">
      <div style="text-align:center;padding:30px;color:#8fa398;">Consultando extrato_agenda_garantidos.php...</div>
    </div>

    <div style="padding:14px 20px;background:#16221c;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div id="ib-resumo-rodape" style="font-size:0.9rem;color:#8fa398;">Selecione os prestadores para lançar.</div>
      <button type="button" id="ib-lancar" style="padding:12px 24px;border-radius:10px;border:0;background:linear-gradient(135deg,#2bd46a,#1a9b2c);color:#04140a;font-weight:700;font-size:0.98rem;cursor:pointer;">🚀 Lançar Diárias Confirmadas</button>
    </div>
  </div>
\`;
document.body.appendChild(overlay);

const elLoja=overlay.querySelector('#ib-loja');
const elData=overlay.querySelector('#ib-data');
const elValor=overlay.querySelector('#ib-valor');
const elEmpLanc=overlay.querySelector('#ib-emp-lanc');
const elSubject=overlay.querySelector('#ib-subject');
const elWrap=overlay.querySelector('#ib-table-wrap');
const elSub=overlay.querySelector('#ib-substatus');
const elResumo=overlay.querySelector('#ib-resumo-rodape');
const btnLancar=overlay.querySelector('#ib-lancar');

elLoja.value=detectarLojaPagina();
elData.value=detectarDataPagina();
elValor.value=sugerirValor(elLoja.value,elData.value);

overlay.querySelector('#ib-close').onclick=()=>overlay.remove();
overlay.querySelectorAll('.ib-preset').forEach(b=>{
  b.onclick=()=>{elValor.value=b.dataset.val;atualizarTotaisUI();};
});
elLoja.onchange=()=>{
  elValor.value=sugerirValor(elLoja.value,elData.value);
  carregarDados();
};
elData.onchange=()=>{
  elValor.value=sugerirValor(elLoja.value,elData.value);
  carregarDados();
};
elValor.oninput=()=>atualizarTotaisUI();
overlay.querySelector('#ib-refresh').onclick=()=>carregarDados();

let listaFinal=[];

const atualizarTotaisUI=()=>{
  const vUnit=parseFloat(elValor.value)||0;
  let totalLancamentos=0,totalReais=0;
  overlay.querySelectorAll('.ib-row-item').forEach(tr=>{
    const idx=+tr.dataset.idx;
    const chk=tr.querySelector('.ib-chk').checked;
    const qtd=+tr.querySelector('.ib-qtd').value||0;
    listaFinal[idx].selecionado=chk;
    listaFinal[idx].qtd=qtd;
    const cellVal=tr.querySelector('.ib-cell-val');
    if(chk&&qtd>0){
      const valInteiro=qtd*vUnit;
      totalLancamentos+=1;
      totalReais+=valInteiro;
      cellVal.innerHTML=qtd===1
        ?'<b>R$ '+valInteiro.toFixed(2)+'</b> <small style="color:#8fa398;">(1x)</small>'
        :'<b style="color:#6ef0b4;">R$ '+valInteiro.toFixed(2)+'</b> <small style="color:#8fa398;">('+qtd+'x R$ '+vUnit.toFixed(2)+')</small>';
    }else{
      cellVal.innerHTML='<span style="color:#666;">—</span>';
    }
  });
  elResumo.innerHTML='Total a enviar: <b style="color:#6ef0b4;">'+totalLancamentos+' lançamento(s) avulso(s)</b> • Soma Bruta: <b style="color:#fff;">R$ '+totalReais.toFixed(2)+'</b>';
};

const carregarDados=async()=>{
  elWrap.innerHTML='<div style="text-align:center;padding:30px;color:#8fa398;">⏳ Consultando Agenda de Garantidos ('+elLoja.value+') em '+elData.value.split('-').reverse().join('/')+'...</div>';
  try{
    const doModal=lerModalDashboard();
    const mapaAgenda=await consultarAgenda(elLoja.value,elData.value);
    listaFinal=[];

    if(doModal.length){
      elSub.textContent='Lidos '+doModal.length+' prestador(es) do modal #modalPrestadoresCorridas no Dashboard.';
      for(const p of doModal){
        const ag=mapaAgenda.get(p.driver_id);
        const qtdConf=ag?ag.confirmados.length:0;
        listaFinal.push({
          driver_id:p.driver_id,
          nome:p.nome,
          turnos:ag?ag.turnos:[],
          qtd:qtdConf>0?qtdConf:1,
          confirmadoAgenda:qtdConf>0,
          selecionado:qtdConf>0
        });
      }
    }else{
      elSub.textContent='Modal do Dashboard não encontrado nesta aba — listando diretamente os confirmados da Agenda de Garantidos.';
      for(const ag of mapaAgenda.values()){
        const qtdConf=ag.confirmados.length;
        listaFinal.push({
          driver_id:ag.driver_id,
          nome:ag.nome,
          turnos:ag.turnos,
          qtd:qtdConf>0?qtdConf:1,
          confirmadoAgenda:qtdConf>0,
          selecionado:qtdConf>0
        });
      }
    }

    if(!listaFinal.length){
      elWrap.innerHTML='<div style="text-align:center;padding:30px;color:#ffc857;">Nenhum prestador encontrado para esta data/loja.</div>';
      atualizarTotaisUI();
      return;
    }

    const rowsHtml=listaFinal.map((item,idx)=>{
      const badges=item.turnos.length
        ?item.turnos.map(t=>'<span style="display:inline-block;padding:3px 8px;border-radius:6px;font-size:0.75rem;margin:2px;background:'+(t.confirmado?'rgba(43,212,106,0.18);color:#6ef0b4;border:1px solid rgba(43,212,106,0.4)':'rgba(255,107,107,0.15);color:#ff6b6b;')+'">'+(t.confirmado?'✓ ':'✗ ')+t.horario+'</span>').join('')
        :'<span style="font-size:0.78rem;color:#ffc857;">⚠️ Não listado na agenda desta loja/data</span>';

      return \`
        <tr class="ib-row-item" data-idx="\${idx}" style="border-bottom:1px solid rgba(255,255,255,0.06);">
          <td style="padding:10px 8px;text-align:center;">
            <input type="checkbox" class="ib-chk" \${item.selecionado?'checked':''} style="width:17px;height:17px;cursor:pointer;">
          </td>
          <td style="padding:10px 8px;">
            <div style="font-weight:600;color:#eef5f0;">\${item.nome}</div>
            <div style="font-size:0.78rem;color:#8fa398;">Driver ID: <b style="color:#6ef0b4;">\${item.driver_id}</b></div>
          </td>
          <td style="padding:10px 8px;">\${badges}</td>
          <td style="padding:10px 8px;text-align:center;">
            <select class="ib-qtd" style="padding:6px 8px;border-radius:7px;background:#0b110e;color:#fff;border:1px solid rgba(255,255,255,0.2);font-weight:600;">
              <option value="1" \${item.qtd===1?'selected':''}>1 diária (1 horário)</option>
              <option value="2" \${item.qtd===2?'selected':''}>2 diárias (2 horários)</option>
              <option value="3" \${item.qtd>=3?'selected':''}>3 diárias</option>
            </select>
          </td>
          <td class="ib-cell-val" style="padding:10px 8px;text-align:right;white-space:nowrap;"></td>
        </tr>
      \`;
    }).join('');

    elWrap.innerHTML=\`
      <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.12);color:#8fa398;text-align:left;font-size:0.75rem;text-transform:uppercase;">
            <th style="padding:8px;text-align:center;width:40px;"><input type="checkbox" id="ib-chk-all" checked style="width:16px;height:16px;cursor:pointer;"></th>
            <th style="padding:8px;">Prestador / ID</th>
            <th style="padding:8px;">Horários na Agenda Garantidos</th>
            <th style="padding:8px;text-align:center;">Qtd. Lançamentos</th>
            <th style="padding:8px;text-align:right;">Lançar (Bruto)</th>
          </tr>
        </thead>
        <tbody>\${rowsHtml}</tbody>
      </table>
    \`;

    elWrap.querySelectorAll('.ib-chk,.ib-qtd').forEach(el=>{el.onchange=atualizarTotaisUI;});
    const chkAll=elWrap.querySelector('#ib-chk-all');
    if(chkAll){
      chkAll.onchange=()=>{
        elWrap.querySelectorAll('.ib-chk').forEach(c=>{c.checked=chkAll.checked;});
        atualizarTotaisUI();
      };
    }
    atualizarTotaisUI();
  }catch(err){
    console.error(err);
    elWrap.innerHTML='<div style="text-align:center;padding:30px;color:#ff6b6b;">Erro ao consultar agenda: '+err.message+'</div>';
  }
};

btnLancar.onclick=async()=>{
  const vUnit=parseFloat(elValor.value)||0;
  if(vUnit<=0)return alert('Informe um valor bruto válido para a diária.');
  const id_empresa=(elEmpLanc.value||'3307').trim();
  const subject=(elSubject.value||'').trim();
  const dataAlvo=elData.value;

  const fila=[];
  for(const item of listaFinal){
    if(!item.selecionado||item.qtd<=0)continue;
    fila.push({
      driver_id:item.driver_id,
      nome:item.nome,
      qtd:item.qtd,
      valor:(item.qtd*vUnit).toFixed(2),
      data:dataAlvo
    });
  }
  if(!fila.length)return alert('Selecione pelo menos 1 prestador para lançar.');

  const resumoConf=fila.map(f=>'• '+f.nome+' (ID '+f.driver_id+') ['+f.qtd+'x]: R$ '+f.valor).join('\\n');
  if(!confirm('Confirmar '+fila.length+' lançamento(s) avulso(s) em lancamento_avulso.php?\\n\\n'+resumoConf))return;

  btnLancar.disabled=true;
  let ok=0,err=0;
  for(let i=0;i<fila.length;i++){
    const f=fila[i];
    btnLancar.textContent='⏳ Lançando '+(i+1)+'/'+fila.length+' ('+f.driver_id+')...';
    try{
      const r=await fetch(URL_CRIAR,{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
        body:new URLSearchParams({
          id_empresa,
          driver_id:f.driver_id,
          value:f.valor,
          subject,
          statusE:'ok'
        }).toString(),
        credentials:'include'
      });
      if(r.ok)ok++;else err++;
    }catch(e){err++;}
  }

  btnLancar.disabled=false;
  btnLancar.textContent='✅ Concluído ('+ok+' lançados)';

  if(dataAlvo&&dataAlvo!==hojeIso()){
    localStorage.setItem(KEY_PEND,JSON.stringify({
      tipo:'AJUSTE_GARANTIDO_IBOLTT',
      id_empresa,
      driver_id:'DIARIAS_LOTE',
      subject,
      jaCriados:true,
      lancamentos:fila.map(f=>({dia:f.nome+' (ID '+f.driver_id+')',data:f.data,valor:f.valor}))
    }));
    alert('✅ '+ok+' diária(s) lançada(s) com sucesso!'+(err?'\\nErros: '+err:'')+'\\n\\nComo a data escolhida ('+dataAlvo.split('-').reverse().join('/')+') é diferente de hoje, se quiser mudar a data na tabela de edição basta abrir a tabela e clicar no favorito "🚀 Lançar Garantido"!');
  }else{
    alert('🎉 '+ok+' diária(s) lançada(s) com sucesso em lancamento_avulso.php!'+(err?'\\nErros: '+err:''));
  }
};

await carregarDados();
})();`;
}

if ($('bm-diarias-link')) {
  $('bm-diarias-link').href = 'javascript:' + encodeURIComponent(buildDiariasScript());
}

if ($('btn-copy-diarias-script')) {
  $('btn-copy-diarias-script').addEventListener('click', () => {
    navigator.clipboard.writeText(buildDiariasScript()).then(() => {
      toast('📋 Script de Diárias copiado! Cole no Console (F12) do Dashboard.');
    });
  });
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

/* ---------- Init ---------- */
fixedInput.value = localStorage.getItem('valorFixo') || '120';
$('id-empresa').value = localStorage.getItem('idEmpresa') || '3307';
$('driver-id').value = localStorage.getItem('driverId') || '';
$('subject').value = localStorage.getItem('subject') || '';

fixedInput.addEventListener('input', calculate);
$('id-empresa').addEventListener('input', updateAutoPreview);
$('driver-id').addEventListener('input', updateAutoPreview);
$('subject').addEventListener('input', updateAutoPreview);
$('start-date').addEventListener('input', (e) => setStartDate(e.target.value));

$('bm-link').href = 'javascript:' + encodeURIComponent(buildPanelScript(null));

buildTable();
calculate();
getWorker().catch(() => {}); // pré-carrega o leitor em segundo plano
