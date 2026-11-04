// Visão "Busca" do painel (ADR-0189 D-11, Task 22; emenda 2026-11-02, Task 5): resumo dos produtos carregados, filtros
// e ordenação só no painel (o DOM do ML não é reordenado; o clique destaca o card na página), lista com miniatura,
// Minha margem dos vinculados e vínculo dos demais. O SW identifica e analisa sozinho: o painel só consome o estado e
// oferece "Tentar de novo" (margem aguardando cota ou falha) e "Tentar novamente" (enriquecimento parcial).
import { useId, useState } from 'react';
import type { EstadoBusca } from '../busca-sw';
import {
  filtrarCards, margemClassico, ordenarCards, participacaoNosPisos, resumoBusca, resumoEnriquecimento, type FiltroBusca, type OrdemBusca,
} from '../compartilhado/busca-resumo';
import {
  esperaDaNovaTentativa, haParaTentar, NOME_MEDALHA, NOME_REPUTACAO, REPUTACOES, vistaDoCard, vistaDoFrete, type EstadoEnriquecimento, type Reputacao,
} from '../compartilhado/enriquecimento';
import type { CardBusca } from '../leitura/busca';
import type { MetadadosCardBusca } from '../../../supabase/functions/_shared/extensao/busca.ts';
import type { MargemTipo } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import { brl, mensagemDeErro, type Chamar } from './formato';
import { VinculoProduto } from './VinculoProduto';

const LINHAS = 15;
const num = (n: number) => n.toLocaleString('pt-BR');
const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
/** Fração 0–1 dos pisos observados: 12% · 3,4% · <0,1% (mesma regra do Mini-bloco). */
const pctPisos = (f: number) => (f > 0 && f < 0.001 ? '<0,1%' : `${(Math.round(f * (f < 0.1 ? 1000 : 100)) / (f < 0.1 ? 10 : 1)).toLocaleString('pt-BR')}%`);
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
  { id: 'relevancia', rotulo: 'Relevância' }, { id: 'vendidos', rotulo: 'Vendidos' }, { id: 'preco', rotulo: 'Preço' }, { id: 'margem', rotulo: 'Minha margem' },
];

const AJUDA = {
  faixa: ['Faixa de preço', 'Menor e maior preço entre os cards lidos nesta página, incluindo os patrocinados.'],
  vendas: ['Vendas mínimas da página', 'Soma do piso de vendidos que o Mercado Livre mostra em cada produto ("+100mil" conta como 100.000). Cada produto entra uma vez. Em card de catálogo, os vendidos são do produto somando todos os vendedores. É um mínimo: o total real é maior.'],
  giro: ['Giro mínimo ao preço atual', 'Piso de vendidos de cada produto × o preço atual do card. Serve para comparar o tamanho dos produtos entre si. Não é faturamento nem o valor realmente vendido: as vendas aconteceram a outros preços e o Mercado Livre só informa a faixa.'],
  meus: ['Meus anúncios', 'Anúncios desta página publicados pelas contas do Mercado Livre conectadas à sua empresa.'],
  vinculados: ['SKUs vinculados', 'Produtos desta página ligados a um SKU do seu catálogo (pelo catálogo do ML, pelo EAN da busca ou por vínculo manual). Só eles têm Minha margem calculada.'],
  catalogos: ['Catálogos lidos', 'Catálogos do Mercado Livre desta página já consultados: vendedores, medalha, UF, tipo do anúncio e idade. A página inteira é consultada de uma vez. Se o Mercado Livre limitar as consultas ou o tempo acabar, o que já chegou fica e o restante aparece como indisponível até você tocar em "Tentar novamente".'],
  medalhas: ['Vendedores por medalha', 'Cada vendedor conta uma vez, mesmo com vários anúncios na página. Só entram vendedores de anúncios localizados no catálogo; perfil não carregado ou medalha não informada pelo Mercado Livre ficam em "Não informada".'],
  ufs: ['UF dos vendedores', 'Estado do endereço do vendedor no Mercado Livre, um por vendedor. Mostra as 5 UFs mais frequentes; as demais somam em "Outras".'],
  tipos: ['Tipo de anúncio', 'Clássico ou Premium da oferta de cada card no catálogo. Cards cuja oferta não foi localizada na leitura não entram.'],
  faixas: ['Vendedores por catálogo', 'Quantos vendedores diferentes cada catálogo tem, contando só catálogos com leitura completa. Leitura parcial aparece como "≥ N": há pelo menos N vendedores.'],
  participacao: ['% dos pisos observados', 'Em cada produto da lista: o piso de vendidos dele ÷ a soma dos pisos de vendidos dos produtos carregados nesta busca (a mesma base das Vendas mínimas). Cada produto conta uma vez: catálogo = o produto inteiro, patrocinado e orgânico juntos. "—" = sem piso de vendidos. Não é participação de mercado.'],
  frete: ['Frete cotado', 'Cotação do Mercado Livre para a oferta de cada card, CEP 01310-100 (São Paulo capital). Valor antes dos descontos, opção recomendada ou primeira disponível. Não é o custo efetivamente pago pelo vendedor nem o "Frete na sua conta" da Minha margem.'],
  reputacao: ['Vendedores por reputação', 'Cor do termômetro de reputação do Mercado Livre, um por vendedor único das ofertas localizadas no catálogo. Perfil não carregado ou reputação não informada ficam em "Não informada". Na lista, o ponto colorido ao lado da cidade cadastrada do vendedor.'],
  ordem: ['Ordenar', 'Relevância: a ordem do Mercado Livre. Vendidos: maior piso de vendidos primeiro. Preço: menor primeiro. Minha margem: sua margem simulada no Clássico ao preço de cada card, só para produtos vinculados. A ordem muda apenas esta lista, nunca a página do ML.'],
} as const;
type IdAjuda = keyof typeof AJUDA;

/** Botão "i" ao lado de um rótulo; a explicação (`Ajuda`) aparece logo abaixo da linha. */
function Info({ id, aberto, onAlternar }: { id: IdAjuda; aberto: boolean; onAlternar: (id: IdAjuda) => void }) {
  return <button type="button" className="bs-info" aria-label={`O que é ${AJUDA[id][0]}?`} aria-expanded={aberto} onClick={() => onAlternar(id)}>i</button>;
}
const Ajuda = ({ id, aberto }: { id: IdAjuda; aberto: IdAjuda | null }) => (aberto === id ? <p className="nota bs-ajuda" role="note">{AJUDA[id][1]}</p> : null);

type Analisar = (forcar: string[], retentar?: boolean) => Promise<{ ok: boolean; erro?: string; tentarAposEm?: number }>;
const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const pausa = (ms: number) => `O Mercado Livre pediu uma pausa; tente de novo às ${hora(ms)}`;
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
  const [ajuda, setAjuda] = useState<IdAjuda | null>(null);
  // Resposta do "Tentar novamente" do enriquecimento (pausa pedida pelo ML ou erro): fica na seção dos catálogos.
  const [avisoRetentar, setAvisoRetentar] = useState<string | null>(null);
  const alternarAjuda = (id: IdAjuda) => setAjuda((a) => (a === id ? null : id));
  const nomeOrdem = useId();

  const rodar = async (forcar: string[] = []) => {
    setOcupado(true);
    setErro(null);
    const r = await analisar(forcar);
    setOcupado(false);
    if (!r.ok) setErro(mensagemDeErro(r.erro ?? 'interno'));
  };
  const retentar = async () => {
    setOcupado(true);
    setAvisoRetentar(null);
    const r = await analisar([], true);
    setOcupado(false);
    if (!r.ok) setAvisoRetentar(r.erro === 'aguardar' && typeof r.tentarAposEm === 'number' ? pausa(r.tentarAposEm) : mensagemDeErro(r.erro ?? 'interno'));
  };

  const r = resumoBusca(cards, metadados, ocorrencias);
  const enr = estado.resposta.enriquecimento;
  // Base única: todos os cards carregados (o filtro e a ordem da lista não mudam a participação).
  const participacao = participacaoNosPisos(cards);
  const fretes = cards.map((c) => vistaDoFrete(c, c.preco, enr)).filter((f) => f !== null);
  const fretesCotados = fretes.filter((f) => f !== 'consultando' && f.estado === 'ok').length;
  const aguardando = cards.filter((c) => resultados[c.itemId]?.estado === 'limite').length;
  // Sem produto vinculado não há margem para ordenar: a aba fica desabilitada e a ordem cai para Relevância.
  const semMargem = r.vinculados === 0;
  const ordemAtiva: OrdemBusca = ordem === 'margem' && semMargem ? 'relevancia' : ordem;
  const visiveis = ordenarCards(filtrarCards(cards, metadados, filtros), resultados, ordemAtiva);
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
            <div className="bs-bloco" data-cor="meu"><dt>Meus anúncios<Info id="meus" aberto={ajuda === 'meus'} onAlternar={alternarAjuda} /></dt>{contar(r.meus, r.proprioIndisponivel)}</div>
            <div className="bs-bloco" data-cor="vinculado"><dt>SKUs vinculados<Info id="vinculados" aberto={ajuda === 'vinculados'} onAlternar={alternarAjuda} /></dt>{contar(r.vinculados)}</div>
          </dl>
          <Ajuda id="meus" aberto={ajuda} /><Ajuda id="vinculados" aberto={ajuda} />
          <div className="bs-faixas">
            <div className="ct-linha">
              <span className="ct-rotulo">Faixa de preço<Info id="faixa" aberto={ajuda === 'faixa'} onAlternar={alternarAjuda} /></span>
              <span className="mono ct-forte">{r.menorPreco === null ? 'Não informada' : `${brl(r.menorPreco)} a ${brl(r.maiorPreco!)}`}</span>
            </div>
            <Ajuda id="faixa" aberto={ajuda} />
            <div className="ct-linha">
              <span className="ct-rotulo">Vendas mínimas da página<Info id="vendas" aberto={ajuda === 'vendas'} onAlternar={alternarAjuda} /></span>
              <span className="mono ct-forte">{vm.cobertura ? `${num(vm.soma)} vendidos` : 'Não informado'}</span>
            </div>
            <Ajuda id="vendas" aberto={ajuda} />
            <p className="nota bs-cobertura">{`${num(vm.cobertura)} de ${num(vm.grupos)} grupos de vendas${vm.conflitos ? ` · ${num(vm.conflitos)} ${vm.conflitos === 1 ? 'excluído' : 'excluídos'} por identificação conflitante` : ''}`}</p>
            <div className="ct-linha">
              <span className="ct-rotulo">Giro mínimo ao preço atual<Info id="giro" aberto={ajuda === 'giro'} onAlternar={alternarAjuda} /></span>
              <span className="mono ct-forte">{r.volumeMinimo.cobertura ? brl(r.volumeMinimo.centavos / 100) : 'Não informado'}</span>
            </div>
            <Ajuda id="giro" aberto={ajuda} />
            <p className="nota bs-cobertura">{`Giro: ${num(r.volumeMinimo.cobertura)} de ${num(r.volumeMinimo.grupos)} grupos com piso e preço`}</p>
            <div className="ct-linha">
              <span className="ct-rotulo">% dos pisos observados<Info id="participacao" aberto={ajuda === 'participacao'} onAlternar={alternarAjuda} /></span>
              <span className="mono ct-forte">{`${num(participacao.cobertura)} de ${num(participacao.grupos)}`}</span>
            </div>
            <Ajuda id="participacao" aberto={ajuda} />
            <p className="nota bs-cobertura">grupos de vendas com piso, mostrado em cada produto da lista</p>
            {fretes.length > 0 && (
              <>
                <div className="ct-linha">
                  <span className="ct-rotulo">Frete cotado<Info id="frete" aberto={ajuda === 'frete'} onAlternar={alternarAjuda} /></span>
                  <span className="mono ct-forte">{`${num(fretesCotados)} de ${num(fretes.length)}`}</span>
                </div>
                <Ajuda id="frete" aberto={ajuda} />
                <p className="nota bs-cobertura">produtos com frete cotado, CEP 01310-100</p>
              </>
            )}
          </div>
        </div>

        <Catalogos cards={cards} enr={enr} ajuda={ajuda} alternarAjuda={alternarAjuda} ocupado={ocupado} retentar={retentar} aviso={avisoRetentar} />

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

        <div className="bs-ordem-rotulo">
          <span className="ct-rotulo">Ordenar<Info id="ordem" aberto={ajuda === 'ordem'} onAlternar={alternarAjuda} /></span>
        </div>
        <Ajuda id="ordem" aberto={ajuda} />
        <div className="segmentado ct-ordem bs-ordem">
          <div className="opcoes" role="radiogroup" aria-label="Ordenar produtos por">
            {ORDENS.map((o) => (
              <label key={o.id} title={o.id === 'margem' && semMargem ? 'Vincule um SKU a algum produto desta busca para ordenar por margem.' : undefined} data-desativada={o.id === 'margem' && semMargem ? '' : undefined}>
                <input type="radio" name={nomeOrdem} checked={ordemAtiva === o.id} disabled={o.id === 'margem' && semMargem} onChange={() => setOrdem(o.id)} />
                {o.rotulo}
              </label>
            ))}
          </div>
        </div>

        {r.vinculados > 0 && <p className="nota">Margem simulada no Clássico ao preço de cada card.</p>}
        <ul className="bs-lista" aria-label="Produtos da busca">
          {mostrar.map((c) => (
            <Linha key={c.itemId} card={c} enr={enr} participacao={participacao.porItem[c.itemId] ?? null} resultado={resultados[c.itemId]} precoDaMargem={estado.resposta.precoDaMargem?.[c.itemId]} meta={metadados[c.itemId]} aberto={aberto === c.itemId}
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

type Fatia = { rotulo: string; n: number; cor?: 4 | 'neutra' | Reputacao };
/** Distribuição em linhas rótulo · barra · contagem; a barra é a fatia do denominador (cor sempre com texto e número). */
function Distribuicao({ rotulo, fatias, total, classe }: { rotulo: string; fatias: Fatia[]; total: number; classe?: string }) {
  return (
    <ul className={`bs-distrib ${classe ?? ''}`} aria-label={rotulo}>
      {fatias.map((f) => (
        <li key={f.rotulo} data-cor={f.cor === 4 ? '4' : undefined} data-neutra={f.cor === 'neutra' ? '' : undefined} data-rep={typeof f.cor === 'string' && f.cor !== 'neutra' ? f.cor : undefined}>
          <span className="bs-distrib-rotulo">{f.rotulo}</span>
          <span className="bs-distrib-barra" aria-hidden="true"><span style={{ width: `${total ? Math.round((f.n / total) * 100) : 0}%` }} /></span>
          <span className="mono">{num(f.n)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Catálogos e vendedores (Task 10): resumo do enriquecimento, sempre com denominador; desconhecido fica à parte. */
function Catalogos({ cards, enr, ajuda, alternarAjuda, ocupado, retentar, aviso }: {
  cards: CardBusca[]; enr: EstadoEnriquecimento | undefined; ajuda: IdAjuda | null; alternarAjuda: (id: IdAjuda) => void; ocupado: boolean; retentar: () => void; aviso: string | null;
}) {
  const r = resumoEnriquecimento(cards, enr);
  // Parcial terminal (429, tempo, orçamento, rede): o que chegou fica; só o "Tentar novamente" refaz (sem retomada sozinha).
  // Página inteira indisponível (sem conexão ML, módulo desligado...) também: o motivo e o "Tentar novamente". Vale também
  // para busca sem catálogo (só frete).
  const tentar = !!enr && haParaTentar(enr);
  const espera = enr ? esperaDaNovaTentativa(enr, Date.now()) : null;
  const avisoTentar = tentar && !ocupado && (
    <div className={`bs-aviso ${enr!.falhou ? 'erro' : 'aguardando'}`} role={enr!.falhou ? 'alert' : undefined}>
      <span>{aviso ?? (espera !== null ? pausa(espera) : enr!.indisponivel ?? (enr!.falhou ? 'Não foi possível ler os dados adicionais agora.' : 'Dados adicionais indisponíveis agora'))}</span>
      <button type="button" className="secundario" onClick={retentar}>Tentar novamente</button>
    </div>
  );
  if (r.cardsComCatalogo === 0) return avisoTentar || null;
  const { vendedores: v, tipos: t, faixas: f } = r;
  const lidos = r.catalogosLidos;
  const comOfertas = f.completos + f.parciais.length;
  const titulo = (id: IdAjuda) => <h3 className="ct-rotulo bs-sub">{AJUDA[id][0]}<Info id={id} aberto={ajuda === id} onAlternar={alternarAjuda} /></h3>;
  const plural = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`;
  return (
    <section className="bs-catalogos" aria-labelledby="bs-catalogos-titulo">
      <h3 id="bs-catalogos-titulo" className="bs-catalogos-titulo">Catálogos e vendedores</h3>
      <div className="ct-linha">
        <span className="ct-rotulo">Catálogos lidos<Info id="catalogos" aberto={ajuda === 'catalogos'} onAlternar={alternarAjuda} /></span>
        <span className="mono ct-forte">{`${num(lidos)} de ${num(f.catalogos)}`}</span>
      </div>
      <Ajuda id="catalogos" aberto={ajuda} />
      {r.catalogosIndisponiveis > 0 && <p className="nota bs-cobertura">{`${plural(r.catalogosIndisponiveis, 'catálogo', 'catálogos')} sem ofertas lidas agora`}</p>}
      {!enr?.indisponivel && r.catalogosConsultando > 0 && <p className="nota bs-estado-enr" role="status">Consultando dados do catálogo</p>}
      {avisoTentar}
      {comOfertas > 0 && (
        <>
          {titulo('medalhas')}
          <Ajuda id="medalhas" aberto={ajuda} />
          <Distribuicao rotulo="Vendedores por medalha" classe="bs-medalhas" total={v.unicos} fatias={[
            ...(['platinum', 'gold', 'silver', 'sem'] as const).map((m) => ({ rotulo: NOME_MEDALHA[m], n: v.medalhas[m], cor: m === 'sem' ? 'neutra' as const : 4 as const })),
            { rotulo: 'Não informada', n: v.medalhaDesconhecida, cor: 'neutra' },
          ]} />
          <p className="nota bs-cobertura">{`${plural(v.unicos, 'vendedor único', 'vendedores únicos')} · ${num(v.cardsSemVendedor)} de ${num(r.cardsComCatalogo)} cards de catálogo sem vendedor identificado`}</p>
          {titulo('reputacao')}
          <Ajuda id="reputacao" aberto={ajuda} />
          <Distribuicao rotulo="Vendedores por reputação" classe="bs-reputacao" total={v.unicos} fatias={[
            ...REPUTACOES.map((k) => ({ rotulo: NOME_REPUTACAO[k][0].toUpperCase() + NOME_REPUTACAO[k].slice(1), n: v.reputacoes[k], cor: k })),
            { rotulo: 'Não informada', n: v.reputacaoDesconhecida, cor: 'neutra' as const },
          ]} />
          <p className="nota bs-cobertura">{`de ${plural(v.unicos, 'vendedor único', 'vendedores únicos')} · ${num(v.reputacaoDesconhecida)} sem reputação informada`}</p>
          {titulo('ufs')}
          <Ajuda id="ufs" aberto={ajuda} />
          <Distribuicao rotulo="UF dos vendedores" total={v.unicos} fatias={[
            ...v.ufs.map(([uf, n]) => ({ rotulo: uf, n })),
            ...(v.ufOutros ? [{ rotulo: 'Outras', n: v.ufOutros, cor: 'neutra' as const }] : []),
            ...(v.ufDesconhecida ? [{ rotulo: 'Não informada', n: v.ufDesconhecida, cor: 'neutra' as const }] : []),
          ]} />
          {titulo('tipos')}
          <Ajuda id="tipos" aberto={ajuda} />
          <Distribuicao rotulo="Tipo de anúncio" total={t.exatas} fatias={[
            { rotulo: 'Clássico', n: t.classico }, { rotulo: 'Premium', n: t.premium },
            ...(t.desconhecido ? [{ rotulo: 'Não confirmado', n: t.desconhecido, cor: 'neutra' as const }] : []),
          ]} />
          <p className="nota bs-cobertura">{`${num(t.exatas)} de ${num(r.cardsComCatalogo)} cards de catálogo com oferta localizada`}</p>
          {titulo('faixas')}
          <Ajuda id="faixas" aberto={ajuda} />
          <Distribuicao rotulo="Vendedores por catálogo" total={f.completos} fatias={[
            ...(f.semOfertas ? [{ rotulo: 'Sem ofertas', n: f.semOfertas, cor: 'neutra' as const }] : []),
            { rotulo: '1–5', n: f.ate5 }, { rotulo: '6–10', n: f.ate10 }, { rotulo: '11–30', n: f.ate30 }, { rotulo: 'Mais de 30', n: f.acima30 },
          ]} />
          <p className="nota bs-cobertura">{`${num(f.completos)} de ${num(comOfertas)} ${comOfertas === 1 ? 'catálogo' : 'catálogos'} com leitura completa${f.parciais.length ? ` · Leitura parcial: ${f.parciais.map((n) => `≥ ${num(n)}`).join(', ')}` : ''}`}</p>
        </>
      )}
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

/** Fatia 2.1 na linha: marca, reputação (ponto) + cidade/UF do vendedor da oferta exata, % dos pisos e frete cotado. */
function Extras({ card: c, preco, enr, participacao }: { card: CardBusca; preco: number | null; enr: EstadoEnriquecimento | undefined; participacao: number | null }) {
  const v = vistaDoCard(c, enr);
  const vend = v?.vendedor?.estado === 'ok' ? v.vendedor : null;
  // Frete só da aparição ao preço cotado (o do card agregado).
  const frete = preco !== null && preco === c.preco ? vistaDoFrete(c, preco, enr) : null;
  const local = vend?.cidade ? `${vend.cidade}${vend.uf ? `/${vend.uf}` : ''}` : null;
  return (
    <div className="bs-sinais bs-extras">
      <span title="Piso de vendidos deste produto ÷ soma dos pisos dos produtos carregados">{`${participacao === null ? '—' : pctPisos(participacao)} dos pisos observados`}</span>
      {frete === 'consultando' && <span className="bs-consultando">Consultando frete</span>}
      {frete && frete !== 'consultando' && (frete.estado === 'ok'
        ? <span>Frete cotado <span className="mono bs-forte">{brl(frete.valor)}</span></span>
        : <span title={frete.motivo}>Frete cotado indisponível</span>)}
      {(vend?.reputacao || local) && (
        <span className="bs-vendedor" title={local ? 'Cidade cadastrada do vendedor' : undefined}>
          {vend?.reputacao && <span className="bs-rep" data-rep={vend.reputacao} role="img" aria-label={`Reputação ${NOME_REPUTACAO[vend.reputacao]}`} title={`Reputação ${NOME_REPUTACAO[vend.reputacao]}`} />}
          {local && <span className="bs-cidade">{local}</span>}
        </span>
      )}
      {v?.marca && <span className="bs-marca" title={`Marca do catálogo: ${v.marca}`}>marca <b>{v.marca}</b></span>}
    </div>
  );
}

function Linha({ card: c, enr, participacao, resultado, precoDaMargem, meta, aberto, onAbrir, onDestacar, chamar, onVinculado }: {
  card: CardBusca; enr: EstadoEnriquecimento | undefined; participacao: number | null; resultado: Resultado; precoDaMargem: number | undefined; meta: MetadadosCardBusca | undefined; aberto: boolean;
  onAbrir: () => void; onDestacar: () => void; chamar: Chamar; onVinculado: () => void;
}) {
  // Uma aparição só por linha: a do preço da margem (ou do card); vendidos e selos vêm dela, nunca da outra aparição.
  const alvo = precoDaMargem ?? c.preco;
  const oc = c.ocorrencias.find((o) => o.preco === alvo) ?? c.ocorrencias[0];
  const sinal = (k: 'full' | 'lojaOficial') => (oc && k in oc ? oc[k] : c[k]); // estado antigo: ocorrência sem sinais
  const ap = { preco: oc ? oc.preco : c.preco, vendidosTexto: oc ? oc.vendidosTexto : c.vendidosTexto, full: sinal('full'), lojaOficial: sinal('lojaOficial'), patrocinado: oc ? oc.patrocinado : c.patrocinado };
  // Margem calculada a outro preço (ex.: estado da 0.4.2 sem precoDaMargem): o % não vai ao lado deste preço.
  const precoM = resultado?.estado === 'ok' ? resultado.margem?.preco : undefined;
  const outroPreco = typeof precoM === 'number' && precoM !== ap.preco;
  const m = outroPreco ? null : margemClassico(resultado);
  const estado = outroPreco ? undefined : resultado?.estado;
  const proprio = meta?.proprio === true, vinculado = !!meta?.vinculo, semVinculo = !!meta && !meta.vinculo;
  const borda = proprio ? 'meu' : vinculado ? 'vinculado' : meta ? 'sem-vinculo' : 'desconhecido';
  return (
    <li className="bs-item">
      <Miniatura key={c.miniaturaUrl ?? ''} url={c.miniaturaUrl} estado={borda} />
      <div className="bs-conteudo">
        <div className="bs-linha">
          <button type="button" className="bs-titulo" onClick={onDestacar} title={`${c.titulo}\nClique para mostrar este card na página`}>{c.titulo}</button>
          <span className="bs-valor">
            {m !== null && <span className={`bs-margem ${m < 0 ? 'prejuizo' : 'lucro'}`} aria-label={`Margem simulada no Clássico: ${pct(m)}`}>{pct(m)}</span>}
            {estado === 'ok' && m === null && <span className="bs-estado">Margem indisponível</span>}
            {estado === 'sem_categoria' && <span className="bs-estado">Sem categoria</span>}
            {estado === 'limite' && <span className="bs-estado aguardando">Aguardando cota</span>}
            {estado === 'indisponivel' && <span className="bs-estado">Indisponível</span>}
          </span>
        </div>
        <div className="bs-sinais">
          <span className="mono bs-preco">{ap.preco === null ? 'Preço não lido' : brl(ap.preco)}</span>
          {ap.vendidosTexto && <span>{ap.vendidosTexto}</span>}
          {proprio && <span className="bs-tag" data-cor="1">Meu anúncio</span>}
          {vinculado && <span className="bs-tag" data-cor="1">SKU vinculado</span>}
          {ap.full && <span className="bs-tag" data-cor="3">Full</span>}
          {ap.lojaOficial && <span className="bs-tag" data-cor="4">Oficial</span>}
          {ap.patrocinado && <span className="bs-tag" data-cor="5">Patrocinado</span>}
          {semVinculo && (
            <button type="button" className="bs-vincular" aria-label="Vincular ao meu SKU" aria-expanded={aberto} onClick={onAbrir}>Vincular</button>
          )}
        </div>
        <Extras card={c} preco={ap.preco} enr={enr} participacao={participacao} />
        {/* O SKU fica visível em qualquer estado com código; com composição ele vai dentro de Detalhes. */}
        {resultado && 'codigo' in resultado && !(resultado.estado === 'ok' && resultado.margem && !outroPreco) && <p className="nota">{`SKU ${resultado.codigo}`}</p>}
        {/* Detalhes só quando há a conta da margem (título completo fica no hover do título). */}
        {!outroPreco && resultado?.estado === 'ok' && resultado.margem && (
          <details className="bs-detalhes">
            <summary>Detalhes</summary>
            <dl className="bs-composicao">
              <Composicao rotulo="Clássico" tipo={resultado.margem.classico} />
              <Composicao rotulo="Premium" tipo={resultado.margem.premium} />
            </dl>
            {'codigo' in resultado && <p className="nota">{`SKU ${resultado.codigo}`}</p>}
          </details>
        )}
      </div>
      {aberto && semVinculo && (
        <div className="bs-vinculo">
          <VinculoProduto entrada={{ mlItemId: c.itemId, catalogProductId: c.catalogProductId }} fonte="nenhuma" chamar={chamar} onVinculado={onVinculado} abertoInicial />
        </div>
      )}
    </li>
  );
}
