const state = {
  grupos: [],
  config: null,
  busca: "",
  ordem: "menor",
  timer: null
};

const el = {
  refresh: document.querySelector("#refresh"),
  refreshExcel: document.querySelector("#refresh-excel"),
  syncState: document.querySelector("#sync-state"),
  lastUpdate: document.querySelector("#last-update"),
  fileUpdate: document.querySelector("#file-update"),
  heroTitle: document.querySelector("#hero-title"),
  heroSubtitle: document.querySelector("#hero-subtitle"),
  gaugeNumber: document.querySelector("#gauge-number"),
  riskStack: document.querySelector("#risk-stack"),
  ruptura: document.querySelector("#m-ruptura"),
  critico: document.querySelector("#m-critico"),
  atencao: document.querySelector("#m-atencao"),
  itens: document.querySelector("#m-itens"),
  total: document.querySelector("#m-total"),
  hotlist: document.querySelector("#hotlist"),
  addressChart: document.querySelector("#address-chart"),
  gradeChart: document.querySelector("#grade-chart"),
  configForm: document.querySelector("#config-form"),
  configMessage: document.querySelector("#config-message"),
  planilhaPath: document.querySelector("#planilha-path"),
  intervaloMinutos: document.querySelector("#intervalo-minutos"),
  atualizarExcelAntes: document.querySelector("#atualizar-excel-antes"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  status: document.querySelector("#status"),
  groups: document.querySelector("#groups")
};

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function fmtData(iso) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(iso));
}

function riscoGrupo(grupo) {
  if (grupo.menorDisponivel <= 2) return { nivel: "rupture", label: "Ruptura iminente", peso: 3 };
  if (grupo.menorDisponivel <= 5) return { nivel: "critical", label: "Critico", peso: 2 };
  return { nivel: "attention", label: "Atencao", peso: 1 };
}

function contarPorRisco(grupos) {
  const contagem = { rupture: 0, critical: 0, attention: 0 };
  for (const grupo of grupos) contagem[riscoGrupo(grupo).nivel] += 1;
  return contagem;
}

function todosItens(grupos) {
  return grupos.flatMap(grupo => grupo.itens || []);
}

function topMapa(itens, chave, limite = 6) {
  const mapa = new Map();
  for (const item of itens) {
    const key = item[chave] || "-";
    mapa.set(key, (mapa.get(key) || 0) + 1);
  }
  return Array.from(mapa.entries())
    .map(([label, valor]) => ({ label, valor }))
    .sort((a, b) => b.valor - a.valor || a.label.localeCompare(b.label, "pt-BR", { numeric: true }))
    .slice(0, limite);
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

function renderStack(contagem) {
  const total = Math.max(state.grupos.length, 1);
  const partes = [
    ["rupture", contagem.rupture],
    ["critical", contagem.critical],
    ["attention", contagem.attention]
  ];
  el.riskStack.innerHTML = partes.map(([nivel, valor]) => {
    const pct = Math.max(valor ? 4 : 0, Math.round((valor / total) * 100));
    return `<i class="${nivel}" style="width:${pct}%"></i>`;
  }).join("");
}

function renderHotlist() {
  const top = gruposPrioridade().slice(0, 6);
  el.hotlist.innerHTML = top.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    const enderecos = (grupo.enderecos || []).slice(0, 3).join(" / ");
    return `
      <article class="hot-item ${risco.nivel}">
        <div class="hot-index">${index + 1}</div>
        <div class="hot-main">
          <div class="hot-line">
            <strong>${esc(grupo.prodcor)}</strong>
            <span>${esc(risco.label)}</span>
          </div>
          <p>${esc(grupo.descProduto)}</p>
          <small>${esc(enderecos || "-")} - Tam ${esc((grupo.tamanhos || []).join(", ") || "-")} - Grade ${esc((grupo.grades || []).join(", ") || "-")}</small>
        </div>
        <div class="hot-number">
          <b>${esc(grupo.menorDisponivel)}</b>
          <span>menor disp.</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderBars(container, dados) {
  const maior = Math.max(...dados.map(item => item.valor), 1);
  container.innerHTML = dados.map(item => {
    const pct = Math.max(8, Math.round((item.valor / maior) * 100));
    return `
      <div class="bar-row">
        <span>${esc(item.label)}</span>
        <div class="bar-track"><i style="width:${pct}%"></i></div>
        <b>${esc(item.valor)}</b>
      </div>
    `;
  }).join("");
}

function textoBusca(grupo) {
  return [
    grupo.prodcor,
    grupo.produto,
    grupo.descProduto,
    grupo.cor,
    ...(grupo.tamanhos || []),
    ...(grupo.grades || []),
    ...(grupo.enderecos || []),
    ...(grupo.itens || []).flatMap(item => [item.endereco, item.caixa, item.tamanho, item.grade])
  ].join(" ").toUpperCase();
}

function gruposFiltrados() {
  const termo = state.busca.trim().toUpperCase();
  const grupos = termo ? state.grupos.filter(grupo => textoBusca(grupo).includes(termo)) : [...state.grupos];
  return grupos.sort((a, b) => {
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
      <td>${esc(item.endereco)}</td>
      <td>${esc(item.caixa)}</td>
      <td>${esc(item.produto)}</td>
      <td>${esc(item.descProduto)}</td>
      <td>${esc(item.cor)}</td>
      <td>${esc(item.tamanho)}</td>
      <td>${esc(item.grade)}</td>
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
    el.status.textContent = state.grupos.length ? "Nenhum resultado para essa busca." : "Nenhuma peca abaixo de 10 encontrada.";
    return;
  }

  el.status.hidden = true;
  el.groups.innerHTML = grupos.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    return `
      <article class="group ${risco.nivel}">
        <details ${index < 2 ? "open" : ""}>
          <summary>
            <div>
              <span class="badge ${risco.nivel}">${risco.label}</span>
              <strong>${esc(grupo.prodcor)}</strong>
              <small>${esc(grupo.descProduto)}</small>
            </div>
            <dl>
              <div><dt>Menor</dt><dd>${esc(grupo.menorDisponivel)}</dd></div>
              <div><dt>Total</dt><dd>${esc(grupo.totalDisponivel)}</dd></div>
              <div><dt>Caixas</dt><dd>${esc(grupo.caixas)}</dd></div>
            </dl>
          </summary>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Endereco</th>
                  <th>Caixa</th>
                  <th>Produto</th>
                  <th>Descricao</th>
                  <th>Cor</th>
                  <th>Tamanho</th>
                  <th>Grade</th>
                  <th>Estoque</th>
                  <th>Reservada</th>
                  <th>Disponivel</th>
                </tr>
              </thead>
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

  el.heroTitle.textContent = `${contagem.rupture} itens para acabar`;
  el.heroSubtitle.textContent = primeiro
    ? `Mais urgente: ${primeiro.prodcor} com menor disponivel ${primeiro.menorDisponivel}.`
    : "Nenhum item em risco com os filtros atuais.";
  el.gaugeNumber.textContent = contagem.rupture;
  el.ruptura.textContent = contagem.rupture;
  el.critico.textContent = contagem.critical;
  el.atencao.textContent = contagem.attention;
  el.itens.textContent = dados.totalItens;
  el.total.textContent = `${dados.totalLinhasPlanilha} linhas lidas`;
  el.lastUpdate.textContent = `Ultima leitura: ${fmtData(dados.atualizadoEm)}`;
  el.fileUpdate.textContent = `Arquivo salvo em: ${fmtData(dados.arquivoModificadoEm)}`;

  renderStack(contagem);
  renderHotlist();
  renderBars(el.addressChart, topMapa(itens, "endereco", 6));
  renderBars(el.gradeChart, topMapa(itens, "grade", 6));
  renderGroups();
}

function aplicarConfig(config) {
  state.config = config;
  el.planilhaPath.value = config.planilhaPath || "";
  el.intervaloMinutos.value = config.intervaloMinutos || 5;
  el.atualizarExcelAntes.checked = Boolean(config.atualizarExcelAntesDeLer);

  if (state.timer) clearInterval(state.timer);
  const ms = Math.max(1, Number(config.intervaloMinutos) || 5) * 60 * 1000;
  state.timer = setInterval(() => carregar(false), ms);
}

async function carregarConfig() {
  const resposta = await fetch("/api/config", { cache: "no-store" });
  const config = await resposta.json();
  aplicarConfig(config);
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
    el.syncState.textContent = "Sincronizado";
  } catch (erro) {
    el.groups.innerHTML = "";
    el.status.hidden = false;
    el.status.textContent = erro.message;
    el.syncState.textContent = "Erro";
  } finally {
    el.refresh.disabled = false;
  }
}

async function salvarConfiguracao(event) {
  event.preventDefault();
  el.configMessage.textContent = "Salvando...";
  const payload = {
    planilhaPath: el.planilhaPath.value.trim(),
    intervaloMinutos: Number(el.intervaloMinutos.value) || 5,
    atualizarExcelAntesDeLer: el.atualizarExcelAntes.checked
  };

  try {
    const resposta = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const config = await resposta.json();
    if (!resposta.ok) throw new Error(config.erro || "Nao foi possivel salvar.");
    aplicarConfig(config);
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

el.refresh.addEventListener("click", () => carregar(true));
el.refreshExcel.addEventListener("click", atualizarExcel);
el.configForm.addEventListener("submit", salvarConfiguracao);
el.search.addEventListener("input", event => {
  state.busca = event.target.value;
  renderGroups();
});
el.sort.addEventListener("change", event => {
  state.ordem = event.target.value;
  renderGroups();
});

await carregarConfig();
await carregar(true);
