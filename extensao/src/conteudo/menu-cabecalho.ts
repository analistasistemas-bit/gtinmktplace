// Menu do ícone no cabeçalho do ML (ADR-0189, spec 2026-10-24 decisão 4). Roda dentro de um shadow root fechado.
// Nunca leva dado financeiro: só nome, organização, chave e versão.
export type EstadoExt = { ativa: boolean; logado: boolean; perfil: { nome: string | null; orgNome: string | null } | null; versao: string; geracao: number };
export type Acao = 'entrar' | 'painel' | 'app' | 'chave' | 'sair';
export type ModoVisual = 'ativo' | 'deslogado' | 'desativado';

export const modoVisual = (e: EstadoExt | null): ModoVisual => (!e?.logado ? 'deslogado' : e.ativa ? 'ativo' : 'desativado');

export const CSS = `
  :host{all:initial;display:inline-block;position:relative;margin-left:12px;vertical-align:middle;font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c1b2a}
  *{box-sizing:border-box}
  button.icone{all:unset;box-sizing:border-box;position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.14);cursor:pointer}
  button.icone:focus-visible{outline:2px solid #5c5ceb;outline-offset:2px}
  button.icone svg{width:20px;height:20px}
  :host([data-estado="desativado"]) button.icone svg{filter:grayscale(1);opacity:.55}
  .ponto{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;border:2px solid #fff}
  .verde{background:#1f9d55}.laranja{background:#f08a24}.cinza{background:#9a9aa6}
  [role=menu]{position:absolute;right:0;top:40px;z-index:2147483000;width:268px;padding:6px 0;background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(20,18,50,.22),0 0 0 1px rgba(0,0,0,.08);text-align:left}
  [role=menu][hidden]{display:none}
  .topo{padding:10px 16px 12px;border-bottom:1px solid #ececf2}
  .nome{font-weight:700;font-size:15px}
  .sub{color:#5d5c70;font-size:13px}
  .mudo{color:#8a8998;font-size:13px;padding:8px 16px}
  .linha{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;width:100%;padding:9px 16px;cursor:pointer;color:inherit;font:inherit}
  .linha:hover,.linha:focus-visible{background:#f3f3fa;outline:none}
  .sair{color:#c4262e}
  .principal{all:unset;box-sizing:border-box;display:block;margin:10px 16px 6px;width:calc(100% - 32px);padding:9px 0;text-align:center;border-radius:8px;background:#5c5ceb;color:#fff;font-weight:600;cursor:pointer}
  .principal:focus-visible{outline:2px solid #1c1b2a;outline-offset:2px}
  .chave{position:relative;width:34px;height:20px;border-radius:10px;background:#c9c9d4;flex:none}
  .chave::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .12s}
  [aria-checked=true] .chave{background:#1f9d55}
  [aria-checked=true] .chave::after{left:16px}
  .rodape{padding:8px 16px 4px;border-top:1px solid #ececf2;color:#8a8998;font-size:12px}
  .sep{height:1px;background:#ececf2;margin:4px 0}
`;

type Fabrica = (tag: string, props?: Record<string, string>, ...filhos: (Node | string)[]) => HTMLElement;

/** Conteúdo do menu. Todo texto entra por textContent (nome/org vêm do SW, nunca como HTML). */
export function preencherMenu(menu: HTMLElement, e: EstadoExt | null, doc: Document): void {
  const h: Fabrica = (tag, props = {}, ...filhos) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
    n.append(...filhos);
    return n;
  };
  const linha = (acao: Acao, texto: string, extra: Record<string, string> = {}, ...filhos: (Node | string)[]) =>
    h('button', { class: 'linha', role: 'menuitem', type: 'button', 'data-acao': acao, ...extra }, texto, ...filhos);
  const nodes: HTMLElement[] = [];
  const modo = modoVisual(e);

  if (!e) {
    nodes.push(h('div', { class: 'mudo' }, 'Verificando…'));
  } else if (modo === 'deslogado') {
    nodes.push(
      h('div', { class: 'topo' }, h('div', { class: 'nome' }, 'Entrar no PubliAI'), h('div', { class: 'sub' }, 'Use o mesmo e-mail e senha do app')),
      h('button', { class: 'principal', role: 'menuitem', type: 'button', 'data-acao': 'entrar' }, 'Entrar'),
    );
  } else {
    const org = e.perfil?.orgNome;
    const sub = modo === 'ativo' ? 'conectado' : 'extensão desativada';
    nodes.push(
      h('div', { class: 'topo' }, h('div', { class: 'nome' }, e.perfil?.nome ?? 'Conta PubliAI'), h('div', { class: 'sub' }, org ? `${org} · ${sub}` : sub)),
      h('button', { class: 'linha', role: 'menuitemcheckbox', type: 'button', 'aria-checked': String(e.ativa), 'data-acao': 'chave' }, 'Extensão ativa', h('span', { class: 'chave' })),
    );
    if (modo === 'ativo') {
      nodes.push(linha('painel', 'Abrir painel de análise', {}, '›'), linha('app', 'Abrir o PubliAI', {}, '↗'));
    } else {
      nodes.push(h('div', { class: 'mudo' }, 'Selos e análises pausados'));
    }
    nodes.push(h('div', { class: 'sep' }), linha('sair', 'Sair', { class: 'linha sair' }));
  }
  if (e) nodes.push(h('div', { class: 'rodape' }, `Versão ${e.versao}`));
  menu.replaceChildren(...nodes);
}
