// Leitura do anúncio sem falso alarme de layout (ADR-0189, emenda de 22/10 sobre erros de leitura).
// `estado_nao_encontrado` só prova ausência do estado naquela leitura: relê uma vez depois do load (página que ainda
// hidrata ou redireciona) e não conta páginas de bloqueio/verificação do ML como quebra de layout.
import type { ResultadoLeitura } from '../leitura/pdp';

// Só os caminhos observados (emenda de 22/10); bloqueio servido na própria URL do anúncio ainda não tem marcador.
const BLOQUEIO = [/^\/captcha\//, /^\/gz\/account-verification/];
export const paginaDeBloqueio = (caminho: string) => BLOQUEIO.some((r) => r.test(caminho));

/** null = não registrar (página de bloqueio). */
export async function lerComReleitura(
  ler: () => ResultadoLeitura,
  esperar: () => Promise<void>,
  caminho: () => string,
): Promise<ResultadoLeitura | null> {
  if (paginaDeBloqueio(caminho())) return null;
  const primeira = ler();
  if (primeira.ok || primeira.motivo !== 'estado_nao_encontrado') return primeira;
  await esperar();
  if (paginaDeBloqueio(caminho())) return null;
  return ler();
}

/** load (com limite) + 1,5 s: tempo de a página terminar de hidratar ou de redirecionar. */
export function esperarPaginaEstavel(doc: Document = document, limiteMs = 8000): Promise<void> {
  const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const carregou = doc.readyState === 'complete'
    ? Promise.resolve()
    : Promise.race([new Promise<void>((r) => window.addEventListener('load', () => r(), { once: true })), pausa(limiteMs)]);
  return carregou.then(() => pausa(1500));
}
