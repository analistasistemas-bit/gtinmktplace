import { validateTerms } from './validation.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACTIONS = new Set(['list','organization','overview','metrics','terms','save_terms','preview','close','statements','statement','reconcile_revenue','pulse_usage','audit']);
type Repository = Record<string, (...args: any[]) => Promise<unknown>>;
type Dependencies = { authenticate(req: Request): Promise<{ userId: string }>; repository: Repository; corsHeaders?: Record<string, string> };

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} é obrigatório`); return value.trim();
}
function uuid(value: unknown, name: string): string { const result = requiredString(value, name); if (!UUID.test(result)) throw new TypeError(`${name} inválido`); return result; }
function month(value: unknown): string { const result = requiredString(value, 'month'); if (!MONTH.test(result)) throw new TypeError('month deve ser YYYY-MM'); return result; }
function page(value: unknown, fallback = 1): number { const result = value === undefined ? fallback : value; if (!Number.isInteger(result) || Number(result) < 1) throw new TypeError('paginação inválida'); return Number(result); }
function pageSize(value: unknown): number { const result = page(value, 20); if (result > 50) throw new TypeError('page_size deve ser no máximo 50'); return result; }

export function createPlatformAdminHandler(deps: Dependencies): (req: Request) => Promise<Response> {
  const headers = deps.corsHeaders ?? {};
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Método não permitido', code: 'method_not_allowed' }, 405, headers);
    try {
      const { userId } = await deps.authenticate(req); const body = await req.json().catch(() => { throw new TypeError('JSON inválido'); }) as Record<string, unknown>;
      const action = requiredString(body.action, 'action'); if (!ACTIONS.has(action)) throw new TypeError('action inválida');
      const orgActions = new Set(['organization','metrics','terms','save_terms','preview','close','statements','statement','reconcile_revenue','pulse_usage','audit']);
      const orgId = orgActions.has(action) ? uuid(body.org_id, 'org_id') : null;
      if (orgId && action !== 'organization' && !(await deps.repository.organizationExists(orgId))) return json({ error: 'Organização não encontrada', code: 'organization_not_found' }, 404, headers);
      let result: unknown;
      switch (action) {
        case 'list': {
          const sort = body.sort === undefined ? 'name' : requiredString(body.sort, 'sort'); if (!['name','slug','gross_desc'].includes(sort)) throw new TypeError('sort inválido');
          result = await deps.repository.list(userId, { month: month(body.month), search: typeof body.search === 'string' ? body.search.trim() : undefined, include_test: body.include_test === true, page: page(body.page), page_size: pageSize(body.page_size), sort }); break;
        }
        case 'organization': {
          result = await deps.repository.organization(userId, orgId, month(body.month));
          if (!result) return json({ error: 'Organização não encontrada', code: 'organization_not_found' }, 404, headers);
          break;
        }
        case 'overview': result = await deps.repository.overview(userId, month(body.month), body.include_test === true); break;
        case 'metrics': result = await deps.repository.metrics(userId, orgId, month(body.month)); break;
        case 'terms': result = await deps.repository.terms(userId, orgId); break;
        case 'save_terms': result = await deps.repository.saveTerms(userId, validateTerms(body)); break;
        case 'preview': result = await deps.repository.preview(userId, orgId, month(body.month)); break;
        case 'close': result = await deps.repository.close(userId, orgId, month(body.month), requiredString(body.expected_revision, 'expected_revision')); break;
        case 'statements': result = await deps.repository.statements(userId, orgId, page(body.page), pageSize(body.page_size)); break;
        case 'statement': result = await deps.repository.statement(userId, orgId, uuid(body.statement_id, 'statement_id')); break;
        case 'reconcile_revenue': result = await deps.repository.reconcile(userId, { org_id: orgId, sale_id: uuid(body.sale_id, 'sale_id'), source_updated_at: requiredString(body.source_updated_at, 'source_updated_at'), refunded_product_cents: body.refunded_product_cents, reason: requiredString(body.reason, 'reason') }); break;
        case 'pulse_usage': result = await deps.repository.pulseUsage(userId, orgId, month(body.month), page(body.page), pageSize(body.page_size)); break;
        case 'audit': result = await deps.repository.audit(userId, orgId, month(body.month), { category: typeof body.category === 'string' ? body.category : undefined, actor_id: body.actor_id === undefined ? undefined : uuid(body.actor_id, 'actor_id'), result: typeof body.result === 'string' ? body.result : undefined }, page(body.page), pageSize(body.page_size)); break;
      }
      return json(result, 200, headers);
    } catch (error) {
      if (error instanceof Response) return error;
      const message = error instanceof Error ? error.message : 'Erro interno';
      const status = error instanceof TypeError ? 400 : /forbidden|required/i.test(message) ? 403 : /revision conflict/i.test(message) ? 409 : 500;
      return json({ error: message, code: status === 400 ? 'invalid_input' : status === 403 ? 'forbidden' : status === 409 ? 'conflict' : 'internal_error' }, status, headers);
    }
  };
}
