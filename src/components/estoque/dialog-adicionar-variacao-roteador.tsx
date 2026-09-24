// ADR-0166 2026-09-24c: "Adicionar variação" em produto de grade abre a extensão da matriz; o
// resto abre o dialog de sempre, na hora, sem consulta nova (INV-1, Codex r2 #6). Decide pelo DADO
// do produto (`temTamanho`, vindo do resumo — Task 1/2), não pelo tipo habilitado na org (Codex #8).
import { useEffect, useState } from 'react';
import { DialogEstenderGrade } from '@/components/estoque/dialog-estender-grade';
import { DialogAdicionarVariacao } from '@/components/estoque/dialog-adicionar-variacao';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

export function DialogAdicionarVariacaoRoteador({ produto, onFechar }: {
  produto: ProdutoEstoqueResumo | null; onFechar: () => void;
}) {
  // A palavra final é do dialog de grade, que lê a família PUBLICADA com a mesma
  // `classificarFamilia` da edge; se ela disser 'simples', cai para o fluxo antigo (Codex r4 #1).
  const [forcarSimples, setForcarSimples] = useState(false);
  useEffect(() => { setForcarSimples(false); }, [produto?.codigoPai]);
  const ehGrade = !!produto?.temTamanho && !forcarSimples;
  return (
    <>
      <DialogEstenderGrade
        produto={ehGrade ? produto : null}
        aberto={produto != null && ehGrade}
        onFechar={onFechar}
        onNaoEhGrade={() => setForcarSimples(true)}
      />
      <DialogAdicionarVariacao
        produto={ehGrade ? null : produto}
        aberto={produto != null && !ehGrade}
        onFechar={onFechar}
      />
    </>
  );
}
