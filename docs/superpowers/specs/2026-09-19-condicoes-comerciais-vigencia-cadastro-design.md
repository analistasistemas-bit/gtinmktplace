# Especificação de Design — Vigência Imediata no Cadastro de Condições Comerciais

**Data:** 2026-09-19  
**Status:** Aprovado para planejamento (Revisado pós-Adversarial Codex R9 — Blindagem Multi-tenant e Fuso Horário)  
**Autor:** Diego / Antigravity  
**Contexto:** Menu Organizações (`/admin`) e Detalhe da Organização (`/admin/organizacoes/:id`)

---

## 1. Contexto e Motivação

Na Central de Organizações (`/admin`), ao selecionar a competência corrente (`2026-09`), as três organizações cadastradas (**Avil**, **DSA** e **Daludi Shop**) apresentam os seguintes sintomas:
1. Alertas na faixa "Precisa da sua atenção":
   - `Avil: 2026-09 não fecha — condição comercial começa em 2026-10`
   - `DSA: 2026-09 não fecha — condição comercial começa em 2026-10`
   - `Daludi Shop: 2026-09 não fecha — condição comercial começa em 2026-10`
2. No KPI "Previsão de cobrança": valor `—` com o descritivo `"3 com vigência futura — fora do total"`.
3. Na tabela da carteira: a coluna de previsão fica vazia (`—`) e o badge sob o nome exibe `"Vigência em 2026-10"`.

### Causa Raiz

No componente `CommercialTermsForm` (`src/components/platform-admin/commercial-terms-form.tsx`), ao preencher as condições comerciais de um novo contrato (`current === null`), o estado inicial da vigência (`startsOn`) vinha pré-configurado como `nextMonth` (`nextMonthStart()`). O elemento `<select>` exibia "Próximo mês" como primeira opção e o texto informativo reforçava "Padrão: próximo mês".

Ao cadastrar os contratos das três organizações em setembro, a condição comercial foi salva com `starts_on = '2026-10-01'` e `setup_due_month = '2026-10-01'`. Como a função `platform_resolve_terms` filtra `starts_on <= competência`, a competência `2026-09` fica sem nenhum termo comercial vigente, impedindo o fechamento e a previsão de cobrança para o mês corrente.

---

## 2. Objetivos e Requisitos

### 2.1 Requisitos Funcionais

1. **Padrão no primeiro cadastro (Frontend):**
   - Ao cadastrar as condições comerciais pela primeira vez (`current === null`), o início da vigência (`startsOn`) deve ser por padrão **o mês corrente** (`currentMonthStart()`).
   - O `<select>` de início de vigência deve exibir `"Este mês (AAAA-MM-01)"` como primeira opção selecionada por padrão.
   - O texto descritivo deve informar que o padrão do primeiro contrato é o mês corrente.
   - O mês padrão da taxa de implantação (`setupDueMonth`) no estado inicial deve ser o mês corrente (`startsOn.slice(0, 7)`).
   - **Clamping de vigência e implantação:** Caso o operador selecione explicitamente "Próximo mês" (`startsOn` avançando para `AAAA-MM+1`), o campo `setupDueMonth` deve ser automaticamente ajustado caso seja menor que `startsOn.slice(0, 7)`, garantindo que nunca seja enviado um payload que viole a constraint `setup_due_month >= starts_on` (tanto no `onChange` quanto na sanitização do `submit`).
   - **Conexão estrita no payload:** O valor sanitizado `effectiveSetupDue` deve ser explicitamente mapeado no objeto enviado a `save.mutateAsync({ setup_due_month: effectiveSetupDue, ... })`.
   - **Proteção contra virada de competência em America/Fortaleza:** `currentMonth` e `nextMonth` são calculados dinamicamente no fuso de Fortaleza (`America/Fortaleza`, UTC-3). Se a tela permanecer aberta durante a virada do mês (às 00:00 de Fortaleza = 03:00 UTC), tanto ao recuperar o foco da janela (`focus`) quanto no clique de submissão (`submit`), o formulário deve impedir o envio com competência passada, atualizar `startsOn` para o novo mês corrente, ajustar `setupDueMonth` para a nova competência e exibir aviso ao operador: `"A competência do mês virou enquanto o formulário estava aberto. A vigência foi ajustada para o mês atual. Revise e confirme o salvamento."`

2. **Renegociações futuras mantidas:**
   - A regra de renegociação permanece inalterada: contratos posteriores para organizações que já possuem termo comercial continuam valendo a partir do próximo mês (`effectiveStartsOn = nextMonthStart()`), preservando a estabilidade da competência em andamento.

3. **Correção cirúrgica e segura dos dados existentes (Backend / Supabase PostgreSQL):**
   - Criar migration para atualizar estritamente as três organizações alvo (**Avil** `slug='avil'`, **DSA** `slug='diego-souza'` e **Daludi Shop** `slug='daludishop'`).
   - **Pré-condição incondicional antes de qualquer DDL:** A validação das 3 organizações deve rodar antes de qualquer mutação, lock ou `ALTER TABLE ... DISABLE TRIGGER`. Se encontrar 0 organizações (ambiente de testes/CI limpo sem seeds), faz no-op absoluto com `return;` sem tocar no trigger nem na tabela. Se encontrar entre 1 e 2 organizações, aborta imediatamente com exceção `23514`, impedindo qualquer mutação parcial.
   - **Validação de contrato inaugural:** Para cada um dos 3 slugs individualmente, validar via `SELECT ... INTO STRICT` que a organização possui exatamente 1 termo no histórico total, que esse termo possui `version = 1` e que seu `starts_on = '2026-10-01'`, provando que se trata do primeiro contrato de implantação e não de uma renegociação legítima.
   - **Cardinalidade comprovada de 1 linha por organização:** Atualizar cirurgicamente o `id` específico de cada um dos 3 termos e materializar em tabela temporária `_migracao_termos_corrigidos on commit drop`. Comprovar que exatamente 3 linhas foram atualizadas e que para cada um dos 3 slugs há exatamente 1 linha corrigida.
   - O trigger de imutabilidade `platform_commercial_terms_no_mutation` deve ser desabilitado estritamente durante a transação e reabilitado antes do fim do bloco.
   - Gerar eventos de auditoria completos em `platform_audit_events` com categoria `'admin'`, ação `'platform_terms_vigencia_corrigida'`, registrando `starts_on_anterior`, `starts_on_atual`, `setup_due_month_anterior`, `setup_due_month_atual` e `org_slug`.

4. **Gate Operacional de Segurança Multi-Tenant em Produção (AGENTS.md):**
   - Nenhuma mutação de dados em produção pode ser executada sem um preview somente-leitura prévio listando nome, `org_id`, `term_id`, versão e valores atuais, seguido de autorização humana explícita de Diego.
   - **Prova de Isolamento Total com Digest Criptográfico Determinístico:** Para comprovar que nenhum outro tenant foi alterado nem sofreu efeitos colaterais em nenhuma das tabelas afetadas, capturar contagem e digest MD5 completo (`row_to_json(t.*)`) de todas as linhas dos outros tenants em `platform_commercial_terms` e em `platform_audit_events` antes e após a execução em produção.

---

## 3. Arquitetura e Detalhamento das Alterações

### 3.1 Frontend: `src/components/platform-admin/commercial-terms-form.tsx`

1. **Estado dinâmico e sincronização de virada de mês:**
   ```typescript
   const isFirstContract = current === null;
   const [startsOn, setStartsOn] = useState(() => currentMonthStart());
   const effectiveStartsOn = isFirstContract ? startsOn : nextMonthStart();
   const today = useMemo(() => todayInFortaleza(), []);
   const [form, setForm] = useState<FormState>(() => initialState(current, effectiveStartsOn));
   const [error, setError] = useState<string | null>(null);
   const revenueTouched = useRef(false);

   function syncMonthRollover(nowMonth: string) {
     setStartsOn(nowMonth);
     const minSetupMonth = nowMonth.slice(0, 7);
     setForm((previous) => ({
       ...previous,
       setupDueMonth: previous.setupDueMonth && previous.setupDueMonth < minSetupMonth
         ? minSetupMonth
         : previous.setupDueMonth,
     }));
     setError('A competência do mês virou enquanto o formulário estava aberto. A vigência foi ajustada para o mês atual. Revise e confirme o salvamento.');
   }

   // Sincronização ao alterar tenant ou contrato
   useEffect(() => {
     const month = currentMonthStart();
     setStartsOn(month);
     setForm(initialState(current, month));
     revenueTouched.current = false;
     setError(null);
   }, [current, orgId]);

   // Sincronização em tempo real ao focar na janela se a competência virou em Fortaleza
   useEffect(() => {
     function syncOnFocus() {
       const nowMonth = currentMonthStart();
       if (isFirstContract && startsOn < nowMonth) {
         syncMonthRollover(nowMonth);
       }
     }
     window.addEventListener('focus', syncOnFocus);
     return () => window.removeEventListener('focus', syncOnFocus);
   }, [isFirstContract, startsOn]);
   ```

2. **Mudança de `startsOn` com clamping de `setupDueMonth`:**
   Ao selecionar um novo `startsOn`:
   ```typescript
   onChange={(event) => {
     const newStartsOn = event.target.value;
     setStartsOn(newStartsOn);
     const minSetupMonth = newStartsOn.slice(0, 7);
     setForm((previous) => {
       if (previous.setupDueMonth && previous.setupDueMonth < minSetupMonth) {
         return { ...previous, setupDueMonth: minSetupMonth };
       }
       return previous;
     });
   }}
   ```

3. **No submit (defensivo contra virada de mês e clamping estrito do payload):**
   ```typescript
   // Defesa contra virada do mês no momento do clique
   const nowCurrentMonth = currentMonthStart();
   if (isFirstContract && startsOn < nowCurrentMonth) {
     syncMonthRollover(nowCurrentMonth);
     return;
   }

   const effectiveSetupDue = isFirstContract
     ? (form.setupDueMonth && form.setupDueMonth < effectiveStartsOn.slice(0, 7)
         ? effectiveStartsOn.slice(0, 7)
         : form.setupDueMonth || null)
     : null;

   await save.mutateAsync({
     org_id: orgId,
     starts_on: effectiveStartsOn,
     modality: Number(form.modality) as 1 | 2,
     monthly_fee_cents: form.modality === '2' ? 0 : monthly!,
     revenue_bps_t1: revenueT1!,
     revenue_bps_t2: revenueT2!,
     revenue_bps_t3: revenueT3!,
     revenue_bps_t4: revenueT4!,
     sonar_unit_cents: form.modality === '1' ? 0 : sonar!,
     setup_fee_cents: isFirstContract ? setup! : 0,
     setup_due_month: effectiveSetupDue,
     reason: form.reason.trim(),
   });
   ```

4. **Opções do `<select>` no primeiro contrato:**
   ```tsx
   <select
     aria-label="Início da vigência"
     className="h-9 w-full rounded-md border border-input bg-transparent px-3"
     value={startsOn}
     onChange={...}
   >
     <option value={currentMonthStart()}>Este mês ({currentMonthStart()})</option>
     <option value={nextMonthStart()}>Próximo mês ({nextMonthStart()})</option>
   </select>
   ```

---

### 3.2 Banco de Dados: Migration Supabase

Arquivo: `supabase/migrations/20260919130000_platform_terms_vigencia_setembro.sql`

```sql
-- Migration: Ajuste de vigência inicial dos primeiros contratos de Avil, DSA e Daludi Shop para setembro/2026
-- Contexto: Contratos cadastrados em setembro/2026 foram salvos com starts_on = 2026-10-01
-- devido ao valor padrão do formulário anterior. Esta migration ajusta especificamente
-- as três organizações para 2026-09-01 para habilitar previsão e fechamento de 2026-09.

create or replace function pg_temp.executar_migracao_vigencia_setembro()
returns void
language plpgsql
as $$
declare
  v_expected_orgs integer;
  v_target_slug text;
  v_org_id uuid;
  v_term_count integer;
  v_term public.platform_commercial_terms%rowtype;
  v_corrigido record;
  v_slug_count integer;
begin
  -- 1. Pré-condição incondicional ANTES de qualquer DDL, lock ou alteração:
  select count(*) into v_expected_orgs
  from public.organizations
  where slug in ('avil', 'diego-souza', 'daludishop');

  -- Em ambiente limpo sem seeds de produção (ex.: suíte de testes isolada ou CI novo):
  if v_expected_orgs = 0 then
    -- No-op absoluto: encerra sem tocar no trigger, na tabela ou em qualquer lock
    return;
  end if;

  -- Se encontrou pelo menos uma organização alvo, EXIGE obrigatoriamente que as 3 existam
  if v_expected_orgs <> 3 then
    raise exception 'Pré-condição violada: esperava exatamente 3 organizações (avil, diego-souza, daludishop) ou nenhuma (ambiente limpo), mas encontrou %', v_expected_orgs
      using errcode = '23514';
  end if;

  -- 2. Somente após a pré-condição ser satisfeita, criar a tabela temporária e desabilitar o trigger:
  create temporary table _migracao_termos_corrigidos (
    id uuid primary key,
    org_id uuid not null,
    slug text not null,
    starts_on_anterior date not null,
    starts_on_atual date not null,
    setup_due_anterior date,
    setup_due_atual date
  ) on commit drop;

  alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

  -- 3. Para cada organização alvo, validar individualmente e atualizar cirurgicamente
  for v_target_slug in select unnest(array['avil', 'diego-souza', 'daludishop']) loop
    select id into strict v_org_id
    from public.organizations
    where slug = v_target_slug;

    -- Validar que possui exatamente 1 termo no histórico total (contrato inaugural)
    select count(*) into strict v_term_count
    from public.platform_commercial_terms
    where org_id = v_org_id;

    if v_term_count <> 1 then
      raise exception 'Organização % possui % termos comerciais no histórico, esperava exatamente 1 (primeiro contrato inaugural)', v_target_slug, v_term_count
        using errcode = '23514';
    end if;

    -- Obter o termo inaugural
    select * into strict v_term
    from public.platform_commercial_terms
    where org_id = v_org_id;

    -- Validar que é versão 1 e estava com vigência em 2026-10-01
    if v_term.version <> 1 or v_term.starts_on <> '2026-10-01'::date then
      raise exception 'Termo da organização % não é o contrato inaugural esperado de 2026-10-01 (versão %, starts_on %)', v_target_slug, v_term.version, v_term.starts_on
        using errcode = '23514';
    end if;

    -- Atualizar especificamente esse termo único
    update public.platform_commercial_terms
    set starts_on = '2026-09-01',
        setup_due_month = case when setup_due_month = '2026-10-01' then '2026-09-01'::date else setup_due_month end
    where id = v_term.id and org_id = v_org_id
    returning id, org_id, starts_on, setup_due_month
    into v_corrigido;

    insert into _migracao_termos_corrigidos (
      id, org_id, slug, starts_on_anterior, starts_on_atual, setup_due_anterior, setup_due_atual
    ) values (
      v_corrigido.id,
      v_corrigido.org_id,
      v_target_slug,
      v_term.starts_on,
      v_corrigido.starts_on,
      v_term.setup_due_month,
      v_corrigido.setup_due_month
    );
  end loop;

  -- 4. Asserção LOUD: exatamente 3 linhas atualizadas no total
  if (select count(*) from _migracao_termos_corrigidos) <> 3 then
    raise exception 'Esperava exatamente 3 linhas em _migracao_termos_corrigidos, mas obteve %', (select count(*) from _migracao_termos_corrigidos)
      using errcode = '23514';
  end if;

  -- 5. Asserção LOUD: exatamente 1 linha por organização
  for v_target_slug in select unnest(array['avil', 'diego-souza', 'daludishop']) loop
    select count(*) into v_slug_count
    from _migracao_termos_corrigidos
    where slug = v_target_slug;

    if v_slug_count <> 1 then
      raise exception 'Esperava exatamente 1 linha corrigida para a organização %, mas obteve %', v_target_slug, v_slug_count
        using errcode = '23514';
    end if;
  end loop;

  -- 6. Asserção LOUD: nenhum termo restante em 2026-10 para as organizações alvo
  if exists (
    select 1
    from public.platform_commercial_terms t
    join public.organizations o on o.id = t.org_id
    where o.slug in ('avil', 'diego-souza', 'daludishop')
      and t.starts_on = '2026-10-01'
  ) then
    raise exception 'Restaram termos em 2026-10 para as organizações alvo' using errcode = '23514';
  end if;

  -- 7. Auditoria completa para cada termo modificado
  insert into public.platform_audit_events (org_id, actor_id, category, action, result, target, reason, details)
  select org_id, null, 'admin', 'platform_terms_vigencia_corrigida', 'success', id::text,
    'Ajuste de vigencia inicial: primeiro contrato inicia no mes do cadastro (2026-09)',
    jsonb_build_object(
      'org_slug', slug,
      'starts_on_anterior', starts_on_anterior,
      'starts_on_atual', starts_on_atual,
      'setup_due_month_anterior', setup_due_anterior,
      'setup_due_month_atual', setup_due_atual
    )
  from _migracao_termos_corrigidos;

  -- 8. Reabilitar o trigger incondicionalmente
  alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;
end;
$$;

select pg_temp.executar_migracao_vigencia_setembro();
```

---

## 4. Plano de Validação e Testes

1. **Testes Unitários de Frontend (`src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`):**
   - Substituição do teste padrão existente para esperar `starts_on = '2026-09-01'` e `setup_due_month = '2026-09'`.
   - Teste de clamping na seleção de vigência futura.
   - Teste de sanitização no submit contra input manual de mês de implantação defasado.
   - Teste defensivo de virada de mês no fuso de Fortaleza (`02:59Z → 03:01Z`) via `window.dispatchEvent` envolvido em `act()`, validando `startsOn = '2026-10-01'`, `setupDueMonth = '2026-10'` e mensagem de alerta.
   - Teste defensivo de virada de mês no `submit` cruzando `02:59Z → 03:01Z`, comprovando que bloqueia o salvamento e atualiza `startsOn = '2026-10-01'` e `setupDueMonth = '2026-10'` na UI com alerta.
2. **Typecheck e Lint:**
   - Executar `npx tsc -b --force`.
   - Executar `pnpm eslint src/components/platform-admin/commercial-terms-form.tsx src/components/platform-admin/__tests__/commercial-terms-form.test.tsx`.
3. **Suite SQL (`supabase/tests/platform_commercial.sql`):**
   - Teste de 0 organizações (no-op comprovado via contagem antes e depois na tabela temporária sem ON COMMIT DROP).
   - Teste de 1 organização (executa `pg_temp.executar_migracao_vigencia_setembro()` preservada na sessão e valida que lança `23514`).
   - Teste de 2 organizações (executa `pg_temp.executar_migracao_vigencia_setembro()` preservada na sessão e valida que lança `23514`).
   - Teste de 3 organizações + tenant controle com asserções completas de readback e teste de trigger imutável sem falsos positivos via flag booleana.
   - Limpeza final de `pg_temp.executar_migracao_vigencia_setembro()`.
   - Executar via `psql -U supabase_admin -d codex_platform_admin_test_20260906 -v ON_ERROR_STOP=1 -f supabase/tests/platform_commercial.sql`.
4. **Gate Operacional de Produção (AGENTS.md):**
   - Preview somente-leitura dos 3 contratos reais + digest MD5 de isolamento dos demais tenants nas tabelas `platform_commercial_terms` e `platform_audit_events`.
   - Autorização explícita de Diego.
   - Readback pós-execução confirmando sucesso e digest dos demais tenants rigorosamente inalterado.
5. **Documentação:**
   - Atualizar `obsidian-vault/09-Logs/Changelog.md` e `docs/project-status.md`.
