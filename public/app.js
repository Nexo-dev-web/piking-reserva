const state = {
  grupos: [],
  config: null,
  busca: "",
  ordem: "menor",
  riscoFiltro: "rupture",
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
  setupExcel: $("#setup-atualizar-excel-antes"),
  openSetup: $("#open-setup"),
  reportPdf: $("#report-pdf"),
  refresh: $("#refresh"),
  refreshExcel: $("#refresh-excel"),
  syncState: $("#sync-state"),
  lastUpdate: $("#last-update"),
  fileUpdate: $("#file-update"),
  heroTitle: $("#hero-title"),
  heroSubtitle: $("#hero-subtitle"),
  gaugeNumber: $("#gauge-number"),
  riskStack: $("#risk-stack"),
  ruptura: $("#m-ruptura"),
  critico: $("#m-critico"),
  atencao: $("#m-atencao"),
  itens: $("#m-itens"),
  total: $("#m-total"),
  hotlist: $("#hotlist"),
  addressChart: $("#address-chart"),
  colorChart: $("#color-chart"),
  gradeChart: $("#grade-chart"),
  filterSummary: $("#filter-summary"),
  configForm: $("#config-form"),
  configMessage: $("#config-message"),
  planilhaPath: $("#planilha-path"),
  intervaloMinutos: $("#intervalo-minutos"),
  limiteDisponivel: $("#limite-disponivel"),
  atualizarExcelAntes: $("#atualizar-excel-antes"),
  search: $("#search"),
  sort: $("#sort"),
  status: $("#status"),
  groups: $("#groups")
};

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));
}

function fmtData(iso) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function riscoGrupo(grupo) {
  if (grupo.menorDisponivel <= 2) return { nivel: "rupture", label: "Acabando agora", peso: 3 };
  if (grupo.menorDisponivel <= 5) return { nivel: "critical", label: "Critico", peso: 2 };
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

function gruposPrioridade() {
  return [...state.grupos].sort((a, b) => {
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

function renderHotlist() {
  const top = gruposPrioridade().filter(grupo => riscoGrupo(grupo).nivel === "rupture").slice(0, 10);
  const fallback = top.length ? top : gruposPrioridade().slice(0, 8);
  el.hotlist.innerHTML = fallback.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    return `
      <button class="hot-item ${risco.nivel}" type="button" data-prodcor-link="${esc(grupo.prodcor)}">
        <span class="hot-index">${index + 1}</span>
        <span class="hot-main">
          <span class="hot-line"><strong>${esc(grupo.prodcor)}</strong><em>${esc(risco.label)}</em></span>
          <span class="hot-desc">${esc(grupo.descProduto)}</span>
          <span class="hot-meta">${esc((grupo.enderecos || []).join(" / ") || "-")} | Tam ${esc((grupo.tamanhos || []).join(", ") || "-")} | Grade ${esc((grupo.grades || []).join(", ") || "-")}</span>
        </span>
        <span class="hot-number"><b>${esc(grupo.menorDisponivel)}</b><small>disp. minima</small></span>
      </button>
    `;
  }).join("");
}

function renderBars(container, dados) {
  if (!dados.length) {
    container.innerHTML = `<div class="empty-chart">Sem ocorrencias nesta faixa</div>`;
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
  const porRisco = state.riscoFiltro === "all" ? porBusca : porBusca.filter(grupo => riscoGrupo(grupo).nivel === state.riscoFiltro);
  return porRisco.sort((a, b) => {
    const riscoA = riscoGrupo(a);
    const riscoB = riscoGrupo(b);
    if (state.ordem === "prodcor") return a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true });
    if (state.ordem === "caixas") return b.caixas - a.caixas || riscoB.peso - riscoA.peso;
    return riscoB.peso - riscoA.peso || a.menorDisponivel - b.menorDisponivel || a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true });
  });
}

function linha(item) {
  return `
    <tr>
      <td class="strong">${esc(item.endereco)}</td>
      <td class="strong">${esc(item.caixa)}</td>
      <td>${esc(item.produto)}</td>
      <td>${esc(item.descProduto)}</td>
      <td>${esc(item.cor)}</td>
      <td class="strong">${esc(item.tamanho)}</td>
      <td class="strong">${esc(item.grade)}</td>
      <td class="num">${esc(item.quantidadeEstoque)}</td>
      <td class="num">${esc(item.quantidadeReservada)}</td>
      <td class="num danger">${esc(item.quantidadeDisponivel)}</td>
    </tr>
  `;
}

function renderGroups() {
  const grupos = gruposFiltrados();
  if (!grupos.length) {
    el.groups.innerHTML = "";
    el.status.hidden = false;
    el.status.textContent = state.grupos.length ? "Nenhum resultado para esse filtro." : "Nenhuma peca encontrada no limite configurado.";
    return;
  }

  el.status.hidden = true;
  el.groups.innerHTML = grupos.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    return `
      <article class="group ${risco.nivel}" data-prodcor="${esc(grupo.prodcor)}">
        <details ${index < 3 ? "open" : ""}>
          <summary>
            <div>
              <span class="badge ${risco.nivel}">${risco.label}</span>
              <strong>${esc(grupo.prodcor)}</strong>
              <small>${esc(grupo.descProduto)}</small>
              <small>${esc((grupo.enderecos || []).join(" / "))}</small>
            </div>
            <dl>
              <div><dt>Disp. minima</dt><dd>${esc(grupo.menorDisponivel)}</dd></div>
              <div><dt>Qtd. linhas</dt><dd>${esc(grupo.caixas)}</dd></div>
              <div><dt>Enderecos</dt><dd>${esc((grupo.enderecos || []).length)}</dd></div>
            </dl>
          </summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Endereco</th><th>Caixa</th><th>Produto</th><th>Descricao</th><th>Cor</th><th>Tamanho</th><th>Grade</th><th>Estoque</th><th>Reservada</th><th>Disponivel</th></tr></thead>
              <tbody>${grupo.itens.map(linha).join("")}</tbody>
            </table>
          </div>
        </details>
      </article>
    `;
  }).join("");
}

function render(dados) {
  const contagem = contarPorRisco(state.grupos);
  const itens = todosItens(state.grupos);
  const primeiro = gruposPrioridade()[0];
  const limite = dados.config.limiteDisponivel;

  el.heroTitle.textContent = `${contagem.rupture} pecas acabando`;
  el.heroSubtitle.textContent = primeiro
    ? `Prioridade: ${primeiro.prodcor} esta com disponibilidade minima ${primeiro.menorDisponivel}.`
    : `Nenhum item abaixo ou igual a ${limite}.`;
  el.gaugeNumber.textContent = contagem.rupture;
  el.ruptura.textContent = contagem.rupture;
  el.critico.textContent = contagem.critical;
  el.atencao.textContent = contagem.attention;
  el.itens.textContent = dados.totalItens;
  el.total.textContent = `${dados.totalLinhasPlanilha} linhas lidas`;
  el.lastUpdate.textContent = `Ultima leitura: ${fmtData(dados.atualizadoEm)}`;
  el.fileUpdate.textContent = `Arquivo salvo em: ${fmtData(dados.arquivoModificadoEm)}`;
  el.filterSummary.textContent = `${dados.filtros.galpao} / ${dados.filtros.tipoEnd} / ${dados.filtros.descricaoContem} / disponivel <= ${limite}`;

  renderStack(contagem);
  renderHotlist();
  const itensRuptura = itens.filter(item => item.quantidadeDisponivel <= 2);
  const baseGraficos = itensRuptura.length ? itensRuptura : itens;
  renderBars(el.addressChart, topMapa(baseGraficos, "endereco", 6));
  renderBars(el.colorChart, topMapa(baseGraficos, "cor", 6));
  renderBars(el.gradeChart, topMapa(baseGraficos, "grade", 6));
  renderGroups();
}

function preencherForms(config) {
  for (const prefix of ["", "setup-"]) {
    const path = $(`#${prefix}planilha-path`);
    const intervalo = $(`#${prefix}intervalo-minutos`);
    const limite = $(`#${prefix}limite-disponivel`);
    const excel = $(`#${prefix}atualizar-excel-antes`);
    if (path) path.value = config.planilhaPath || "";
    if (intervalo) intervalo.value = config.intervaloMinutos || 5;
    if (limite) limite.value = config.limiteDisponivel ?? 10;
    if (excel) excel.checked = Boolean(config.atualizarExcelAntesDeLer);
  }
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
    atualizarExcelAntesDeLer: el.setupExcel.checked
  };
}

function payloadDoPainel() {
  return {
    planilhaPath: el.planilhaPath.value.trim(),
    intervaloMinutos: Number(el.intervaloMinutos.value) || 5,
    limiteDisponivel: Number(el.limiteDisponivel.value) || 10,
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
    const resposta = await fetch("/api/wms/baixo-estoque", { cache: "no-store" });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Falha ao carregar dados.");
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
    el.configMessage.textContent = "Configuracao salva.";
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

el.openSetup.addEventListener("click", () => { el.setupScreen.hidden = false; });
el.reportPdf.addEventListener("click", () => window.print());
el.setupForm.addEventListener("submit", entrarSetup);
el.refresh.addEventListener("click", () => carregar(true));
el.refreshExcel.addEventListener("click", atualizarExcel);
el.configForm.addEventListener("submit", salvarConfiguracao);
el.search.addEventListener("input", event => { state.busca = event.target.value; renderGroups(); });
el.sort.addEventListener("change", event => { state.ordem = event.target.value; renderGroups(); });
document.querySelectorAll("[data-risk-filter]").forEach(botao => {
  botao.addEventListener("click", () => ativarFiltroRisco(botao.dataset.riskFilter, botao));
});
el.hotlist.addEventListener("click", event => {
  const item = event.target.closest("[data-prodcor-link]");
  if (item) buscarEExpandir(item.dataset.prodcorLink);
});
document.querySelectorAll(".bar-chart").forEach(chart => {
  chart.addEventListener("click", event => {
    const item = event.target.closest("[data-search]");
    if (item) buscarEExpandir(item.dataset.search);
  });
});

await carregarConfig();
await carregar(true);
