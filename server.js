import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { spawn } from "node:child_process";
import express from "express";
import XLSX from "xlsx";
import { txt, extrairItensBase, montarResultado } from "./public/wms-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3333);
const CONFIG_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const DEFAULT_PLANILHA = path.resolve(__dirname, "..", "WMS_GERAL 09-05.xlsm");

function configPadrao() {
  return {
    planilhaPath: process.env.WMS_GERAL_PATH || DEFAULT_PLANILHA,
    intervaloMinutos: 1,
    limiteDisponivel: 10,
    atualizarExcelAntesDeLer: true,
    capacidadeCaixa: 50
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

const cachePlanilha = { mtimeMs: null, itensBase: null, totalLinhas: 0 };

function lerItensBase(planilha, stat) {
  if (cachePlanilha.mtimeMs === stat.mtimeMs) {
    return { itensBase: cachePlanilha.itensBase, totalLinhas: cachePlanilha.totalLinhas };
  }

  const { itensBase, totalLinhas } = extrairItensBase(XLSX, XLSX.readFile(planilha, { cellDates: false }));
  cachePlanilha.mtimeMs = stat.mtimeMs;
  cachePlanilha.itensBase = itensBase;
  cachePlanilha.totalLinhas = totalLinhas;
  return { itensBase, totalLinhas };
}

function lerWms({ ignorarLimite = false } = {}) {
  const configAtual = lerConfig();
  const planilha = configAtual.planilhaPath;

  if (!fs.existsSync(planilha)) {
    const erro = new Error(`Planilha não encontrada: ${planilha}`);
    erro.status = 404;
    throw erro;
  }

  const stat = fs.statSync(planilha);
  const { itensBase, totalLinhas } = lerItensBase(planilha, stat);
  return montarResultado({
    itensBase,
    totalLinhas,
    config: configAtual,
    arquivo: planilha,
    arquivoModificadoEm: stat.mtime.toISOString(),
    ignorarLimite
  });
}

function atualizarExcel(planilha) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Atualização automática do Excel só está disponível no Windows."));
      return;
    }

    const caminho = JSON.stringify(planilha);
    const comando = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$origem = ${caminho}
if (!(Test-Path -LiteralPath $origem)) { throw "Arquivo não encontrado: $origem" }
$temp = Join-Path $env:TEMP ("picking-wms-" + [guid]::NewGuid().ToString() + ".xlsm")
Copy-Item -LiteralPath $origem -Destination $temp -Force
$antes = @(Get-Process EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$excel = New-Object -ComObject Excel.Application
$novoPid = $null
for ($tentativa = 0; $tentativa -lt 25 -and -not $novoPid; $tentativa++) {
  Start-Sleep -Milliseconds 200
  $depois = @(Get-Process EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $novoPid = $depois | Where-Object { $antes -notcontains $_ } | Select-Object -First 1
}
if ($novoPid) { Write-Output "EXCEL_PID: $novoPid" }
$excel.Visible = $true
$excel.UserControl = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
$workbook = $null
try {
  $workbook = $excel.Workbooks.Open($temp, 3, $false)
  foreach ($connection in @($workbook.Connections)) {
    try { if ($connection.OLEDBConnection) { $connection.OLEDBConnection.BackgroundQuery = $false } } catch {}
    try { if ($connection.ODBCConnection) { $connection.ODBCConnection.BackgroundQuery = $false } } catch {}
    try {
      $connection.Refresh()
    } catch {
      Write-Output "AVISO_CONEXAO: $($connection.Name) - $($_.Exception.Message)"
    }
  }
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

    const inicioIso = new Date().toISOString();
    const processo = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", comando], {
      windowsHide: true
    });

    let excelPid = null;
    let stdoutBuf = "";
    let stderrBuf = "";
    let finalizado = false;

    function matarExcelOrfao() {
      const scriptLimpeza = `Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -ge (Get-Date "${inicioIso}") } | Stop-Process -Force -ErrorAction SilentlyContinue`;
      spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", scriptLimpeza], { windowsHide: true, detached: true }).unref();
    }

    const limite = setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      processo.kill();
      if (excelPid) {
        try { process.kill(excelPid); } catch {}
      }
      matarExcelOrfao();
      reject(new Error("A automação do Excel não respondeu em até 3 minutos. Verifique se o Excel abriu uma janela pedindo login, senha, permissão de conexão ou confirmação de atualização."));
    }, 180000);

    processo.stdout.on("data", chunk => {
      stdoutBuf += chunk.toString("utf8");
      const encontrado = stdoutBuf.match(/EXCEL_PID:\s*(\d+)/);
      if (encontrado) excelPid = Number(encontrado[1]);
    });
    processo.stderr.on("data", chunk => {
      stderrBuf += chunk.toString("utf8");
    });

    processo.on("error", erro => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(limite);
      reject(erro);
    });

    processo.on("close", codigo => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(limite);
      if (codigo !== 0) {
        reject(new Error(stderrBuf.trim() || `PowerShell saiu com código ${codigo}`));
        return;
      }
      const avisos = stdoutBuf
        .split(/\r?\n/)
        .filter(linha => linha.startsWith("AVISO_CONEXAO:"))
        .map(linha => linha.replace("AVISO_CONEXAO:", "").trim());
      resolve({ avisos });
    });
  });
}

const estadoAtualizacao = {
  emAndamento: false,
  ultimaExecucaoEm: null,
  aviso: "",
  erro: ""
};

let execucaoEmAndamentoPromise = null;

function atualizarExcelSincronizado(planilha) {
  if (execucaoEmAndamentoPromise) return execucaoEmAndamentoPromise;
  estadoAtualizacao.emAndamento = true;
  execucaoEmAndamentoPromise = atualizarExcel(planilha)
    .then(({ avisos }) => {
      estadoAtualizacao.erro = "";
      estadoAtualizacao.aviso = avisos.length
        ? `${avisos.length} conexão(ões) de dados não atualizou(aram): ${avisos.join(" | ")}`
        : "";
      return { avisos };
    })
    .catch(erro => {
      estadoAtualizacao.erro = erro.message;
      throw erro;
    })
    .finally(() => {
      estadoAtualizacao.emAndamento = false;
      estadoAtualizacao.ultimaExecucaoEm = new Date().toISOString();
      execucaoEmAndamentoPromise = null;
    });
  return execucaoEmAndamentoPromise;
}

let temporizadorAtualizacao = null;

function reagendarAtualizacao(configAtual) {
  if (temporizadorAtualizacao) clearInterval(temporizadorAtualizacao);
  temporizadorAtualizacao = null;
  if (!configAtual.atualizarExcelAntesDeLer) return;

  const ms = Math.max(1, Number(configAtual.intervaloMinutos) || 1) * 60 * 1000;
  const rodar = () => {
    atualizarExcelSincronizado(configAtual.planilhaPath).catch(erro => {
      console.error("Falha ao atualizar Excel em segundo plano:", erro.message);
    });
  };
  rodar();
  temporizadorAtualizacao = setInterval(rodar, ms);
}

const app = express();

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: res => res.setHeader("Cache-Control", "no-cache")
}));

app.get("/api/config", (_req, res) => {
  res.json(lerConfig());
});

app.post("/api/config", (req, res) => {
  const planilhaPath = txt(req.body?.planilhaPath);
  const intervaloMinutos = Math.max(1, Math.min(1440, Number(req.body?.intervaloMinutos) || 1));
  const limiteDisponivel = Math.max(0, Math.min(999999, Number(req.body?.limiteDisponivel) || 10));
  const atualizarExcelAntesDeLer = Boolean(req.body?.atualizarExcelAntesDeLer);
  const capacidadeCaixa = Math.max(1, Math.min(9999, Number(req.body?.capacidadeCaixa) || 50));

  if (!planilhaPath) {
    res.status(400).json({ erro: "Informe o caminho da planilha." });
    return;
  }

  const config = { planilhaPath, intervaloMinutos, limiteDisponivel, atualizarExcelAntesDeLer, capacidadeCaixa };
  salvarConfig(config);
  reagendarAtualizacao(config);
  res.json(config);
});

function escolherPlanilhaNoWindows(atual) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialogo = New-Object System.Windows.Forms.OpenFileDialog
$dialogo.Title = "Selecionar planilha WMS"
$dialogo.Filter = "Planilhas Excel (*.xlsm;*.xlsx;*.xls)|*.xlsm;*.xlsx;*.xls|Todos os arquivos (*.*)|*.*"
$atual = $env:PLANILHA_ATUAL
if ($atual) {
  $pasta = Split-Path -Path $atual -Parent -ErrorAction SilentlyContinue
  if ($pasta -and (Test-Path -LiteralPath $pasta)) { $dialogo.InitialDirectory = $pasta }
}
$dono = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($dialogo.ShowDialog($dono) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialogo.FileName
}
$dono.Dispose()`;

  return new Promise((resolve, reject) => {
    const processo = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: { ...process.env, PLANILHA_ATUAL: atual }
    });
    let saida = "";
    let erros = "";
    processo.stdout.on("data", parte => { saida += parte.toString("utf8"); });
    processo.stderr.on("data", parte => { erros += parte.toString("utf8"); });
    processo.on("error", reject);
    processo.on("close", codigo => {
      if (codigo !== 0) reject(new Error(txt(erros) || "Não foi possível abrir a janela de seleção."));
      else resolve(txt(saida));
    });
  });
}

app.post("/api/escolher-planilha", async (req, res, next) => {
  try {
    const caminho = await escolherPlanilhaNoWindows(txt(req.body?.atual) || lerConfig().planilhaPath);
    res.json({ caminho });
  } catch (erro) {
    next(erro);
  }
});

app.post("/api/wms/atualizar-planilha",async (_req, res, next) => {
  try {
    const configAtual = lerConfig();
    const { avisos } = await atualizarExcelSincronizado(configAtual.planilhaPath);
    const avisoAtualizacaoExcel = avisos.length
      ? `Planilha salva, mas ${avisos.length} conexão(ões) de dados não atualizou(aram): ${avisos.join(" | ")}`
      : "";
    res.json({ ok: true, atualizadoEm: new Date().toISOString(), avisoAtualizacaoExcel });
  } catch (erro) {
    next(erro);
  }
});

app.get("/api/wms/baixo-estoque", (_req, res, next) => {
  try {
    const dados = lerWms();
    const exibirAvisoAtualizacao = dados.config.atualizarExcelAntesDeLer;
    res.json({
      ...dados,
      avisoAtualizacaoExcel: exibirAvisoAtualizacao ? (estadoAtualizacao.erro || estadoAtualizacao.aviso || "") : "",
      atualizandoExcelAgora: estadoAtualizacao.emAndamento,
      ultimaAtualizacaoExcelEm: estadoAtualizacao.ultimaExecucaoEm
    });
  } catch (erro) {
    next(erro);
  }
});

app.get("/api/wms/todos-produtos", (_req, res, next) => {
  try {
    res.json(lerWms({ ignorarLimite: true }));
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
  reagendarAtualizacao(configAtual);
});
