// ADR-0194: linha de uma sugestão: motivo, campanha recomendada, lucro e ações.
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL } from '@/lib/formato';
import { rotuloTipo } from '@/lib/promocoes';
import { cn } from '@/lib/utils';
import type { OpcaoCampanha, Sugestao } from '@/lib/sugestoes-promocao';

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;

function precoDaOpcao(o: OpcaoCampanha, campo: 'preco_avaliado' | 'preco_original' = 'preco_avaliado') {
  const precos = o.itens.map((i) => i[campo]!);
  const [menor, maior] = [Math.min(...precos), Math.max(...precos)];
  return menor === maior ? fmtBRL(menor) : `${fmtBRL(menor)} a ${fmtBRL(maior)}`;
}

export function ResumoCampanha({ o }: { o: OpcaoCampanha }) {
  return (
    <span className="tabular-nums">
      {precoDaOpcao(o)} · −{Math.round(o.descontoPct)}% · lucro {fmtBRL(o.lucroPorVenda)} por venda
    </span>
  );
}

export function CardSugestao({ s, podeExecutar, comConversao, dispensada, ocupado, onAderir, onDispensar, onReativar }: {
  s: Sugestao; podeExecutar: boolean; comConversao: boolean; dispensada?: boolean; ocupado?: boolean;
  onAderir: (o: OpcaoCampanha) => void; onDispensar: () => void; onReativar: () => void;
}) {
  // Guarda o id, não o objeto: a lista recarrega e a opção escolhida precisa acompanhar os dados novos.
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [abrirOutras, setAbrirOutras] = useState(false);
  const opcoes = [s.recomendada, ...s.alternativas];
  const opcao = opcoes.find((o) => o.promocao.promocao_id === escolhida) ?? s.recomendada;
  const outras = opcoes.filter((o) => o !== opcao);
  const quase = s.faixa === 'quase_vendendo';

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-1 gap-3">
        {s.thumbnail
          ? <img src={s.thumbnail} alt="" className="size-12 shrink-0 rounded-md object-cover" loading="lazy" />
          : <div className="size-12 shrink-0 rounded-md bg-muted" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium sm:line-clamp-1" title={s.titulo}>{s.titulo}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{plural(s.visitas, 'visita', 'visitas')}, {plural(s.unidades, 'venda', 'vendas')} em 30 dias</span>
            {s.estoque != null && <><span aria-hidden>·</span><span>Estoque {s.estoque.toLocaleString('pt-BR')}</span></>}
            <span aria-hidden>·</span><span className="tabular-nums">Preço atual {precoDaOpcao(opcao, 'preco_original')}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium">{opcao.promocao.nome ?? rotuloTipo(opcao.promocao.tipo)}</span>
            <span className="text-muted-foreground"><ResumoCampanha o={opcao} /></span>
            {opcao.semaforo === 'amarelo' && <StatusPill tone="warning">Abaixo do piso</StatusPill>}
          </div>
          {opcao.itens.length < s.anunciosConvidados && (
            <p className="mt-1 text-xs text-muted-foreground">{opcao.itens.length} de {s.anunciosConvidados} anúncios nesta campanha</p>
          )}
          {outras.length > 0 && (
            <button type="button" onClick={() => setAbrirOutras((v) => !v)} aria-expanded={abrirOutras}
              className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-sm text-xs sm:min-h-6 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              +{outras.length} {outras.length === 1 ? 'campanha' : 'campanhas'}
              <ChevronDown className={cn('size-3.5 transition-transform motion-reduce:transition-none', abrirOutras && 'rotate-180')} aria-hidden />
            </button>
          )}
          {abrirOutras && (
            <ul className="mt-2 flex flex-col gap-1 border-l pl-3">
              {outras.map((o) => {
                const nome = o.promocao.nome ?? rotuloTipo(o.promocao.tipo);
                return (
                  <li key={o.promocao.promocao_id} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{nome}</span>
                    <ResumoCampanha o={o} />
                    {o.semaforo === 'amarelo' && <span>· abaixo do piso</span>}
                    {podeExecutar && (
                      <Button variant="link" size="sm" className="min-h-11 p-0 text-xs sm:h-auto sm:min-h-0" aria-label={`Usar ${nome}`}
                        onClick={() => { setEscolhida(o.promocao.promocao_id); setAbrirOutras(false); }}>Usar</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-2">
        {quase && comConversao ? (
          <p className="leading-tight sm:text-right">
            <span className="block text-base font-semibold tabular-nums">Vendeu {s.unidadesOk.toLocaleString('pt-BR')} · esperado ~{Math.round(s.vendasEsperadas)}</span>
            <span className="block text-xs text-muted-foreground">pela média da conta</span>
          </p>
        ) : !quase ? <p className="text-xs text-muted-foreground">Poucas visitas</p> : <span />}
        {podeExecutar && (
          dispensada ? (
            <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" disabled={ocupado} aria-label={`Reativar ${s.titulo}`} onClick={onReativar}>Reativar</Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" disabled={ocupado} aria-label={`Dispensar ${s.titulo} por 30 dias`} onClick={onDispensar}>Dispensar</Button>
              <Button size="sm" className="min-h-11 sm:min-h-8" aria-label={`Aderir ${s.titulo}`} onClick={() => onAderir(opcao)}>Aderir</Button>
            </div>
          )
        )}
      </div>
    </li>
  );
}
