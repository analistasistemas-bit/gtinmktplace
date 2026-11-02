// Visão "Busca" do painel (ADR-0189 D-11, Task 22; emenda 2026-11-02, Task 5): resumo dos produtos carregados, filtros
// e ordenação só no painel (o DOM do ML não é reordenado; o clique destaca o card na página), lista com miniatura,
// Minha margem dos vinculados e vínculo dos demais. O SW identifica e analisa sozinho: o painel só consome o estado e
// oferece "Tentar de novo" quando o estado diz que algo aguarda cota ou falhou.
import { useId, useState } from 'react';
import type { EstadoBusca } from '../busca-sw';
import {
  filtrarCards, margemClassico, ordenarCards, resumoBusca, type FiltroBusca, type OrdemBusca,
} from '../compartilhado/busca-resumo';
import type { CardBusca } from '../leitura/busca';
import type { MetadadosCardBusca } from '../../../supabase/functions/_shared/extensao/busca.ts';
import type { MargemTipo } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import { brl, mensagemDeErro, type Chamar } from './formato';
import { VinculoProduto } from './VinculoProduto';

const LINHAS = 15;
const num = (n: number) => n.toLocaleString('pt-BR');
const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
/** `cor` = significado fixo da paleta (chart-1 meu/minha margem, 2 catálogo, 3 Full/frete, 4 medalha, 5 patrocinado/oferta). */
const FILTROS: { id: FiltroBusca; rotulo: string; cor: 1 | 2 | 3 | 4 | 5 }[] = [
  { id: 'meus', rotulo: 'Meus anúncios', cor: 1 },
  { id: 'vinculados', rotulo: 'SKUs vinculados', cor: 1 },
  { id: 'catalogo', rotulo: 'Com catálogo', cor: 2 },
  { id: 'full', rotulo: 'Full', cor: 3 },
  { id: 'frete', rotulo: 'Frete grátis', cor: 3 },
  { id: 'oficiais', rotulo: 'Oficiais', cor: 4 },
  { id: 'patrocinados', rotulo: 'Patrocinados', cor: 5 },
  { id: 'oferta', rotulo: 'Com oferta', cor: 5 },
];
const ORDENS: { id: OrdemBusca; rotulo: string }[] = [
  { id: 'relevancia', rotulo: 'Relevância' }, { id: 'vendidos', rotulo: 'Vendidos' }, { id: 'preco', rotulo: 'Preço' }, { id: 'margem', rotulo: 'Margem' },
];

type Analisar = (forcar: string[]) => Promise<{ ok: boolean; erro?: string }>;
type Resultado = EstadoBusca['resposta']['resultados'][string] | undefined;

export function Busca({ estado, chamar, analisar, destacar }: {
  estado: EstadoBusca; chamar: Chamar; analisar: Analisar; destacar: (itemId: string) => void;
}) {
  const { cards, ocorrencias } = estado.observado;
  const { resultados, metadados } = estado.resposta;
  const [filtros, setFiltros] = useState<Set<FiltroBusca>>(new Set());
  const [ordem, setOrdem] = useState<OrdemBusca>('relevancia');
  const [todos, setTodos] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nomeOrdem = useId();

  const rodar = async (forcar: string[] = []) => {
    setOcupado(true);
    setErro(null);
    const r = await analisar(forcar);
    setOcupado(false);
    if (!r.ok) setErro(mensagemDeErro(r.erro ?? 'interno'));
  };

  const r = resumoBusca(cards, metadados, ocorrencias);
  const aguardando = cards.filter((c) => resultados[c.itemId]?.estado === 'limite').length;
  const visiveis = ordenarCards(filtrarCards(cards, metadados, filtros), resultados, ordem);
  const mostrar = todos ? visiveis : visiveis.slice(0, LINHAS);
  const contagem: Record<FiltroBusca, number> = {
    meus: r.meus, vinculados: r.vinculados, full: r.full, frete: r.freteGratis, oficiais: r.oficiais, catalogo: r.comCatalogo, patrocinados: r.patrocinados, oferta: r.comOferta,
  };
  const alternar = (f: FiltroBusca) => setFiltros((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  // Desconhecido nunca vira 0: nada identificado = "Verificando"; verificação de anúncio próprio falhou (null) em todos
  // os identificados = "Indisponível"; em parte deles = contagem + quantos ficaram sem verificação.
  const meusDesconhecido = r.identificados === 0 || r.proprioIndisponivel === r.identificados;
  const contagemConhecida: Partial<Record<FiltroBusca, boolean>> = { meus: !meusDesconhecido, vinculados: r.identificados > 0 };
  const contar = (n: number, indisponivel = 0) => {
    if (r.identificados === 0) return <dd className="bs-verificando">Verificando</dd>;
    if (indisponivel === r.identificados) return <dd className="bs-verificando">Indisponível</dd>;
    return <dd><span className="mono">{num(n)}</span>{indisponivel > 0 && <span className="bs-bloco-nota">{`${num(indisponivel)} sem verificação`}</span>}</dd>;
  };
  const vm = r.vendidosMinimos;

  if (cards.length === 0) {
    return (
      <div className="cartao chamada">
        <h2>Lendo a busca…</h2>
        <p>Os produtos aparecem aqui assim que a página do Mercado Livre terminar de mostrar os resultados.</p>
      </div>
    );
  }

  return (
    <section className="cartao bs-painel" aria-labelledby="bs-titulo" aria-busy={ocupado || undefined}>
      <header className="bs-cabeca">
        <div className="bs-cabeca-topo">
          <h2 id="bs-titulo">Busca</h2>
          <span className="bs-contagem mono">{`${num(r.produtos)} produtos`}</span>
        </div>
        <p className="bs-cabeca-nota">{`${num(r.ocorrencias)} cards na página, ${num(r.produtos)} produtos diferentes`}</p>
        {r.identificados > 0 && r.identificados < r.produtos && (
          <p className="bs-cabeca-nota">{`Identificados ${num(r.identificados)} de ${num(r.produtos)}`}</p>
        )}
      </header>

      <div className="bs-corpo">
        <div className="bs-resumo">
          <dl className="bs-blocos">
            <div className="bs-bloco" data-cor="meu"><dt>Meus anúncios</dt>{contar(r.meus, r.proprioIndisponivel)}</div>
            <div className="bs-bloco" data-cor="vinculado"><dt>SKUs vinculados</dt>{contar(r.vinculados)}</div>
          </dl>
          <div className="bs-faixas">
            <div className="ct-linha">
              <span className="ct-rotulo">Faixa de preço</span>
              <span className="mono ct-forte">{r.menorPreco === null ? 'Não informada' : `${brl(r.menorPreco)} a ${brl(r.maiorPreco!)}`}</span>
            </div>
            <div className="ct-linha">
              <span className="ct-rotulo">Soma dos mínimos informados</span>
              <span className="mono ct-forte">{vm.cobertura ? `${num(vm.soma)} vendidos` : 'Não informado'}</span>
            </div>
            <p className="nota bs-cobertura">{`${num(vm.cobertura)} de ${num(vm.grupos)} grupos de vendas${vm.conflitos ? ` · ${num(vm.conflitos)} ${vm.conflitos === 1 ? 'excluído' : 'excluídos'} por identificação conflitante` : ''}`}</p>
            <div className="ct-linha">
              <span className="ct-rotulo">Volume mínimo ao preço atual</span>
              <span className="mono ct-forte">{r.volumeMinimo.cobertura ? brl(r.volumeMinimo.centavos / 100) : 'Não informado'}</span>
            </div>
            <p className="nota bs-cobertura">{`Volume: ${num(r.volumeMinimo.cobertura)} de ${num(r.volumeMinimo.grupos)} grupos com piso e preço`}</p>
          </div>
        </div>

        {ocupado && <p className="nota" role="status">Analisando…</p>}
        {!ocupado && erro && (
          <div className="bs-aviso erro" role="alert">
            <span>{erro}</span>
            <button type="button" className="secundario" onClick={() => rodar()}>Tentar de novo</button>
          </div>
        )}
        {!ocupado && !erro && aguardando > 0 && (
          <div className="bs-aviso aguardando">
            <span>{`Minha margem aguardando cota em ${num(aguardando)} ${aguardando === 1 ? 'produto' : 'produtos'}`}</span>
            <button type="button" className="secundario" onClick={() => rodar()}>Tentar de novo</button>
          </div>
        )}

        <div className="bs-filtros" role="group" aria-label="Filtrar produtos">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className="bs-chip" data-cor={f.cor} aria-pressed={filtros.has(f.id)} onClick={() => alternar(f.id)}>
              {f.rotulo}{contagemConhecida[f.id] !== false && <span className="mono">{num(contagem[f.id])}</span>}
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
            <Linha key={c.itemId} card={c} resultado={resultados[c.itemId]} meta={metadados[c.itemId]} aberto={aberto === c.itemId}
              onAbrir={() => setAberto(aberto === c.itemId ? null : c.itemId)} onDestacar={() => destacar(c.itemId)}
              chamar={chamar} onVinculado={() => { setAberto(null); void rodar([c.itemId]); }} />
          ))}
        </ul>
        {visiveis.length === 0 && <p className="nota">Nenhum produto com esses filtros.</p>}
        {visiveis.length > LINHAS && (
          <button type="button" className="link" onClick={() => setTodos(!todos)}>{todos ? 'Ver menos' : `Ver todos (${num(visiveis.length)})`}</button>
        )}
      </div>
    </section>
  );
}

function Miniatura({ url, estado }: { url: string | null; estado: string }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <span className="bs-miniatura" data-estado={estado} aria-hidden="true">
      {url && !falhou
        ? <img src={url} alt="" width={56} height={56} loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)} />
        : <span className="bs-miniatura-vazia" />}
    </span>
  );
}

function Composicao({ rotulo, tipo }: { rotulo: string; tipo: { estado: string; valor?: MargemTipo } }) {
  const v = tipo.estado === 'ok' ? tipo.valor : undefined;
  const r$ = (n: number | null | undefined) => (typeof n === 'number' ? brl(n) : 'Não informado');
  return (
    <div className="bs-tipo">
      <dt>{rotulo}</dt>
      {v ? (
        <dd>
          <span className="mono">{`Lucro ${r$(v.lucro)}${typeof v.margemPct === 'number' ? ` · ${pct(v.margemPct)}` : ''}`}</span>
          <span className="mono bs-tipo-conta">{`Recebe ${r$(v.recebe)} · Comissão na sua conta ${r$(v.comissao)} · imposto ${r$(v.imposto)} · Frete na sua conta ${r$(v.frete)} · custo ${r$(v.custo)}`}</span>
        </dd>
      ) : <dd>Indisponível</dd>}
    </div>
  );
}

function Linha({ card: c, resultado, meta, aberto, onAbrir, onDestacar, chamar, onVinculado }: {
  card: CardBusca; resultado: Resultado; meta: MetadadosCardBusca | undefined; aberto: boolean;
  onAbrir: () => void; onDestacar: () => void; chamar: Chamar; onVinculado: () => void;
}) {
  const m = margemClassico(resultado);
  const estado = resultado?.estado;
  const proprio = meta?.proprio === true, vinculado = !!meta?.vinculo, semVinculo = !!meta && !meta.vinculo;
  const borda = proprio ? 'meu' : vinculado ? 'vinculado' : meta ? 'sem-vinculo' : 'desconhecido';
  return (
    <li className="bs-item">
      <Miniatura key={c.miniaturaUrl ?? ''} url={c.miniaturaUrl} estado={borda} />
      <div className="bs-conteudo">
        <div className="bs-linha">
          <button type="button" className="bs-titulo" onClick={onDestacar} title="Mostrar este card na página">{c.titulo}</button>
          <span className="bs-valor">
            {m !== null && <span className={`bs-margem ${m < 0 ? 'prejuizo' : 'lucro'}`} aria-label={`Margem simulada no Clássico: ${pct(m)}`}>{pct(m)}</span>}
            {estado === 'ok' && m === null && <span className="bs-estado">Margem indisponível</span>}
            {estado === 'sem_categoria' && <span className="bs-estado">Sem categoria</span>}
            {estado === 'limite' && <span className="bs-estado aguardando">Minha margem aguardando cota</span>}
            {estado === 'indisponivel' && <span className="bs-estado">Indisponível</span>}
          </span>
        </div>
        <div className="bs-sinais">
          <span className="mono bs-preco">{c.preco === null ? 'Preço não lido' : brl(c.preco)}</span>
          {c.vendidosTexto && <span>{c.vendidosTexto}</span>}
          {proprio && <span className="bs-tag" data-cor="1">Meu anúncio</span>}
          {vinculado && <span className="bs-tag" data-cor="1">SKU vinculado</span>}
          {c.full && <span className="bs-tag" data-cor="3">Full</span>}
          {c.lojaOficial && <span className="bs-tag" data-cor="4">Oficial</span>}
          {c.patrocinado && <span className="bs-tag" data-cor="5">Patrocinado</span>}
          {semVinculo && (
            <button type="button" className="bs-vincular" aria-label="Vincular ao meu SKU" aria-expanded={aberto} onClick={onAbrir}>Vincular</button>
          )}
        </div>
        <details className="bs-detalhes">
          <summary>Detalhes</summary>
          <p>{c.titulo}</p>
          {resultado?.estado === 'ok' && resultado.margem && (
            <dl className="bs-composicao">
              <Composicao rotulo="Clássico" tipo={resultado.margem.classico} />
              <Composicao rotulo="Premium" tipo={resultado.margem.premium} />
            </dl>
          )}
          {resultado && 'codigo' in resultado && <p className="nota">{`SKU ${resultado.codigo}`}</p>}
        </details>
      </div>
      {aberto && semVinculo && (
        <div className="bs-vinculo">
          <VinculoProduto entrada={{ mlItemId: c.itemId, catalogProductId: c.catalogProductId }} fonte="nenhuma" chamar={chamar} onVinculado={onVinculado} abertoInicial />
        </div>
      )}
    </li>
  );
}
