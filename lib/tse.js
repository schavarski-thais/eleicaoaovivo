// Busca e normalização dos JSONs de resultado do TSE. Usado pelo servidor local
// (server.js) e pela função serverless da Vercel (api/apuracao.js).

const CONFIG = {
  base: process.env.TSE_BASE || 'https://resultados.tse.jus.br',
  ambiente: process.env.TSE_AMBIENTE || 'oficial',
  ciclo: process.env.TSE_CICLO || 'ele2026',
  eleicao: process.env.TSE_ELEICAO || '6258', // 2º turno federal 2026 (ver /oficial/comum/config/ele-c.json)
  cargo: '0001', // Presidente
  intervaloMs: (Number(process.env.INTERVALO_S) || 15) * 1000,
};

const UFS = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb',
  'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to'];
const ABRANGENCIAS = ['br', ...UFS, 'zz']; // zz = exterior

const urlArquivo = (abr) => {
  const ele = CONFIG.eleicao.padStart(6, '0');
  return `${CONFIG.base}/${CONFIG.ambiente}/${CONFIG.ciclo}/${CONFIG.eleicao}/dados/${abr}/${abr}-c${CONFIG.cargo}-e${ele}-u.json`;
};

// "51,661710187" -> 51.661710187
const num = (v) => (v == null || v === '' ? 0 : Number(String(v).replace(',', '.')));

function normalizar(raw) {
  const cargo = (raw.carg || [])[0] || {};
  const candidatos = [];
  for (const agr of cargo.agr || []) {
    for (const par of agr.par || []) {
      for (const c of par.cand || []) {
        candidatos.push({
          numero: c.n,
          nome: c.nmu || c.nm,
          nomeCompleto: c.nm,
          partido: par.sg,
          votos: num(c.vap),
          percentual: num(c.pvapn || c.pvap),
          eleito: c.e === 's',
          situacao: c.st || '',
        });
      }
    }
  }
  candidatos.sort((a, b) => b.votos - a.votos);
  const s = raw.s || {};
  const v = raw.v || {};
  const e = raw.e || {};
  return {
    abrangencia: raw.cdabr,
    atualizadoTSE: `${raw.dg || ''} ${raw.hg || ''}`.trim(),
    totalizado: raw.tf === 's',
    secoes: { total: num(s.ts), totalizadas: num(s.st), percentual: num(s.pstn || s.pst) },
    // comparecimento/abstenção referem-se às seções já totalizadas
    eleitorado: { total: num(e.te), comparecimento: num(e.c), abstencao: num(e.a),
      percentualComparecimento: num(e.pcn || e.pc), percentualAbstencao: num(e.pan || e.pa) },
    votos: { validos: num(v.vv), brancos: num(v.vb), nulos: num(v.tvn), total: num(v.tv) },
    candidatos,
  };
}

// Estado em memória: último dado válido por abrangência + ETag para requisições condicionais.
// Na Vercel ele sobrevive enquanto a instância da função estiver quente.
const cache = Object.fromEntries(ABRANGENCIAS.map((a) => [a, { etag: null, dados: null, erro: null }]));
let ultimaRodada = null;

async function buscar(abr) {
  const item = cache[abr];
  try {
    const headers = { 'User-Agent': 'apuracao-site/1.0', Accept: 'application/json' };
    if (item.etag) headers['If-None-Match'] = item.etag;
    const res = await fetch(urlArquivo(abr), { headers, signal: AbortSignal.timeout(8000) });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    item.dados = normalizar(await res.json());
    item.etag = res.headers.get('etag');
    item.erro = null;
  } catch (err) {
    item.erro = err.message; // mantém o último dado bom
  }
}

async function atualizar() {
  await Promise.all(ABRANGENCIAS.map(buscar));
  ultimaRodada = new Date().toISOString();
}

const idadeMs = () => (ultimaRodada ? Date.now() - Date.parse(ultimaRodada) : Infinity);
const falhas = () => ABRANGENCIAS.filter((a) => cache[a].erro);

function payload() {
  return {
    eleicao: { ciclo: CONFIG.ciclo, codigo: CONFIG.eleicao, cargo: 'Presidente' },
    ultimaConsulta: ultimaRodada,
    intervaloSegundos: CONFIG.intervaloMs / 1000,
    brasil: cache.br.dados,
    exterior: cache.zz.dados,
    estados: Object.fromEntries(UFS.map((uf) => [uf, cache[uf].dados])),
    falhas: falhas(),
  };
}

module.exports = { CONFIG, cache, atualizar, payload, idadeMs, falhas };
