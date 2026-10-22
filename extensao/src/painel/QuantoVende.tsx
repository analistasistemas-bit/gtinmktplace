// Bloco "Quanto vende · Observado" (ADR-0189 D-6/D-9 + emenda 2026-10-22). Ritmo só com faixa e data do MESMO
// anúncio (HTML produto.mercadolivre); a faixa de /p/ (catálogo) e /up/ (produto do vendedor) é agregada e aparece
// à parte, sem ritmo. Sem estimativa: reprovada na Task 13 (errata ADR-0189).
import { pisoDosVendidos, quantoVende } from '../compartilhado/quanto-vende';

export interface Observado { vendidosTexto: string | null; vendidosAnuncio?: string | null; criadoEm: string | null; motivo?: string }

const num = (n: number) => n.toLocaleString('pt-BR');
const faixa = (piso: number, texto: string) => (/^\+/.test(texto.trim()) ? `+${num(piso)}` : num(piso));

export function QuantoVende({ observado, catalogo, agora }: { observado: Observado; catalogo: boolean; agora?: Date }) {
  const a = quantoVende({ vendidosTexto: observado.vendidosAnuncio ?? null, criadoEm: observado.criadoEm }, agora);
  const temAnuncio = a.piso !== null || a.dias !== null;
  const pisoPagina = pisoDosVendidos(observado.vendidosTexto);
  const paginaAParte = pisoPagina !== null && observado.vendidosTexto?.trim() !== observado.vendidosAnuncio?.trim();
  if (!temAnuncio && pisoPagina === null) return null;
  return (
    <section className="cartao quanto-vende" aria-labelledby="qv-titulo">
      <div className="qv-cabeca">
        <h2 id="qv-titulo">Quanto vende</h2>
        <span className="observado">Observado</span>
      </div>
      {temAnuncio && (
        <>
          <h3 className="qv-sub">Este anúncio</h3>
          <dl className="qv-numeros">
            <div>
              <dt>Vendidos</dt>
              <dd className="mono">{a.piso === null ? '—' : faixa(a.piso, observado.vendidosAnuncio!)}</dd>
            </div>
            {a.dias !== null && (
              <div>
                <dt>Criado há</dt>
                <dd className="mono">
                  <span className={`ponto ${a.semaforo}`} title={`Criado em ${new Date(a.criadoEm!).toLocaleDateString('pt-BR')}`} />
                  {`${num(a.dias)} dias`}
                </dd>
              </div>
            )}
            {a.minimoPorMes !== null && (
              <div>
                <dt>Por mês</dt>
                <dd className="mono">{`≥ ${num(a.minimoPorMes)}`}</dd>
              </div>
            )}
            {a.minimoPorDia !== null && (
              <div>
                <dt>Por dia</dt>
                <dd className="mono">{`≥ ${num(a.minimoPorDia)}`}</dd>
              </div>
            )}
          </dl>
        </>
      )}
      {paginaAParte && (
        <div className="qv-agregado">
          <span>{catalogo ? 'Catálogo, todos os vendedores' : 'Somando os anúncios deste produto'}</span>
          <span className="mono">{faixa(pisoPagina, observado.vendidosTexto!)}</span>
        </div>
      )}
      {!temAnuncio && <p className="nota">Vendas e idade deste anúncio indisponíveis. Entre no Mercado Livre neste navegador para vê-las.</p>}
      {a.dias === null && observado.motivo && <p className="nota">{`Leitura da página do anúncio: ${observado.motivo}.`}</p>}
      {a.minimoPorMes !== null && <p className="nota">Mínimo: piso da faixa dividido pela idade do anúncio.</p>}
    </section>
  );
}
