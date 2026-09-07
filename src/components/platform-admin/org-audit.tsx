import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePlatformAudit } from '@/hooks/usePlatformAdmin';
import type { AuditRow } from '@/lib/platform-admin';

const PAGE_SIZE = 20;

export function OrgAudit({ orgId, month }: { orgId: string; month: string }) {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<AuditRow['category'] | ''>('');
  const [actorId, setActorId] = useState('');
  const [result, setResult] = useState('');
  const query = usePlatformAudit({
    org_id: orgId,
    month,
    category: category || undefined,
    actor_id: actorId.trim() || undefined,
    result: result.trim() || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const audit = query.data;

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Carregando auditoria…</p>;
  if (!audit) {
    return <p className="text-sm text-destructive" role="alert">Não foi possível carregar a auditoria.</p>;
  }

  const totalPages = Math.max(1, Math.ceil(audit.total / audit.page_size));
  return (
    <div className="space-y-4">
      {query.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          A atualização da auditoria falhou; os últimos dados disponíveis permanecem na tela.
        </p>
      )}
      {query.isStale && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="status">
          Os eventos exibidos podem estar desatualizados.
        </p>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Categoria</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3"
              value={category}
              onChange={(event) => { setCategory(event.target.value as typeof category); setPage(1); }}
            >
              <option value="">Todas</option>
              <option value="admin">Administração</option>
              <option value="billing">Cobrança</option>
              <option value="pulse">Pulse</option>
              <option value="support">Suporte</option>
            </select>
          </label>
          <label className="space-y-1 text-sm" htmlFor="audit-actor">
            <span className="font-medium">Responsável</span>
            <Input id="audit-actor" value={actorId} onChange={(event) => { setActorId(event.target.value); setPage(1); }} placeholder="ID do usuário" />
          </label>
          <label className="space-y-1 text-sm" htmlFor="audit-result">
            <span className="font-medium">Resultado</span>
            <Input id="audit-result" value={result} onChange={(event) => { setResult(event.target.value); setPage(1); }} placeholder="Ex.: success" />
          </label>
        </CardContent>
      </Card>

      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead><TableHead>Categoria</TableHead><TableHead>Ação</TableHead>
              <TableHead>Responsável</TableHead><TableHead>Resultado</TableHead><TableHead>Alvo</TableHead>
              <TableHead>Detalhes sanitizados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{new Date(row.at).toLocaleString('pt-BR')}</TableCell>
                <TableCell>{row.category}</TableCell>
                <TableCell>{row.action}</TableCell>
                <TableCell>{row.actor_name ?? row.actor_id ?? 'Sistema'}</TableCell>
                <TableCell>{row.result}</TableCell>
                <TableCell>{row.target ?? '—'}</TableCell>
                <TableCell className="max-w-sm whitespace-normal break-words">
                  {Object.keys(row.details).length > 0 ? JSON.stringify(row.details) : '—'}
                  {row.reason && <span className="block text-xs text-muted-foreground">{row.reason}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-3 md:hidden">
        {audit.rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="space-y-2 p-4 text-sm">
              <div><p className="font-medium">{row.action}</p><p className="text-xs text-muted-foreground">{new Date(row.at).toLocaleString('pt-BR')}</p></div>
              <p>{row.category} · {row.result}</p>
              <p className="break-words text-xs text-muted-foreground">
                {Object.keys(row.details).length > 0 ? JSON.stringify(row.details) : 'Sem detalhes'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {audit.rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum evento encontrado.</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Página {page} de {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</Button>
        </div>
      </div>
    </div>
  );
}
