// Pulse (ADR-0119): reprecificar a partir de um alerta/preço sugerido. Grava `preco_publicacao`
// via updateVariacaoPreco (mesma escrita da edição manual existente) e leva o operador à Revisão
// — nenhuma escrita nova no ML, a publicação continua 100% no fluxo Revisão existente.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { updateVariacaoPreco } from '@/lib/queries';
import { fetchContextoMargem } from '@/lib/pulse';
import { margemEstimada } from '@/lib/pulse-margem';
import { fmtBRL, parseNumeroPtBr } from '@/lib/formato';

function insumoFaltante(
  contexto: { custo: number | null; aliquotaPct: number | null } | undefined,
  ptwCustos: { comissao: number | null; frete: number | null } | null,
): string | null {
  if (!contexto || contexto.custo == null) return 'custo do produto';
  if (contexto.aliquotaPct == null) return 'alíquota de imposto';
  if (!ptwCustos || ptwCustos.comissao == null || ptwCustos.frete == null) return 'referência de preço do Mercado Livre';
  return null;
}

export function DialogReprecificar({
  codigoPai, precoInicial, ptwCustos, onFechar,
}: {
  codigoPai: string | null;
  precoInicial: number | null;
  ptwCustos: { comissao: number | null; frete: number | null } | null;
  onFechar: () => void;
}) {
  const aberto = codigoPai != null;
  const navigate = useNavigate();
  const [preco, setPreco] = useState('');
  useEffect(() => setPreco(precoInicial != null ? String(precoInicial) : ''), [codigoPai, precoInicial]);

  const { data: contexto, isLoading: contextoCarregando } = useQuery({
    queryKey: ['pulse', 'contexto-margem', codigoPai],
    queryFn: () => fetchContextoMargem(codigoPai!),
    enabled: aberto,
  });

  const precoSimulado = parseNumeroPtBr(preco);
  const faltando = !contextoCarregando ? insumoFaltante(contexto, ptwCustos) : null;
  const margem = precoSimulado && precoSimulado > 0 && !faltando
    ? margemEstimada({
        preco: precoSimulado, custoProduto: contexto?.custo ?? null,
        ptwCustos, aliquotaPct: contexto?.aliquotaPct ?? null,
      })
    : null;

  const confirmar = useMutation({
    mutationFn: async () => {
      const novoPreco = parseNumeroPtBr(preco);
      if (!novoPreco || novoPreco <= 0) throw new Error('Informe um preço válido');
      // Resolve a família publicável; ambiguidade → orienta e leva à Revisão (nunca escolhe sozinho).
      // Erro de leitura (RLS/rede) tem que estourar aqui — nunca cair no mesmo caminho da
      // ambiguidade, senão o operador vê "não achei família" quando na verdade a query falhou.
      const { data: familias, error: erroFamilias } = await supabase.from('familias')
        .select('id').eq('codigo_pai', codigoPai!).in('status', ['pronto', 'erro']);
      if (erroFamilias) throw erroFamilias;
      if (!familias || familias.length !== 1) {
        toast.error('Não achei uma família única publicável — ajuste o preço pela Revisão.');
        navigate('/revisao');
        return;
      }
      const { data: variacoes, error: erroVariacoes } = await supabase.from('variacoes')
        .select('id, preco_publicacao').eq('familia_id', familias[0].id);
      if (erroVariacoes) throw erroVariacoes;
      // Regra financeira LOUD: sem variação lida, não existe "gravou" — nunca reportar sucesso
      // sobre uma escrita que não aconteceu.
      if (!variacoes || variacoes.length === 0) throw new Error('Família sem variações — ajuste o preço pela Revisão.');

      // Preço divergente entre variações significa anúncio publicado por faixa (split). Gravar um
      // preço único aqui achataria a faixa em silêncio — e o worker de preço único recusa com 400
      // justamente por isso (_shared/preco/grupos.ts). Este dialog só sabe reprecificar em bloco.
      const distintos = new Set(
        variacoes.map((v) => (v.preco_publicacao == null ? 'null' : Number(v.preco_publicacao).toFixed(2))),
      );
      if (distintos.size > 1) {
        throw new Error(
          'Este anúncio tem preço diferente por variação — reprecificar aqui achataria todos. Ajuste na Revisão.',
        );
      }
      for (const v of variacoes) await updateVariacaoPreco(v.id, novoPreco);
      toast.success('✓ Preço gravado — confirme e publique na Revisão.');
      navigate('/revisao');
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => onFechar(),
  });

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reprecificar</DialogTitle>
          <DialogDescription>
            Grava o novo preço nas variações do anúncio; a publicação continua um passo explícito
            na Revisão.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            inputMode="decimal"
            className="w-32"
            aria-label="Novo preço"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
          />
          {contextoCarregando ? (
            <span className="text-sm text-muted-foreground">Carregando custo e alíquota…</span>
          ) : faltando ? (
            <Badge variant="destructive">Margem indisponível: falta {faltando}</Badge>
          ) : margem ? (
            <span className="text-sm">
              Líquido <span className="font-medium tabular-nums">{fmtBRL(margem.liquido)}</span>{' '}
              <span className="text-muted-foreground tabular-nums">({margem.margemPct.toFixed(1)}%)</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Informe um preço para simular a margem.</span>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={confirmar.isPending}>Cancelar</Button>
          <Button
            onClick={() => confirmar.mutate()}
            disabled={!precoSimulado || precoSimulado <= 0 || confirmar.isPending}
          >
            {confirmar.isPending ? 'Gravando…' : 'Gravar e ir para Revisão'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
