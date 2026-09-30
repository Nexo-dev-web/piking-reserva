// Quando o painel roda sem o server.js (ex.: Netlify), responde as rotas /api/* direto no navegador:
// a planilha é escolhida pelo usuário, lida com SheetJS e processada pelas mesmas regras do servidor.
import { txt, extrairItensBase, montarResultado } from "./wms-core.js";

const CHAVE_CONFIG = "picking-radar-config";
const DB_NOME = "picking-radar";
const DB_STORE = "arquivos";

let modo = null;
let handleArquivo = null;
let arquivoAvulso = null;
const cache = { assinatura: null, itensBase: null, totalLinhas: 0 };

export async function detectarModo() {
  if (modo) return modo;
  try {
    const resposta = await fetch("/api/config", { cache: "no-store" });
    const tipo = resposta.headers.get("content-type") || "";
    modo = resposta.ok && tipo.includes("application/json") ? "servidor" : "navegador";
  } catch {
    modo = "navegador";
  }
  if (modo === "navegador") handleArquivo = await lerHandleSalvo();
  return modo;
}

export const modoNavegador = () => modo === "navegador";
export const suportaReleitura = () => typeof window.showOpenFilePicker === "function";

export async function precisaPermissao() {
  if (!handleArquivo) return false;
  try { return (await handleArquivo.queryPermission({ mode: "read" })) !== "granted"; } catch { return true; }
}

export function arquivoSelecionado() {
  return Boolean(handleArquivo || arquivoAvulso);
}

export async function api(url, opcoes = {}) {
  if (!modo) await detectarModo();
  if (modo === "servidor") return fetch(url, opcoes);
  try {
    return responder(await rotaLocal(url.split("?")[0], (opcoes.method || "GET").toUpperCase(), opcoes.body));
  } catch (erro) {
    return responder({ erro: erro.message || "Erro ao ler a planilha." }, erro.status || 500);
  }
}

function responder(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json" } });
}

function rotaLocal(rota, metodo, corpo) {
  if (rota === "/api/config" && metodo === "GET") return lerConfig();
  if (rota === "/api/config" && metodo === "POST") return salvarConfig(JSON.parse(corpo || "{}"));
  if (rota === "/api/escolher-planilha") return escolherArquivo();
  if (rota === "/api/wms/baixo-estoque") return lerWms(false);
  if (rota === "/api/wms/todos-produtos") return lerWms(true);
  if (rota === "/api/wms/atualizar-planilha") {
    throw erroComStatus("Pelo navegador não dá para abrir o Excel e atualizar as conexões. Atualize e salve a planilha no Excel; o painel relê o arquivo sozinho.", 400);
  }
  throw erroComStatus("Rota não encontrada.", 404);
}

function erroComStatus(mensagem, status) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function nomeArquivo() {
  return handleArquivo?.name || arquivoAvulso?.name || "";
}

function lerConfig() {
  let salvo = {};
  try { salvo = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || "{}"); } catch {}
  return {
    intervaloMinutos: 1,
    limiteDisponivel: 10,
    capacidadeCaixa: 50,
    capacidadePorTipo: "",
    ...salvo,
    atualizarExcelAntesDeLer: false,
    planilhaPath: nomeArquivo()
  };
}

function salvarConfig(corpo) {
  if (!arquivoSelecionado()) throw erroComStatus('Clique em "Selecionar planilha" e escolha o arquivo WMS_GERAL.', 400);
  const config = {
    intervaloMinutos: Math.max(1, Math.min(1440, Number(corpo.intervaloMinutos) || 1)),
    limiteDisponivel: Math.max(0, Math.min(999999, Number(corpo.limiteDisponivel) || 10)),
    capacidadeCaixa: Math.max(1, Math.min(9999, Number(corpo.capacidadeCaixa) || 50)),
    capacidadePorTipo: String(corpo.capacidadePorTipo ?? "").slice(0, 4000)
  };
  try { localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config)); } catch {}
  return lerConfig();
}

// Chamado direto do clique: não pode haver await antes de abrir a janela.
function escolherArquivo() {
  if (suportaReleitura()) {
    return window.showOpenFilePicker({
      id: "planilha-wms",
      types: [{ description: "Planilha Excel", accept: { "application/vnd.ms-excel": [".xlsm", ".xlsx", ".xls"] } }],
      multiple: false
    }).then(async ([handle]) => {
      handleArquivo = handle;
      arquivoAvulso = null;
      cache.assinatura = null;
      await salvarHandle(handle);
      return { caminho: handle.name };
    }, erro => {
      if (erro?.name === "AbortError") return { caminho: nomeArquivo() };
      throw erro;
    });
  }

  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsm,.xlsx,.xls";
    input.addEventListener("change", () => {
      if (input.files?.[0]) {
        arquivoAvulso = input.files[0];
        handleArquivo = null;
        cache.assinatura = null;
      }
      resolve({ caminho: nomeArquivo() });
    });
    input.addEventListener("cancel", () => resolve({ caminho: nomeArquivo() }));
    input.click();
  });
}

let permissaoPendente = null;

async function garantirPermissao(handle) {
  if ((await handle.queryPermission({ mode: "read" })) === "granted") return true;
  permissaoPendente ||= handle.requestPermission({ mode: "read" })
    .then(estado => estado === "granted", () => false)
    .finally(() => { permissaoPendente = null; });
  return permissaoPendente;
}

async function obterArquivo() {
  if (handleArquivo) {
    if (!(await garantirPermissao(handleArquivo))) {
      throw erroComStatus(`O navegador precisa da sua permissão para ler "${handleArquivo.name}" de novo. Abra Configurar e clique em "Entrar no painel".`, 403);
    }
    return handleArquivo.getFile();
  }
  if (arquivoAvulso) return arquivoAvulso;
  throw erroComStatus('Nenhuma planilha selecionada. Abra Configurar e clique em "Selecionar planilha".', 400);
}

let leituraPendente = null;

async function lerPlanilha(arquivo) {
  const assinatura = `${arquivo.name}|${arquivo.size}|${arquivo.lastModified}`;
  if (cache.assinatura === assinatura) return;
  if (leituraPendente?.assinatura === assinatura) return leituraPendente.promessa;

  const promessa = (async () => {
    let buffer;
    try {
      buffer = await arquivo.arrayBuffer();
    } catch {
      throw erroComStatus(`Não foi possível ler "${arquivo.name}". Se a planilha foi alterada ou movida, selecione o arquivo de novo.`, 409);
    }
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: false });
    Object.assign(cache, extrairItensBase(window.XLSX, workbook), { assinatura });
  })().finally(() => { leituraPendente = null; });

  leituraPendente = { assinatura, promessa };
  return promessa;
}

async function lerWms(ignorarLimite) {
  const arquivo = await obterArquivo();
  await lerPlanilha(arquivo);

  return {
    ...montarResultado({
      itensBase: cache.itensBase,
      totalLinhas: cache.totalLinhas,
      config: lerConfig(),
      arquivo: txt(arquivo.name),
      arquivoModificadoEm: new Date(arquivo.lastModified).toISOString(),
      ignorarLimite
    }),
    avisoAtualizacaoExcel: ""
  };
}

function abrirDb() {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(DB_NOME, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(DB_STORE);
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

async function salvarHandle(handle) {
  try {
    const db = await abrirDb();
    db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(handle, "planilha");
  } catch {}
}

async function lerHandleSalvo() {
  try {
    const db = await abrirDb();
    return await new Promise(resolve => {
      const pedido = db.transaction(DB_STORE).objectStore(DB_STORE).get("planilha");
      pedido.onsuccess = () => resolve(pedido.result || null);
      pedido.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
