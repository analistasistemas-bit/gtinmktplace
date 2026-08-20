// Card de veredito do Sonar (ADR-0124 + ADR-0128): a conclusão do garimpo, antes dos números crus.
// Identidade visual deliberadamente distinta do SemaforoPreco (ADR-0020) — aquele julga um preço,
// este julga um nicho; ícones de tendência aqui, ícones de círculo lá.
// ADR-0128: título separa Demanda de Entrada; chip de entrada ao lado do badge parcial.
import { useState } from 'react';
import { ChevronDown, Gauge, Minus, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ContextoItem, ExplicacaoRegua, NivelEntrada, NivelFator, VereditoAnuncios } from '@/lib/veredito-sonar';

/** Borda do card: baixa=vermelho, alta=verde; demais (média / não medida / fechada) = warning. */
const CLS_VEREDITO = {
  alta: { borda: 'border-success/40', fundo: 'bg-success/5', texto: 'text-success' },
  media: { borda: 'border-warning/40', fundo: 'bg-warning/5', texto: 'text-warning' },
  baixa: { borda: 'border-destructive/40', fundo: 'bg-destructive/5', texto: 'text-destructive' },
} as const;

const LABEL_ENTRADA: Record<NivelEntrada, string> = {
  aberta: 'entrada aberta',
  fechada: 'entrada fechada',
  nao_medida: 'concorrência não medida',
};

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

const LABEL_FATOR: Record<'demanda' | 'disputa' | 'tracao' | 'marca', string> = {
  demanda: 'Demanda',
  disputa: 'Disputa',
  tracao: 'Tração',
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

export function VereditoSonar({ veredito, contexto }: { veredito: VereditoAnuncios; contexto: ContextoItem[] }) {
  const [aberto, setAberto] = useState(false);
  const cls = CLS_VEREDITO[veredito.nivel];
  const { explicacao } = veredito;
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
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              title="Entrada no nicho (ADR-0128): pergunta separada da Demanda."
            >
              {LABEL_ENTRADA[veredito.entrada]}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{veredito.motivo}</p>
          {/* `montarMotivoAnuncios` só menciona o motivo da avaliação parcial quando o nível NÃO é
              'baixa' (o gate de demanda já explica o 'baixa' sozinho) — sem esta linha o badge
              "avaliação parcial" ficaria sem explicação visível nesse caso. */}
          {veredito.parcial && veredito.nivel === 'baixa' && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Além disso, não foi possível avaliar a concorrência do nicho por completo — falta de
              dado não é sinal de negócio.
            </p>
          )}
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

          {veredito.rivaisPodio.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Pódio de rivais — por faturamento na amostra
              </p>
              {veredito.rivaisPodio.some((r) => r.vendedor == null) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Anúncio sem rótulo de loja ainda é rival — o líder sem nome não some da briga.
                </p>
              )}
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-sm">
                {veredito.rivaisPodio.map((r) => (
                  <li key={r.item_id || r.titulo}>
                    <span className="font-medium">{r.vendedor ?? 'sem rótulo'}</span>
                    <span className="text-muted-foreground"> — {r.titulo}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

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
