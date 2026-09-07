import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import {
  callPlatformAdmin,
  type AuditRow,
  type BillingPreview,
  type BillingStatement,
  type CommercialTerms,
  type CommercialTermsInput,
  type Month,
  type OrgMetrics,
  type OrgSummary,
  type Page,
  type PulseUsage,
  type RevenueReconciliationInput,
  type Wallet,
} from '@/lib/platform-admin';

export type PlatformWalletParams = {
  month: Month;
  search?: string;
  include_test?: boolean;
  page?: number;
  page_size?: number;
  sort?: 'name' | 'slug' | 'gross_desc';
};

export type PlatformPulseUsageParams = {
  org_id: string;
  month: Month;
  page?: number;
  page_size?: number;
};

export type PlatformAuditParams = PlatformPulseUsageParams & {
  category?: AuditRow['category'];
  actor_id?: string;
  result?: string;
};

export type ClosePlatformStatementInput = {
  org_id: string;
  month: Month;
  expected_revision: string;
};

type Filters = Record<string, unknown>;
type UserId = string | null;

function filters(values: Filters): Filters {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function key(
  userId: UserId,
  action: string,
  orgId: string | null,
  month: Month | null,
  queryFilters: Filters,
) {
  return ['platform-admin', userId, action, orgId, month, queryFilters] as const;
}

export const platformAdminKeys = {
  wallet: (userId: UserId, params: PlatformWalletParams) =>
    key(userId, 'wallet', null, params.month, filters({
      search: params.search,
      include_test: params.include_test,
      page: params.page,
      page_size: params.page_size,
      sort: params.sort,
    })),
  organization: (userId: UserId, orgId: string, month: Month) =>
    key(userId, 'organization', orgId, month, {}),
  metrics: (userId: UserId, orgId: string, month: Month) =>
    key(userId, 'metrics', orgId, month, {}),
  terms: (userId: UserId, orgId: string) =>
    key(userId, 'terms', orgId, null, {}),
  preview: (userId: UserId, orgId: string, month: Month) =>
    key(userId, 'preview', orgId, month, {}),
  statements: (userId: UserId, orgId: string) =>
    key(userId, 'statements', orgId, null, {}),
  pulseUsage: (userId: UserId, params: PlatformPulseUsageParams) =>
    key(userId, 'pulse_usage', params.org_id, params.month, filters({
      page: params.page,
      page_size: params.page_size,
    })),
  audit: (userId: UserId, params: PlatformAuditParams) =>
    key(userId, 'audit', params.org_id, params.month, filters({
      category: params.category,
      actor_id: params.actor_id,
      result: params.result,
      page: params.page,
      page_size: params.page_size,
    })),
};

function requireUser(userId: UserId): void {
  if (!userId) throw new Error('Usuário não autenticado');
}

export function usePlatformWallet(params: PlatformWalletParams) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<Wallet>({
    queryKey: platformAdminKeys.wallet(userId, params),
    queryFn: () => callPlatformAdmin('wallet', { ...params }),
    enabled: Boolean(userId && params.month),
  });
}

export function usePlatformOrganization(orgId: string, month: Month) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<OrgSummary>({
    queryKey: platformAdminKeys.organization(userId, orgId, month),
    queryFn: () => callPlatformAdmin('organization', { org_id: orgId, month }),
    enabled: Boolean(userId && orgId && month),
  });
}

export function usePlatformMetrics(orgId: string, month: Month) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<OrgMetrics>({
    queryKey: platformAdminKeys.metrics(userId, orgId, month),
    queryFn: () => callPlatformAdmin('metrics', { org_id: orgId, month }),
    enabled: Boolean(userId && orgId && month),
  });
}

export function usePlatformTerms(orgId: string) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<{ rows: CommercialTerms[] }>({
    queryKey: platformAdminKeys.terms(userId, orgId),
    queryFn: () => callPlatformAdmin('terms', { org_id: orgId }),
    enabled: Boolean(userId && orgId),
  });
}

export function usePlatformPreview(orgId: string, month: Month) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<BillingPreview>({
    queryKey: platformAdminKeys.preview(userId, orgId, month),
    queryFn: () => callPlatformAdmin('preview', { org_id: orgId, month }),
    enabled: Boolean(userId && orgId && month),
  });
}

export function usePlatformStatements(orgId: string) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<Page<BillingStatement>>({
    queryKey: platformAdminKeys.statements(userId, orgId),
    queryFn: () => callPlatformAdmin('statements', { org_id: orgId }),
    enabled: Boolean(userId && orgId),
  });
}

export function usePlatformPulseUsage(params: PlatformPulseUsageParams) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<PulseUsage>({
    queryKey: platformAdminKeys.pulseUsage(userId, params),
    queryFn: () => callPlatformAdmin('pulse_usage', { ...params }),
    enabled: Boolean(userId && params.org_id && params.month),
  });
}

export function usePlatformAudit(params: PlatformAuditParams) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  return useQuery<Page<AuditRow>>({
    queryKey: platformAdminKeys.audit(userId, params),
    queryFn: () => callPlatformAdmin('audit', { ...params }),
    enabled: Boolean(userId && params.org_id && params.month),
  });
}

async function invalidateBilling(
  queryClient: QueryClient,
  userId: string,
  orgId: string,
  month: Month,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['platform-admin', userId, 'wallet', null, month] }),
    queryClient.invalidateQueries({ queryKey: ['platform-admin', userId, 'preview', orgId, month] }),
    queryClient.invalidateQueries({ queryKey: ['platform-admin', userId, 'statements', orgId] }),
  ]);
}

export function useSavePlatformTerms() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation<CommercialTerms, Error, CommercialTermsInput>({
    mutationFn: (input) => {
      requireUser(userId);
      return callPlatformAdmin('save_terms', { ...input });
    },
    onSuccess: async (_terms, input) => {
      if (!userId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platform-admin', userId, 'terms', input.org_id] }),
        invalidateBilling(queryClient, userId, input.org_id, input.starts_on.slice(0, 7)),
      ]);
    },
  });
}

export function useClosePlatformStatement() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation<BillingStatement, Error, ClosePlatformStatementInput>({
    mutationFn: (input) => {
      requireUser(userId);
      return callPlatformAdmin('close', { ...input });
    },
    onSuccess: async (_statement, input) => {
      if (!userId) return;
      await invalidateBilling(queryClient, userId, input.org_id, input.month);
    },
  });
}

export function useReconcilePlatformRevenue(month: Month) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, Error, RevenueReconciliationInput>({
    mutationFn: (input) => {
      requireUser(userId);
      return callPlatformAdmin('reconcile_revenue', { ...input });
    },
    onSuccess: async (_result, input) => {
      if (!userId) return;
      await invalidateBilling(queryClient, userId, input.org_id, month);
    },
  });
}
