const React = window.React;
const { useEffect, useRef, useState } = React;
import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const h = React.createElement;
const LEVEL_ORDER = [10, 20, 30, 40, 50];
const WALK_SPEED = 6.2;
const WALK_EYE_HEIGHT = 1.7;

function txt(valor) {
  return String(valor ?? "").trim();
}

function parseEndereco(endereco) {
  const raw = txt(endereco);
  const match = /^E(?<zona>\d+)(?<rua>AC\d{2})P(?<prateleira>\d{2})L(?<coluna>\d{4})$/.exec(raw);
  if (!match?.groups) return { raw, valido: false };

  const prateleira = Number(match.groups.prateleira);
  const colunaRaw = match.groups.coluna;
  const colunaBase = colunaRaw.slice(0, 2);
  const colunaAltura = Number(colunaBase);

  return {
    raw,
    valido: true,
    zona: `E${match.groups.zona}`,
    rua: match.groups.rua,
    prateleira,
    paridade: Number.isFinite(prateleira) && prateleira % 2 === 0 ? "par" : "ímpar",
    coluna: `L${colunaRaw}`,
    colunaBase,
    colunaAltura,
    colunaFaixa: {
      10: "embaixo",
      20: "no meio",
      30: "mais alta",
      40: "altura do peito",
      50: "altura da cabeca"
    }[colunaAltura] || "na coluna"
  };
}

function corQtd(qtd, limite = 10) {
  const valor = Math.max(0, Math.min(limite, qtd));
  const t = limite > 0 ? valor / limite : 0;
  const color = new THREE.Color();
  if (t < 0.5) color.setHSL(0.02 - t * 0.05, 0.9, 0.45 + t * 0.1);
  else color.setHSL(0.26 - (t - 0.5) * 0.18, 0.75, 0.38 + (t - 0.5) * 0.12);
  return color;
}

function corOcupacao(pct) {
  if (pct >= 67) return 0x22c55e;
  if (pct >= 34) return 0xf59e0b;
  return 0xf43f5e;
}

function corRisco(qtd, limite = 10) {
  const valor = Number.isFinite(qtd) ? qtd : limite + 1;
  if (valor <= 5) return 0xf43f5e;
  if (valor <= limite) return 0xf59e0b;
  return 0x22c55e;
}

function nivelOcupacaoTxt(pct) {
  if (pct >= 67) return "saudável";
  if (pct >= 34) return "atenção";
  return "crítico";
}

function nivelQtd(qtd) {
  if (qtd <= 2) return "rupture";
  if (qtd <= 5) return "critical";
  return "attention";
}

function rackHeights() {
  return new Map([
    [10, 0.9],
    [20, 2.55],
    [30, 4.2],
    [40, 5.85],
    [50, 7.5]
  ]);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const paragraphs = String(text).split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
  }
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((entry, index) => ctx.fillText(entry, x, startY + index * lineHeight));
}

function makeSprite(texto, { bg = "rgba(17, 24, 39, .9)", fg = "#fff", size = 44, scale = [3.4, 1.7] } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bg;
  roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 28);
  ctx.fill();

  ctx.fillStyle = fg;
  ctx.font = `900 ${size}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  wrapText(ctx, texto, canvas.width / 2, canvas.height / 2, canvas.width - 60, size + 10);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale[0], scale[1], 1);
  return sprite;
}

function disposeNode(node) {
  if (node.geometry) node.geometry.dispose?.();
  if (node.material) {
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value?.isTexture) value.dispose?.();
      }
      material.dispose?.();
    }
  }
  for (const child of node.children || []) disposeNode(child);
}

class Location3DErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("[location-3d]", error);
  }

  render() {
    if (this.state.error) {
      return h(
        "div",
        { className: "wms-3d-shell empty" },
        h(
          "div",
          { className: "wms-3d-empty" },
          h("strong", null, "Falha ao montar o 3D"),
          h("span", null, this.state.error?.message || "Erro inesperado na cena.")
        )
      );
    }
    return this.props.children;
  }
}

function Legend({ modo }) {
  return h(
    "div",
    { className: "wms-3d-legend" },
    h(
      "div",
      { className: "wms-3d-legend-colors" },
      h("span", { className: "dot alta" }), h("small", null, "sem prodcor em baixo estoque"),
      h("span", { className: "dot media" }), h("small", null, "tem prodcor em atenção"),
      h("span", { className: "dot baixa" }), h("small", null, "tem prodcor crítico/ruptura")
    ),
    modo === "corredor"
      ? h("div", { className: "wms-3d-legend-glossario" }, h("small", null, "Cada bloco mostra PRODUTO, CAIXA e ENDEREÇO completo. P19 = prateleira 19 · L10/L20/L50 = altura/coluna."))
      : null,
    h(
      "div",
      { className: "wms-3d-legend-controls" },
      modo === "corredor"
        ? h("small", null, "Arraste = olhar · Scroll = zoom · WASD/setas = andar · Clique numa caixa pra ver os detalhes")
        : h("small", null, "Arraste = girar · Scroll = zoom · Clique num pilar pra abrir o corredor")
    )
  );
}

function WarehouseScene({ data }) {
  const hostRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d14);
    scene.fog = new THREE.Fog(0x090d14, 34, 190);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    camera.position.set(0, 10, 32);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(host.clientWidth || 800, host.clientHeight || 520);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x090d14, 1);
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 4.8, 0);
    controls.minDistance = 1.5;
    controls.maxDistance = 95;
    controls.maxPolarAngle = 1.5;
    controls.rotateSpeed = 0.5;
    controls.panSpeed = 0.18;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2233, 1.35));

    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(-8, 20, 12);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 90;
    dir.shadow.camera.left = -30;
    dir.shadow.camera.right = 30;
    dir.shadow.camera.top = 30;
    dir.shadow.camera.bottom = -30;
    scene.add(dir);

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    const debugGrid = new THREE.GridHelper(60, 60, 0x243042, 0x18202d);
    debugGrid.position.y = 0.01;
    scene.add(debugGrid);

    const levelYs = rackHeights();
    const clock = new THREE.Clock();
    const modeRef = { current: "geral" };
    const keysRef = { current: new Set() };
    const walkBoundsRef = { current: null };
    const pulsesRef = { current: [] };
    const clickTargetsRef = { current: [] };
    const proximityTagsRef = { current: [] };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = null;

    const clearScene = () => {
      while (dynamicGroup.children.length) {
        const child = dynamicGroup.children[0];
        disposeNode(child);
        dynamicGroup.remove(child);
      }
    };

    const buildOverview = payload => {
      const ruas = Array.isArray(payload?.ruas)
        ? payload.ruas.slice().sort((a, b) => (a.numero || 0) - (b.numero || 0))
        : [];
      const ocupacaoPorRua = payload?.ocupacaoPorRua || {};
      const piorRuaGeral = payload?.piorRuaGeral || null;
      const limiteDisponivel = Number(payload?.limiteDisponivel) || 10;

      if (!ruas.length) {
        const empty = makeSprite("Nenhum corredor encontrado com os filtros atuais", { bg: "rgba(153, 27, 27, .85)", fg: "#fff", size: 32, scale: [5.2, 2.2] });
        if (empty) {
          empty.position.set(0, 4, 0);
          dynamicGroup.add(empty);
        }
        return { totalWidth: 10 };
      }

      const spacing = 6.4;
      const totalWidth = (ruas.length - 1) * spacing;
      const startX = -totalWidth / 2;

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(spacing * ruas.length + 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x0b0f16, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      dynamicGroup.add(floor);

      ruas.forEach((ruaInfo, index) => {
        const rua = ruaInfo.rua;
        const info = ocupacaoPorRua[rua] || null;
        const piorPct = typeof info?.piorPct === "number" ? info.piorPct : 0;
        const mediaPct = typeof info?.mediaPct === "number" ? info.mediaPct : 0;
        const menorDisponivel = typeof info?.menorDisponivel === "number" ? info.menorDisponivel : limiteDisponivel + 1;
        const cor = corRisco(menorDisponivel, limiteDisponivel);
        const ehPior = rua === piorRuaGeral;
        const x = startX + index * spacing;
        const alturaBase = 2.6 + ((100 - piorPct) / 100) * 6.6;

        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.95, 1.15, alturaBase, 22),
          new THREE.MeshStandardMaterial({
            color: cor,
            emissive: new THREE.Color(cor).multiplyScalar(ehPior ? 0.55 : 0.3),
            emissiveIntensity: ehPior ? 1.15 : 0.55,
            metalness: 0.25,
            roughness: 0.4
          })
        );
        pillar.position.set(x, alturaBase / 2, 0);
        pillar.castShadow = true;
        pillar.userData.rua = rua;
        dynamicGroup.add(pillar);
        clickTargetsRef.current.push({ mesh: pillar, rua });

        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(1.7, 1.7, 0.2, 26),
          new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 })
        );
        base.position.set(x, 0.1, 0);
        dynamicGroup.add(base);

        const nomeLabel = makeSprite(rua, { bg: ehPior ? "rgba(244, 63, 94, .95)" : "rgba(15, 23, 42, .92)", fg: "#fff", size: 62, scale: [3.6, 1.8] });
        if (nomeLabel) {
          nomeLabel.position.set(x, alturaBase + 2.15, 0);
          dynamicGroup.add(nomeLabel);
        }

        const detalheTxt = `Pior: Prateleira ${info?.piorPrateleira != null ? String(info.piorPrateleira).padStart(2, "0") : "--"} - só ${menorDisponivel} disponível\n${info?.rupturas ?? 0} de ${info?.totalCaixas ?? 0} caixas em baixo estoque`;
        const detalhe = makeSprite(detalheTxt, { bg: "rgba(17, 24, 39, .88)", fg: "#e2e8f0", size: 24, scale: [3.1, 1.7] });
        if (detalhe) {
          detalhe.position.set(x, alturaBase + 0.85, 0);
          dynamicGroup.add(detalhe);
        }

        const pctBadge = makeSprite(`${menorDisponivel}`, { bg: `rgba(${(cor >> 16) & 255}, ${(cor >> 8) & 255}, ${cor & 255}, .95)`, fg: "#0b1220", size: 46, scale: [1.35, 0.85] });
        if (pctBadge) {
          pctBadge.position.set(x, alturaBase * 0.55, 1.35);
          dynamicGroup.add(pctBadge);
        }

        if (ehPior) {
          const flag = makeSprite("ATACAR AQUI", { bg: "rgba(244, 63, 94, .96)", fg: "#fff", size: 34, scale: [3.0, 1.15] });
          if (flag) {
            flag.position.set(x, alturaBase + 3.2, 0);
            dynamicGroup.add(flag);
            pulsesRef.current.push({ kind: "scale", obj: flag, base: [3.0, 1.15], speed: 3.4, phase: 0, amount: 0.14 });
          }
          const beacon = new THREE.PointLight(cor, 2.6, 13, 2);
          beacon.position.set(x, alturaBase + 1.1, 0.7);
          dynamicGroup.add(beacon);
          pulsesRef.current.push({ kind: "light", obj: beacon, base: 2.6, speed: 3.2, phase: 0.4 });
        }
      });

      return { totalWidth };
    };

    const buildCorredor = payload => {
      const itens = Array.isArray(payload?.itensRua) ? payload.itensRua : [];
      const ocupacaoPorPrateleira = payload?.ocupacaoPorPrateleira || {};
      const limiteDisponivel = Number(payload?.limiteDisponivel) || 10;
      const selectedRua = txt(payload?.ruaSelecionada || payload?.filtros?.rua || "");
      const focoItem = payload?.itemFoco || null;
      const focoEndereco = txt(focoItem?.endereco);
      const focoCaixa = txt(focoItem?.caixa);
      let focoPos = null;
      const bayCenters = new Map();

      const porLado = { "ímpar": new Map(), par: new Map() };
      for (const item of itens) {
        const info = parseEndereco(item.endereco);
        if (!info.valido) continue;
        const lado = info.paridade === "par" ? "par" : "ímpar";
        if (!porLado[lado].has(info.prateleira)) porLado[lado].set(info.prateleira, []);
        porLado[lado].get(info.prateleira).push({ ...item, info });
      }

      const prateleiras = Array.from(new Set(itens.map(item => parseEndereco(item.endereco).prateleira).filter(Boolean))).sort((a, b) => a - b);
      const depthStep = 4.6;
      const startZ = prateleiras.length ? -((prateleiras.length - 1) * depthStep) / 2 : 0;

      const entranceTitle = makeSprite(selectedRua ? `Corredor ${selectedRua}` : "Corredor em foco", { bg: "rgba(244, 63, 94, .9)", fg: "#fff", size: 42, scale: [3.4, 1.5] });
      if (entranceTitle) {
        entranceTitle.position.set(0, 5.2, startZ + 1.5);
        dynamicGroup.add(entranceTitle);
      }

      const aisleLight = new THREE.Mesh(
        new THREE.PlaneGeometry(2.7, Math.max(10, prateleiras.length * depthStep + 10)),
        new THREE.MeshStandardMaterial({ color: 0x111827, transparent: true, opacity: 0.9, roughness: 1 })
      );
      aisleLight.rotation.x = -Math.PI / 2;
      aisleLight.position.y = 0.03;
      dynamicGroup.add(aisleLight);

      const aisleStrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.05, Math.max(10, prateleiras.length * depthStep + 8)),
        new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0x6b1220, emissiveIntensity: 0.42, roughness: 0.3 })
      );
      aisleStrip.position.y = 0.06;
      dynamicGroup.add(aisleStrip);

      if (!prateleiras.length) {
        const empty = makeSprite("Nenhum item encontrado nesta rua", { bg: "rgba(153, 27, 27, .85)", fg: "#fff", size: 34 });
        if (empty) {
          empty.position.set(0, 5.5, 0);
          dynamicGroup.add(empty);
        }
      }

      const addItemBox = (item, sideX, bayZ, slotIndex, slotCount) => {
        const boxW = 1.05;
        const boxH = 0.68;
        const boxD = 0.76;
        const localWidth = 4.9;
        const spacing = slotCount > 1 ? localWidth / (slotCount + 1) : 0;
        const localX = slotCount > 1 ? -localWidth / 2 + spacing * (slotIndex + 1) : 0;
        const y = levelYs.get(item.info.colunaAltura) ?? 0.9;
        const color = corQtd(item.quantidadeDisponivel, 10);
        const material = new THREE.MeshStandardMaterial({
          color,
          emissive: color.clone().multiplyScalar(0.14),
          roughness: 0.48,
          metalness: 0.08
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), material);
        mesh.position.set(sideX + localX, y, bayZ + (sideX < 0 ? -0.36 : 0.36));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.item = {
          prodcor: item.prodcor,
          descProduto: item.descProduto,
          cor: item.cor,
          tamanho: item.tamanho,
          grade: item.grade,
          caixa: item.caixa,
          endereco: item.endereco,
          quantidadeEstoque: item.quantidadeEstoque,
          quantidadeReservada: item.quantidadeReservada,
          quantidadeDisponivel: item.quantidadeDisponivel
        };
        dynamicGroup.add(mesh);
        clickTargetsRef.current.push({ mesh, item: mesh.userData.item });

        const itemEndereco = txt(item.endereco);
        const itemCaixa = txt(item.caixa);
        const focoCoincide = focoEndereco && focoCaixa
          ? itemEndereco === focoEndereco && itemCaixa === focoCaixa
          : focoEndereco
            ? itemEndereco === focoEndereco
            : false;
        if (focoCoincide || (!focoPos && focoItem && itemEndereco === txt(focoItem.endereco))) {
          focoPos = mesh.position.clone();
        }

        const tag = makeSprite(`Produto: ${item.prodcor}\nCaixa: ${item.caixa || "sem caixa"}\nEndereço: ${item.endereco}`, {
          bg: "rgba(15, 23, 42, .94)",
          fg: "#fff",
          size: 20,
          scale: [2.7, 1.4]
        });
        if (tag) {
          tag.position.set(mesh.position.x, mesh.position.y + 0.92, mesh.position.z);
          dynamicGroup.add(tag);
          proximityTagsRef.current.push(tag);
          tag.userData.item = mesh.userData.item;
          clickTargetsRef.current.push({ mesh: tag, item: mesh.userData.item });
        }

        const qtdTag = makeSprite(`${item.quantidadeDisponivel}`, {
          bg: item.quantidadeDisponivel <= 2 ? "rgba(244, 63, 94, .95)" : item.quantidadeDisponivel <= 5 ? "rgba(251, 146, 60, .95)" : "rgba(34, 197, 94, .9)",
          fg: "#fff",
          size: 50,
          scale: [0.42, 0.3]
        });
        if (qtdTag) {
          qtdTag.position.set(mesh.position.x, mesh.position.y + boxH / 2 + 0.14, mesh.position.z);
          dynamicGroup.add(qtdTag);
          qtdTag.userData.item = mesh.userData.item;
          clickTargetsRef.current.push({ mesh: qtdTag, item: mesh.userData.item });
        }
      };

      const buildSide = (sideKey, xPos) => {
        const prateleirasSide = Array.from(porLado[sideKey].keys()).sort((a, b) => a - b);
        prateleirasSide.forEach((prateleira, index) => {
          const bayItems = porLado[sideKey].get(prateleira) || [];
          const groupedLevels = new Map();
          for (const item of bayItems) {
            const level = item.info.colunaAltura || 0;
            if (!groupedLevels.has(level)) groupedLevels.set(level, []);
            groupedLevels.get(level).push(item);
          }

          const bayGroup = new THREE.Group();
          bayGroup.position.set(xPos, 0, startZ + index * depthStep);
          bayCenters.set(prateleira, bayGroup.position.clone());

          const ocupacao = ocupacaoPorPrateleira[prateleira] || null;
          const pct = typeof ocupacao?.pct === "number" ? ocupacao.pct : null;
          const menorDisponivelBay = typeof ocupacao?.menorDisponivel === "number" ? ocupacao.menorDisponivel : null;
          const frameColor = menorDisponivelBay === null ? (sideKey === "ímpar" ? 0xf59e0b : 0x38bdf8) : corRisco(menorDisponivelBay, limiteDisponivel);
          const frameMaterial = new THREE.MeshStandardMaterial({ color: frameColor, metalness: 0.4, roughness: 0.45 });
          const postGeo = new THREE.BoxGeometry(0.13, 7.0, 0.13);
          const beamGeo = new THREE.BoxGeometry(7.0, 0.11, 0.13);
          const depthGeo = new THREE.BoxGeometry(0.13, 0.11, 2.05);

          const leftPost = new THREE.Mesh(postGeo, frameMaterial);
          leftPost.position.set(-3.45, 3.5, 0);
          bayGroup.add(leftPost);
          const rightPost = new THREE.Mesh(postGeo, frameMaterial);
          rightPost.position.set(3.45, 3.5, 0);
          bayGroup.add(rightPost);

          [0.18, 1.38, 2.58, 3.78, 4.98, 6.18].forEach(y => {
            const beam = new THREE.Mesh(beamGeo, frameMaterial);
            beam.position.set(0, y, 0);
            bayGroup.add(beam);
          });
          [-1.0, 1.0].forEach(z => {
            const depthBar = new THREE.Mesh(depthGeo, frameMaterial);
            depthBar.position.set(0, 0.36, z);
            bayGroup.add(depthBar);
            const depthBarTop = new THREE.Mesh(depthGeo, frameMaterial);
            depthBarTop.position.set(0, 6.68, z);
            bayGroup.add(depthBarTop);
          });

          const rackBase = new THREE.Mesh(
            new THREE.BoxGeometry(7.45, 0.16, 2.26),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 1, metalness: 0 })
          );
          rackBase.position.set(0, 0.05, 0);
          bayGroup.add(rackBase);

          const enderecosBay = Array.from(new Set(bayItems.map(item => txt(item.endereco)).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
          const enderecosResumo = enderecosBay.slice(0, 2).join(" / ");
          const extraEnderecos = enderecosBay.length > 2 ? ` +${enderecosBay.length - 2}` : "";
          const bayLabelTexto = pct === null
            ? `P${String(prateleira).padStart(2, "0")} · ${sideKey === "par" ? "lado par" : "lado ímpar"}\nEnd.: ${enderecosResumo || selectedRua}${extraEnderecos}`
            : `P${String(prateleira).padStart(2, "0")} · ${sideKey === "par" ? "lado par" : "lado ímpar"} · menor ${menorDisponivelBay}\nEnd.: ${enderecosResumo || selectedRua}${extraEnderecos}`;
          const bayLabel = makeSprite(bayLabelTexto, {
            bg: "rgba(248, 250, 252, .94)",
            fg: "#111827",
            size: 24,
            scale: [3.2, 1.3]
          });
          if (bayLabel) {
            bayLabel.position.set(0, 7.42, 0);
            bayGroup.add(bayLabel);
          }

          if (pct !== null) {
            const gaugeColor = corRisco(menorDisponivelBay, limiteDisponivel);
            const gaugeX = sideKey === "ímpar" ? -3.9 : 3.9;
            const gaugeHeight = 7.0;
            const fillHeight = Math.max(0.06, (pct / 100) * gaugeHeight);

            const track = new THREE.Mesh(
              new THREE.BoxGeometry(0.24, gaugeHeight, 0.24),
              new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0.1, transparent: true, opacity: 0.55 })
            );
            track.position.set(gaugeX, gaugeHeight / 2, 0);
            bayGroup.add(track);

            const fill = new THREE.Mesh(
              new THREE.BoxGeometry(0.28, fillHeight, 0.28),
              new THREE.MeshStandardMaterial({ color: gaugeColor, emissive: new THREE.Color(gaugeColor).multiplyScalar(0.5), emissiveIntensity: 0.6, roughness: 0.35 })
            );
            fill.position.set(gaugeX, fillHeight / 2, 0);
            bayGroup.add(fill);

            const gaugeGlow = new THREE.PointLight(gaugeColor, 0.7, 2.8, 2.2);
            gaugeGlow.position.set(gaugeX, fillHeight, 0.4);
            bayGroup.add(gaugeGlow);
          }

          LEVEL_ORDER.forEach(level => {
            const levelItems = (groupedLevels.get(level) || []).sort((a, b) => a.prodcor.localeCompare(b.prodcor, "pt-BR", { numeric: true }));
            const levelY = levelYs.get(level) || 0.9;
            const shelfLine = new THREE.Mesh(
              new THREE.BoxGeometry(6.8, 0.06, 0.1),
              new THREE.MeshStandardMaterial({ color: level === 50 ? 0x94a3b8 : 0x475569, metalness: 0.2, roughness: 0.5 })
            );
            shelfLine.position.set(0, levelY - 0.3, 0);
            bayGroup.add(shelfLine);
            levelItems.forEach((item, slotIndex) => addItemBox(item, xPos, startZ + index * depthStep, slotIndex, levelItems.length));
          });

          dynamicGroup.add(bayGroup);
        });
      };

      buildSide("ímpar", -6.35);
      buildSide("par", 6.35);

      let piorPrateleiraLocal = null;
      let piorPctLocal = Infinity;
      for (const [chave, entrada] of Object.entries(ocupacaoPorPrateleira)) {
        if (typeof entrada?.pct === "number" && entrada.pct < piorPctLocal) {
          piorPctLocal = entrada.pct;
          piorPrateleiraLocal = Number(chave);
        }
      }
      if (piorPrateleiraLocal !== null && bayCenters.has(piorPrateleiraLocal)) {
        const piorPos = bayCenters.get(piorPrateleiraLocal);
        const beacon = new THREE.PointLight(0xf43f5e, 2.4, 10, 2);
        beacon.position.set(piorPos.x, 8.2, piorPos.z);
        dynamicGroup.add(beacon);
        pulsesRef.current.push({ kind: "light", obj: beacon, base: 2.4, speed: 3.4, phase: 1.1 });

        const flag = makeSprite(`PIOR DESTE CORREDOR\nP${String(piorPrateleiraLocal).padStart(2, "0")} · ${piorPctLocal.toFixed(0)}%`, {
          bg: "rgba(244, 63, 94, .94)",
          fg: "#fff",
          size: 26,
          scale: [3.2, 1.55]
        });
        if (flag) {
          flag.position.set(piorPos.x, 9.3, piorPos.z);
          dynamicGroup.add(flag);
          pulsesRef.current.push({ kind: "scale", obj: flag, base: [3.2, 1.55], speed: 3.0, phase: 0.6, amount: 0.12 });
        }
      }

      if (focoPos) {
        const halo = new THREE.Mesh(
          new THREE.BoxGeometry(1.25, 0.85, 1.0),
          new THREE.MeshBasicMaterial({ color: 0xfde047, wireframe: true, transparent: true, opacity: 0.9 })
        );
        halo.position.copy(focoPos);
        dynamicGroup.add(halo);

        const glow = new THREE.PointLight(0xfde047, 2.2, 12, 2.0);
        glow.position.set(focoPos.x, focoPos.y + 1.5, focoPos.z + 0.35);
        dynamicGroup.add(glow);
      }

      const summary = makeSprite(`${selectedRua || "Corredor"} - ${prateleiras.length} prateleira${prateleiras.length === 1 ? "" : "s"} - ${itens.length} item${itens.length === 1 ? "" : "s"}`, {
        bg: "rgba(9, 13, 20, .78)",
        fg: "#e2e8f0",
        size: 28,
        scale: [3.6, 1.35]
      });
      if (summary) {
        summary.position.set(0, 0.46, startZ - 5.8);
        dynamicGroup.add(summary);
      }

      walkBoundsRef.current = {
        minX: -2.6,
        maxX: 2.6,
        minZ: startZ - 7.5,
        maxZ: startZ + Math.max(0, prateleiras.length - 1) * depthStep + 4.2
      };

      return { startZ, prateleiras, focoPos };
    };

    const rebuild = (payload = data) => {
      clearScene();
      pulsesRef.current = [];
      clickTargetsRef.current = [];
      proximityTagsRef.current = [];
      const modo = payload?.modo === "corredor" ? "corredor" : "geral";
      modeRef.current = modo;

      if (modo === "geral") {
        walkBoundsRef.current = null;
        const { totalWidth } = buildOverview(payload);
        camera.fov = 46;
        camera.updateProjectionMatrix();
        const spread = Math.max(totalWidth, 10);
        camera.position.set(0, 11.5 + spread * 0.05, spread * 0.6 + 14);
        controls.target.set(0, 3.4, 0);
        controls.minDistance = 8;
        controls.maxDistance = 95;
        camera.lookAt(controls.target);
        controls.update();
        renderer.domElement.style.cursor = "default";
      } else {
        const { startZ, focoPos } = buildCorredor(payload);
        camera.fov = focoPos ? 34 : 42;
        camera.updateProjectionMatrix();
        if (focoPos) {
          camera.position.set(focoPos.x + 3.6, focoPos.y + 2.6, focoPos.z + 4.4);
          controls.target.set(focoPos.x, focoPos.y + 0.5, focoPos.z);
          controls.minDistance = 3;
          controls.maxDistance = 60;
        } else {
          camera.position.set(0, WALK_EYE_HEIGHT, startZ - 7);
          controls.target.set(0, WALK_EYE_HEIGHT + 1.6, startZ + 2.5);
          controls.minDistance = 1.5;
          controls.maxDistance = 50;
        }
        camera.lookAt(controls.target);
        controls.update();
        renderer.domElement.style.cursor = "default";
      }
    };

    apiRef.current = { rebuild };
    window.__wmsDebug = { camera, controls, clickTargetsRef, renderer };
    rebuild(data);

    const onKeyDown = event => {
      if (modeRef.current !== "corredor") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!host.offsetParent) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        keysRef.current.add(key);
        event.preventDefault();
      }
    };
    const onKeyUp = event => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onPointerDown = event => {
      pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const onPointerUp = event => {
      if (!pointerDown) return;
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      const dt = performance.now() - pointerDown.time;
      pointerDown = null;
      if (Math.hypot(dx, dy) > 6 || dt > 500) return;
      if (!clickTargetsRef.current.length) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const meshes = clickTargetsRef.current.map(entry => entry.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        const hitData = hits[0].object.userData;
        if (hitData.rua) window.dispatchEvent(new CustomEvent("wms-abrir-corredor", { detail: { rua: hitData.rua } }));
        else if (hitData.item) window.dispatchEvent(new CustomEvent("wms-item-click", { detail: hitData.item }));
      }
    };
    const onPointerMove = event => {
      if (!clickTargetsRef.current.length) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickTargetsRef.current.map(entry => entry.mesh), false);
      renderer.domElement.style.cursor = hits.length ? "pointer" : "default";
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    let frame = 0;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const deltaSeconds = Math.min(0.12, clock.getDelta());
      const elapsed = clock.getElapsedTime();

      if (modeRef.current === "corredor" && keysRef.current.size) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() > 0.0001) forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        const move = new THREE.Vector3();
        const keys = keysRef.current;
        if (keys.has("w") || keys.has("arrowup")) move.add(forward);
        if (keys.has("s") || keys.has("arrowdown")) move.sub(forward);
        if (keys.has("d") || keys.has("arrowright")) move.add(right);
        if (keys.has("a") || keys.has("arrowleft")) move.sub(right);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(WALK_SPEED * deltaSeconds);
          const bounds = walkBoundsRef.current;
          let nextX = camera.position.x + move.x;
          let nextZ = camera.position.z + move.z;
          if (bounds) {
            nextX = Math.min(bounds.maxX, Math.max(bounds.minX, nextX));
            nextZ = Math.min(bounds.maxZ, Math.max(bounds.minZ, nextZ));
          }
          const appliedX = nextX - camera.position.x;
          const appliedZ = nextZ - camera.position.z;
          camera.position.x += appliedX;
          camera.position.z += appliedZ;
          controls.target.x += appliedX;
          controls.target.z += appliedZ;
          camera.position.y = WALK_EYE_HEIGHT;
        }
      }

      if (modeRef.current === "corredor" && proximityTagsRef.current.length) {
        const nearDist = 3.6;
        const farDist = 5.6;
        for (const tag of proximityTagsRef.current) {
          const dist = camera.position.distanceTo(tag.position);
          if (dist <= nearDist) tag.material.opacity = 1;
          else if (dist >= farDist) tag.material.opacity = 0;
          else tag.material.opacity = 1 - (dist - nearDist) / (farDist - nearDist);
          tag.visible = tag.material.opacity > 0.02;
        }
      }

      for (const pulse of pulsesRef.current) {
        const factor = 0.65 + 0.35 * Math.sin(elapsed * pulse.speed + pulse.phase);
        if (pulse.kind === "light") {
          pulse.obj.intensity = pulse.base * factor;
        } else if (pulse.kind === "scale") {
          const grow = 1 + pulse.amount * (factor - 0.65) / 0.35;
          pulse.obj.scale.set(pulse.base[0] * grow, pulse.base[1] * grow, 1);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!hostRef.current) return;
      const width = hostRef.current.clientWidth || 800;
      const height = hostRef.current.clientHeight || 520;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    if (resizeObserver) resizeObserver.observe(host);
    window.addEventListener("resize", onResize);
    window.setTimeout(onResize, 0);
    window.setTimeout(onResize, 250);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      resizeObserver?.disconnect();
      controls.dispose();
      renderer.dispose();
      host.replaceChildren();
      apiRef.current = null;
      scene.traverse(obj => {
        if (obj.isMesh) {
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) obj.material.forEach(material => material.dispose?.());
          else obj.material?.dispose?.();
        }
      });
    };
  }, []);

  useEffect(() => {
    if (apiRef.current) apiRef.current.rebuild(data);
  }, [data]);

  return h("div", { className: "wms-3d-stage", ref: hostRef });
}

function ItemPopup({ item, onClose }) {
  const info = parseEndereco(item.endereco);
  return h(
    "div",
    { className: "wms-3d-popup-backdrop", onClick: onClose },
    h(
      "div",
      { className: "wms-3d-popup", onClick: event => event.stopPropagation() },
      h("button", { type: "button", className: "wms-3d-popup-close", onClick: onClose }, "×"),
      h("p", { className: "tag" }, item.prodcor),
      h("h3", null, item.descProduto || "Produto"),
      h(
        "div",
        { className: "wms-3d-popup-stats" },
        h("span", null, h("b", null, item.quantidadeEstoque), h("small", null, "estoque")),
        h("span", null, h("b", null, item.quantidadeReservada), h("small", null, "reservado")),
        h("span", { className: item.quantidadeDisponivel <= 2 ? "neg" : "" }, h("b", null, item.quantidadeDisponivel), h("small", null, "disponível"))
      ),
      h(
        "div",
        { className: "wms-3d-popup-endereco" },
        h("strong", null, item.endereco),
        info.valido ? h("small", null, `${info.zona} · Rua ${info.rua} · P${info.prateleira} ${info.paridade} · Coluna ${info.coluna} (${info.colunaBase} ${info.colunaFaixa})`) : null
      ),
      h(
        "div",
        { className: "wms-3d-popup-caixa" },
        h("span", null, "Caixa"), h("b", null, item.caixa || "sem caixa")
      ),
      h("small", { className: "wms-3d-popup-meta" }, `Tam ${item.tamanho || "-"} · Grade ${item.grade || "-"} · Cor ${item.cor || "-"}`)
    )
  );
}

function Location3DApp() {
  const [payload, setPayload] = useState(window.__WMS_LOCATION_DATA__ || null);
  const [tela, setTela] = useState(false);
  const [itemPopup, setItemPopup] = useState(null);
  const shellRef = useRef(null);

  useEffect(() => {
    const listener = event => setPayload(event.detail);
    window.addEventListener("wms-location-data", listener);
    if (window.__WMS_LOCATION_DATA__) setPayload(window.__WMS_LOCATION_DATA__);
    return () => window.removeEventListener("wms-location-data", listener);
  }, []);

  useEffect(() => {
    const listener = event => setItemPopup(event.detail);
    window.addEventListener("wms-item-click", listener);
    return () => window.removeEventListener("wms-item-click", listener);
  }, []);

  useEffect(() => {
    setItemPopup(null);
  }, [payload?.ruaSelecionada, payload?.modo]);

  useEffect(() => {
    const onChange = () => setTela(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const alternarTela = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      shellRef.current?.requestFullscreen?.();
    }
  };

  if (!payload) {
    return h(
      "div",
      { className: "wms-3d-shell empty" },
      h(
        "div",
        { className: "wms-3d-empty" },
        h("strong", null, "Aguardando dados da localização..."),
        h("span", null, "Abra a aba Localização para carregar o corredor.")
      )
    );
  }

  const modo = payload.modo === "corredor" ? "corredor" : "geral";
  const resumo = {
    rua: payload.ruaSelecionada || "-",
    itens: payload.itensRua?.length || 0,
    ruas: payload.ruas?.length || 0,
    prateleiras: payload.prateleiras || 0,
    colunas: payload.colunas || 0
  };

  return h(
    "div",
    { className: `wms-3d-shell${tela ? " tela-cheia" : ""}`, ref: shellRef },
    h(
      "div",
      { className: "wms-3d-header" },
      h(
        "div",
        null,
        h("p", { className: "tag" }, modo === "corredor" ? "Corredor 3D" : "Visão geral 3D"),
        h("h3", null, modo === "corredor" ? resumo.rua : `${resumo.ruas} corredores`),
        h("p", null, modo === "corredor"
          ? "Ande pelo corredor pra entender a peça no lugar físico dela."
          : "Cada pilar é um corredor — quanto mais vermelho e alto, pior a ocupação. O pior de todos pisca em \"Atacar aqui\".")
      ),
      modo === "corredor"
        ? h(
          "div",
          { className: "wms-3d-kpis" },
          h("span", null, h("b", null, resumo.itens), h("small", null, "itens")),
          h("span", null, h("b", null, resumo.prateleiras), h("small", null, "prateleiras")),
          h("span", null, h("b", null, resumo.colunas), h("small", null, "colunas"))
        )
        : h(
          "div",
          { className: "wms-3d-kpis" },
          h("span", null, h("b", null, resumo.ruas), h("small", null, "corredores"))
        ),
      h("button", { type: "button", className: "wms-3d-fullscreen", onClick: alternarTela, title: tela ? "Sair da tela cheia" : "Ver em tela cheia" }, tela ? "⤢ Sair" : "⛶ Tela cheia")
    ),
    modo === "corredor" ? h("div", { className: "wms-3d-corridor-badge" }, h("small", null, "Você está no"), h("strong", null, resumo.rua)) : null,
    h(WarehouseScene, { data: payload }),
    h(Legend, { modo }),
    itemPopup ? h(ItemPopup, { item: itemPopup, onClose: () => setItemPopup(null) }) : null
  );
}

function mount() {
  const root = document.getElementById("location-3d-root");
  if (!root) return false;
  if (root.dataset.mounted === "1") return true;
  root.dataset.mounted = "1";
  try {
    const reactDom = window.ReactDOM;
    if (typeof reactDom?.createRoot === "function") {
      reactDom.createRoot(root).render(h(Location3DErrorBoundary, null, h(Location3DApp)));
    } else if (typeof reactDom?.render === "function") {
      reactDom.render(h(Location3DErrorBoundary, null, h(Location3DApp)), root);
    } else {
      throw new Error("ReactDOM não está disponível para montar a visão 3D.");
    }
  } catch (error) {
    console.error("[location-3d]", error);
    root.dataset.mounted = "0";
    root.innerHTML = `
      <div class="wms-3d-shell empty">
        <div class="wms-3d-empty">
          <strong>Falha ao carregar o 3D</strong>
          <span>Abra o console para ver o erro e recarregue a pagina.</span>
        </div>
      </div>
    `;
    return false;
  }
  return true;
}

window.__mountLocation3D = mount;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
