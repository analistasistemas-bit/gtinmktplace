// Leitura do anúncio sem falso alarme de layout (ADR-0189, emenda de 22/10 sobre erros de leitura).
// `estado_nao_encontrado` só prova ausência do estado naquela leitura: relê uma vez depois do load (página que ainda
// hidrata ou redireciona) e não conta páginas de bloqueio/verificação do ML como quebra de layout. Na dúvida (load que
// não chegou, página que navegou ou saiu durante a espera), não registra: inconclusivo não é quebra de layout.
import type { ResultadoLeitura } from '../leitura/pdp';

// Só os caminhos observados (emenda de 22/10); bloqueio servido na própria URL do anúncio ainda não tem marcador.
const BLOQUEIO = [/^\/captcha\//, /^\/gz\/account-verification/];
export const paginaDeBloqueio = (caminho: string) => BLOQUEIO.some((r) => r.test(caminho));

/** null = não registrar (bloqueio, navegação ou espera inconclusiva). `local()` = pathname + search. */
export async function lerComReleitura(
  ler: () => ResultadoLeitura,
  esperar: () => Promise<boolean>,
  local: () => string,
): Promise<ResultadoLeitura | null> {
  const antes = local();
  if (paginaDeBloqueio(antes)) return null;
  const primeira = ler();
  if (primeira.ok || primeira.motivo !== 'estado_nao_encontrado') return primeira;
  if (!(await esperar())) return null;
  if (local() !== antes) return null; // a página navegou: o estado lido seria de outra página
  return ler();
}

/** true = página estável (load + 1,5 s sem sair); false = load não chegou no limite ou a página saiu (pagehide). */
export function esperarPaginaEstavel(doc: Document = document, janela: Window = window, limiteMs = 8000): Promise<boolean> {
  return new Promise((resolver) => {
    let saiu = false;
    const aoSair = () => { saiu = true; resolver(false); };
    janela.addEventListener('pagehide', aoSair, { once: true });
    const terminar = (ok: boolean) => {
      janela.removeEventListener('pagehide', aoSair);
      if (!saiu) resolver(ok);
    };
    const depoisDoLoad = () => setTimeout(() => terminar(true), 1500);
    if (doc.readyState === 'complete') { depoisDoLoad(); return; }
    const limite = setTimeout(() => terminar(false), limiteMs);
    janela.addEventListener('load', () => { clearTimeout(limite); depoisDoLoad(); }, { once: true });
  });
}
