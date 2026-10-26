// Frontend da apuração: consulta /api/apuracao periodicamente e desenha placar, mapa e tabela.
(() => {
  // Candidatos identificados pelo número de urna; A = vermelho, B = azul.
  const CAND_A = { numero: '13', rotulo: 'Lula', claro: '#f3a3ad', forte: '#a8102a' };
  const CAND_B = { numero: '22', rotulo: 'Flávio', claro: '#9dbbe6', forte: '#0f3c7a' };
  const MARGEM_MAX = 30; // pontos percentuais para atingir a cor mais forte
  const INTERVALO_PADRAO = 15;

  const IBGE_UF = { 11: 'ro', 12: 'ac', 13: 'am', 14: 'rr', 15: 'pa', 16: 'ap', 17: 'to', 21: 'ma', 22: 'pi',
    23: 'ce', 24: 'rn', 25: 'pb', 26: 'pe', 27: 'al', 28: 'se', 29: 'ba', 31: 'mg', 32: 'es', 33: 'rj', 35: 'sp',
    41: 'pr', 42: 'sc', 43: 'rs', 50: 'ms', 51: 'mt', 52: 'go', 53: 'df' };
  const NOMES = { ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará',
    df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais',
    ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco', pi: 'Piauí',
    pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia', rr: 'Roraima',
    rs: 'Rio Grande do Sul', sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins', zz: 'Exterior' };
  const REGIOES = [
    ['Norte', ['ac', 'am', 'ap', 'pa', 'ro', 'rr', 'to']],
    ['Nordeste', ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se']],
    ['Centro-Oeste', ['df', 'go', 'ms', 'mt']],
    ['Sudeste', ['es', 'mg', 'rj', 'sp']],
    ['Sul', ['pr', 'rs', 'sc']],
  ];

  const fmtInt = new Intl.NumberFormat('pt-BR');
  const fmtPct = (v, casas = 2) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
  const fmtPP = (v, casas = 1) => fmtPct(Math.abs(v), casas).replace('%', '') + ' p.p.';
  const $ = (id) => document.getElementById(id);

  let dados = null;
  let ordenacao = { campo: 'nome', asc: true };
  let ufAtiva = null;

  // ---------- Resumo de uma abrangência ----------
  function resumo(r) {
    if (!r) return null;
    const a = r.candidatos.find((c) => c.numero === CAND_A.numero) || { votos: 0, percentual: 0 };
    const b = r.candidatos.find((c) => c.numero === CAND_B.numero) || { votos: 0, percentual: 0 };
    const temVotos = a.votos + b.votos > 0;
    const margem = a.percentual - b.percentual; // > 0: A lidera
    const eleitoradoBR = dados && dados.brasil ? dados.brasil.eleitorado.total : 0;
    return { r, a, b, temVotos, margem, lider: !temVotos || margem === 0 ? null : margem > 0 ? 'a' : 'b',
      apurado: r.secoes.percentual, peso: eleitoradoBR ? (r.eleitorado.total / eleitoradoBR) * 100 : 0,
      difVotos: a.votos - b.votos, abstencao: r.eleitorado.abstencao, pctAbstencao: r.eleitorado.percentualAbstencao };
  }

  // Soma os estados de uma região num objeto com o mesmo formato de uma abrangência do TSE.
  function agregar(ufs) {
    const rs = ufs.map((uf) => dados.estados[uf]).filter(Boolean);
    if (!rs.length) return null;
    const soma = (f) => rs.reduce((t, r) => t + f(r), 0);
    const validos = soma((r) => r.votos.validos);
    const total = soma((r) => r.secoes.total), totalizadas = soma((r) => r.secoes.totalizadas);
    const cand = (numero) => {
      const votos = soma((r) => (r.candidatos.find((c) => c.numero === numero) || { votos: 0 }).votos);
      return { numero, votos, percentual: validos ? (votos / validos) * 100 : 0 };
    };
    const comparecimento = soma((r) => r.eleitorado.comparecimento), abstencao = soma((r) => r.eleitorado.abstencao);
    return { secoes: { total, totalizadas, percentual: total ? (totalizadas / total) * 100 : 0 },
      eleitorado: { total: soma((r) => r.eleitorado.total), comparecimento, abstencao,
        percentualAbstencao: comparecimento + abstencao ? (abstencao / (comparecimento + abstencao)) * 100 : 0 },
      candidatos: [cand(CAND_A.numero), cand(CAND_B.numero)] };
  }

  function corEstado(s) {
    if (!s || !s.lider) return getComputedStyle(document.documentElement).getPropertyValue('--vazio').trim();
    const c = s.lider === 'a' ? CAND_A : CAND_B;
    return d3.interpolateRgb(c.claro, c.forte)(intensidade(s));
  }
  const intensidade = (s) => 0.25 + 0.75 * Math.min(Math.abs(s.margem) / MARGEM_MAX, 1);

  // ---------- Placar nacional ----------
  function contarLiderancas() {
    const n = { a: 0, b: 0 };
    Object.values(dados.estados).forEach((r) => { const s = resumo(r); if (s && s.lider) n[s.lider]++; });
    return n;
  }

  function cartao(el, cand, info, lado, estados) {
    const c = info || { votos: 0, percentual: 0 };
    const selo = c.eleito ? '<span class="selo">ELEITO</span>' : '';
    el.innerHTML = `
      <div class="nome">${lado === 'b' ? selo : ''}${cand.rotulo}${lado === 'a' ? selo : ''}</div>
      <div class="partido">${c.partido ? c.partido + ' · ' : ''}${cand.numero}</div>
      <div class="pct">${fmtPct(c.percentual)}</div>
      <div class="votos">${fmtInt.format(c.votos)} votos</div>
      <div class="estados-lider"><b>${estados}</b> ${estados === 1 ? 'estado' : 'estados'} na frente</div>`;
  }

  function renderPlacar() {
    const s = resumo(dados.brasil);
    const lid = contarLiderancas();
    cartao($('candA'), CAND_A, s && s.a, 'a', lid.a);
    cartao($('candB'), CAND_B, s && s.b, 'b', lid.b);
    $('diferenca').innerHTML = s && s.lider
      ? `<span style="color:var(--${s.lider})">${s.lider === 'a' ? CAND_A.rotulo : CAND_B.rotulo}</span> à frente por ` +
        `<b>${fmtInt.format(Math.abs(s.difVotos))}</b> votos (${fmtPP(s.margem, 2)})`
      : s && s.temVotos ? 'Empate' : '';
    $('barraA').style.width = (s ? s.a.percentual : 0) + '%';
    $('barraB').style.width = (s ? s.b.percentual : 0) + '%';
    const br = dados.brasil;
    $('pctApurado').textContent = br ? fmtPct(br.secoes.percentual) : '—';
    $('barraApurado').style.width = (br ? br.secoes.percentual : 0) + '%';
    if (br) {
      const tv = br.votos.total || 1;
      $('detalhes').innerHTML = [
        `${fmtInt.format(br.secoes.totalizadas)} de ${fmtInt.format(br.secoes.total)} seções`,
        `Comparecimento ${fmtPct(br.eleitorado.percentualComparecimento)}`,
        `Abstenção ${fmtPct(br.eleitorado.percentualAbstencao)}`,
        `Brancos ${fmtPct((br.votos.brancos / tv) * 100)}`,
        `Nulos ${fmtPct((br.votos.nulos / tv) * 100)}`,
      ].map((t) => `<span>${t}</span>`).join('');
    }
    $('thA').textContent = CAND_A.rotulo;
    $('thB').textContent = CAND_B.rotulo;
  }

  function renderStatus() {
    const br = dados.brasil;
    const final = br && br.totalizado;
    $('aoVivo').classList.toggle('final', !!final);
    $('aoVivo').innerHTML = `<span class="ponto"></span> ${final ? 'TOTALIZADO' : 'AO VIVO'}`;
    $('atualizado').textContent = br ? `TSE: ${br.atualizadoTSE}` : 'Aguardando dados do TSE…';
  }

  // ---------- Mapa ----------
  let geo = null;
  const svg = d3.select('#mapa');
  const tooltip = $('tooltip');

  async function iniciarMapa() {
    geo = await (await fetch('br-uf.geojson')).json();
    geo.features.forEach((f) => { f.properties.uf = IBGE_UF[f.properties.codarea]; });
    const L = 600, A = 580;
    svg.attr('viewBox', `0 0 ${L} ${A}`);
    // Projeção planar: ignora a orientação dos anéis do GeoJSON do IBGE.
    const proj = d3.geoIdentity().reflectY(true).fitExtent([[8, 8], [L - 8, A - 8]], geo);
    const caminho = d3.geoPath(proj);
    svg.append('g').attr('class', 'ufs').selectAll('path').data(geo.features).join('path')
      .attr('d', caminho)
      .attr('data-uf', (d) => d.properties.uf)
      .on('pointermove', (ev, d) => mostrarTooltip(ev, d.properties.uf))
      .on('pointerleave', esconderTooltip)
      .on('click', (ev, d) => { ativar(d.properties.uf); mostrarTooltip(ev, d.properties.uf); });
    const ajuste = { df: [6, -2], rn: [4, 0], pb: [6, 0], pe: [4, 2], al: [3, 1], se: [2, 1], es: [2, 0], rj: [2, 2], sc: [2, 0] };
    svg.append('g').attr('class', 'rotulos').selectAll('text').data(geo.features).join('text')
      .attr('x', (d) => caminho.centroid(d)[0] + (ajuste[d.properties.uf] || [0, 0])[0])
      .attr('y', (d) => caminho.centroid(d)[1] + (ajuste[d.properties.uf] || [0, 0])[1])
      .text((d) => d.properties.uf.toUpperCase());
  }

  function renderMapa() {
    if (!geo) return;
    svg.selectAll('.ufs path')
      .attr('fill', (d) => corEstado(resumo(dados.estados[d.properties.uf])))
      .classed('ativo', (d) => d.properties.uf === ufAtiva);
    svg.selectAll('.rotulos text').classed('sem-dado', (d) => {
      const s = resumo(dados.estados[d.properties.uf]);
      return !s || !s.lider;
    }).style('fill', (d) => {
      const s = resumo(dados.estados[d.properties.uf]);
      return s && s.lider && intensidade(s) < 0.45 ? '#15181d' : null;
    }).style('stroke', (d) => {
      const s = resumo(dados.estados[d.properties.uf]);
      return s && s.lider && intensidade(s) < 0.45 ? 'none' : null;
    });

    const lid = contarLiderancas();
    const semVotos = 27 - lid.a - lid.b;
    $('contagem').innerHTML = `<b class="a">${CAND_A.rotulo}</b> lidera em ${lid.a} · <b class="b">${CAND_B.rotulo}</b> lidera em ${lid.b}` +
      (semVotos ? ` · ${semVotos} sem definição` : '');
  }

  function renderLegenda() {
    const grad = (c) => `linear-gradient(90deg, ${d3.interpolateRgb(c.claro, c.forte)(0.25)}, ${c.forte})`;
    $('legenda').innerHTML = `
      <span class="escala"><i style="background:${grad(CAND_A)}"></i>${CAND_A.rotulo}</span>
      <span class="escala"><i style="background:${grad(CAND_B)}"></i>${CAND_B.rotulo}</span>
      <span class="escala"><i style="background:var(--vazio);width:14px"></i>sem votos apurados</span>
      <span>Cor mais forte = vantagem maior (até ${MARGEM_MAX} p.p.)</span>`;
  }

  function mostrarTooltip(ev, uf) {
    const s = resumo(dados && dados.estados[uf]);
    const caixa = $('mapa').parentElement.getBoundingClientRect();
    tooltip.innerHTML = `<h3>${NOMES[uf]}</h3>` + (s ? `
      <div class="ap">${fmtPct(s.apurado)} das seções apuradas · peso ${fmtPct(s.peso, 1)} do eleitorado</div>
      <div class="linha a"><span>${CAND_A.rotulo}</span><b>${fmtPct(s.a.percentual)}</b></div>
      <div class="linha b"><span>${CAND_B.rotulo}</span><b>${fmtPct(s.b.percentual)}</b></div>
      <div class="mini"><div class="a" style="width:${s.a.percentual}%"></div><div class="b" style="width:${s.b.percentual}%"></div></div>
      <div class="ap">${fmtInt.format(s.a.votos)} × ${fmtInt.format(s.b.votos)} votos</div>
      <div class="ap">Diferença de ${fmtInt.format(Math.abs(s.difVotos))} votos · abstenção ${fmtPct(s.pctAbstencao, 1)}</div>` : '<div class="ap">Sem dados ainda</div>');
    tooltip.hidden = false;
    const x = ev.clientX - caixa.left, y = ev.clientY - caixa.top;
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    tooltip.style.left = Math.max(0, Math.min(x + 14, caixa.width - w)) + 'px';
    tooltip.style.top = (y + 14 + h > caixa.height ? Math.max(0, y - h - 10) : y + 14) + 'px';
  }
  const esconderTooltip = () => { tooltip.hidden = true; };

  function ativar(uf) {
    ufAtiva = ufAtiva === uf ? null : uf;
    renderMapa();
    document.querySelectorAll('#tabela tbody tr').forEach((tr) => tr.classList.toggle('ativo', tr.dataset.uf === ufAtiva));
    const tr = document.querySelector(`#tabela tbody tr[data-uf="${ufAtiva}"]`);
    if (tr && window.innerWidth > 1100) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- Tabela ----------
  function renderTabela() {
    const valor = (l) => {
      const s = l.s;
      switch (ordenacao.campo) {
        case 'peso': return s ? s.peso : -1;
        case 'apurado': return s ? s.apurado : -1;
        case 'a': return s ? s.a.percentual : -1;
        case 'b': return s ? s.b.percentual : -1;
        case 'margem': return s ? s.margem : 0;
        case 'abstencao': return s ? s.pctAbstencao : -1;
        default: return NOMES[l.uf];
      }
    };
    const ordenar = (linhas) => linhas.sort((x, y) => {
      const vx = valor(x), vy = valor(y);
      const r = typeof vx === 'string' ? vx.localeCompare(vy, 'pt-BR') : vx - vy;
      return ordenacao.asc ? r : -r;
    });
    const linha = ({ uf, s, nome, classe = '' }) => {
      const tag = `<span class="tag" style="background:${s && s.lider ? corEstado(s) : 'var(--vazio)'}"></span>`;
      const vant = s && s.lider ? `<span class="vant" style="color:var(--${s.lider})" title="${s.lider === 'a' ? CAND_A.rotulo : CAND_B.rotulo} na frente">+${fmtPP(s.margem)}<small>${fmtInt.format(Math.abs(s.difVotos))} votos</small></span>` : '—';
      const rotulo = uf ? `<span class="uf">${uf.toUpperCase()}</span><span class="nome-uf">${NOMES[uf]}</span>` : nome;
      return `<tr ${uf ? `data-uf="${uf}"` : ''} class="${classe} ${uf && uf === ufAtiva ? 'ativo' : ''}">
        <td>${tag}${rotulo}</td>
        <td class="num peso">${s ? fmtPct(s.peso, 1) : '—'}</td>
        <td class="num"><span class="ap-cel"><span class="trilho"><div style="width:${s ? s.apurado : 0}%"></div></span>${s ? fmtPct(s.apurado, 1) : '—'}</span></td>
        <td class="num ${s && s.lider === 'a' ? 'lider-a' : ''}">${s ? fmtPct(s.a.percentual) : '—'}</td>
        <td class="num ${s && s.lider === 'b' ? 'lider-b' : ''}">${s ? fmtPct(s.b.percentual) : '—'}</td>
        <td class="num">${vant}</td>
        <td class="num abst">${s && s.temVotos ? fmtPct(s.pctAbstencao, 1) : '—'}</td></tr>`;
    };
    let html = REGIOES.map(([nome, ufs]) =>
      linha({ nome, s: resumo(agregar(ufs)), classe: 'regiao' }) +
      ordenar(ufs.map((uf) => ({ uf, s: resumo(dados.estados[uf]) }))).map(linha).join('')).join('');
    if (dados.exterior) html += linha({ uf: 'zz', s: resumo(dados.exterior), classe: 'regiao exterior' });
    document.querySelector('#tabela tbody').innerHTML = html;
    document.querySelectorAll('#tabela th').forEach((th) => {
      th.classList.toggle('ord', th.dataset.ord === ordenacao.campo);
      th.classList.toggle('asc', th.dataset.ord === ordenacao.campo && ordenacao.asc);
    });
  }

  document.querySelector('#tabela thead').addEventListener('click', (ev) => {
    const th = ev.target.closest('th');
    if (!th) return;
    const campo = th.dataset.ord;
    ordenacao = { campo, asc: ordenacao.campo === campo ? !ordenacao.asc : campo === 'nome' };
    renderTabela();
  });
  document.querySelector('#tabela tbody').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr');
    if (tr && tr.dataset.uf && tr.dataset.uf !== 'zz') ativar(tr.dataset.uf);
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('#mapa')) esconderTooltip(); });

  // ---------- Contribuição de estados e regiões ----------
  // Tons suaves das cores usuais dos mapas escolares de regiões do IBGE
  const CORES_REGIAO = { Norte: '#9bb89f', Nordeste: '#e3cd8e', 'Centro-Oeste': '#dbb08a', Sudeste: '#d1a6a1',
    Sul: '#a9abcb', Exterior: '#c9ccd1' };
  const fmtMi = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (a / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' mi';
    return a >= 1e4 ? Math.round(a / 1e3).toLocaleString('pt-BR') + ' mil' : fmtInt.format(a);
  };
  const ladoDe = (saldo) => (saldo > 0 ? 'a' : saldo < 0 ? 'b' : null);
  const nomeLado = (l) => (l === 'a' ? CAND_A.rotulo : CAND_B.rotulo);
  const votosDe = (r) => {
    const s = resumo(r);
    return s ? { a: s.a.votos, b: s.b.votos, saldo: s.difVotos } : { a: 0, b: 0, saldo: 0 };
  };

  // Uma linha de barra horizontal de ini até fim, numa escala dom = [mín, máx] com o zero marcado.
  function linhaBarra({ rotulo, titulo, ini, fim, dom, valor, classe = '' }) {
    const pos = (v) => ((v - dom[0]) / (dom[1] - dom[0])) * 100;
    const l = ladoDe(valor);
    const esq = pos(Math.min(ini, fim));
    const larg = Math.max(pos(Math.max(ini, fim)) - esq, 0.4);
    return `<div class="cb-linha ${classe}" title="${titulo}">
      <span class="cb-rotulo">${rotulo}</span>
      <span class="cb-trilho"><i class="cb-zero" style="left:${pos(0)}%"></i><i class="cb-barra" style="left:${esq}%;width:${larg}%;background:var(--${l || 'vazio'})"></i></span>
      <span class="cb-valor" style="color:var(--${l || 'suave'})">${l ? '+' : ''}${fmtMi(valor)}</span></div>`;
  }

  function renderContribuicao() {
    const br = votosDe(dados.brasil);
    const regioes = REGIOES.map(([nome, ufs]) => {
      const ag = agregar(ufs);
      return { nome, eleitorado: ag ? ag.eleitorado.total : 0, ...votosDe(ag) };
    });
    if (dados.exterior) regioes.push({ nome: 'Exterior', eleitorado: dados.exterior.eleitorado.total, ...votosDe(dados.exterior) });
    const estados = Object.keys(dados.estados).map((uf) => ({ uf, ...votosDe(dados.estados[uf]) }));
    if (dados.exterior) estados.push({ uf: 'zz', ...votosDe(dados.exterior) });
    const detalhe = (nome, v) => `${nome}: ${CAND_A.rotulo} ${fmtInt.format(v.a)} × ${CAND_B.rotulo} ${fmtInt.format(v.b)}` +
      (br.saldo ? ` · ${fmtPct((v.saldo / br.saldo) * 100, 1)} da margem nacional` : '');

    // Resumo em texto
    const lid = ladoDe(br.saldo);
    if (!lid) {
      $('contribResumo').textContent = br.a + br.b ? 'Empate na soma nacional.' : 'Aguardando votos apurados.';
    } else {
      const outro = lid === 'a' ? 'b' : 'a';
      const sinal = lid === 'a' ? 1 : -1;
      const pelo = (lista, s) => [...lista].sort((x, y) => s * (y.saldo - x.saldo))[0];
      const top = pelo(regioes, sinal);
      const resto = br.saldo - top.saldo;
      const ufLid = pelo(estados, sinal), ufOutro = pelo(estados, -sinal);
      const nac = resumo(dados.brasil);
      const parte = (v) => `${fmtPct((v / br.saldo) * 100, 0)} da margem`;
      const item = (rotulo, v, nota) => `<div class="cr-item"><span class="cr-rot">${rotulo}</span>` +
        `<span class="cr-val" style="color:var(--${ladoDe(v)})">+${fmtMi(v)}</span><span class="cr-nota">${nota}</span></div>`;
      const vezes = (top.saldo / br.saldo).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      const itens = [item(top.nome, top.saldo, `para ${nomeLado(lid)} · ` +
        (Math.abs(top.saldo) > Math.abs(br.saldo) ? `${vezes} vezes a margem final` : parte(top.saldo)))];
      if (resto) itens.push(item('Demais regiões somadas', resto, `para ${nomeLado(ladoDe(resto))}`));
      itens.push(item(NOMES[ufLid.uf], ufLid.saldo, `maior saldo de ${nomeLado(lid)} · ${parte(ufLid.saldo)}`));
      if (ladoDe(ufOutro.saldo) === outro) itens.push(item(NOMES[ufOutro.uf], ufOutro.saldo, `maior saldo de ${nomeLado(outro)}`));
      $('contribResumo').innerHTML =
        `<p class="cr-lead"><b style="color:var(--${lid})">${nomeLado(lid)}</b> ${dados.brasil.totalizado ? 'venceu' : 'lidera'} por ` +
        `<b>${fmtInt.format(Math.abs(br.saldo))}</b> votos (${fmtPct(nac[lid].percentual)} a ${fmtPct(nac[outro].percentual)} dos válidos). ` +
        `Veja de onde veio essa diferença:</p><div class="cr-itens">${itens.join('')}</div>`;
    }

    // Ponte: saldo de cada região somado até o resultado nacional
    const passos = [...regioes].sort((x, y) => y.saldo - x.saldo);
    let acc = 0;
    const ponte = passos.map((r) => { const ini = acc; acc += r.saldo; return { r, ini, fim: acc }; });
    const ext = [0, ...ponte.flatMap((p) => [p.ini, p.fim])];
    const dom = [Math.min(...ext), Math.max(...ext)];
    if (dom[0] === dom[1]) dom[1] = dom[0] + 1;
    $('ponte').innerHTML = ponte.map(({ r, ini, fim }) =>
      linhaBarra({ rotulo: r.nome, titulo: detalhe(r.nome, r), ini, fim, dom, valor: r.saldo })).join('') +
      linhaBarra({ rotulo: 'Resultado', titulo: detalhe('Brasil', br), ini: 0, fim: acc, dom, valor: acc, classe: 'total' });

    // Composição dos votos de cada candidato por região, comparada ao eleitorado
    const totE = regioes.reduce((t, r) => t + r.eleitorado, 0);
    const pilha = (rotulo, campo, total) => `<div class="cb-pilha"><div class="cb-pilha-rot">${rotulo}</div><div class="cb-pilha-barra">` +
      regioes.map((r) => {
        const p = total ? (r[campo] / total) * 100 : 0;
        return `<i style="width:${p}%;background:${CORES_REGIAO[r.nome]}" title="${r.nome}: ${fmtPct(p, 1)}">${p >= 8 ? fmtPct(p, 0) : ''}</i>`;
      }).join('') + '</div></div>';
    $('origem').innerHTML = pilha(`Votos de ${CAND_A.rotulo}`, 'a', br.a) + pilha(`Votos de ${CAND_B.rotulo}`, 'b', br.b) +
      pilha('Eleitorado (peso)', 'eleitorado', totE);
    $('origemLegenda').innerHTML = regioes.map((r) => `<span><i style="background:${CORES_REGIAO[r.nome]}"></i>${r.nome}</span>`).join('');

    // Saldo de cada estado: primeiro os de A, depois os de B, cada grupo do maior para o menor saldo
    const grupo = (e) => (e.saldo > 0 ? 0 : e.saldo < 0 ? 1 : 2);
    estados.sort((x, y) => grupo(x) - grupo(y) || Math.abs(y.saldo) - Math.abs(x.saldo));
    const dom2 = [0, Math.max(1, ...estados.map((e) => Math.abs(e.saldo)))];
    $('saldoEstados').innerHTML = estados.map((e) => linhaBarra({
      rotulo: `<span class="uf">${e.uf === 'zz' ? 'EXT' : e.uf.toUpperCase()}</span><span class="nome-uf">${NOMES[e.uf]}</span>`,
      titulo: detalhe(NOMES[e.uf], e), ini: 0, fim: Math.abs(e.saldo), dom: dom2, valor: e.saldo,
    })).join('');
  }

  // ---------- Ciclo de atualização ----------
  async function atualizar() {
    let intervalo = INTERVALO_PADRAO;
    try {
      const res = await fetch('/api/apuracao', { cache: 'no-store' });
      dados = await res.json();
      intervalo = dados.intervaloSegundos || INTERVALO_PADRAO;
      renderStatus(); renderPlacar(); renderMapa(); renderTabela(); renderContribuicao();
    } catch (err) {
      $('atualizado').textContent = 'Falha ao atualizar — tentando de novo…';
    }
    setTimeout(atualizar, intervalo * 1000);
  }

  // ---------- Consentimento de cookies (Google Consent Mode v2) ----------
  const CHAVE_CONSENT = 'consentimento-analytics'; // mesma chave lida no <head> do index.html
  const banner = $('cookies');
  let consentimento = null;
  try { consentimento = localStorage.getItem(CHAVE_CONSENT); } catch (e) { /* armazenamento bloqueado */ }
  if (!consentimento) banner.hidden = false;
  banner.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-consent]');
    if (!botao) return;
    const valor = botao.dataset.consent;
    try { localStorage.setItem(CHAVE_CONSENT, valor); } catch (e) { /* vale só nesta visita */ }
    if (window.gtag) gtag('consent', 'update', { analytics_storage: valor === 'aceito' ? 'granted' : 'denied' });
    banner.hidden = true;
  });
  $('prefCookies').addEventListener('click', () => { banner.hidden = false; });

  renderLegenda();
  iniciarMapa().then(() => dados && renderMapa());
  atualizar();
})();
