const state = {
  grupos: [],
  busca: "",
  ordem: "menor"
};

const el = {
  refresh: document.querySelector("#refresh"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  status: document.querySelector("#status"),
  groups: document.querySelector("#groups"),
  prodcor: document.querySelector("#m-prodcor"),
  itens: document.querySelector("#m-itens"),
  ruptura: document.querySelector("#m-ruptura"),
  total: document.querySelector("#m-total"),
  data: document.querySelector("#m-data"),
  fileStatus: document.querySelector("#file-status"),
  riskChart: document.querySelector("#risk-chart"),
  topRisk: document.querySelector("#top-risk"),
  addressChart: document.querySelector("#address-chart"),
  gradeChart: document.querySelector("#grade-chart")
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
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(iso));
}

function riscoGrupo(grupo) {
  if (grupo.menorDisponivel <= 2) return { nivel: "ruptura", label: "Ruptura iminente", peso: 3 };
  if (grupo.menorDisponivel <= 5) return { nivel: "critico", label: "Critico", peso: 2 };
  return { nivel: "atencao", label: "Atencao", peso: 1 };
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

function contarPorRisco(grupos) {
  const contagem = { ruptura: 0, critico: 0, atencao: 0 };
  for (const grupo of grupos) contagem[riscoGrupo(grupo).nivel] += 1;
  return contagem;
}

function topMapa(itens, chave, limite = 7) {
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

function renderRiskChart(grupos) {
  const contagem = contarPorRisco(grupos);
  const total = Math.max(grupos.length, 1);
  const dados = [
    ["ruptura", "Ruptura iminente", contagem.ruptura],
    ["critico", "Critico", contagem.critico],
    ["atencao", "Atencao", contagem.atencao]
  ];

  el.riskChart.innerHTML = dados.map(([nivel, label, valor]) => {
    const pct = Math.round((valor / total) * 100);
    return `
      <div class="risk-row ${nivel}">
        <div class="risk-copy">
          <strong>${label}</strong>
          <span>${valor} PRODCOR</span>
        </div>
        <div class="track" aria-label="${label}: ${pct}%">
          <i style="width:${pct}%"></i>
        </div>
        <b>${pct}%</b>
      </div>
    `;
  }).join("");
}

function renderRanking(grupos) {
  const top = [...grupos]
    .sort((a, b) => {
      const riscoA = riscoGrupo(a);
      const riscoB = riscoGrupo(b);
      return riscoB.peso - riscoA.peso || a.menorDisponivel - b.menorDisponivel || b.caixas - a.caixas;
    })
    .slice(0, 8);

  el.topRisk.innerHTML = top.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    return `
      <div class="rank-item">
        <span class="rank-num">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <strong>${esc(grupo.prodcor)}</strong>
          <small>${esc(grupo.descProduto)}</small>
        </div>
        <span class="badge ${risco.nivel}">${risco.label}</span>
        <b>${esc(grupo.menorDisponivel)}</b>
      </div>
    `;
  }).join("");
}

function renderBars(container, dados) {
  const maior = Math.max(...dados.map(item => item.valor), 1);
  container.innerHTML = dados.map(item => {
    const pct = Math.max(5, Math.round((item.valor / maior) * 100));
    return `
      <div class="bar-row">
        <span>${esc(item.label)}</span>
        <div class="bar-track"><i style="width:${pct}%"></i></div>
        <b>${esc(item.valor)}</b>
      </div>
    `;
  }).join("");
}

function todosItens(grupos) {
  return grupos.flatMap(grupo => grupo.itens || []);
}

function renderInsights() {
  const grupos = state.grupos;
  const itens = todosItens(grupos);
  renderRiskChart(grupos);
  renderRanking(grupos);
  renderBars(el.addressChart, topMapa(itens, "endereco", 8));
  renderBars(el.gradeChart, topMapa(itens, "grade", 8));
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
    el.status.textContent = state.grupos.length ? "Nenhum resultado para essa busca." : "Nenhuma peca encontrada abaixo de 10.";
    return;
  }

  el.status.hidden = true;
  el.groups.innerHTML = grupos.map((grupo, index) => {
    const risco = riscoGrupo(grupo);
    return `
      <article class="group ${risco.nivel}">
        <details ${index < 3 ? "open" : ""}>
          <summary>
            <div class="summary-title">
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
          <div class="meta">
            <span>Produto ${esc(grupo.produto)}</span>
            <span>Cor ${esc(grupo.cor || "-")}</span>
            <span>Tamanhos ${esc((grupo.tamanhos || []).join(", ") || "-")}</span>
            <span>Grades ${esc((grupo.grades || []).join(", ") || "-")}</span>
            <span>${esc((grupo.enderecos || []).length)} enderecos</span>
          </div>
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

async function carregar() {
  el.refresh.disabled = true;
  el.fileStatus.textContent = "Lendo planilha";
  el.status.hidden = false;
  el.status.textContent = "Carregando WMS_GERAL...";

  try {
    const resposta = await fetch("/api/wms/baixo-estoque", { cache: "no-store" });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Falha ao carregar dados.");

    state.grupos = dados.resumo || [];
    const contagem = contarPorRisco(state.grupos);

    el.prodcor.textContent = dados.totalProdcor;
    el.itens.textContent = dados.totalItens;
    el.ruptura.textContent = contagem.ruptura;
    el.total.textContent = `${dados.totalLinhasPlanilha} linhas lidas`;
    el.data.textContent = fmtData(dados.atualizadoEm);
    el.fileStatus.textContent = "Planilha sincronizada";

    renderInsights();
    renderGroups();
  } catch (erro) {
    el.groups.innerHTML = "";
    el.status.hidden = false;
    el.status.textContent = erro.message;
    el.fileStatus.textContent = "Erro na leitura";
  } finally {
    el.refresh.disabled = false;
  }
}

el.refresh.addEventListener("click", carregar);
el.search.addEventListener("input", event => {
  state.busca = event.target.value;
  renderGroups();
});
el.sort.addEventListener("change", event => {
  state.ordem = event.target.value;
  renderGroups();
});

carregar();
