// ADR-0078 F2: com preços divergentes, desconto e atacado deixam de ser família-level e passam
// a ser POR FAIXA DE PREÇO (cada faixa vira um anúncio próprio no split). A config é gravada em
// TODAS as variações do grupo — viaja na variação, repreçar nunca a órfã (invariante #2). Grupo
// herdando config família-level ATIVA sem confirmação explícita → o publish falha LOUD; o selo
// "configurar faixa" antecipa isso na Revisão.
import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { AtacadoEditor } from '@/components/atacado-editor';
import { useDescontoPct } from '@/hooks/useConfiguracoes';
import { useSetDescontoGrupo, useSetAtacadoGrupo } from '@/hooks/useFamiliaMutations';
import { calcularPrecoDe, pctEfetivo, podeAlterarDescontoVisual } from '@/lib/desconto';
import { validarFaixas, type FaixaAtacado } from '@/lib/atacado';
import { gruposDePreco, configGrupoPendente, type GrupoPreco } from '@/lib/grupos-preco';
import { fmtBRLSemSimbolo } from '@/lib/formato';
import type { Familia } from '@/lib/tipos-dominio';

export function ConfigGruposPreco({ familia }: { familia: Familia }) {
  const grupos = gruposDePreco(familia);
  return (
    <div className="space-y-3 text-xs">
      <div className="text-muted-foreground">
        Cores com preços diferentes: desconto e atacado são configurados <strong>por faixa de
        preço</strong>. Cada faixa será publicada como um anúncio próprio no Mercado Livre.
      </div>
      {grupos.map((g) => (
        <GrupoConfig key={g.preco} familia={familia} grupo={g} />
      ))}
    </div>
  );
}

function GrupoConfig({ familia, grupo }: { familia: Familia; grupo: GrupoPreco }) {
  const { data: globalPct } = useDescontoPct();
  const setDesconto = useSetDescontoGrupo(familia.loteId);
  const setAtacado = useSetAtacadoGrupo(familia.loteId);
  const ids = grupo.variacoes.map((x) => x.id).filter((x): x is string => !!x);
  const rep = grupo.variacoes[0];
  const exibir = rep.exibirComDesconto ?? false;
  const podeAlterar = podeAlterarDescontoVisual(familia.formatoPublicacaoMl, exibir);
  const pct = pctEfetivo(rep.descontoPct, globalPct ?? 15);
  const de = calcularPrecoDe(grupo.preco, pct);
  const [faixas, setFaixas] = useState<FaixaAtacado[]>(rep.atacado ?? []);
  // Re-sincroniza quando o servidor muda (mesmo padrão do AtacadoControle atual).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setFaixas(rep.atacado ?? []); }, [JSON.stringify(rep.atacado ?? [])]);
  const atacadoAtivo = faixas.length > 0;
  const erro = validarFaixas(faixas);
  const dirty = JSON.stringify(faixas) !== JSON.stringify(rep.atacado ?? []);
  const pendente = configGrupoPendente(familia, grupo);

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2 font-medium">
        Faixa R$ {fmtBRLSemSimbolo(grupo.preco)} · {grupo.variacoes.length} cor(es)
        <span className="truncate font-normal text-muted-foreground">
          {grupo.variacoes.slice(0, 4).map((x) => x.cor || x.codigo).join(', ')}
          {grupo.variacoes.length > 4 && '…'}
        </span>
        {pendente && (
          <StatusPill
            tone="warning"
            title="A família tinha desconto/atacado ativo. Confirme a config desta faixa (mesmo que seja desligar) — sem isso a publicação falha de propósito."
          >
            ⚠ configurar faixa
          </StatusPill>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          aria-label={`Exibir com desconto (faixa R$ ${fmtBRLSemSimbolo(grupo.preco)})`}
          checked={exibir}
          disabled={!podeAlterar}
          onCheckedChange={(marcado) =>
            setDesconto.mutate({ variacaoIds: ids, exibir: marcado === true, pct: rep.descontoPct })
          }
        />
        <span>Exibir com desconto</span>
        {familia.formatoPublicacaoMl === 'user_products' && (
          <span className="text-muted-foreground">
            O ML não permite desconto apenas visual em User Products.
          </span>
        )}
        {exibir && (
          <>
            <Input
              type="number"
              min={0}
              max={99}
              className="w-14"
              defaultValue={rep.descontoPct ?? globalPct ?? 15}
              onBlur={(e) => {
                const n = Number(e.target.value);
                setDesconto.mutate({ variacaoIds: ids, exibir: true, pct: Number.isFinite(n) ? n : null });
              }}
            />
            <span>%</span>
            {de != null && (
              <span className="text-muted-foreground">
                <s>R$ {fmtBRLSemSimbolo(de)}</s> · R$ {fmtBRLSemSimbolo(grupo.preco)} · {pct}% OFF
              </span>
            )}
          </>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            aria-label={`Preço de atacado (faixa R$ ${fmtBRLSemSimbolo(grupo.preco)})`}
            checked={atacadoAtivo}
            onCheckedChange={(marcado) => {
              if (marcado) setFaixas(faixas.length ? faixas : [{ min_unidades: 5, desconto_pct: 5 }]);
              // [] explícito = "sem atacado" confirmado (null significaria herdar → LOUD no publish).
              else { setFaixas([]); setAtacado.mutate({ variacaoIds: ids, faixas: [] }); }
            }}
          />
          <span>Preço de atacado</span>
        </div>
        {atacadoAtivo && (
          <div className="pl-6">
            <AtacadoEditor faixas={faixas} precoBase={grupo.preco} onChange={setFaixas} />
            <Button
              type="button"
              size="sm"
              className="mt-1 h-7 text-xs"
              disabled={!!erro || !dirty || setAtacado.isPending}
              onClick={() => setAtacado.mutate({ variacaoIds: ids, faixas })}
            >
              {setAtacado.isPending ? 'Salvando…' : dirty ? 'Salvar atacado' : '✓ Salvo'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
