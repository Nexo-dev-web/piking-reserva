import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { execFile } from "node:child_process";
import express from "express";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3333);
const CONFIG_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const DEFAULT_PLANILHA = path.resolve(__dirname, "..", "WMS_GERAL 09-05.xlsm");
const ABA = "WMS_GERAL";
const FILTROS_FIXOS = {
  galpao: "OD_RJ",
  tipoEnd: "E4AC",
  descricaoContem: "INK"
};

function configPadrao() {
  return {
    planilhaPath: process.env.WMS_GERAL_PATH || DEFAULT_PLANILHA,
    intervaloMinutos: 5,
    limiteDisponivel: 10,
    atualizarExcelAntesDeLer: false
  };
}

function lerConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return configPadrao();
  try {
    return { ...configPadrao(), ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) };
  } catch {
    return configPadrao();
  }
}

function salvarConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

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

function lerWms() {
  const configAtual = lerConfig();
  const planilha = configAtual.planilhaPath;
  const limiteDisponivel = Math.max(0, Number(configAtual.limiteDisponivel) || 10);

  if (!fs.existsSync(planilha)) {
    const erro = new Error(`Planilha não encontrada: ${planilha}`);
    erro.status = 404;
    throw erro;
  }

  const stat = fs.statSync(planilha);
  const workbook = XLSX.readFile(planilha, { cellDates: false });
  const sheet = workbook.Sheets[ABA];
  if (!sheet) {
    const erro = new Error(`Aba ${ABA} não encontrada.`);
    erro.status = 404;
    throw erro;
  }

  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headers = matriz[0] || [];
  const linhas = matriz.slice(1).map(valores => montarLinha(headers, valores));
  const itens = linhas
    .map(normalizarItem)
    .filter(item =>
      item.galpao === FILTROS_FIXOS.galpao &&
      item.tipoEnd === FILTROS_FIXOS.tipoEnd &&
      contem(item.descProduto, FILTROS_FIXOS.descricaoContem) &&
      item.quantidadeDisponivel <= limiteDisponivel
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
    arquivo: planilha,
    aba: ABA,
    atualizadoEm: new Date().toISOString(),
    arquivoModificadoEm: stat.mtime.toISOString(),
    filtros: { ...FILTROS_FIXOS, limiteDisponivel },
    config: { ...configAtual, limiteDisponivel },
    totalLinhasPlanilha: linhas.length,
    totalItens: itens.length,
    totalProdcor: resumo.length,
    resumo
  };
}

function atualizarExcel(planilha) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Atualização automática do Excel só está disponível no Windows."));
      return;
    }

    const caminho = JSON.stringify(planilha);
    const comando = `
$ErrorActionPreference = 'Stop'
$origem = ${caminho}
if (!(Test-Path -LiteralPath $origem)) { throw "Arquivo nao encontrado: $origem" }
$temp = Join-Path $env:TEMP ("picking-wms-" + [guid]::NewGuid().ToString() + ".xlsm")
Copy-Item -LiteralPath $origem -Destination $temp -Force
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
$workbook = $null
try {
  $workbook = $excel.Workbooks.Open($temp, 3, $false)
  foreach ($connection in @($workbook.Connections)) {
    try { $connection.Refresh() } catch {}
  }
  $workbook.RefreshAll()
  $excel.CalculateUntilAsyncQueriesDone()
  Start-Sleep -Seconds 12
  $excel.CalculateFullRebuild()
  $workbook.Save()
  $workbook.Close($true)
  Copy-Item -LiteralPath $temp -Destination $origem -Force
} finally {
  if ($workbook -ne $null) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null }
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}`;

    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", comando], {
      windowsHide: true,
      timeout: 180000
    }, (erro, stdout, stderr) => {
      if (erro) {
        reject(new Error(stderr || erro.message));
        return;
      }
      resolve(stdout);
    });
  });
}

const app = express();

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  res.json(lerConfig());
});

app.post("/api/config", (req, res) => {
  const planilhaPath = txt(req.body?.planilhaPath);
  const intervaloMinutos = Math.max(1, Math.min(1440, Number(req.body?.intervaloMinutos) || 5));
  const limiteDisponivel = Math.max(0, Math.min(999999, Number(req.body?.limiteDisponivel) || 10));
  const atualizarExcelAntesDeLer = Boolean(req.body?.atualizarExcelAntesDeLer);

  if (!planilhaPath) {
    res.status(400).json({ erro: "Informe o caminho da planilha." });
    return;
  }

  const config = { planilhaPath, intervaloMinutos, limiteDisponivel, atualizarExcelAntesDeLer };
  salvarConfig(config);
  res.json(config);
});

app.post("/api/wms/atualizar-planilha", async (_req, res, next) => {
  try {
    const configAtual = lerConfig();
    await atualizarExcel(configAtual.planilhaPath);
    res.json({ ok: true, atualizadoEm: new Date().toISOString() });
  } catch (erro) {
    next(erro);
  }
});

app.get("/api/wms/baixo-estoque", async (_req, res, next) => {
  try {
    const configAtual = lerConfig();
    let avisoAtualizacaoExcel = "";
    if (configAtual.atualizarExcelAntesDeLer) {
      try {
        await atualizarExcel(configAtual.planilhaPath);
      } catch (erro) {
        avisoAtualizacaoExcel = `Excel não atualizou. Lendo a última versão salva. ${erro.message}`;
      }
    }
    res.json({ ...lerWms(), avisoAtualizacaoExcel });
  } catch (erro) {
    next(erro);
  }
});

app.use((erro, _req, res, _next) => {
  res.status(erro.status || 500).json({ erro: erro.message || "Erro ao ler a planilha." });
});

app.listen(PORT, () => {
  const configAtual = lerConfig();
  console.log(`WMS web em http://localhost:${PORT}`);
  console.log(`Planilha: ${configAtual.planilhaPath}`);
});
