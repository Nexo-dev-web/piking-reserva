// Regras de leitura do WMS_GERAL compartilhadas entre o servidor (server.js) e o navegador (browser-api.js).

export const ABA = "WMS_GERAL";
export const FILTROS_FIXOS = {
  galpao: "OD_RJ",
  tipoEnd: "E4AC",
  descricaoContem: "INK"
};

export function txt(valor) {
  return String(valor ?? "").trim();
}

export function num(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const convertido = Number(txt(valor).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(convertido) ? convertido : 0;
}

export function contem(valor, trecho) {
  return txt(valor).toUpperCase().includes(txt(trecho).toUpperCase());
}

function chave(valor) {
  return txt(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function montarLinha(headers, valores) {
  const linha = {};
  headers.forEach((header, index) => {
    linha[chave(header)] = valores[index] ?? "";
  });
  return linha;
}

function normalizarItem(linha, index) {
  return {
    linhaExcel: index + 2,
    endereco: txt(linha.ENDERECO),
    galpao: txt(linha.GALPAO),
    tipoEnd: txt(linha.TIPOEND),
    caixa: txt(linha.CAIXA),
    produto: txt(linha.PRODUTO),
    descProduto: txt(linha.DESCPRODUTO),
    cor: txt(linha.COR),
    tamanho: txt(linha.TAMANHO),
    grade: txt(linha.GRADE),
    quantidadeEstoque: num(linha.QUANTIDADEESTOQUE),
    quantidadeReservada: num(linha.QUANTIDADERESERVADA),
    quantidadeDisponivel: num(linha.QUANTIDADEDISPONIVEL),
    prodcor: txt(linha.PRODCOR),
    txt: txt(linha.TXT)
  };
}

// Recebe um workbook do SheetJS (XLSX) e devolve só as linhas do picking INK.
export function extrairItensBase(XLSX, workbook) {
  const sheet = workbook.Sheets[ABA];
  if (!sheet) {
    const erro = new Error(`Aba ${ABA} não encontrada.`);
    erro.status = 404;
    throw erro;
  }

  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headers = matriz[0] || [];
  const linhas = matriz.slice(1).map(valores => montarLinha(headers, valores));
  const itensBase = linhas
    .map(normalizarItem)
    .filter(item =>
      item.galpao === FILTROS_FIXOS.galpao &&
      item.tipoEnd === FILTROS_FIXOS.tipoEnd &&
      contem(item.descProduto, FILTROS_FIXOS.descricaoContem)
    );

  return { itensBase, totalLinhas: linhas.length };
}

const ordenar = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true });

export function montarResultado({ itensBase, totalLinhas, config, arquivo, arquivoModificadoEm, ignorarLimite = false }) {
  const limiteDisponivel = Math.max(0, Number(config.limiteDisponivel) || 10);

  const itens = itensBase
    .filter(item => ignorarLimite || item.quantidadeDisponivel <= limiteDisponivel)
    .sort((a, b) =>
      ordenar(a.prodcor, b.prodcor) ||
      a.quantidadeDisponivel - b.quantidadeDisponivel ||
      ordenar(a.endereco, b.endereco)
    );

  const grupos = new Map();
  for (const item of itens) {
    if (!grupos.has(item.prodcor)) {
      grupos.set(item.prodcor, {
        prodcor: item.prodcor,
        produto: item.produto,
        descProduto: item.descProduto,
        cor: item.cor,
        menorDisponivel: item.quantidadeDisponivel,
        totalDisponivel: 0,
        caixas: 0,
        tamanhos: new Set(),
        grades: new Set(),
        enderecos: new Set(),
        itens: []
      });
    }

    const grupo = grupos.get(item.prodcor);
    grupo.menorDisponivel = Math.min(grupo.menorDisponivel, item.quantidadeDisponivel);
    grupo.totalDisponivel += item.quantidadeDisponivel;
    grupo.caixas += 1;
    if (item.tamanho) grupo.tamanhos.add(item.tamanho);
    if (item.grade) grupo.grades.add(item.grade);
    if (item.endereco) grupo.enderecos.add(item.endereco);
    grupo.itens.push(item);
  }

  const resumo = Array.from(grupos.values()).map(grupo => ({
    ...grupo,
    tamanhos: Array.from(grupo.tamanhos).sort(ordenar),
    grades: Array.from(grupo.grades).sort(ordenar),
    enderecos: Array.from(grupo.enderecos).sort(ordenar)
  }));

  return {
    arquivo,
    aba: ABA,
    atualizadoEm: new Date().toISOString(),
    arquivoModificadoEm,
    filtros: { ...FILTROS_FIXOS, limiteDisponivel },
    config: { ...config, limiteDisponivel },
    totalLinhasPlanilha: totalLinhas,
    totalItens: itens.length,
    totalProdcor: resumo.length,
    resumo
  };
}
