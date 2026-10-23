// Visão "Busca" do painel (ADR-0189 D-11, Task 22): resumo dos produtos carregados, filtros e ordenação só no painel
// (o DOM do ML não é reordenado; o clique destaca o card na página), margem simulada dos cards casados e vínculo dos
// demais. Análise ao abrir o painel; os cards que chegam no scroll esperam "Analisar novos resultados".
import { useEffect, useId, useRef, useState } from 'react';
import type { EstadoBusca } from '../busca-sw';
import {
  filtrarCards, margemClassico, ordenarCards, resumoBusca, type FiltroBusca, type OrdemBusca,
} from '../compartilhado/busca-resumo';
import type { CardBusca } from '../leitura/busca';
import { brl, mensagemDeErro, type Chamar } from './formato';
import { VinculoProduto } from './VinculoProduto';

const LINHAS = 15;
const MAX_POR_ANALISE = 50; // = MAX_POR_ANALISE do SW (busca-sw.ts) e MAX_ITENS_BUSCA da edge
const num = (n: number) => n.toLocaleString('pt-BR');
const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const FILTROS: { id: FiltroBusca; rotulo: string }[] = [
  { id: 'seus', rotulo: 'Seus produtos' },
  { id: 'full', rotulo: 'Full' },
  { id: 'frete', rotulo: 'Frete grátis' },
  { id: 'oficiais', rotulo: 'Oficiais' },
  { id: 'catalogo', rotulo: 'Com catálogo' },
  { id: 'patrocinados', rotulo: 'Patrocinados' },
  { id: 'oferta', rotulo: 'Com oferta' },
];
const ORDENS: { id: OrdemBusca; rotulo: string }[] = [
  { id: 'relevancia', rotulo: 'Relevância' }, { id: 'vendidos', rotulo: 'Vendidos' }, { id: 'preco', rotulo: 'Preço' }, { id: 'margem', rotulo: 'Margem' },
];

type Analisar = (forcar: string[]) => Promise<{ ok: boolean; erro?: string }>;

export function Busca({ estado, chamar, analisar, destacar }: {
  estado: EstadoBusca; chamar: Chamar; analisar: Analisar; destacar: (itemId: string) => void;
}) {
  const { cards, ocorrencias } = estado.observado;
  const resultados = estado.resposta.resultados;
  const [filtros, setFiltros] = useState<Set<FiltroBusca>>(new Set());
  const [ordem, setOrdem] = useState<OrdemBusca>('relevancia');
  const [todos, setTodos] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nomeOrdem = useId();
  const autoFeito = useRef(false);

  const pendentes = cards.filter((c) => c.preco !== null && (!resultados[c.itemId] || resultados[c.itemId]?.estado === 'limite'));
  const nenhumResultado = Object.keys(resultados).length === 0;
  const verificados = cards.filter((c) => resultados[c.itemId] && resultados[c.itemId]?.estado !== 'limite').length;

  const rodar = async (forcar: string[] = []) => {
    setOcupado(true);
    setErro(null);
    const r = await analisar(forcar);
    setOcupado(false);
    if (!r.ok) setErro(r.erro === 'limite' ? mensagemDeErro('limite') : mensagemDeErro(r.erro ?? 'interno'));
  };
  // Ao abrir o painel numa busca ainda não analisada: analisa os produtos já carregados (uma vez).
  useEffect(() => {
    if (autoFeito.current || !nenhumResultado || pendentes.length === 0) return;
    autoFeito.current = true;
    void rodar();
  });

  const r = resumoBusca(cards, resultados, ocorrencias);
  const visiveis = ordenarCards(filtrarCards(cards, resultados, filtros), resultados, ordem);
  const mostrar = todos ? visiveis : visiveis.slice(0, LINHAS);
  const contagem: Record<FiltroBusca, number> = {
    seus: r.vinculados, full: r.full, frete: r.freteGratis, oficiais: r.oficiais, catalogo: r.comCatalogo, patrocinados: r.patrocinados, oferta: r.comOferta,
  };
  const alternar = (f: FiltroBusca) => setFiltros((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  if (cards.length === 0) {
    return (
      <div className="cartao chamada">
        <h2>Lendo a busca…</h2>
        <p>Os produtos aparecem aqui assim que a página do Mercado Livre terminar de mostrar os resultados.</p>
      </div>
    );
  }

  return (
    <section className="cartao quanto-vende bs-painel" aria-labelledby="bs-titulo" aria-busy={ocupado || undefined}>
      <div className="qv-cabeca">
        <h2 id="bs-titulo">Busca</h2>
        <span className="observado">{`${num(r.produtos)} produtos`}</span>
      </div>
      <p className="nota">{`${num(r.ocorrencias)} cards na página, ${num(r.produtos)} produtos diferentes`}</p>

      <div className="ct-resumo bs-resumo">
        <dl className="qv-numeros ct-resumo-numeros">
          <div><dt>Seus produtos</dt>{nenhumResultado
            ? <dd className="bs-verificando">Verificando</dd>
            : <dd className="mono">{num(r.vinculados)}</dd>}</div>
          <div><dt>Com catálogo</dt><dd className="mono">{num(r.comCatalogo)}</dd></div>
          <div><dt>Ofertas Full</dt><dd className="mono">{num(r.full)}</dd></div>
        </dl>
        {!nenhumResultado && verificados < r.produtos && (
          <p className="nota">{`Seus produtos: ${num(verificados)} de ${num(r.produtos)} verificados`}</p>
        )}
        <div className="ct-linha">
          <span className="ct-rotulo">Faixa de preço</span>
          <span className="mono ct-forte">{r.menorPreco === null ? 'Não informada' : `${brl(r.menorPreco)} a ${brl(r.maiorPreco!)}`}</span>
        </div>
        <div className="ct-linha">
          <span className="ct-rotulo">Soma dos mínimos informados</span>
          <span className="mono ct-forte">{`${num(r.vendidosMinimos.soma)} vendidos`}</span>
        </div>
        <p className="nota bs-cobertura">{`${num(r.vendidosMinimos.cobertura)} de ${num(r.produtos)} produtos`}</p>
      </div>

      {ocupado && <p className="nota" role="status">{`Analisando ${num(Math.min(pendentes.length, MAX_POR_ANALISE))} produtos…`}</p>}
      {erro && (
        <div className="bs-erro" role="alert">
          <span>{erro}</span>
          <button type="button" className="secundario" onClick={() => rodar()}>Tentar de novo</button>
        </div>
      )}
      {!ocupado && !erro && pendentes.length > 0 && (
        <button type="button" className="secundario" onClick={() => rodar()}>
          {`${nenhumResultado ? 'Analisar resultados' : 'Analisar novos resultados'} (${num(pendentes.length)})`}
        </button>
      )}

      <div className="bs-filtros" role="group" aria-label="Filtrar produtos">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" className="bs-chip" aria-pressed={filtros.has(f.id)} onClick={() => alternar(f.id)}>
            {f.rotulo}<span className="mono">{num(contagem[f.id])}</span>
          </button>
        ))}
      </div>

      <div className="segmentado ct-ordem bs-ordem">
        <div className="opcoes" role="radiogroup" aria-label="Ordenar produtos por">
          {ORDENS.map((o) => (
            <label key={o.id}>
              <input type="radio" name={nomeOrdem} checked={ordem === o.id} onChange={() => setOrdem(o.id)} />
              {o.rotulo}
            </label>
          ))}
        </div>
      </div>

      {r.vinculados > 0 && <p className="nota">Margem simulada no Clássico ao preço de cada card.</p>}
      <ul className="bs-lista" aria-label="Produtos da busca">
        {mostrar.map((c) => (
          <Linha key={c.itemId} card={c} resultado={resultados[c.itemId]} aberto={aberto === c.itemId}
            onAbrir={() => setAberto(aberto === c.itemId ? null : c.itemId)} onDestacar={() => destacar(c.itemId)}
            chamar={chamar} onVinculado={() => { setAberto(null); void rodar([c.itemId]); }} />
        ))}
      </ul>
      {visiveis.length === 0 && <p className="nota">Nenhum produto com esses filtros.</p>}
      {visiveis.length > LINHAS && (
        <button type="button" className="link" onClick={() => setTodos(!todos)}>{todos ? 'Ver menos' : `Ver todos (${num(visiveis.length)})`}</button>
      )}
    </section>
  );
}

function Linha({ card: c, resultado, aberto, onAbrir, onDestacar, chamar, onVinculado }: {
  card: CardBusca; resultado: EstadoBusca['resposta']['resultados'][string] | undefined; aberto: boolean;
  onAbrir: () => void; onDestacar: () => void; chamar: Chamar; onVinculado: () => void;
}) {
  const m = margemClassico(resultado);
  const estado = resultado?.estado;
  return (
    <li>
      <div className="bs-linha">
        <button type="button" className="bs-titulo" onClick={onDestacar} title="Mostrar este card na página">{c.titulo}</button>
        <span className="bs-valor">
          {m !== null && <span className={`bs-margem ${m < 0 ? 'prejuizo' : 'lucro'}`} aria-label={`Margem simulada no Clássico: ${pct(m)}`}>{pct(m)}</span>}
          {estado === 'ok' && m === null && <span className="bs-estado">Margem indisponível</span>}
          {estado === 'sem_categoria' && <span className="bs-estado">Sem categoria</span>}
          {estado === 'limite' && <span className="bs-estado">Limite</span>}
          {estado === 'indisponivel' && <span className="bs-estado">Indisponível</span>}
        </span>
      </div>
      <div className="ct-oferta-detalhe">
        <span className="mono bs-preco">{c.preco === null ? 'Preço não lido' : brl(c.preco)}</span>
        {c.vendidosTexto && <span>{c.vendidosTexto}</span>}
        {resultado && estado !== 'sem_vinculo' && <span className="ct-tag sua">Seu SKU</span>}
        {c.full && <span className="ct-tag">Full</span>}
        {c.lojaOficial && <span className="ct-tag">Oficial</span>}
        {c.patrocinado && <span className="ct-tag">Patrocinado</span>}
        {estado === 'sem_vinculo' && (
          <button type="button" className="bs-vincular" aria-label="Vincular ao meu SKU" aria-expanded={aberto} onClick={onAbrir}>Vincular</button>
        )}
      </div>
      {aberto && estado === 'sem_vinculo' && (
        <div className="bs-vinculo">
          <VinculoProduto entrada={{ mlItemId: c.itemId, catalogProductId: c.catalogProductId }} fonte="nenhuma" chamar={chamar} onVinculado={onVinculado} abertoInicial />
        </div>
      )}
    </li>
  );
}
