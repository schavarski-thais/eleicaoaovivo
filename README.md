![Eleição ao Vivo](docs/eleicaoaovivo.png)

# Eleição ao Vivo · Presidente 2026

Apuração em tempo real do 2º turno presidencial de 2026 com dados oficiais do TSE.

**No ar:** https://eleicao-ao-vivo.vercel.app

- Mapa por estado: vermelho onde Lula lidera, azul onde Flávio lidera; quanto mais forte a cor, maior a vantagem.
- Placar nacional com percentuais, votos, diferença em votos, quantos estados cada um lidera,
  seções apuradas, comparecimento, abstenção, brancos e nulos.
- Tabela agrupada por região com peso de cada estado no eleitorado, % apurado, % de cada candidato,
  vantagem (p.p. e votos) e abstenção — ordenável por qualquer coluna.
- "De onde veio o resultado": saldo de votos de cada região somado até a margem nacional, composição dos
  votos de cada candidato por região comparada ao eleitorado, e saldo de cada estado.
- Atualiza sozinho a cada 15 segundos; funciona no celular e em modo escuro.

## Rodar localmente

```bash
npm start            # http://localhost:3000
```

Sem dependências — só Node 20+. `npm run teste-1turno` sobe o site com o resultado final do 1º turno.

## Estrutura

```
lib/tse.js         busca e normaliza os JSONs do TSE (compartilhado)
server.js          servidor local: consulta o TSE em segundo plano + arquivos estáticos
api/apuracao.js    a mesma API como função serverless da Vercel
public/            front-end (HTML, CSS, JS com d3 e malha de UFs do IBGE)
```

## Como funciona

- O TSE publica um JSON por abrangência (`br`, 27 UFs e `zz` = exterior):
  `https://resultados.tse.jus.br/oficial/ele2026/6258/dados/{uf}/{uf}-c0001-e006258-u.json`
- Os códigos das eleições vêm de `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`
  (6257 = 1º turno federal, 6258 = 2º turno federal).
- O TSE não envia cabeçalho CORS, então o navegador consulta `/api/apuracao`, que busca no TSE com
  `If-None-Match` (arquivos sem mudança não são baixados de novo) e guarda o último dado válido.
- Mapa: malha de UFs da API de malhas do IBGE (`public/br-uf.geojson`).

## Configuração (variáveis de ambiente)

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta HTTP (servidor local) |
| `TSE_ELEICAO` | `6258` | Código da eleição (`6257` = 1º turno, útil para testes) |
| `TSE_CICLO` | `ele2026` | Ciclo eleitoral |
| `INTERVALO_S` | `15` | Intervalo de consulta ao TSE em segundos |

Números e cores dos candidatos ficam no topo de `public/app.js` (`CAND_A` / `CAND_B`).

## Publicar (Vercel)

```bash
npx vercel deploy --prod --yes
```

`/api/apuracao` roda como função em São Paulo (`gru1`, definido em `vercel.json`) — o TSE pode bloquear
IPs estrangeiros, então mantenha a região no Brasil. A CDN guarda a resposta por 15s.

## Analytics

Google Analytics 4 com Consent Mode v2: nenhum cookie é gravado até o visitante aceitar no banner, e
sinais de anúncios ficam sempre negados. Para usar sua própria propriedade, troque o ID `G-…` em
`public/index.html`.

## Licença

MIT. Dados: [Tribunal Superior Eleitoral](https://resultados.tse.jus.br).
