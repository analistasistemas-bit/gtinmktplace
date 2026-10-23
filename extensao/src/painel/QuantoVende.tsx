// Bloco "Quanto vende · Observado" (ADR-0189 D-6/D-9 + emenda 2026-10-22). Ritmo só com faixa e data do MESMO
// anúncio (HTML produto.mercadolivre); a faixa de /p/ (catálogo) e /up/ (produto do vendedor) é agregada e aparece
// à parte, sem ritmo. Estimativa: só a recalibrada, nas faixas validadas e pela faixa DO anúncio (emenda de 23/10).
import { estimarVendasCalibrada } from '../compartilhado/estimativa';
import { pisoDosVendidos, quantoVende } from '../compartilhado/quanto-vende';
import type { DadosQualidade } from '../compartilhado/qualidade';

export interface Observado { vendidosTexto: string | null; vendidosAnuncio?: string | null; criadoEm: string | null; motivo?: string; lojaOficial?: { nome: string | null } | null; qualidade?: DadosQualidade | null }

const num = (n: number) => n.toLocaleString('pt-BR');
const faixa = (piso: number, texto: string) => (/^\+/.test(texto.trim()) ? `+${num(piso)}` : num(piso));

const bloqueado = (motivo?: string) => !!motivo && /captcha/i.test(motivo);

export function QuantoVende({ observado, catalogo, catalogoCriadoEm, agora }: {
  observado: Observado; catalogo: boolean; catalogoCriadoEm?: string | null; agora?: Date;
}) {
  const a = quantoVende({ vendidosTexto: observado.vendidosAnuncio ?? null, criadoEm: observado.criadoEm }, agora);
  // Ritmo do catálogo: faixa da página /p/ (todos os vendedores) ÷ idade do produto de catálogo (/products, D-9).
  const c = catalogo && catalogoCriadoEm ? quantoVende({ vendidosTexto: observado.vendidosTexto, criadoEm: catalogoCriadoEm }, agora) : null;
  const temAnuncio = a.piso !== null || a.dias !== null;
  const est = estimarVendasCalibrada(observado.vendidosAnuncio ?? null);
  const pisoPagina = pisoDosVendidos(observado.vendidosTexto);
  // Catálogo é outra entidade (todos os vendedores): sempre à parte; fora dele, só se a faixa difere da do anúncio.
  const paginaAParte = pisoPagina !== null && (catalogo || observado.vendidosTexto?.trim() !== observado.vendidosAnuncio?.trim());
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
          {est && (
            <div className="qv-agregado qv-estimativa">
              <div className="qv-agregado-linha">
                <span>Total estimado <span className="estimativa">Estimativa</span></span>
                <span className="mono">{`≈ ${num(est.estimativa)}`}</span>
              </div>
              <p className="nota">
                {`Faixa +${num(est.piso)} × ${est.fator.toLocaleString('pt-BR')}, calibrada em vendas reais de anúncios próprios (amostra limitada; erro mediano medido ${est.erroMedianoPct.toLocaleString('pt-BR')}%).`}
              </p>
            </div>
          )}
        </>
      )}
      {paginaAParte && (
        <div className="qv-agregado">
          <div className="qv-agregado-linha">
            <span>{catalogo ? 'Catálogo, todos os vendedores' : 'Somando os anúncios deste produto'}</span>
            <span className="mono">{faixa(pisoPagina, observado.vendidosTexto!)}</span>
          </div>
          {c?.dias != null && (
            <div className="qv-agregado-linha mono">
              <span>{`desde ${new Date(c.criadoEm!).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' })}`}</span>
              {c.minimoPorMes !== null && <span>{`≥ ${num(c.minimoPorMes)}/mês`}</span>}
              {c.minimoPorDia !== null && <span>{`≥ ${num(c.minimoPorDia)}/dia`}</span>}
            </div>
          )}
        </div>
      )}
      {!temAnuncio && (
        <p className="nota">
          {bloqueado(observado.motivo)
            ? 'Vendas e idade deste anúncio: o Mercado Livre não libera essa leitura para a extensão.'
            : `Vendas e idade deste anúncio indisponíveis${observado.motivo ? ` (${observado.motivo})` : ''}.`}
        </p>
      )}
      {(a.minimoPorMes !== null || c?.minimoPorMes != null) && <p className="nota">Mínimo: piso da faixa dividido pela idade.</p>}
    </section>
  );
}
