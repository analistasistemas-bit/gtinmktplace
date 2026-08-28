import * as THREE from 'three';
import { LADO_GRADE, amostrarPoisson, distanciasPorDensidade, ruido1d } from './amostragem';
import {
  FRAGMENT_PARTICULAS,
  FRAGMENT_SIMULACAO,
  VERTEX_PARTICULAS,
  VERTEX_SIMULACAO,
} from './shaders';

export interface OpcoesCampo {
  /** 0–300. Controla a distância mínima do Poisson-disk, logo a quantidade de partículas. */
  densidade: number;
  /** Multiplicador do tamanho do ponto. */
  escalaParticulas: number;
  raioAnel: number;
  larguraAnel: number;
  larguraAnel2: number;
  /** O quanto o anel empurra as partículas. É o que mais muda a personalidade do efeito. */
  deslocamentoAnel: number;
  /** Opacidade global — numa tela de login o fundo não pode competir com o formulário. */
  opacidade: number;
  cores: [string, string, string];
  /** Sem movimento: desenha um único quadro e não abre RAF nem escuta o ponteiro. */
  estatico: boolean;
  /** Sem interação: o anel passeia sozinho guiado por ruído (usado no mobile). */
  semPonteiro: boolean;
}

export interface Campo {
  destruir(): void;
}

/**
 * O quanto do campo o anel percorre atrás do cursor (1 = borda a borda). O efeito original
 * usa ~0.32; aqui vai mais alto porque o card de login ocupa o meio da tela e um anel preso
 * ao centro ficaria escondido atrás dele.
 */
const ALCANCE_CURSOR = 0.75;
/** Amplitude do passeio de ruído do anel (x, y). */
const AMPLITUDE_PASSEIO = { x: 0.2, y: 0.1 };
/** O atraso é intencional: o anel nunca alcança o cursor, ele o persegue. */
const LERP_COM_CURSOR = 0.02;
const LERP_SEM_CURSOR = 0.01;
/**
 * A fórmula de tamanho do efeito original assume uma escala de partícula bem maior que a
 * que esta simulação produz em repouso — sem o ganho o ponto sai com menos de 1px e o campo
 * some. É o parâmetro para mexer se o fundo ficar tímido ou pesado demais.
 */
const GANHO_TAMANHO = 4.5;

/**
 * Monta o campo GPGPU dentro do container. Devolve `null` quando o ambiente não suporta
 * render em textura float (WebGL1, ou WebGL2 sem `EXT_color_buffer_float`) — nesse caso o
 * chamador mostra o fundo estático.
 */
export function criarCampo(container: HTMLElement, opcoes: OpcoesCampo): Campo | null {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    precision: 'highp',
    stencil: false,
    preserveDrawingBuffer: true,
  });

  const gl = renderer.getContext();
  const suportaFloat =
    renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
  if (!suportaFloat) {
    renderer.dispose();
    return null;
  }

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 3.1;

  // ── posições de repouso ────────────────────────────────────────────────────────────
  const { min, max } = distanciasPorDensidade(opcoes.densidade);
  const pontos = amostrarPoisson(LADO_GRADE, min, max);
  const total = pontos.length;
  const lado = Math.ceil(Math.sqrt(total));

  const dadosRefs = new Float32Array(lado * lado * 4);
  const refs = new Float32Array(total * 2);
  const seeds = new Float32Array(total * 4);
  for (let i = 0; i < total; i++) {
    // grade 500×500 → centrada e normalizada para [-1, 1]
    const x = (pontos[i][0] - LADO_GRADE / 2) / (LADO_GRADE / 2);
    const y = (pontos[i][1] - LADO_GRADE / 2) / (LADO_GRADE / 2);
    dadosRefs[i * 4] = x;
    dadosRefs[i * 4 + 1] = y;
    // +0.5 texel: amostragem NEAREST tem que cair no centro do texel, não na borda
    refs[i * 2] = ((i % lado) + 0.5) / lado;
    refs[i * 2 + 1] = (Math.floor(i / lado) + 0.5) / lado;
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = Math.random();
  }

  const texturaRefs = new THREE.DataTexture(dadosRefs, lado, lado, THREE.RGBAFormat, THREE.FloatType);
  texturaRefs.minFilter = THREE.NearestFilter;
  texturaRefs.magFilter = THREE.NearestFilter;
  texturaRefs.needsUpdate = true;

  // ── ping-pong ──────────────────────────────────────────────────────────────────────
  const criarAlvo = () =>
    new THREE.WebGLRenderTarget(lado, lado, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

  let alvoAtual = criarAlvo();
  let alvoAnterior = criarAlvo();
  for (const alvo of [alvoAtual, alvoAnterior]) {
    renderer.setRenderTarget(alvo);
    renderer.clear(); // estado inicial: offset zero, escala zero, velocidade zero
  }
  renderer.setRenderTarget(null);

  const anel = new THREE.Vector2(0, 0);

  const materialSim = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SIMULACAO,
    fragmentShader: FRAGMENT_SIMULACAO,
    uniforms: {
      uPosition: { value: alvoAnterior.texture },
      uPosRefs: { value: texturaRefs },
      uRingPos: { value: anel },
      uRingRadius: { value: opcoes.raioAnel },
      uRingWidth: { value: opcoes.larguraAnel },
      uRingWidth2: { value: opcoes.larguraAnel2 },
      uRingDisplacement: { value: opcoes.deslocamentoAnel },
      uTime: { value: 0 },
    },
  });

  const cenaSim = new THREE.Scene();
  const geoSim = new THREE.PlaneGeometry(2, 2);
  cenaSim.add(new THREE.Mesh(geoSim, materialSim));
  const cameraSim = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ── partículas ─────────────────────────────────────────────────────────────────────
  const geoParticulas = new THREE.BufferGeometry();
  geoParticulas.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  geoParticulas.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
  geoParticulas.setAttribute('aSeeds', new THREE.BufferAttribute(seeds, 4));

  const materialParticulas = new THREE.ShaderMaterial({
    vertexShader: VERTEX_PARTICULAS,
    fragmentShader: FRAGMENT_PARTICULAS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPosition: { value: alvoAtual.texture },
      uPosRefs: { value: texturaRefs },
      uRingPos: { value: anel },
      uTime: { value: 0 },
      uPointScale: { value: 1 },
      uEscalaCampo: { value: 1 },
      uCorA: { value: new THREE.Color(opcoes.cores[0]) },
      uCorB: { value: new THREE.Color(opcoes.cores[1]) },
      uCorC: { value: new THREE.Color(opcoes.cores[2]) },
      uOpacidade: { value: opcoes.opacidade },
    },
  });

  const particulas = new THREE.Points(geoParticulas, materialParticulas);
  particulas.frustumCulled = false;
  const cena = new THREE.Scene();
  cena.add(particulas);

  // ── cursor ─────────────────────────────────────────────────────────────────────────
  const ndc = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();
  const plano = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const alvoCursor = new THREE.Vector3();
  let sobre = false;

  /** Meia-largura do campo em unidades da cena — o que o campo [-1,1] precisa esticar para cobrir a viewport. */
  let escalaCampo = 1;

  function dimensionar() {
    const l = container.clientWidth;
    const a = container.clientHeight;
    if (l === 0 || a === 0) return;
    renderer.setSize(l, a, false);
    camera.aspect = l / a;
    camera.updateProjectionMatrix();

    const meiaAltura = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    escalaCampo = Math.max(meiaAltura * camera.aspect, meiaAltura) * 1.02;
    materialParticulas.uniforms.uEscalaCampo.value = escalaCampo;
    // O termo `largura/2000` faz o ponto acompanhar o tamanho da tela; sem o piso o campo
    // some por completo num celular de 400px.
    const larguraRef = Math.max(l, 1000);
    materialParticulas.uniforms.uPointScale.value =
      7.0 * (pixelRatio * 0.5) * ((larguraRef / 2000) * opcoes.escalaParticulas) * GANHO_TAMANHO;
  }
  dimensionar();

  function moverPonteiro(e: PointerEvent) {
    const r = container.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    sobre = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
    ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
  }
  function sairPonteiro() {
    sobre = false;
  }

  function passearAnel(tempo: number) {
    const passeio = {
      x: (ruido1d(tempo * 0.66) * 2 - 1) * AMPLITUDE_PASSEIO.x,
      y: (ruido1d(tempo * 0.75) * 2 - 1) * AMPLITUDE_PASSEIO.y,
    };

    let destinoX = passeio.x;
    let destinoY = passeio.y;
    let lerp = LERP_SEM_CURSOR;

    if (sobre && !opcoes.semPonteiro) {
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plano, alvoCursor)) {
        // O raycast devolve o ponto em unidades da cena; o anel vive no campo [-1,1].
        destinoX = (alvoCursor.x / escalaCampo) * ALCANCE_CURSOR + passeio.x * 0.1;
        destinoY = (alvoCursor.y / escalaCampo) * ALCANCE_CURSOR + passeio.y * 0.1;
        lerp = LERP_COM_CURSOR;
      }
    }

    anel.x += (destinoX - anel.x) * lerp;
    anel.y += (destinoY - anel.y) * lerp;
  }

  function quadro(tempo: number) {
    passearAnel(tempo);

    materialSim.uniforms.uTime.value = tempo;
    materialSim.uniforms.uPosition.value = alvoAnterior.texture;
    renderer.setRenderTarget(alvoAtual);
    renderer.render(cenaSim, cameraSim);
    renderer.setRenderTarget(null);

    materialParticulas.uniforms.uTime.value = tempo;
    materialParticulas.uniforms.uPosition.value = alvoAtual.texture;
    renderer.render(cena, camera);

    const troca = alvoAtual;
    alvoAtual = alvoAnterior;
    alvoAnterior = troca;
  }

  // ── loop ───────────────────────────────────────────────────────────────────────────
  let raf = 0;
  let visivel = true;
  let naTela = true;
  const inicio = performance.now();

  function rodando() {
    return visivel && naTela && !opcoes.estatico;
  }

  function loop() {
    quadro((performance.now() - inicio) / 1000);
    raf = requestAnimationFrame(loop);
  }

  function retomar() {
    if (raf === 0 && rodando()) raf = requestAnimationFrame(loop);
  }
  function pausar() {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  const aoTrocarVisibilidade = () => {
    visivel = document.visibilityState === 'visible';
    if (rodando()) retomar();
    else pausar();
  };

  const observadorTela = new IntersectionObserver((entradas) => {
    naTela = entradas.some((e) => e.isIntersecting);
    if (rodando()) retomar();
    else pausar();
  });
  observadorTela.observe(container);

  const observadorTamanho = new ResizeObserver(() => {
    dimensionar();
    if (opcoes.estatico) quadro(0);
  });
  observadorTamanho.observe(container);

  document.addEventListener('visibilitychange', aoTrocarVisibilidade);
  if (!opcoes.semPonteiro && !opcoes.estatico) {
    window.addEventListener('pointermove', moverPonteiro, { passive: true });
    document.addEventListener('pointerleave', sairPonteiro);
  }

  if (opcoes.estatico) {
    // Um quadro só: o campo aparece nas posições de repouso, sem animação nem RAF.
    quadro(0);
    quadro(0);
  } else {
    retomar();
  }

  return {
    destruir() {
      pausar();
      observadorTela.disconnect();
      observadorTamanho.disconnect();
      document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
      window.removeEventListener('pointermove', moverPonteiro);
      document.removeEventListener('pointerleave', sairPonteiro);

      geoSim.dispose();
      geoParticulas.dispose();
      materialSim.dispose();
      materialParticulas.dispose();
      texturaRefs.dispose();
      alvoAtual.dispose();
      alvoAnterior.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
