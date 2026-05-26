import { Link, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLote } from '@/hooks/useLotes';
import { useFamilias } from '@/hooks/useFamilias';

export default function Relatorio() {
  const { loteId } = useParams();
  const lote = useLote(loteId);
  // No M1, usamos as famílias do lote-42 como mock visual mesmo para outros lotes
  const familias = useFamilias('lote-42').slice(0, lote?.totalFamilias ?? 0);

  if (!lote) return <div className="p-6">Lote não encontrado.</div>;

  const publicadas = familias.slice(0, lote.totalPublicadas);
  const erros = familias.slice(lote.totalPublicadas, lote.totalPublicadas + lote.totalErros);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Relatório · Lote #{lote.numero}
        </h1>
        <Button variant="outline" disabled>
          Exportar PDF
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-3xl font-semibold text-green-700">{lote.totalPublicadas}</div>
          <div className="text-xs text-muted-foreground">publicadas</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-semibold text-destructive">{lote.totalErros}</div>
          <div className="text-xs text-muted-foreground">com erro</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-semibold">R$ 0,42</div>
          <div className="text-xs text-muted-foreground">custo IA</div>
        </Card>
      </div>

      {publicadas.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Publicadas</h2>
          <div className="mb-6 flex flex-col gap-2">
            {publicadas.map((f) => (
              <Card key={f.id} className="flex items-center justify-between p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={f.operacao === 'CREATE' ? 'default' : 'secondary'}>
                    {f.operacao}
                  </Badge>
                  <span>{f.titulo}</span>
                </div>
                <Link
                  to="https://produto.mercadolivre.com.br/MLB-mockid"
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver no Mercado Livre →
                </Link>
              </Card>
            ))}
          </div>
        </>
      )}

      {erros.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Com erro</h2>
          <div className="flex flex-col gap-2">
            {erros.map((f) => (
              <Card key={f.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <div>{f.titulo}</div>
                  <div className="text-xs text-destructive">Erro: campo obrigatório ausente</div>
                </div>
                <Button size="sm" variant="outline">
                  Editar e tentar de novo
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
