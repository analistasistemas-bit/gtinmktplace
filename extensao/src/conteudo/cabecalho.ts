// Ícone e menu do PubliAI no cabeçalho do Mercado Livre (ADR-0189, spec 2026-10-24 decisão 4).
//
// Medição ao vivo em 2026-10-25 (playwright-cli, sessão isolada, UA desktop, anônimo):
//   home www.mercadolivre.com.br: `header.nav-header` > `.nav-bounds` > `.nav-header-plus-menu-wrapper.nav-area.nav-bottom-area.nav-right-area`
//   contém `nav#nav-header-menu` + `a#nav-cart.nav-cart` (o carrinho). Encaixe = `header a.nav-cart`; o ícone entra logo depois dele.
//   Com o UA padrão do Playwright (HeadlessChrome) a home devolve só uma página de erro de 344 B (sem carrinho).
//   Busca (lista.) e /p/MLB53180253 redirecionaram para /gz/account-verification (verificação de conta, não contornada):
//   não foi possível medir o cabeçalho nelas. Presume-se o mesmo cabeçalho `nav-header` (compartilhado pelo ML); se divergir,
//   `inserirIcone` devolve null e nada é criado.
//   Fixture: __fixtures__/cabecalho-ml.html.
import { MARCA } from './aparencia';
import { CSS, modoVisual, preencherMenu, type Acao, type EstadoExt } from './menu-cabecalho';

export const SELETOR_CARRINHO = 'header a.nav-cart';
const ID = 'publiai-cabecalho';
// Espelha os exclude_matches do manifest: páginas sem o cabeçalho de navegação.
const SEM_CABECALHO = /^\/(checkout|gz|jms|captcha)(\/|$)/;

type Partes = { icone: HTMLButtonElement; ponto: HTMLElement; menu: HTMLElement };
const PARTES = new WeakMap<HTMLElement, Partes>(); // o shadow root é fechado: só este módulo alcança as partes

const paginaSemCabecalho = (doc: Document) => SEM_CABECALHO.test(doc.location?.pathname ?? '');

export function localizarEncaixe(doc: Document): Element | null {
  if (paginaSemCabecalho(doc)) return null;
  return doc.querySelector(SELETOR_CARRINHO);
}

/** Idempotente. null sem encaixe (nenhum nó criado). Não move nem esconde nada da página (ML ou Avant): só `after()`. */
export function inserirIcone(doc: Document, modo: ShadowRootMode = 'closed'): HTMLElement | null {
  const ja = doc.getElementById(ID);
  if (ja) return ja;
  const cart = localizarEncaixe(doc);
  if (!cart) return null;
  const host = doc.createElement('div');
  host.id = ID;
  const raiz = host.attachShadow({ mode: modo });
  const estilo = doc.createElement('style');
  estilo.textContent = CSS;
  const icone = doc.createElement('button');
  icone.type = 'button';
  icone.className = 'icone';
  icone.setAttribute('aria-haspopup', 'menu');
  icone.setAttribute('aria-expanded', 'false');
  icone.setAttribute('aria-label', 'PubliAI');
  icone.innerHTML = MARCA; // constante do código, sem dado externo
  const ponto = doc.createElement('span');
  ponto.className = 'ponto';
  icone.append(ponto);
  const menu = doc.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'PubliAI');
  menu.hidden = true;
  ponto.className = 'ponto neutro'; // até a 1ª resposta do SW
  preencherMenu(menu, null, doc);
  raiz.append(estilo, icone, menu);
  PARTES.set(host, { icone, ponto, menu });
  cart.after(host);
  return host;
}

const COR = { ativo: 'verde', deslogado: 'laranja', desativado: 'cinza' } as const;
const ehEstado = (r: unknown): r is EstadoExt =>
  typeof r === 'object' && r !== null && typeof (r as EstadoExt).logado === 'boolean' && typeof (r as EstadoExt).ativa === 'boolean';

/** Liga o ícone ao SW e mantém a inserção quando o ML reconstrói o cabeçalho. Devolve `parar`. */
export function iniciar(doc: Document, modo: ShadowRootMode = 'closed', prazoBuscaMs = 15000): () => void {
  let vivo = true;
  let estado: EstadoExt | null = null;
  let seq = 0;
  let host: HTMLElement | null = null;
  const ligados = new WeakSet<HTMLElement>();

  // Erros de contexto invalidado (extensão recarregada) ficam silenciosos.
  const enviar = async (msg: object): Promise<unknown> => {
    try { return await chrome.runtime.sendMessage(msg); } catch { return undefined; }
  };
  const partes = () => (host ? PARTES.get(host) : undefined);

  function aplicar(e: EstadoExt) {
    estado = e;
    const p = partes();
    if (!host || !p) return;
    const m = modoVisual(e);
    host.dataset.estado = m;
    p.ponto.className = `ponto ${COR[m]}`;
    preencherMenu(p.menu, e, doc);
  }
  async function ler(abrindo: boolean) {
    const n = ++seq;
    const r = await enviar({ tipo: 'publiai:estado-extensao', abrindo });
    if (vivo && n === seq && ehEstado(r)) aplicar(r);
  }
  async function comando(msg: object) {
    const n = ++seq;
    const r = await enviar(msg);
    if (!vivo || n !== seq) return;
    if (ehEstado(r) && (r as { ok?: boolean }).ok !== false) aplicar(r);
    else void ler(false); // geracao_antiga, sem_sessao ou sem resposta: relê o estado
  }

  function abrirMenu(abrir: boolean) {
    const p = partes();
    if (!p) return;
    p.menu.hidden = !abrir;
    p.icone.setAttribute('aria-expanded', String(abrir));
    if (abrir) void ler(true); // a cada abertura: o SW confere a sessão
  }
  const fechar = (devolverFoco = false) => {
    abrirMenu(false);
    if (devolverFoco) partes()?.icone.focus();
  };

  function ligar(h: HTMLElement) {
    const p = PARTES.get(h)!;
    p.icone.addEventListener('click', () => abrirMenu(p.menu.hidden));
    p.menu.addEventListener('click', (ev) => {
      const acao = (ev.target as Element).closest<HTMLElement>('[data-acao]')?.dataset.acao as Acao | undefined;
      if (!acao) return;
      if (acao === 'entrar' || acao === 'painel') {
        // sidePanel.open exige o gesto do usuário: envia síncrono, antes de qualquer await.
        try { void Promise.resolve(chrome.runtime.sendMessage({ tipo: 'publiai:abrir-painel' })).catch(() => {}); } catch { /* contexto invalidado */ }
        fechar();
      } else if (acao === 'app') {
        void enviar({ tipo: 'publiai:abrir-app' });
        fechar();
      } else if (acao === 'chave' && estado) {
        void comando({ tipo: 'publiai:definir-ativa', ativa: !estado.ativa, geracao: estado.geracao });
      } else if (acao === 'sair' && estado) {
        void comando({ tipo: 'publiai:sair', geracao: estado.geracao });
        fechar();
      }
    });
  }

  // Busca do encaixe: só até inserir ou até o prazo (sem encaixe, desiste sem erro). Depois de inserir, só os ancestrais diretos
  // do carrinho (childList, sem subtree): o ML trocando o cabeçalho tira o host do DOM e a busca recomeça uma vez.
  const busca = new MutationObserver(() => tentar());
  const ancestrais = new MutationObserver(() => { if (!host?.isConnected) tentar(); });
  let prazo: ReturnType<typeof setTimeout> | undefined;
  const pararBusca = () => { busca.disconnect(); clearTimeout(prazo); };

  function tentar() {
    if (!vivo || host?.isConnected || paginaSemCabecalho(doc)) return;
    const h = inserirIcone(doc, modo);
    if (!h) {
      if (!prazo) {
        busca.observe(doc.documentElement, { childList: true, subtree: true });
        prazo = setTimeout(pararBusca, prazoBuscaMs);
      }
      return;
    }
    pararBusca();
    prazo = undefined;
    host = h;
    if (!ligados.has(h)) { ligar(h); ligados.add(h); }
    ancestrais.disconnect();
    for (const n of [h.parentElement, h.closest('header'), h.closest('header')?.parentElement]) if (n) ancestrais.observe(n, { childList: true });
    if (estado) aplicar(estado);
    void ler(false);
  }

  const aoTeclar = (ev: KeyboardEvent) => {
    const p = partes();
    if (ev.key === 'Escape' && p && !p.menu.hidden) fechar(true);
  };
  const aoClicar = (ev: Event) => {
    const p = partes();
    if (p && !p.menu.hidden && host && !ev.composedPath().includes(host)) fechar();
  };
  const aoNavegar = () => { prazo = undefined; tentar(); };
  doc.addEventListener('keydown', aoTeclar);
  doc.addEventListener('click', aoClicar);
  doc.defaultView?.addEventListener('popstate', aoNavegar);
  chrome.runtime.onMessage.addListener((msg: { tipo?: unknown }) => {
    if (vivo && host?.isConnected && (msg?.tipo === 'publiai:conta-mudou' || msg?.tipo === 'publiai:ativacao')) void ler(false);
  });

  tentar();

  return () => {
    vivo = false;
    pararBusca();
    ancestrais.disconnect();
    doc.removeEventListener('keydown', aoTeclar);
    doc.removeEventListener('click', aoClicar);
    doc.defaultView?.removeEventListener('popstate', aoNavegar);
  };
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) iniciar(document);
