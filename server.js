// Servidor local da apuração: consulta o TSE em segundo plano (lib/tse.js) e serve
// /api/apuracao + arquivos estáticos de ./public. Sem dependências (Node 20+).
// Em produção (Vercel) o mesmo endpoint é atendido por api/apuracao.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const tse = require('./lib/tse');

const PORTA = Number(process.env.PORT) || 3000;

async function rodada() {
  await tse.atualizar();
  const br = tse.cache.br.dados;
  const falhas = tse.falhas();
  console.log(`[${new Date().toISOString()}] br ${br ? br.secoes.percentual.toFixed(2) + '%' : '—'}` +
    (falhas.length ? ` | falhas: ${falhas.map((a) => `${a}(${tse.cache[a].erro})`).join(', ')}` : ''));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.geojson': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/apuracao') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(tse.payload()));
  }
  const arquivo = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!arquivo.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream' });
    res.end(conteudo);
  });
});

rodada().finally(() => {
  setInterval(rodada, tse.CONFIG.intervaloMs);
  server.listen(PORTA, () => {
    console.log(`Apuração ${tse.CONFIG.ciclo}/${tse.CONFIG.eleicao} em http://localhost:${PORTA}`);
  });
});
