import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3333);
const PLANILHA = process.env.WMS_GERAL_PATH || path.resolve(__dirname, "..", "WMS_GERAL 09-05.xlsm");
const ABA = "WMS_GERAL";
const FILTROS = {
  galpao: "OD_RJ",
  tipoEnd: "E4AC",
  descricaoContem: "INK",
  quantidadeDisponivelMenorQue: 10
};

function txt(valor) {
  return String(valor ?? "").trim();
}

function num(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const convertido = Number(txt(valor).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(convertido) ? convertido : 0;
}

function contem(valor, trecho) {
  return txt(valor).toUpperCase().includes(txt(trecho).toUpperCase());
}

function lerWms() {
  if (!fs.existsSync(PLANILHA)) {
    const erro = new Error(`Planilha nao encontrada: ${PLANILHA}`);
    erro.status = 404;
    throw erro;
  }

  const workbook = XLSX.readFile(PLANILHA, { cellDates: false });
  const sheet = workbook.Sheets[ABA];
  if (!sheet) {
    const erro = new Error(`Aba ${ABA} nao encontrada.`);
    erro.status = 404;
    throw erro;
  }

  const linhas = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  const itens = linhas
    .map((linha, index) => ({
      linhaExcel: index + 2,
      endereco: txt(linha["ENDEREÇO"]),
      galpao: txt(linha["GALPÃO"]),
      tipoEnd: txt(linha.TIPO_END),
      caixa: txt(linha.CAIXA),
      produto: txt(linha.PRODUTO),
      descProduto: txt(linha.DESC_PRODUTO),
      cor: txt(linha.COR),
      tamanho: txt(linha.TAMANHO),
      grade: txt(linha.GRADE),
      quantidadeEstoque: num(linha.QUANTIDADEESTOQUE),
      quantidadeReservada: num(linha.QUANTIDADERESERVADA),
      quantidadeDisponivel: num(linha.QUANTIDADEDISPONIVEL),
      prodcor: txt(linha.PRODCOR),
      txt: txt(linha.Txt)
    }))
    .filter(item =>
      item.galpao === FILTROS.galpao &&
      item.tipoEnd === FILTROS.tipoEnd &&
      contem(item.descProduto, FILTROS.descricaoContem) &&
      item.quantidadeDisponivel < FILTROS.quantidadeDisponivelMenorQue
    )
    .sort((a, b) =>
      a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true }) ||
      a.quantidadeDisponivel - b.quantidadeDisponivel ||
      a.endereco.localeCompare(b.endereco, "pt-BR", { numeric: true })
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
    tamanhos: Array.from(grupo.tamanhos).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
    grades: Array.from(grupo.grades).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
    enderecos: Array.from(grupo.enderecos).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
  }));

  return {
    arquivo: PLANILHA,
    aba: ABA,
    atualizadoEm: new Date().toISOString(),
    filtros: FILTROS,
    totalLinhasPlanilha: linhas.length,
    totalItens: itens.length,
    totalProdcor: resumo.length,
    resumo
  };
}

const app = express();

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/wms/baixo-estoque", (_req, res, next) => {
  try {
    res.json(lerWms());
  } catch (erro) {
    next(erro);
  }
});

app.use((erro, _req, res, _next) => {
  res.status(erro.status || 500).json({ erro: erro.message || "Erro ao ler a planilha." });
});

app.listen(PORT, () => {
  console.log(`WMS web em http://localhost:${PORT}`);
  console.log(`Planilha: ${PLANILHA}`);
});
