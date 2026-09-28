import { PackageCheck, PackagePlus, PackageX, RotateCcw, ShieldAlert, ShieldCheck, Undo2, type LucideIcon } from 'lucide-react';
import type { TipoEvento } from '@/lib/sku-dossie';

/** Ícone e cor de cada tipo de evento: os mesmos na lista de eventos e nos marcadores da série. */
export const TIPO_EVENTO: Record<TipoEvento, { Icone: LucideIcon; cor: string; fundo: string; rotulo: string }> = {
  entrada: { Icone: PackagePlus, cor: 'text-info', fundo: 'bg-info/10', rotulo: 'Entrada de estoque' },
  ruptura: { Icone: PackageX, cor: 'text-danger', fundo: 'bg-danger/10', rotulo: 'Ruptura' },
  retorno_estoque: { Icone: PackageCheck, cor: 'text-success', fundo: 'bg-success/10', rotulo: 'Estoque voltou' },
  moderacao_detectada: { Icone: ShieldAlert, cor: 'text-warning', fundo: 'bg-warning/10', rotulo: 'Moderação' },
  moderacao_resolvida: { Icone: ShieldCheck, cor: 'text-success', fundo: 'bg-success/10', rotulo: 'Moderação resolvida' },
  devolucao_aberta: { Icone: Undo2, cor: 'text-warning', fundo: 'bg-warning/10', rotulo: 'Devolução aberta' },
  devolucao_estorno: { Icone: RotateCcw, cor: 'text-muted-foreground', fundo: 'bg-muted', rotulo: 'Devolução encerrada' },
};

/** Movimentos de estoque: no kit eles vêm da base (o saldo do kit é derivado). */
export const EVENTO_DE_ESTOQUE: ReadonlySet<TipoEvento> = new Set(['entrada', 'ruptura', 'retorno_estoque']);
