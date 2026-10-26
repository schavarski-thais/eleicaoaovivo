// Função serverless (Vercel). A CDN guarda a resposta por 15s, então o TSE recebe
// no máximo uma rodada de consultas a cada ~15s por região, independente do número de visitantes.
const tse = require('../lib/tse');

module.exports = async (req, res) => {
  if (tse.idadeMs() > 10000) await tse.atualizar();
  const corpo = tse.payload();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Sem nenhum dado (TSE fora do ar/bloqueado) não deixa a CDN guardar a resposta vazia.
  res.setHeader('Cache-Control', corpo.brasil
    ? 'public, max-age=5, s-maxage=15, stale-while-revalidate=30'
    : 'no-store');
  res.status(200).send(JSON.stringify(corpo));
};
