const LIMIAR_RUPTURA = 2;
const LIMIAR_CRITICO = 5;

const state = {
  grupos: [],
  config: null,
  busca: "",
  ordem: "menor",
  riscoFiltro: "rupture",
  heatmapModo: "produto",
  aba: "painel",
  todosProdutos: [],
  todosCarregado: false,
  buscaProdutos: "",
  ordemProdutos: "menor",
  localizacao: {
    rua: "",
    prateleira: "",
    caixa: "",
    corredorRua: "",
    modo: "geral"
  },
  filtrosColuna: {},
  timer: null
};

const $ = selector => document.querySelector(selector);

const el = {
  setupScreen: $("#setup-screen"),
  setupForm: $("#setup-form"),
  setupMessage: $("#setup-message"),
  setupPath: $("#setup-planilha-path"),
  setupIntervalo: $("#setup-intervalo-minutos"),
  setupLimite: $("#setup-limite-disponivel"),
  setupCapacidadeCaixa: $("#setup-capacidade-caixa"),
  setupExcel: $("#setup-atualizar-excel-antes"),
  openSetup: $("#open-setup"),
  reportPdf: $("#report-pdf"),
  printReport: $("#print-report"),
  refresh: $("#refresh"),
  refreshExcel: $("#refresh-excel"),
  syncState: $("#sync-state"),
  lastUpdate: $("#last-update"),
  fileUpdate: $("#file-update"),
  heroTitle: $("#hero-title"),
  heroPrioridade: $("#hero-prioridade"),
  heroBriefing: $("#hero-briefing"),
  gaugeNumber: $("#gauge-number"),
  riskStack: $("#risk-stack"),
  ruptura: $("#m-ruptura"),
  rupturaDesc: $("#m-ruptura-desc"),
  critico: $("#m-critico"),
  criticoDesc: $("#m-critico-desc"),
  atencao: $("#m-atencao"),
  atencaoDesc: $("#m-atencao-desc"),
  itens: $("#m-itens"),
  total: $("#m-total"),
  hotlist: $("#hotlist"),
  heatmap: $("#heatmap"),
  heatmapEnderecos: $("#heatmap-enderecos"),
  heatModoProduto: $("#heat-modo-produto"),
  heatModoEndereco: $("#heat-modo-endereco"),
  addressChart: $("#address-chart"),
  colorChart: $("#color-chart"),
  gradeChart: $("#grade-chart"),
  filterSummary: $("#filter-summary"),
  configForm: $("#config-form"),
  configMessage: $("#config-message"),
  planilhaPath: $("#planilha-path"),
  intervaloMinutos: $("#intervalo-minutos"),
  limiteDisponivel: $("#limite-disponivel"),
  capacidadeCaixa: $("#capacidade-caixa"),
  atualizarExcelAntes: $("#atualizar-excel-antes"),
  search: $("#search"),
  sort: $("#sort"),
  status: $("#status"),
  groups: $("#groups"),
  tabPainel: $("#tab-painel"),
  tabProdutos: $("#tab-produtos"),
  tabLocalizacao: $("#tab-localizacao"),
  viewPainel: $("#view-painel"),
  viewProdutos: $("#view-produtos"),
  viewLocalizacao: $("#view-localizacao"),
  produtosTotal: $("#produtos-total"),
  produtosTbody: $("#produtos-tbody"),
  searchProdutos: $("#search-produtos"),
  sortProdutos: $("#sort-produtos"),
  localRua: $("#local-rua"),
  localPrateleira: $("#local-prateleira"),
  localCaixa: $("#local-caixa"),
  localCorridorRua: $("#local-corridor-rua"),
  localCapacidadeCaixa: $("#local-capacidade-caixa"),
  localVoltarGeral: $("#local-voltar-geral"),
  localLimpar: $("#local-limpar"),
  localizacaoTotal: $("#localizacao-total"),
  localizacaoResumo: $("#localizacao-resumo"),
  localizacaoCorridor: $("#localizacao-corridor"),
  localizacaoLista: $("#localizacao-lista"),
  localizacaoRankingLista: $("#localizacao-ranking-lista"),
  localizacaoRuasLista: $("#localizacao-ruas-lista")
};

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));
}

function txt(valor) {
  return String(valor ?? "").trim();
}

function tempoRelativo(iso) {
  if (!iso) return "-";
  const diffS = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffS < 60) return `${diffS}s`;
  const diffMin = Math.round(diffS / 60);
  if (diffMin < 60) return `${diffMin} min`;
  return `${Math.round(diffMin / 60)} h`;
}

function fmtData(iso) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function riscoGrupo(grupo) {
  if (grupo.menorDisponivel <= LIMIAR_RUPTURA) return { nivel: "rupture", label: "Acabando agora", peso: 3 };
  if (grupo.menorDisponivel <= LIMIAR_CRITICO) return { nivel: "critical", label: "Crítico", peso: 2 };
  return { nivel: "attention", label: "Baixo", peso: 1 };
}

function contarPorRisco(grupos) {
  const contagem = { rupture: 0, critical: 0, attention: 0 };
  for (const grupo of grupos) contagem[riscoGrupo(grupo).nivel] += 1;
  return contagem;
}

function todosItens(grupos) {
  return grupos.flatMap(grupo => grupo.itens || []);
}

function gruposPrioridade(base = state.grupos) {
  return [...base].sort((a, b) => {
    const riscoA = riscoGrupo(a);
    const riscoB = riscoGrupo(b);
    return riscoB.peso - riscoA.peso ||
      a.menorDisponivel - b.menorDisponivel ||
      b.caixas - a.caixas ||
      a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true });
  });
}

function topMapa(itens, chave, limite = 6) {
  const mapa = new Map();
  for (const item of itens) mapa.set(item[chave] || "-", (mapa.get(item[chave] || "-") || 0) + 1);
  return Array.from(mapa.entries())
    .map(([label, valor]) => ({ label, valor }))
    .sort((a, b) => b.valor - a.valor || a.label.localeCompare(b.label, "pt-BR", { numeric: true }))
    .slice(0, limite);
}

function renderStack(contagem) {
  const total = Math.max(state.grupos.length, 1);
  el.riskStack.innerHTML = [["rupture", contagem.rupture], ["critical", contagem.critical], ["attention", contagem.attention]]
    .map(([nivel, valor]) => `<i class="${nivel}" style="width:${Math.max(valor ? 4 : 0, Math.round((valor / total) * 100))}%"></i>`)
    .join("");
}

function corCalor(qtd, limite) {
  const clamped = Math.max(0, Math.min(limite, qtd));
  const t = limite > 0 ? clamped / limite : 0;
  const lerp = (a, b, f) => Math.round(a + (b - a) * f);
  let r, g, b;
  if (t < 0.5) {
    const f = t / 0.5;
    r = lerp(143, 245, f); g = lerp(7, 158, f); b = lerp(21, 11, f);
  } else {
    const f = (t - 0.5) / 0.5;
    r = lerp(245, 34, f); g = lerp(158, 197, f); b = lerp(11, 94, f);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

function renderHeatmap() {
  const ordenado = gruposPrioridade(gruposFiltrados());
  const limite = state.config?.limiteDisponivel || 10;
  el.heatmap.innerHTML = ordenado.map(grupo => {
    const negativo = grupo.menorDisponivel < 0;
    const cor = corCalor(grupo.menorDisponivel, limite);
    const pior = enderecosComQtd(grupo)[0];
    const piorItem = pior ? grupo.itens.find(item => item.endereco === pior.endereco) : null;
    const outrosEnderecos = (grupo.enderecos || []).length - (pior ? 1 : 0);
    return `
      <button class="heat-tile${negativo ? " neg" : ""}" type="button" style="background:${cor}" data-prodcor-link="${esc(grupo.prodcor)}" title="${esc(grupo.prodcor)} — ${esc(grupo.descProduto)} — menor disponível ${esc(grupo.menorDisponivel)} em ${pior ? esc(pior.endereco) : "endereço não informado"}${piorItem?.caixa ? `, caixa ${esc(piorItem.caixa)}` : ""}">
        <strong>${esc(grupo.prodcor)}</strong>
        ${pior ? `<em>${PIN_SVG}${esc(pior.endereco)}</em>` : ""}
        ${piorItem?.caixa ? `<small class="heat-caixa">Caixa ${esc(piorItem.caixa)}</small>` : ""}
        ${outrosEnderecos > 0 ? `<span class="heat-extra">+${outrosEnderecos} endereço${outrosEnderecos === 1 ? "" : "s"}</span>` : ""}
        <b>${esc(grupo.menorDisponivel)}</b>
      </button>
    `;
  }).join("");
}

const RE_ENDERECO = /^E4AC(\d{2})P(\d{2})L(\d{4})$/;

function parseEndereco(endereco) {
  const raw = txt(endereco);
  const match = /^E(?<zona>\d+)(?<rua>AC\d{2})P(?<prateleira>\d{2})L(?<coluna>\d{4})$/.exec(raw);
  if (!match?.groups) {
    return { raw, valido: false };
  }

  const prateleira = Number(match.groups.prateleira);
  const paridade = Number.isFinite(prateleira) && prateleira % 2 === 0 ? "par" : "ímpar";
  const colunaRaw = match.groups.coluna;
  const colunaBase = colunaRaw.slice(0, 2);
  const colunaAltura = Number(colunaBase);
  const colunaNivel = Number.isFinite(colunaAltura) ? Math.max(1, Math.min(5, Math.round(colunaAltura / 10))) : 0;
  const colunaFaixa = {
    10: "embaixo",
    20: "no meio",
    50: "na altura da cabeça"
  }[colunaAltura] || "na coluna";
  const colunaOrdem = {
    10: 1,
    20: 2,
    50: 3
  }[colunaAltura] || colunaAltura || 0;

  return {
    raw,
    valido: true,
    zona: `E${match.groups.zona}`,
    rua: match.groups.rua,
    prateleira: match.groups.prateleira,
    paridade,
    coluna: `L${colunaRaw}`,
    colunaBase: `L${colunaBase}`,
    colunaAltura,
    colunaNivel,
    colunaFaixa,
    colunaOrdem
  };
}

function enderecoResumoTexto(endereco) {
  const info = parseEndereco(endereco);
  if (!info.valido) return info.raw || "-";
  return `${info.raw} | ${info.zona} | Rua ${info.rua} | Prateleira ${info.prateleira} ${info.paridade} | Coluna ${info.coluna} (${info.colunaBase} ${info.colunaFaixa})`;
}

function renderEnderecoDetalhado(endereco) {
  const info = parseEndereco(endereco);
  if (!info.valido) {
    return `<span class="addr-raw">${esc(info.raw || "-")}</span>`;
  }

  return `
    <span class="addr-raw">${esc(info.raw)}</span>
    <span class="addr-meta">${esc(info.zona)} · Rua ${esc(info.rua)} · P${esc(info.prateleira)} ${esc(info.paridade)} · Coluna ${esc(info.coluna)} (${esc(info.colunaBase)} ${esc(info.colunaFaixa)})</span>
  `;
}

function ruaFiltroAtivo() {
  return txt(state.localizacao.rua).toUpperCase();
}

function prateleiraFiltroAtivo() {
  const valor = txt(state.localizacao.prateleira).replace(/\D/g, "");
  return valor ? String(Number(valor)).padStart(2, "0") : "";
}

function caixaFiltroAtivo() {
  return txt(state.localizacao.caixa).toUpperCase();
}

function itemPassaFiltroLocalizacao(item) {
  const info = parseEndereco(item.endereco);
  const rua = ruaFiltroAtivo();
  const prateleira = prateleiraFiltroAtivo();
  const caixa = caixaFiltroAtivo();

  if (rua && (!info.valido || info.rua.toUpperCase() !== rua)) return false;
  if (prateleira && (!info.valido || info.prateleira !== prateleira)) return false;
  if (caixa && !txt(item.caixa).toUpperCase().includes(caixa)) return false;
  return true;
}

function recomporGrupo(grupo, itens) {
  const tamanhos = new Set();
  const grades = new Set();
  const enderecos = new Set();
  let menorDisponivel = Infinity;
  let totalDisponivel = 0;

  for (const item of itens) {
    menorDisponivel = Math.min(menorDisponivel, item.quantidadeDisponivel);
    totalDisponivel += item.quantidadeDisponivel;
    if (item.tamanho) tamanhos.add(item.tamanho);
    if (item.grade) grades.add(item.grade);
    if (item.endereco) enderecos.add(item.endereco);
  }

  return {
    ...grupo,
    itens,
    caixas: itens.length,
    menorDisponivel: itens.length ? menorDisponivel : 0,
    totalDisponivel,
    tamanhos: Array.from(tamanhos).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
    grades: Array.from(grades).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
    enderecos: Array.from(enderecos).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
  };
}

function filtrosLocaisAtivos() {
  return Boolean(ruaFiltroAtivo() || prateleiraFiltroAtivo() || caixaFiltroAtivo());
}

function itensFiltradosPorLocalizacao(itens) {
  return itens.filter(itemPassaFiltroLocalizacao);
}

function itensDoCorredorEmFoco(itens, ruaSelecionada) {
  const prateleira = prateleiraFiltroAtivo();
  const caixa = caixaFiltroAtivo();

  return itens.filter(item => {
    const info = parseEndereco(item.endereco);
    if (!info.valido || info.rua !== ruaSelecionada) return false;
    if (prateleira && info.prateleira !== prateleira) return false;
    if (caixa && !txt(item.caixa).toUpperCase().includes(caixa)) return false;
    return true;
  });
}

function enderecosGlobais(itensBase = todosItens(state.grupos)) {
  const mapa = new Map();
  for (const item of itensBase) {
    const atual = mapa.get(item.endereco);
    if (!atual || item.quantidadeDisponivel < atual.qtd) {
      mapa.set(item.endereco, {
        endereco: item.endereco,
        qtd: item.quantidadeDisponivel,
        prodcor: item.prodcor,
        caixa: item.caixa,
        descProduto: item.descProduto
      });
    }
  }
  return Array.from(mapa.values());
}

function renderHeatmapEnderecos() {
  const limite = state.config?.limiteDisponivel || 10;
  const porModulo = new Map();
  for (const item of enderecosGlobais(todosItens(gruposFiltrados()))) {
    const info = parseEndereco(item.endereco);
    const modulo = info.valido ? info.rua : "Outros";
    const posicao = info.valido ? Number((info.rua || "").replace(/^AC/, "")) : 0;
    const nivel = info.valido ? Number(info.prateleira) : 0;
    if (!porModulo.has(modulo)) porModulo.set(modulo, []);
    porModulo.get(modulo).push({ ...item, info, posicao, nivel });
  }

  const modulos = Array.from(porModulo.keys()).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  el.heatmapEnderecos.innerHTML = modulos.map(modulo => {
    const fileira = porModulo.get(modulo).sort((a, b) => a.posicao - b.posicao || a.nivel - b.nivel);
    const tiles = fileira.map(item => {
      const cor = corCalor(item.qtd, limite);
      const metaEndereco = item.info.valido
        ? `${item.info.zona} · ${item.info.rua} · P${item.info.prateleira} ${item.info.paridade} · ${item.info.coluna}`
        : item.endereco;
      const metaCaixa = item.caixa ? `Caixa ${item.caixa}` : "Caixa não informada";
      return `
        <button class="heat-tile" type="button" style="background:${cor}" data-prodcor-link="${esc(item.prodcor)}" data-endereco-link="${esc(item.endereco)}" title="${esc(enderecoResumoTexto(item.endereco))} — ${esc(metaCaixa)} — ${esc(item.prodcor)} ${esc(item.descProduto)} — disponível ${esc(item.qtd)}">
          <strong class="tile-prodcor">${esc(item.prodcor)}</strong>
          <em>${PIN_SVG}${esc(item.endereco)}</em>
          <span class="tile-meta">${esc(metaEndereco)}</span>
          <span class="tile-box">${esc(metaCaixa)}</span>
          <b>${esc(item.qtd)}</b>
        </button>
      `;
    }).join("");
    return `
      <div class="fileira">
        <span class="fileira-label">Rua ${esc(modulo)}</span>
        <div class="fileira-tiles">${tiles}</div>
      </div>
    `;
  }).join("");
}

function trocarModoHeatmap(modo) {
  state.heatmapModo = modo;
  el.heatModoProduto.classList.toggle("active", modo === "produto");
  el.heatModoEndereco.classList.toggle("active", modo === "endereco");
  el.heatmap.hidden = modo !== "produto";
  el.heatmapEnderecos.hidden = modo !== "endereco";
  if (modo === "endereco") renderHeatmapEnderecos();
}

function renderHotlist() {
  const base = gruposFiltrados();
  const top = gruposPrioridade(base).filter(grupo => riscoGrupo(grupo).nivel === "rupture").slice(0, 10);
  const fallback = top.length ? top : gruposPrioridade(base).slice(0, 8);
  el.hotlist.innerHTML = fallback.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    const enderecosQtd = enderecosComQtd(grupo);
    return `
      <button class="hot-item ${risco.nivel}" type="button" data-prodcor-link="${esc(grupo.prodcor)}">
        <span class="hot-index">${index + 1}</span>
        <span class="hot-main">
          <span class="hot-line"><strong>${esc(grupo.prodcor)}</strong><em>${esc(risco.label)}</em></span>
          <span class="hot-desc">${esc(grupo.descProduto)}</span>
          <span class="addr-chips hot-chips">${renderAddrChips(enderecosQtd)}</span>
          <span class="hot-meta">Tam ${esc((grupo.tamanhos || []).join(", ") || "-")} · Grade ${esc((grupo.grades || []).join(", ") || "-")}</span>
        </span>
        <span class="hot-number"><b>${esc(grupo.menorDisponivel)}</b><small>disp. mínima</small></span>
      </button>
    `;
  }).join("");
}

function renderBars(container, dados) {
  if (!dados.length) {
    container.innerHTML = `<div class="empty-chart">Sem ocorrências nesta faixa</div>`;
    return;
  }
  const maior = Math.max(...dados.map(item => item.valor), 1);
  container.innerHTML = dados.map(item => `
    <button class="bar-row" type="button" data-search="${esc(item.label)}" title="${esc(item.label)}">
      <span>${esc(item.label)}</span>
      <i><b style="width:${Math.max(8, Math.round((item.valor / maior) * 100))}%"></b></i>
      <strong>${esc(item.valor)}</strong>
    </button>
  `).join("");
}

function textoBusca(grupo) {
  return [grupo.prodcor, grupo.produto, grupo.descProduto, grupo.cor, ...(grupo.tamanhos || []), ...(grupo.grades || []), ...(grupo.enderecos || []), ...(grupo.itens || []).flatMap(item => [item.endereco, item.caixa, item.tamanho, item.grade])].join(" ").toUpperCase();
}

function gruposFiltrados() {
  const termo = state.busca.trim().toUpperCase();
  const porBusca = termo ? state.grupos.filter(grupo => textoBusca(grupo).includes(termo)) : [...state.grupos];
  const porLocalizacao = porBusca
    .map(grupo => recomporGrupo(grupo, itensFiltradosPorLocalizacao(grupo.itens || [])))
    .filter(grupo => grupo.itens.length);
  const porRisco = state.riscoFiltro === "all" ? porLocalizacao : porLocalizacao.filter(grupo => riscoGrupo(grupo).nivel === state.riscoFiltro);
  return porRisco.sort((a, b) => {
    const riscoA = riscoGrupo(a);
    const riscoB = riscoGrupo(b);
    if (state.ordem === "prodcor") return a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true });
    if (state.ordem === "caixas") return b.caixas - a.caixas || riscoB.peso - riscoA.peso;
    return riscoB.peso - riscoA.peso || a.menorDisponivel - b.menorDisponivel || a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true });
  });
}

function gruposParaRanking() {
  const termo = state.busca.trim().toUpperCase();
  const porBusca = termo ? state.grupos.filter(grupo => textoBusca(grupo).includes(termo)) : [...state.grupos];
  return state.riscoFiltro === "all" ? porBusca : porBusca.filter(grupo => riscoGrupo(grupo).nivel === state.riscoFiltro);
}

function gruposVisiveisBase() {
  const termo = state.busca.trim().toUpperCase();
  const porBusca = termo ? state.grupos.filter(grupo => textoBusca(grupo).includes(termo)) : [...state.grupos];
  return porBusca
    .map(grupo => recomporGrupo(grupo, itensFiltradosPorLocalizacao(grupo.itens || [])))
    .filter(grupo => grupo.itens.length);
}

function enderecosComQtd(grupo) {
  const mapa = new Map();
  for (const item of grupo.itens || []) {
    const atual = mapa.get(item.endereco);
    if (atual === undefined || item.quantidadeDisponivel < atual) mapa.set(item.endereco, item.quantidadeDisponivel);
  }
  return Array.from(mapa.entries())
    .map(([endereco, qtd]) => ({ endereco, qtd }))
    .sort((a, b) => a.qtd - b.qtd || a.endereco.localeCompare(b.endereco, "pt-BR", { numeric: true }));
}

function nivelQtd(qtd) {
  if (qtd <= 2) return "rupture";
  if (qtd <= 5) return "critical";
  return "attention";
}

const PIN_SVG = `<svg class="pin" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M12 2c-4 0-7 3-7 7 0 5.2 6.1 12 6.4 12.3.3.3.9.3 1.2 0C12.9 21 19 14.2 19 9c0-4-3-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>`;

function renderAddrChips(lista) {
  if (!lista.length) return `<span class="addr-chip empty">Sem endereço</span>`;
  return lista.map(({ endereco, qtd }) => {
    const negativo = qtd < 0;
    const dica = negativo ? "Reservado é maior que o estoque nesse endereço" : `Local da peça — ${qtd} unidade${qtd === 1 ? "" : "s"} disponível aqui`;
    return `<span class="addr-chip ${nivelQtd(qtd)}" title="${esc(dica)}">${PIN_SVG}${esc(endereco)} <b>${esc(qtd)}${negativo ? "*" : ""}</b></span>`;
  }).join("");
}

function linha(item) {
  return `
    <tr>
      <td class="addr-cell">${renderEnderecoDetalhado(item.endereco)}</td>
      <td class="box-cell"><span class="addr-raw">${esc(item.caixa)}</span><span class="addr-meta">caixa da peça</span></td>
      <td class="strong">${esc(item.tamanho)}</td>
      <td class="strong">${esc(item.grade)}</td>
      <td class="num">${esc(item.quantidadeEstoque)}</td>
      <td class="num">${esc(item.quantidadeReservada)}</td>
      <td class="num danger">${esc(item.quantidadeDisponivel)}</td>
    </tr>
  `;
}

function textoBuscaItem(item) {
  return [item.prodcor, item.produto, item.descProduto, item.cor, item.tamanho, item.grade, item.endereco, item.caixa]
    .join(" ")
    .toUpperCase();
}

function itensTodosFiltrados() {
  const termo = state.buscaProdutos.trim().toUpperCase();
  const base = termo ? state.todosProdutos.filter(item => textoBuscaItem(item).includes(termo)) : [...state.todosProdutos];
  return base.sort((a, b) => {
    if (state.ordemProdutos === "prodcor") {
      return a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true }) || a.endereco.localeCompare(b.endereco, "pt-BR", { numeric: true });
    }
    if (state.ordemProdutos === "endereco") return a.endereco.localeCompare(b.endereco, "pt-BR", { numeric: true });
    return a.quantidadeDisponivel - b.quantidadeDisponivel || a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true });
  });
}

async function carregarTodosProdutos() {
  el.produtosTotal.textContent = "Carregando...";
  try {
    const resposta = await fetch("/api/wms/todos-produtos", { cache: "no-store" });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Falha ao carregar todos os produtos.");
    state.todosProdutos = (dados.resumo || []).flatMap(grupo => grupo.itens);
    state.todosCarregado = true;
    renderTabelaProdutos();
  } catch (erro) {
    el.produtosTotal.textContent = "Erro";
    el.produtosTbody.innerHTML = `<tr><td colspan="10">${esc(erro.message)}</td></tr>`;
  }
}

function renderTabelaProdutos() {
  const itens = itensTodosFiltrados();
  el.produtosTotal.textContent = `${itens.length} linha${itens.length === 1 ? "" : "s"}`;
  el.produtosTbody.innerHTML = itens.map(item => {
    const nivel = nivelQtd(item.quantidadeDisponivel);
    return `
      <tr class="linha-produto ${nivel}" data-prodcor-link="${esc(item.prodcor)}">
        <td class="strong">${esc(item.prodcor)}</td>
        <td>${esc(item.descProduto)}</td>
        <td>${esc(item.cor)}</td>
        <td class="addr-cell">${renderEnderecoDetalhado(item.endereco)}</td>
        <td class="box-cell"><span class="addr-raw">${esc(item.caixa)}</span><span class="addr-meta">caixa da peça</span></td>
        <td class="strong">${esc(item.tamanho)}</td>
        <td class="strong">${esc(item.grade)}</td>
        <td class="num">${esc(item.quantidadeEstoque)}</td>
        <td class="num">${esc(item.quantidadeReservada)}</td>
        <td class="num danger">${esc(item.quantidadeDisponivel)}</td>
      </tr>
    `;
  }).join("");
}

function trocarVisao(aba) {
  state.aba = aba;
  el.tabPainel.classList.toggle("active", aba === "painel");
  el.tabProdutos.classList.toggle("active", aba === "produtos");
  el.tabLocalizacao.classList.toggle("active", aba === "localizacao");
  el.viewPainel.hidden = aba !== "painel";
  el.viewProdutos.hidden = aba !== "produtos";
  el.viewLocalizacao.hidden = aba !== "localizacao";
  if (aba === "produtos") carregarTodosProdutos();
  if (aba === "localizacao") {
    renderLocalizacao();
    window.requestAnimationFrame(() => window.__mountLocation3D?.());
    window.setTimeout(() => window.__mountLocation3D?.(), 80);
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
  }
}

function renderGroups() {
  const grupos = gruposFiltrados();
  if (!grupos.length) {
    el.groups.innerHTML = "";
    el.status.hidden = false;
    el.status.textContent = state.grupos.length ? "Nenhum resultado para esse filtro." : "Nenhuma peça encontrada no limite configurado.";
    return;
  }

  el.status.hidden = true;
  el.groups.innerHTML = grupos.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    const enderecosQtd = enderecosComQtd(grupo);
    const temNegativo = enderecosQtd.some(item => item.qtd < 0);
    const plural = enderecosQtd.length > 1 ? "s" : "";
    return `
      <article class="group ${risco.nivel}" data-prodcor="${esc(grupo.prodcor)}">
        <details ${index < 3 ? "open" : ""}>
          <summary>
            <div>
              <span class="badge ${risco.nivel}">${risco.label}</span>
              <p class="field-label">Produto (PRODCOR)</p>
              <strong>${esc(grupo.prodcor)}</strong>
              <small>${esc(grupo.descProduto)}</small>
              <p class="addr-lead">Acabando em ${enderecosQtd.length} endereço${plural} — abaixo cada linha mostra o endereço completo e a caixa exata da peça:</p>
              <div class="addr-chips">${renderAddrChips(enderecosQtd)}</div>
              ${temNegativo ? `<p class="addr-note">* o número em vermelho com asterisco é negativo porque o estoque físico desse endereço é menor do que a soma do que já foi reservado pra pedidos — provável erro de contagem, precisa checar na mão</p>` : ""}
            </div>
            <dl>
              <div><dt>Disp. mínima</dt><dd>${esc(grupo.menorDisponivel)}</dd><small>pior endereço</small></div>
              <div><dt>Caixas</dt><dd>${esc(grupo.caixas)}</dd><small>com essa peça</small></div>
              <div><dt>Endereços</dt><dd>${esc((grupo.enderecos || []).length)}</dd><small>locais diferentes</small></div>
            </dl>
          </summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Endereço</th><th>Caixa</th><th>Tamanho</th><th>Grade</th><th>Estoque</th><th>Reservada</th><th>Disponível</th></tr></thead>
              <tbody>${grupo.itens.map(linha).join("")}</tbody>
            </table>
          </div>
        </details>
      </article>
    `;
  }).join("");
}

function ruasDisponiveis(itens) {
  const mapa = new Map();
  for (const item of itens) {
    const info = parseEndereco(item.endereco);
    if (!info.valido) continue;
    if (!mapa.has(info.rua)) {
      mapa.set(info.rua, { rua: info.rua, numero: Number((info.rua || "").replace(/^AC/, "")) });
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.numero - b.numero || a.rua.localeCompare(b.rua, "pt-BR", { numeric: true }));
}

function capacidadeCaixaAtual() {
  return Math.max(1, Number(state.config?.capacidadeCaixa) || 50);
}

function calcularOcupacaoPrateleiras(itens, capacidadeCaixa) {
  const mapa = new Map();
  for (const item of itens) {
    const info = parseEndereco(item.endereco);
    if (!info.valido) continue;
    const chave = `${info.rua}·${info.prateleira}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, { rua: info.rua, prateleira: info.prateleira, paridade: info.paridade, caixas: new Set(), somaDisponivel: 0, menorDisponivel: Infinity });
    }
    const entrada = mapa.get(chave);
    if (item.caixa) entrada.caixas.add(item.caixa);
    entrada.somaDisponivel += Number(item.quantidadeDisponivel) || 0;
    entrada.menorDisponivel = Math.min(entrada.menorDisponivel, Number(item.quantidadeDisponivel) || 0);
  }
  return Array.from(mapa.values()).map(entrada => {
    const capacidadeTotal = entrada.caixas.size * capacidadeCaixa;
    const pct = capacidadeTotal > 0 ? Math.min(100, (entrada.somaDisponivel / capacidadeTotal) * 100) : 0;
    return { ...entrada, caixasQtd: entrada.caixas.size, capacidadeTotal, pct };
  });
}

function nivelOcupacao(pct) {
  if (pct >= 67) return "alta";
  if (pct >= 34) return "media";
  return "baixa";
}

function calcularOcupacaoCaixas(itens, capacidadeCaixa) {
  const mapa = new Map();
  for (const item of itens) {
    const caixa = txt(item.caixa);
    if (!caixa) continue;
    const info = parseEndereco(item.endereco);
    if (!mapa.has(caixa)) {
      mapa.set(caixa, {
        caixa,
        rua: info.valido ? info.rua : "",
        prateleira: info.valido ? info.prateleira : null,
        endereco: item.endereco,
        somaDisponivel: 0,
        menorDisponivel: Infinity,
        skus: 0
      });
    }
    const entrada = mapa.get(caixa);
    entrada.somaDisponivel += Number(item.quantidadeDisponivel) || 0;
    entrada.menorDisponivel = Math.min(entrada.menorDisponivel, Number(item.quantidadeDisponivel) || 0);
    entrada.skus += 1;
  }
  return Array.from(mapa.values()).map(entrada => {
    const pct = capacidadeCaixa > 0 ? Math.min(100, (entrada.somaDisponivel / capacidadeCaixa) * 100) : 0;
    return { ...entrada, pct };
  });
}

function calcularOcupacaoRuas(itens, capacidadeCaixa, limiteDisponivel) {
  const porCaixa = calcularOcupacaoCaixas(itens, capacidadeCaixa);
  const mapa = new Map();
  for (const entrada of porCaixa) {
    if (!entrada.rua) continue;
    if (!mapa.has(entrada.rua)) {
      mapa.set(entrada.rua, { rua: entrada.rua, caixas: [], somaPct: 0, piorPct: Infinity, piorPrateleira: null, piorCaixa: null, menorDisponivel: Infinity });
    }
    const grupo = mapa.get(entrada.rua);
    grupo.caixas.push(entrada);
    grupo.somaPct += entrada.pct;
    if (entrada.menorDisponivel < grupo.menorDisponivel) {
      grupo.menorDisponivel = entrada.menorDisponivel;
      grupo.piorPct = entrada.pct;
      grupo.piorPrateleira = entrada.prateleira;
      grupo.piorCaixa = entrada.caixa;
    }
  }
  return Array.from(mapa.values()).map(grupo => ({
    rua: grupo.rua,
    totalPrateleiras: new Set(grupo.caixas.map(c => c.prateleira)).size,
    totalCaixas: grupo.caixas.length,
    mediaPct: grupo.caixas.length ? grupo.somaPct / grupo.caixas.length : 0,
    piorPct: Number.isFinite(grupo.piorPct) ? grupo.piorPct : 0,
    menorDisponivel: Number.isFinite(grupo.menorDisponivel) ? grupo.menorDisponivel : 0,
    piorPrateleira: grupo.piorPrateleira,
    piorCaixa: grupo.piorCaixa,
    rupturas: grupo.caixas.filter(c => c.menorDisponivel <= limiteDisponivel).length
  }));
}

function nivelCritico(pctCritico) {
  if (pctCritico >= 30) return "baixa";
  if (pctCritico >= 10) return "media";
  return "alta";
}

function renderResumoRuas(ruas, ocupacaoPorRua, piorRuaGeral, corredorAtual) {
  if (!el.localizacaoRuasLista) return;
  const lista = ruas.slice().sort((a, b) => (a.numero || 0) - (b.numero || 0));

  if (!lista.length) {
    el.localizacaoRuasLista.innerHTML = `<div class="empty-chart">Nenhum corredor encontrado com os filtros atuais.</div>`;
    return;
  }

  el.localizacaoRuasLista.innerHTML = lista.map(item => {
    const info = ocupacaoPorRua[item.rua] || null;
    const temDados = info && info.totalCaixas > 0;
    const pctCritico = temDados ? (info.rupturas / info.totalCaixas) * 100 : 0;
    const nivel = temDados ? nivelCritico(pctCritico) : "sem-dados";
    const ehPior = item.rua === piorRuaGeral;
    const ehAtual = item.rua === corredorAtual;
    return `
      <button type="button" class="ranking-row rua-row nivel-${nivel}${ehAtual ? " ativo" : ""}" data-rua="${esc(item.rua)}">
        <span class="ranking-pos">${esc(item.rua)}</span>
        <span class="ranking-info">
          <strong>${esc(item.rua)}${ehPior ? ` <span class="rua-badge">atacar aqui</span>` : ""}</strong>
          <small>${!temDados
            ? "sem caixas com dados"
            : `pior: Prateleira ${String(info.piorPrateleira).padStart(2, "0")} · caixa ${esc(info.piorCaixa)} · só ${esc(info.menorDisponivel)} disponível`}</small>
        </span>
        <span class="ranking-bar"><span style="width:${pctCritico.toFixed(1)}%"></span></span>
        <strong class="ranking-pct">${!temDados ? "-" : `${info.rupturas}/${info.totalCaixas}`}</strong>
      </button>
    `;
  }).join("");
}

function renderRankingCaixas(itens) {
  if (!el.localizacaoRankingLista) return;
  const capacidadeCaixa = capacidadeCaixaAtual();
  const ranking = calcularOcupacaoCaixas(itens, capacidadeCaixa).sort((a, b) => b.pct - a.pct);

  if (!ranking.length) {
    el.localizacaoRankingLista.innerHTML = `<div class="empty-chart">Sem dados suficientes pra calcular ocupação.</div>`;
    return;
  }

  el.localizacaoRankingLista.innerHTML = ranking.slice(0, 8).map((entrada, index) => `
    <button type="button" class="ranking-row nivel-${nivelOcupacao(entrada.pct)}" data-rua="${esc(entrada.rua)}" data-prateleira="${esc(entrada.prateleira)}" data-caixa="${esc(entrada.caixa)}">
      <span class="ranking-pos">${index + 1}º</span>
      <span class="ranking-info">
        <strong>${esc(entrada.rua)} · P${String(entrada.prateleira).padStart(2, "0")} · Caixa ${esc(entrada.caixa)}</strong>
        <small>${esc(entrada.somaDisponivel)} peças de ${esc(capacidadeCaixa)}</small>
      </span>
      <span class="ranking-bar"><span style="width:${entrada.pct.toFixed(1)}%"></span></span>
      <strong class="ranking-pct">${entrada.pct.toFixed(0)}%</strong>
    </button>
  `).join("");
}

function renderLocalizacaoCard(item) {
  const info = parseEndereco(item.endereco);
  const meta = info.valido
    ? `${info.zona} · Rua ${info.rua} · P${info.prateleira} ${info.paridade} · Coluna ${info.coluna} (${info.colunaBase} ${info.colunaFaixa})`
    : item.endereco;
  return `
    <article class="location-card ${nivelQtd(item.quantidadeDisponivel)}">
      <div class="location-card-head">
        <strong>${esc(item.prodcor)}</strong>
        <span class="badge ${nivelQtd(item.quantidadeDisponivel)}">${esc(item.quantidadeDisponivel)}</span>
      </div>
      <p>${esc(item.descProduto)}</p>
      <div class="location-card-meta">${renderEnderecoDetalhado(item.endereco)}</div>
      <div class="location-card-box"><span>Caixa</span><b>${esc(item.caixa)}</b></div>
      <small>${esc(meta)}</small>
    </article>
  `;
}

function focarEndereco(endereco) {
  const info = parseEndereco(endereco);
  if (!info.valido) return;
  state.localizacao.rua = info.rua;
  state.localizacao.prateleira = info.prateleira;
  state.localizacao.caixa = "";
  state.localizacao.corredorRua = info.rua;
  if (el.localRua) el.localRua.value = info.rua;
  if (el.localPrateleira) el.localPrateleira.value = info.prateleira;
  if (el.localCaixa) el.localCaixa.value = "";
  trocarVisao("localizacao");
}

function garantirFallbackCorredor(itensRua, ruaSelecionada) {
  if (!el.localizacaoCorridor) return;
  let tentativas = 0;
  const tentar = () => {
    const root = document.getElementById("location-3d-root");
    if (!root) return;
    if (root.querySelector("canvas")) return;
    window.__mountLocation3D?.();
    tentativas += 1;
    if (tentativas < 8) window.setTimeout(tentar, 350);
  };
  window.setTimeout(tentar, 120);
}

function renderLocalizacao() {
  const todosOsItens = state.todosProdutos.length ? state.todosProdutos : todosItens(gruposFiltrados());
  const capacidadeCaixaGeral = capacidadeCaixaAtual();
  const todasAsRuas = ruasDisponiveis(todosOsItens);
  const limiteDisponivelAtual = Math.max(0, Number(state.config?.limiteDisponivel) || 10);
  const ocupacaoPorRuaListaGeral = calcularOcupacaoRuas(todosOsItens, capacidadeCaixaGeral, limiteDisponivelAtual);
  const ocupacaoPorRuaGeral = {};
  for (const entrada of ocupacaoPorRuaListaGeral) ocupacaoPorRuaGeral[entrada.rua] = entrada;
  const piorRuaGeralAbs = ocupacaoPorRuaListaGeral.slice().sort((a, b) => a.menorDisponivel - b.menorDisponivel)[0]?.rua || null;
  renderRankingCaixas(todosOsItens);
  renderResumoRuas(todasAsRuas, ocupacaoPorRuaGeral, piorRuaGeralAbs, state.localizacao.modo === "corredor" ? state.localizacao.corredorRua : null);

  const itensBaixoEstoque = todosItens(gruposFiltrados());
  const itens = itensFiltradosPorLocalizacao(itensBaixoEstoque);
  const ruas = todasAsRuas;

  if (!ruas.length) {
    el.localizacaoTotal.textContent = "0 itens";
    el.localizacaoResumo.textContent = "Nenhum item encontrado com os filtros atuais.";
    el.localizacaoLista.innerHTML = "";
    if (el.localCorridorRua) el.localCorridorRua.innerHTML = "";
    if (el.localVoltarGeral) el.localVoltarGeral.hidden = state.localizacao.modo !== "corredor";
    window.__WMS_LOCATION_DATA__ = {
      modo: state.localizacao.modo,
      itensRua: [],
      ruas: todasAsRuas,
      ruaSelecionada: "",
      filtros: {
        rua: state.localizacao.rua,
        prateleira: state.localizacao.prateleira,
        caixa: state.localizacao.caixa
      },
      prateleiras: 0,
      colunas: 0,
      ocupacaoPorPrateleira: {},
      ocupacaoPorRua: ocupacaoPorRuaGeral,
      piorRuaGeral: piorRuaGeralAbs,
      limiteDisponivel: state.config?.limiteDisponivel ?? 10
    };
    window.dispatchEvent(new CustomEvent("wms-location-data", { detail: window.__WMS_LOCATION_DATA__ }));
    window.__mountLocation3D?.();
    return;
  }

  if (!state.localizacao.corredorRua || !ruas.some(item => item.rua === state.localizacao.corredorRua)) {
    state.localizacao.corredorRua = ruas[0].rua;
  }

  if (el.localRua) el.localRua.value = state.localizacao.rua;
  if (el.localPrateleira) el.localPrateleira.value = state.localizacao.prateleira;
  if (el.localCaixa) el.localCaixa.value = state.localizacao.caixa;

  if (el.localCorridorRua) {
    el.localCorridorRua.innerHTML = ruas.map(item => `<option value="${esc(item.rua)}"${item.rua === state.localizacao.corredorRua ? " selected" : ""}>${esc(item.rua)}</option>`).join("");
  }
  if (el.localVoltarGeral) el.localVoltarGeral.hidden = state.localizacao.modo !== "corredor";

  const ruaSelecionada = state.localizacao.corredorRua;
  const itensRua = itensDoCorredorEmFoco(itensBaixoEstoque, ruaSelecionada);
  const prateleiras = new Set(itensRua.map(item => parseEndereco(item.endereco).prateleira));
  const colunaBaseSet = new Set(itensRua.map(item => parseEndereco(item.endereco).colunaBase));
  const itemFoco = itensRua.find(item => caixaFiltroAtivo() && txt(item.caixa).toUpperCase().includes(caixaFiltroAtivo()))
    || itensRua.find(item => prateleiraFiltroAtivo() && String(parseEndereco(item.endereco).prateleira).padStart(2, '0') === prateleiraFiltroAtivo())
    || null;

  el.localizacaoTotal.textContent = `${itens.length} item${itens.length === 1 ? "" : "s"} · ${ruas.length} rua${ruas.length === 1 ? "" : "s"}`;
  el.localizacaoResumo.innerHTML = `
    <div class="location-summary">
      <div><b>${esc(ruas.length)}</b><span>rua${ruas.length === 1 ? "" : "s"} visível${ruas.length === 1 ? "" : "is"}</span></div>
      <div><b>${esc(prateleiras.size)}</b><span>prateleira${prateleiras.size === 1 ? "" : "s"}</span></div>
      <div><b>${esc(colunaBaseSet.size)}</b><span>altura${colunaBaseSet.size === 1 ? "" : "s"} de coluna</span></div>
    </div>
  `;
  el.localizacaoLista.innerHTML = itensRua.length
    ? itensRua.map(renderLocalizacaoCard).join("")
    : `<div class="empty-chart">Nenhum item nesta rua com os filtros atuais.</div>`;

  const ocupacaoPorPrateleira = {};
  for (const entrada of calcularOcupacaoPrateleiras(itensRua, capacidadeCaixaGeral)) {
    ocupacaoPorPrateleira[entrada.prateleira] = entrada;
  }

  window.__WMS_LOCATION_DATA__ = {
    modo: state.localizacao.modo,
    itensRua,
    ruas,
    ruaSelecionada,
    itemFoco,
    filtros: {
      rua: state.localizacao.rua,
      prateleira: state.localizacao.prateleira,
      caixa: state.localizacao.caixa
    },
    prateleiras: prateleiras.size,
    colunas: colunaBaseSet.size,
    ocupacaoPorPrateleira,
    ocupacaoPorRua: ocupacaoPorRuaGeral,
    piorRuaGeral: piorRuaGeralAbs,
    limiteDisponivel: state.config?.limiteDisponivel ?? 10
  };
  window.dispatchEvent(new CustomEvent("wms-location-data", { detail: window.__WMS_LOCATION_DATA__ }));
  window.__mountLocation3D?.();
}

function renderPrintReport() {
  const dados = state.ultimoDados;
  if (!dados) return;
  const gruposVisiveis = gruposFiltrados();
  const contagem = contarPorRisco(gruposVisiveis);
  const itens = todosItens(gruposVisiveis);
  const primeiro = gruposPrioridade(gruposVisiveis)[0];
  const limite = dados.config.limiteDisponivel;
  const top10 = gruposPrioridade(gruposVisiveis).slice(0, 10);
  const total = Math.max(gruposVisiveis.length, 1);
  const enderecoPrioridadePdf = primeiro ? enderecosComQtd(primeiro)[0] : null;
  const itemPrioridadePdf = primeiro && enderecoPrioridadePdf
    ? primeiro.itens.find(item => item.endereco === enderecoPrioridadePdf.endereco)
    : null;

  const top5 = top10.slice(0, 5);
  const linhasTop = top5.map((grupo, indice) => {
    const risco = riscoGrupo(grupo);
    return `
      <div class="print-rank-row">
        <span class="print-rank-pos">${indice + 1}</span>
        <span class="print-rank-info">
          <strong>${esc(grupo.prodcor)}</strong>
          <small>${esc(grupo.descProduto)}</small>
        </span>
        <span class="print-badge ${risco.nivel}">${esc(risco.label)}</span>
        <strong class="print-rank-num">${esc(grupo.menorDisponivel)}</strong>
      </div>
    `;
  }).join("");

  function barrasPrint(dadosBarra) {
    const maior = Math.max(...dadosBarra.map(item => item.valor), 1);
    return dadosBarra.map(item => `
      <div class="print-bar-row">
        <div class="print-bar-label"><span>${esc(item.label)}</span><strong>${esc(item.valor)}</strong></div>
        <i><b style="width:${Math.max(6, Math.round(item.valor / maior * 100))}%"></b></i>
      </div>
    `).join("");
  }

  const enderecoTop = topMapa(itens, "endereco", 6);
  const corTop = topMapa(itens, "cor", 6);
  const gradeTop = topMapa(itens, "grade", 6);

  const pct = valor => Math.max(valor ? 3 : 0, Math.round((valor / total) * 100));

  el.printReport.innerHTML = `
    <header class="print-head">
      <strong>Picking Automation Radar — Reserva | Picking RJ</strong>
      <span>Gerado em ${fmtData(new Date().toISOString())} · planilha salva há ${tempoRelativo(dados.arquivoModificadoEm)}</span>
    </header>
    <h1>${contagem.rupture} produto${contagem.rupture === 1 ? "" : "s"} travando o picking</h1>
    ${primeiro ? `
      <p class="print-prioridade">
        <b>Comece por aqui:</b> ${esc(primeiro.prodcor)} — ${esc(primeiro.descProduto)} —
        ${itemPrioridadePdf
          ? `estoque físico ${esc(itemPrioridadePdf.quantidadeEstoque)} · reservado ${esc(itemPrioridadePdf.quantidadeReservada)} · disponível ${esc(primeiro.menorDisponivel)}${primeiro.menorDisponivel < 0 ? ` (faltam ${Math.abs(primeiro.menorDisponivel)})` : ""}`
          : `${esc(primeiro.menorDisponivel)} disponível`}
      </p>
    ` : ""}
    <div class="print-kpis">
      <div><b>${contagem.rupture}</b><span>ruptura ≤ ${LIMIAR_RUPTURA}</span></div>
      <div><b>${contagem.critical}</b><span>crítico ${LIMIAR_RUPTURA + 1}-${LIMIAR_CRITICO}</span></div>
      <div><b>${contagem.attention}</b><span>atenção ${LIMIAR_CRITICO + 1}-${limite}</span></div>
      <div><b>${dados.totalItens}</b><span>ocorrências no filtro</span></div>
    </div>
    <div class="print-stack" aria-label="Distribuição de risco">
      <i class="rupture" style="width:${pct(contagem.rupture)}%"></i>
      <i class="critical" style="width:${pct(contagem.critical)}%"></i>
      <i class="attention" style="width:${pct(contagem.attention)}%"></i>
    </div>
    <h2>Top 5 mais urgentes</h2>
    <div class="print-rank">${linhasTop}</div>

    <div class="print-charts">
      <div class="print-chart-col">
        <h2>Endereço — maior concentração</h2>
        <div class="print-bars">${barrasPrint(enderecoTop)}</div>
      </div>
      <div class="print-chart-col">
        <h2>Cor mais sensível</h2>
        <div class="print-bars">${barrasPrint(corTop)}</div>
      </div>
      <div class="print-chart-col">
        <h2>Grade mais sensível</h2>
        <div class="print-bars">${barrasPrint(gradeTop)}</div>
      </div>
    </div>
  `;
}

function render(dados) {
  state.ultimoDados = dados;
  const gruposBaseVisiveis = gruposVisiveisBase();
  const gruposVisiveis = gruposFiltrados();
  const contagem = contarPorRisco(gruposBaseVisiveis);
  const itens = todosItens(gruposBaseVisiveis);
  const primeiro = gruposPrioridade(gruposVisiveis)[0];
  const limite = dados.config.limiteDisponivel;

  const enderecoPrioridade = primeiro ? enderecosComQtd(primeiro)[0] : null;
  const itemPrioridade = primeiro && enderecoPrioridade
    ? primeiro.itens.find(item => item.endereco === enderecoPrioridade.endereco)
    : null;

  el.heroTitle.textContent = `${contagem.rupture} produto${contagem.rupture === 1 ? "" : "s"} travando o picking`;

  const statsPrioridade = itemPrioridade ? `
    <span class="prioridade-stats">
      <span class="prioridade-stat"><b>${esc(itemPrioridade.quantidadeEstoque)}</b><small>peças no endereço</small></span>
      <span class="prioridade-stat"><b>${esc(itemPrioridade.quantidadeReservada)}</b><small>peças reservadas</small></span>
      <span class="prioridade-stat${primeiro.menorDisponivel < 0 ? " neg" : ""}"><b>${esc(primeiro.menorDisponivel)}</b><small>saldo para picking</small></span>
    </span>
    ${primeiro.menorDisponivel < 0 ? `<span class="prioridade-alerta">Ação: saldo negativo. Existem ${esc(itemPrioridade.quantidadeReservada)} peças reservadas e só ${esc(itemPrioridade.quantidadeEstoque)} no endereço; faltam ${Math.abs(primeiro.menorDisponivel)} peças para atender o picking.</span>` : ""}
  ` : primeiro ? `<span class="prioridade-stats"><span class="prioridade-stat"><b>${esc(primeiro.menorDisponivel)}</b><small>saldo para picking</small></span></span>` : "";

  el.heroPrioridade.innerHTML = primeiro
    ? `
      <span class="prioridade-tag">Comece por aqui</span>
      <span class="prioridade-produto"><strong>${esc(primeiro.prodcor)}</strong><span>${esc(primeiro.descProduto)}</span></span>
      ${statsPrioridade}
      ${enderecoPrioridade ? `<span class="prioridade-local"><b>Conferir primeiro:</b> ${PIN_SVG}${renderEnderecoDetalhado(enderecoPrioridade.endereco)}${itemPrioridade?.caixa ? ` · Caixa ${esc(itemPrioridade.caixa)}` : ""}</span>` : ""}
    `
    : `<span class="prioridade-tag ok">Tudo em dia</span><span class="prioridade-desc">Nenhum produto abaixo ou igual a ${limite} disponível agora.</span>`;

  const enderecosAfetados = new Set(itens.map(item => item.endereco)).size;
  const itensZerados = itens.filter(item => item.quantidadeDisponivel <= 0).length;

  el.heroBriefing.innerHTML = `
    <p class="briefing-lead">Peças INK do galpão OD_RJ (zona E4AC) com estoque baixo agora: ${enderecosAfetados} endereço${enderecosAfetados === 1 ? "" : "s"} afetado${enderecosAfetados === 1 ? "" : "s"}, ${itensZerados} já zerado${itensZerados === 1 ? "" : "s"} · planilha atualizada há ${tempoRelativo(dados.arquivoModificadoEm)}. Os cartões abaixo separam por urgência — clique num deles pra filtrar.</p>
  `;

  el.gaugeNumber.textContent = contagem.rupture;
  el.ruptura.textContent = contagem.rupture;
  el.rupturaDesc.textContent = `disponível ≤ ${LIMIAR_RUPTURA} — precisa agir agora`;
  el.critico.textContent = contagem.critical;
  el.criticoDesc.textContent = `disponível de ${LIMIAR_RUPTURA + 1} a ${LIMIAR_CRITICO}`;
  el.atencao.textContent = contagem.attention;
  el.atencaoDesc.textContent = `disponível de ${LIMIAR_CRITICO + 1} a ${limite}`;
  el.itens.textContent = dados.totalItens;
  el.total.textContent = `disponível ≤ ${limite} no filtro (${dados.totalItens} ocorrências)`;
  el.lastUpdate.textContent = `Última leitura: ${fmtData(dados.atualizadoEm)}`;
  el.fileUpdate.textContent = `Arquivo salvo em: ${fmtData(dados.arquivoModificadoEm)}`;
  const resumoLocal = [ruaFiltroAtivo() && `Rua ${ruaFiltroAtivo()}`, prateleiraFiltroAtivo() && `P${prateleiraFiltroAtivo()}`, caixaFiltroAtivo() && `Caixa ${caixaFiltroAtivo()}`].filter(Boolean).join(" / ") || "sem filtro local";
  el.filterSummary.textContent = `${dados.filtros.galpao} / ${dados.filtros.tipoEnd} / ${dados.filtros.descricaoContem} / disponível <= ${limite} / ${resumoLocal}`;

  renderStack(contagem);
  renderHeatmap();
  if (state.heatmapModo === "endereco") renderHeatmapEnderecos();
  renderHotlist();
  const itensRuptura = itens.filter(item => item.quantidadeDisponivel <= 2);
  const baseGraficos = itensRuptura.length ? itensRuptura : itens;
  renderBars(el.addressChart, topMapa(baseGraficos, "endereco", 6));
  renderBars(el.colorChart, topMapa(baseGraficos, "cor", 6));
  renderBars(el.gradeChart, topMapa(baseGraficos, "grade", 6));
  renderGroups();
  renderLocalizacao();
  if (state.aba === "produtos") carregarTodosProdutos();
}

function preencherForms(config) {
  for (const prefix of ["", "setup-"]) {
    const path = $(`#${prefix}planilha-path`);
    const intervalo = $(`#${prefix}intervalo-minutos`);
    const limite = $(`#${prefix}limite-disponivel`);
    const capacidadeCaixa = $(`#${prefix}capacidade-caixa`);
    const excel = $(`#${prefix}atualizar-excel-antes`);
    if (path) path.value = config.planilhaPath || "";
    if (intervalo) intervalo.value = config.intervaloMinutos || 5;
    if (limite) limite.value = config.limiteDisponivel ?? 10;
    if (capacidadeCaixa) capacidadeCaixa.value = config.capacidadeCaixa ?? 50;
    if (excel) excel.checked = Boolean(config.atualizarExcelAntesDeLer);
  }
  if (el.localCapacidadeCaixa) el.localCapacidadeCaixa.value = config.capacidadeCaixa ?? 50;
}

function aplicarConfig(config) {
  state.config = config;
  preencherForms(config);
  if (state.timer) clearInterval(state.timer);
  const ms = Math.max(1, Number(config.intervaloMinutos) || 5) * 60 * 1000;
  state.timer = setInterval(() => carregar(false), ms);
}

async function carregarConfig() {
  const resposta = await fetch("/api/config", { cache: "no-store" });
  aplicarConfig(await resposta.json());
}

function payloadDoSetup() {
  return {
    planilhaPath: el.setupPath.value.trim(),
    intervaloMinutos: Number(el.setupIntervalo.value) || 5,
    limiteDisponivel: Number(el.setupLimite.value) || 10,
    capacidadeCaixa: Number(el.setupCapacidadeCaixa.value) || 50,
    atualizarExcelAntesDeLer: el.setupExcel.checked
  };
}

function payloadDoPainel() {
  return {
    planilhaPath: el.planilhaPath.value.trim(),
    intervaloMinutos: Number(el.intervaloMinutos.value) || 5,
    limiteDisponivel: Number(el.limiteDisponivel.value) || 10,
    capacidadeCaixa: Number(el.capacidadeCaixa.value) || 50,
    atualizarExcelAntesDeLer: el.atualizarExcelAntes.checked
  };
}

async function salvarConfig(payload) {
  const resposta = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const config = await resposta.json();
  if (!resposta.ok) throw new Error(config.erro || "Nao foi possivel salvar.");
  aplicarConfig(config);
  return config;
}

async function carregar(manual = true) {
  el.refresh.disabled = true;
  el.syncState.textContent = manual ? "Lendo agora" : "Auto leitura";
  el.status.hidden = false;
  el.status.textContent = "Lendo WMS_GERAL...";
  try {
    const [resposta, respostaTodos] = await Promise.all([
      fetch("/api/wms/baixo-estoque", { cache: "no-store" }),
      fetch("/api/wms/todos-produtos", { cache: "no-store" })
    ]);
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Falha ao carregar dados.");
    if (respostaTodos.ok) {
      const dadosTodos = await respostaTodos.json();
      state.todosProdutos = (dadosTodos.resumo || []).flatMap(grupo => grupo.itens);
      state.todosCarregado = true;
    }
    state.grupos = dados.resumo || [];
    aplicarConfig(dados.config);
    render(dados);
    el.syncState.textContent = dados.avisoAtualizacaoExcel ? "Lido com aviso" : "Sincronizado";
    if (dados.avisoAtualizacaoExcel) {
      el.status.hidden = false;
      el.status.textContent = dados.avisoAtualizacaoExcel;
    }
  } catch (erro) {
    el.groups.innerHTML = "";
    el.status.hidden = false;
    el.status.textContent = erro.message;
    el.syncState.textContent = "Erro";
  } finally {
    el.refresh.disabled = false;
  }
}

async function entrarSetup(event) {
  event.preventDefault();
  el.setupMessage.textContent = "Salvando e lendo planilha...";
  try {
    await salvarConfig(payloadDoSetup());
    el.setupScreen.hidden = true;
    await carregar(true);
  } catch (erro) {
    el.setupMessage.textContent = erro.message;
  }
}

async function salvarConfiguracao(event) {
  event.preventDefault();
  el.configMessage.textContent = "Salvando...";
  try {
    await salvarConfig(payloadDoPainel());
    el.configMessage.textContent = "Configuração salva.";
    await carregar(true);
  } catch (erro) {
    el.configMessage.textContent = erro.message;
  }
}

async function atualizarExcel() {
  el.refreshExcel.disabled = true;
  el.syncState.textContent = "Atualizando Excel";
  try {
    const resposta = await fetch("/api/wms/atualizar-planilha", { method: "POST" });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Falha ao atualizar Excel.");
    await carregar(true);
    if (dados.avisoAtualizacaoExcel) {
      el.status.hidden = false;
      el.status.textContent = dados.avisoAtualizacaoExcel;
      el.syncState.textContent = "Salvo com aviso";
    }
  } catch (erro) {
    el.status.hidden = false;
    el.status.textContent = erro.message;
    el.syncState.textContent = "Erro Excel";
  } finally {
    el.refreshExcel.disabled = false;
  }
}

function ativarFiltroRisco(valor, botao) {
  state.riscoFiltro = valor;
  document.querySelectorAll("[data-risk-filter]").forEach(item => item.classList.remove("active"));
  if (botao) botao.classList.add("active");
  renderGroups();
  el.groups.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buscarEExpandir(valor) {
  state.busca = valor;
  state.riscoFiltro = "all";
  el.search.value = valor;
  document.querySelectorAll("[data-risk-filter]").forEach(item => item.classList.remove("active"));
  renderGroups();
  const alvo = document.querySelector(`[data-prodcor="${CSS.escape(valor)}"] details`);
  if (alvo) {
    alvo.open = true;
    alvo.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function limparFiltrosFinosDeLocalizacao() {
  state.localizacao.rua = "";
  state.localizacao.prateleira = "";
  state.localizacao.caixa = "";
  if (el.localRua) el.localRua.value = "";
  if (el.localPrateleira) el.localPrateleira.value = "";
  if (el.localCaixa) el.localCaixa.value = "";
}

el.openSetup.addEventListener("click", () => { el.setupScreen.hidden = false; });
el.tabPainel.addEventListener("click", () => trocarVisao("painel"));
el.tabProdutos.addEventListener("click", () => trocarVisao("produtos"));
el.tabLocalizacao.addEventListener("click", () => trocarVisao("localizacao"));
el.produtosTbody.addEventListener("click", event => {
  const linha = event.target.closest("[data-prodcor-link]");
  if (linha) { trocarVisao("painel"); buscarEExpandir(linha.dataset.prodcorLink); }
});
el.reportPdf.addEventListener("click", () => {
  renderPrintReport();
  window.print();
});
el.setupForm.addEventListener("submit", entrarSetup);
el.refresh.addEventListener("click", () => carregar(true));
el.refreshExcel.addEventListener("click", atualizarExcel);
el.configForm.addEventListener("submit", salvarConfiguracao);
el.search.addEventListener("input", event => { state.busca = event.target.value; renderGroups(); });
el.sort.addEventListener("change", event => { state.ordem = event.target.value; renderGroups(); });
el.searchProdutos.addEventListener("input", event => { state.buscaProdutos = event.target.value; renderTabelaProdutos(); });
el.sortProdutos.addEventListener("change", event => { state.ordemProdutos = event.target.value; renderTabelaProdutos(); });
el.localRua.addEventListener("input", event => { state.localizacao.rua = event.target.value; render(state.ultimoDados); });
el.localPrateleira.addEventListener("input", event => { state.localizacao.prateleira = event.target.value; render(state.ultimoDados); });
el.localCaixa.addEventListener("input", event => { state.localizacao.caixa = event.target.value; render(state.ultimoDados); });
el.localCorridorRua.addEventListener("change", event => {
  state.localizacao.corredorRua = event.target.value;
  limparFiltrosFinosDeLocalizacao();
  state.localizacao.modo = "corredor";
  renderLocalizacao();
});
el.localizacaoRankingLista.addEventListener("click", event => {
  const linha = event.target.closest("[data-rua]");
  if (!linha) return;
  state.localizacao.corredorRua = linha.dataset.rua;
  state.localizacao.rua = "";
  state.localizacao.prateleira = linha.dataset.prateleira;
  state.localizacao.modo = "corredor";
  if (el.localRua) el.localRua.value = "";
  if (el.localPrateleira) el.localPrateleira.value = linha.dataset.prateleira;
  renderLocalizacao();
});
el.localizacaoRuasLista.addEventListener("click", event => {
  const linha = event.target.closest("[data-rua]");
  if (!linha) return;
  state.localizacao.corredorRua = linha.dataset.rua;
  limparFiltrosFinosDeLocalizacao();
  state.localizacao.modo = "corredor";
  renderLocalizacao();
});
window.addEventListener("wms-abrir-corredor", event => {
  const rua = txt(event.detail?.rua);
  if (!rua) return;
  state.localizacao.corredorRua = rua;
  limparFiltrosFinosDeLocalizacao();
  state.localizacao.modo = "corredor";
  renderLocalizacao();
});
if (el.localVoltarGeral) {
  el.localVoltarGeral.addEventListener("click", () => {
    state.localizacao.modo = "geral";
    renderLocalizacao();
  });
}
el.localCapacidadeCaixa.addEventListener("change", event => {
  const capacidadeCaixa = Math.max(1, Number(event.target.value) || 50);
  event.target.value = capacidadeCaixa;
  state.config = { ...(state.config || {}), capacidadeCaixa };
  renderLocalizacao();
  salvarConfig({ ...state.config, capacidadeCaixa }).catch(() => {});
});
el.localLimpar.addEventListener("click", () => {
  state.localizacao.rua = "";
  state.localizacao.prateleira = "";
  state.localizacao.caixa = "";
  state.localizacao.corredorRua = "";
  el.localRua.value = "";
  el.localPrateleira.value = "";
  el.localCaixa.value = "";
  render(state.ultimoDados);
});

document.querySelectorAll("[data-risk-filter]").forEach(botao => {
  botao.addEventListener("click", () => ativarFiltroRisco(botao.dataset.riskFilter, botao));
});
el.hotlist.addEventListener("click", event => {
  const item = event.target.closest("[data-prodcor-link]");
  if (item) buscarEExpandir(item.dataset.prodcorLink);
});
el.heatmap.addEventListener("click", event => {
  const item = event.target.closest("[data-prodcor-link]");
  if (item) buscarEExpandir(item.dataset.prodcorLink);
});
el.heatmapEnderecos.addEventListener("click", event => {
  const tile = event.target.closest("[data-endereco-link]");
  if (tile?.dataset?.enderecoLink) {
    focarEndereco(tile.dataset.enderecoLink);
    return;
  }
  const item = event.target.closest("[data-prodcor-link]");
  if (item) buscarEExpandir(item.dataset.prodcorLink);
});
el.heatModoProduto.addEventListener("click", () => trocarModoHeatmap("produto"));
el.heatModoEndereco.addEventListener("click", () => trocarModoHeatmap("endereco"));
document.querySelectorAll(".bar-chart").forEach(chart => {
  chart.addEventListener("click", event => {
    const item = event.target.closest("[data-search]");
    if (item) buscarEExpandir(item.dataset.search);
  });
});

await carregarConfig();
await carregar(true);
