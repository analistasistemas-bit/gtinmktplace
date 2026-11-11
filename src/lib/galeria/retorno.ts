// Galeria IA (Ajuste v2-6): voltar para Publicados com os mesmos filtros e a mesma rolagem.
// Filtros já vivem na URL de Publicados; a rolagem é do <main> do AppShell (não da janela).
const CHAVE = 'galeria:retorno-publicados';

export interface Retorno { busca: string; rolagem: number }

const areaRolagem = () => document.querySelector('main');

/** Chamado pelo botão "Galeria IA", antes de navegar. */
export function guardarRetorno(busca: string) {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ busca, rolagem: areaRolagem()?.scrollTop ?? 0 } satisfies Retorno));
  } catch { /* sessionStorage indisponível: volta sem filtros */ }
}

export function lerRetorno(): Retorno | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(CHAVE) ?? 'null') as Retorno | null;
    return r && typeof r.busca === 'string' ? r : null;
  } catch { return null; }
}

/** Caminho de volta: Publicados com a busca guardada (link direto: Publicados sem filtro). */
export const caminhoDeVolta = () => `/publicados${lerRetorno()?.busca ?? ''}`;

/** Publicados, depois de renderizar as linhas: devolve a rolagem uma vez e esquece. */
export function restaurarRolagem() {
  const r = lerRetorno();
  if (!r) return;
  try { sessionStorage.removeItem(CHAVE); } catch { /* nada */ }
  requestAnimationFrame(() => { areaRolagem()?.scrollTo({ top: r.rolagem }); });
}
