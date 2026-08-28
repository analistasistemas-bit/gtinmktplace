// Card de veredito do Sonar (ADR-0124 + ADR-0128): a conclusão do garimpo, antes dos números crus.
// Identidade visual deliberadamente distinta do SemaforoPreco (ADR-0020) — aquele julga um preço,
// este julga um nicho; ícones de tendência aqui, ícones de círculo lá.
// ADR-0128: título separa Demanda de Entrada; chip de entrada ao lado do badge parcial.
import { useState } from 'react';
import {
  ChevronDown, CircleDollarSign, Eye, ExternalLink, Gauge, HelpCircle, Lock, Minus, ShieldAlert,
  Target, Trophy, TrendingDown, TrendingUp, Unlock,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { insightEntrada, rivaisPodioVisitas } from '@/lib/veredito-sonar';
import type {
  Barreira, ContextoItem, ExplicacaoRegua, NivelFator, VereditoAnuncios,
} from '@/lib/veredito-sonar';
import type { PainelVendasSonar, VisitasAnuncio } from '@/lib/sonar';
import { fmtBRL, fmtInt } from '@/lib/formato';

/** Borda do card: baixa=vermelho, alta=verde; demais (média / não medida / fechada) = warning. */
const CLS_VEREDITO = {
  alta: { borda: 'border-success/40', fundo: 'bg-success/5', texto: 'text-success' },
  media: { borda: 'border-warning/40', fundo: 'bg-warning/5', texto: 'text-warning' },
  baixa: { borda: 'border-destructive/40', fundo: 'bg-destructive/5', texto: 'text-destructive' },
} as const;

// ADR-0138: o chip deixou de ser mapa de estado (o estado já está escrito no título) e passa a
// carregar o NÚMERO que sustenta a barreira — `veredito.chip`, montado na lib.

const CLS_FATOR: Record<NivelFator, string> = {
  bom: 'text-success',
  medio: 'text-warning',
  ruim: 'text-destructive',
};

const ICONE_FATOR: Record<NivelFator, typeof TrendingUp> = {
  bom: TrendingUp,
  medio: Minus,
  ruim: TrendingDown,
};

/** Rótulos do "Saiba mais" — dicionário do comércio (ADR-0138 §2). As chaves seguem internas. */
const LABEL_FATOR: Record<'demanda' | 'disputa' | 'tracao' | 'marca', string> = {
  demanda: 'Demanda',
  disputa: 'Concorrência',
  tracao: 'Faturamento por concorrente',
  marca: 'Marca',
};

/** Barra horizontal com as 3 zonas (ruim/médio/bom) e um marcador no valor atual. `invertida`
 *  troca a ordem das cores porque, em disputa e marca, maior é pior. */
function MiniRegua({ regua }: { regua: ExplicacaoRegua }) {
  const { min, max, cortes: [c1, c2], valor, invertida } = regua;
  const total = Math.max(max - min, 1);
  const larguras = [
    ((c1 - min) / total) * 100,
    ((c2 - c1) / total) * 100,
    ((max - c2) / total) * 100,
  ];
  const cores = invertida
    ? ['bg-success/60', 'bg-warning/60', 'bg-destructive/60']
    : ['bg-destructive/60', 'bg-warning/60', 'bg-success/60'];
  const posicao = Math.min(100, Math.max(0, ((valor - min) / total) * 100));
  return (
    <div className="relative mt-1.5 h-1.5 w-full overflow-visible rounded-full" aria-hidden>
      <div className="flex h-full w-full overflow-hidden rounded-full">
        {larguras.map((l, i) => (
          <div key={i} className={cores[i]} style={{ width: `${l}%` }} />
        ))}
      </div>
      <div
        className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `${posicao}%` }}
      />
    </div>
  );
}

/** Ícone do card de Entrada, coerente com o chip textual já usado no header. */
/** Ícone do card de insight por Barreira (ADR-0138). `marca` é o único cadeado que restou — é a
 *  única barreira que preço não abre. */
const ICONE_BARREIRA: Record<Barreira, typeof Unlock> = {
  nenhuma: Unlock,
  // Interrogação, não cadeado aberto: o caminho B não confirma campo aberto (ADR-0137/0138 §1).
  topo_nao_confirmado: HelpCircle,
  concorrencia: Target,
  mercado_apertado: Target,
  marca: Lock,
  nao_medida: HelpCircle,
};

function PodioColuna({ titulo, dica, Icone, itens }: {
  titulo: string;
  dica: string;
  Icone: typeof Trophy;
  /** `valorDica` existe para o valor que a coluna exibe sem unidade (as visitas, cuja unidade já
   *  está no cabeçalho): repetir "visitas" em cada linha alarga a coluna e desalinha os dígitos. */
  itens: Array<{
    chave: string; posicao: number; nome: string; href: string | null;
    valor: string; valorDica?: string; meta: string;
  }>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" title={dica}>
        <Icone className="h-3 w-3" aria-hidden /> {titulo}
      </div>
      <ul className="flex flex-col gap-2">
        {itens.map((i) => (
          <li key={i.chave} className="grid grid-cols-[1rem_1fr_auto] items-baseline gap-x-2 gap-y-0.5">
            <span className={cn('text-[11px] tabular-nums text-muted-foreground', i.posicao === 1 && 'font-semibold text-foreground')}>
              {i.posicao}
            </span>
            {i.href ? (
              <a
                href={i.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir "${i.nome}" no Mercado Livre (nova aba)`}
                title={i.nome}
                className="flex min-w-0 items-center gap-1 text-xs font-medium hover:underline focus-visible:underline focus-visible:outline-none"
              >
                <span className="truncate">{i.nome}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
              </a>
            ) : (
              <span className="min-w-0 truncate text-xs font-medium" title={i.nome}>{i.nome}</span>
            )}
            <span className="text-xs font-semibold tabular-nums" title={i.valorDica}>{i.valor}</span>
            {i.meta !== '' && (
              <span className="col-start-2 col-span-2 text-[11px] tabular-nums text-muted-foreground">{i.meta}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VereditoSonar({
  veredito, contexto, vendas, visitasPorItem,
}: {
  veredito: VereditoAnuncios; contexto: ContextoItem[]; vendas: PainelVendasSonar;
  visitasPorItem: Map<string, VisitasAnuncio | null>;
}) {
  const [aberto, setAberto] = useState(false);
  const cls = CLS_VEREDITO[veredito.nivel];
  const { explicacao } = veredito;
  const entrada = insightEntrada(veredito);
  const IconeBarreira = ICONE_BARREIRA[veredito.barreira];
  const rivaisVisitas = rivaisPodioVisitas(vendas, visitasPorItem);
  const temFaturamento = veredito.rivaisPodio.length > 0;
  const temVisitas = rivaisVisitas.length > 0;
  const itensFaturamento = veredito.rivaisPodio.map((r, idx) => ({
    chave: r.item_id || r.titulo,
    posicao: idx + 1,
    nome: r.titulo,
    href: r.href,
    valor: `≈ R$ ${fmtInt(Math.round(r.faturamento))}`,
    meta: [
      r.preco != null ? fmtBRL(r.preco) : null,
      r.vendidos != null ? `+${fmtInt(r.vendidos)} vendidos` : null,
    ].filter(Boolean).join(' · '),
  }));
  const itensVisitas = rivaisVisitas.map((r, idx) => ({
    chave: r.item_id,
    posicao: idx + 1,
    nome: r.titulo,
    href: r.href,
    valor: fmtInt(r.visitas),
    valorDica: `${fmtInt(r.visitas)} ${r.visitas === 1 ? 'visita' : 'visitas'} nos últimos 30 dias`,
    meta: r.preco != null ? fmtBRL(r.preco) : '',
  }));
  return (
    <Card className={`mb-4 border ${cls.borda} ${cls.fundo} p-4`}>
      <div className="flex flex-wrap items-start gap-3">
        <Gauge className={`mt-0.5 h-6 w-6 shrink-0 ${cls.texto}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-lg font-semibold ${cls.texto}`}>{veredito.titulo}</span>
            {veredito.parcial && (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                title="Não foi possível avaliar a concorrência do nicho por completo — falta de dado não é sinal de negócio, nem para cima."
              >
                avaliação parcial
              </span>
            )}
            {veredito.chip && (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                title="Número que sustenta a barreira de entrada (ADR-0138)."
              >
                {veredito.chip}
              </span>
            )}
          </div>
          {/* Subtítulo removido no ADR-0138 §6: sob a gramática de dois eixos ele repetia o título
              com outras palavras, e a caixa de resumo já faz a leitura. A causa da avaliação
              parcial vive no card "Concorrência não medida" dos Insights. */}
        </div>
      </div>

      {/* Duas colunas: fatores à esquerda (largura inteira por linha, sem truncar) e o veredito
          em uma frase à direita — o operador lê a conclusão sem abrir Saiba mais. */}
      <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:items-start">
        <div className="flex flex-col gap-1.5">
          {veredito.fatores.map((f) => {
            const Icone = ICONE_FATOR[f.nivel];
            return (
              <div key={f.chave} className="flex flex-wrap items-baseline gap-x-2">
                <Icone className={`h-4 w-4 shrink-0 self-center ${CLS_FATOR[f.nivel]}`} aria-hidden />
                <span className="text-sm font-medium">{f.label}</span>
                <span className="text-xs text-muted-foreground">{f.detalhe}</span>
              </div>
            );
          })}
        </div>
        <p className={`rounded-md border p-3 text-sm font-medium ${cls.borda} ${cls.fundo} ${cls.texto}`}>
          {veredito.resumo}
        </p>
      </div>

      {/* Marca fica fora do grid pontuado: por decisão do Diego ela alerta mas NÃO entra na conta,
          e misturá-la aos outros faria parecer que entra. Marca ruim fecha a Entrada (ADR-0128). */}
      {veredito.marca && veredito.marca.nivel !== 'bom' && (
        <div className="mt-3 flex items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
          <ShieldAlert className={`h-3.5 w-3.5 shrink-0 ${CLS_FATOR[veredito.marca.nivel]}`} aria-hidden />
          <span>
            {veredito.marca.detalhe}
            {veredito.marca.nivel === 'ruim'
              ? ' — revender marca com loja oficial forte tem risco de moderação por propriedade intelectual.'
              : ' — confira se a marca permite revenda antes de cadastrar.'}
          </span>
        </div>
      )}

      {/* Insights do nicho (ADR-0124 addendum 2026-08-21; Errata 1 2026-08-27): sempre visíveis,
          diferencial de SaaS premium — ao contrário do resto da explicação, não ficam escondidos
          no "Saiba mais". Reaproveita o padrão de mini-card de `painel-analise.tsx` (borda,
          bg-card, ícone + label). Cada card só aparece se tiver dado — nunca mostra "vazio". */}
      <div className="mt-3 border-t pt-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Insights do nicho
        </span>
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-col gap-1 rounded-md border bg-card p-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <IconeBarreira className={`h-3.5 w-3.5 ${CLS_FATOR[entrada.tom]}`} aria-hidden />
              {entrada.titulo}
            </div>
            <p className="text-xs text-muted-foreground">{entrada.detalhe}</p>
            {/* Condição de entrada com número (ADR-0138 §3): o ramo "Sem Full" só existe quando o
                topo é majoritariamente Full — é onde o handicap de prazo existe de verdade. */}
            {entrada.ramos.length > 0 && (
              <ul className="mt-0.5 flex flex-col gap-1">
                {entrada.ramos.map((r) => (
                  <li key={r.rotulo} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{r.rotulo}</span> → {r.texto}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(temFaturamento || temVisitas) && (
            <div className="flex w-full flex-col gap-2 rounded-md border bg-card p-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Trophy className="h-4 w-4" aria-hidden /> Pódio de rivais
              </div>
              <div className={cn('grid gap-3', temFaturamento && temVisitas && 'sm:grid-cols-2')}>
                {temFaturamento && (
                  <PodioColuna
                    titulo="Quem mais fatura"
                    dica="Top 5 por faturamento (vendidos × preço) na amostra"
                    Icone={CircleDollarSign}
                    itens={itensFaturamento}
                  />
                )}
                {temVisitas && (
                  <PodioColuna
                    titulo="Quem mais recebe visitas"
                    dica="Top 5 por visitas na amostra"
                    Icone={Eye}
                    itens={itensVisitas}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="mt-3 flex items-center gap-1 border-t pt-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Saiba mais
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} aria-hidden />
      </button>

      {aberto && (
        <div className="mt-3 space-y-4 border-t pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {explicacao.pontuacao.soma} de {explicacao.pontuacao.maximo} pontos
            </span>
            {explicacao.gateDemanda && (
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                demanda derrubou o veredito sozinha
              </span>
            )}
          </div>

          <div className="space-y-3">
            {explicacao.fatores.map((f) => (
              <div key={f.chave}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-semibold uppercase ${CLS_FATOR[f.nivel]}`}>{LABEL_FATOR[f.chave]}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{f.frase}</p>
                {f.regua && <MiniRegua regua={f.regua} />}
                {f.destravar && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Para destravar:</span> {f.destravar}
                  </p>
                )}
              </div>
            ))}
          </div>

          <p className={`rounded-md border p-2.5 text-sm ${cls.borda} ${cls.fundo}`}>{explicacao.acao}</p>

          {contexto.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Contexto do nicho — não entra na pontuação
              </p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                {contexto.map((item) => (
                  <div key={item.rotulo}>
                    <dt className="text-xs text-muted-foreground">{item.rotulo}</dt>
                    <dd className="text-sm font-medium">{item.valor}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
