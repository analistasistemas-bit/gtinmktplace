// Bloco "Qualidade do anúncio" (ADR-0189 D-10, Task 17): checklist do que a página mostra, no formato de
// extrato (rótulo à esquerda, valor medido à direita). Desconhecido aparece como "não informado", nunca ok.
import { avaliarQualidade, type DadosQualidade, type EstadoItem } from '../compartilhado/qualidade';

const MAX_CHIPS = 8;
const ROTULO_ESTADO: Record<EstadoItem, string> = { ok: 'OK:', atencao: 'Atenção:', nao_informado: 'Não informado:' };

// Uma família de ícones (traço 2, 16px), só como reforço do texto.
function Icone({ estado }: { estado: EstadoItem }) {
  return (
    <svg className="ql-icone" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {estado === 'ok' && <path d="M3.5 8.5l3 3 6-7" />}
      {estado === 'atencao' && <><path d="M8 4v5" /><path d="M8 12h.01" /></>}
      {estado === 'nao_informado' && <path d="M4.5 8h7" />}
    </svg>
  );
}

export function Qualidade({ dados }: { dados: DadosQualidade }) {
  const q = avaliarQualidade(dados);
  if (q.itens.every((i) => i.estado === 'nao_informado')) return null;
  const tudoOk = q.itens.every((i) => i.estado === 'ok');
  const resumo = q.atencao > 0 ? `${q.atencao} a melhorar` : tudoOk ? 'Tudo certo' : 'Sem alertas';
  return (
    <section className="cartao quanto-vende qualidade" aria-labelledby="ql-titulo">
      <div className="qv-cabeca">
        <h2 id="ql-titulo">Qualidade do anúncio</h2>
        <span className={`ql-resumo ${q.atencao > 0 ? 'atencao' : tudoOk ? 'ok' : ''}`}>{resumo}</span>
      </div>
      <ul className="ql-lista">
        {q.itens.map((i) => (
          <li key={i.chave} data-estado={i.estado}>
            <div className="ql-linha">
              <Icone estado={i.estado} />
              <span className="ql-sr">{ROTULO_ESTADO[i.estado]}</span>
              <span className="ql-rotulo">{i.rotulo}</span>
              <span className="ql-valor mono">{i.valor}</span>
            </div>
            {i.chave === 'resolucao' && q.fotosFracas.length > 0 && (
              <div className="ql-chips">
                <span className="ql-chips-rotulo" aria-hidden="true">Fotos</span>
                {q.fotosFracas.slice(0, MAX_CHIPS).map((f) => (
                  <span key={f.id} className="ql-chip mono"><span className="ql-sr">Foto </span>{f.posicao}</span>
                ))}
                {q.fotosFracas.length > MAX_CHIPS && <span className="ql-chip mono">{`+${q.fotosFracas.length - MAX_CHIPS}`}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
