# ADR-0164 — A taxa de implantação sobrevive à renegociação

**Status:** Aceito
**Decisor:** Diego, 2026-09-18
**Relacionado:** ADR-0155 (cobrança auditável), ADR-0158 (central de organizações), migration `20260906170000_platform_commercial_foundation.sql` (RPC `platform_save_terms`, `platform_resolve_terms`), `20260907102428_platform_terms_contract_fix.sql` (`platform_billing_preview`)

## Contexto

`platform_save_terms` recusa implantação em renegociação:

```sql
if v_setup_fee > 0 and exists (
  select 1 from public.platform_commercial_terms t where t.org_id = v_org_id
) then
  raise exception 'Setup fee cannot be reapplied on renegotiation';
end if;
```

A trava existe para impedir que a taxa de R$ 3.000 seja lançada duas vezes. Ela funciona — mas
obriga a renegociação a gravar `setup_fee_cents = 0` e `setup_due_month = null`, e esses dois campos
são exatamente de onde a cobrança tira a taxa:

- `platform_resolve_terms` devolve **uma linha só**, a mais nova (`starts_on desc, version desc`).
- `platform_billing_preview` lê `setup_fee_cents` **só do termo resolvido**, e só quando
  `setup_due_month = p_month`.

Logo, uma renegociação gravada no mesmo `starts_on` do termo que carrega a implantação vira a linha
resolvida daquele mês, com setup zerado — e a taxa some da prévia e do fechamento. Em silêncio: a
tela mostra "Implantação R$ 0,00" como se fosse o combinado.

O caso não é hipotético. Em 2026-09-18 as três organizações (Avil, DSA, Daludi Shop) tinham
exatamente um termo cada, `starts_on = setup_due_month = 2026-10-01`, `setup_fee_cents = 300000`.
Renegociar qualquer uma delas ainda em setembro (quando `próximo mês` = 2026-10-01) apagaria a
implantação de outubro — R$ 9.000 no total.

A janela em que o defeito morde é estreita: a partir de 2026-10-01 a renegociação passa a gravar
`2026-11-01`, o termo de outubro deixa de ser sobrescrito e a taxa é cobrada normalmente. Mas o
padrão se repete a cada cliente novo — contrato fechado num mês, implantação devida no mês seguinte,
ajuste de percentual antes de começar — e nada no sistema avisa.

## Decisão

**A implantação é obrigação do contrato, não da versão.** Renegociar o percentual, a mensalidade ou
o valor do Sonar não cancela uma implantação já acordada e ainda não cobrada.

Em `platform_save_terms`, quando a organização já tem termo (isto é, quando a gravação é
renegociação), os campos `setup_fee_cents` e `setup_due_month` deixam de vir do input e passam a ser
**herdados do termo mais recente da organização** — o mesmo critério de `platform_resolve_terms`
(`starts_on desc, version desc`).

A trava `Setup fee cannot be reapplied on renegotiation` **continua igual**, e continua avaliando o
input. O front (`commercial-terms-form.tsx`) segue enviando `0`/`null` em renegociação, com os campos
de implantação desabilitados. Quem tentar reaplicar a taxa por fora do app continua recebendo o erro.

Cobrança dupla segue impossível por outro caminho, que já existia: `platform_billing_preview` só
lança a linha `setup` quando nenhum demonstrativo fechado da organização já a contém.

## Alternativas descartadas

**Preview buscar a implantação em qualquer termo da organização com `setup_due_month = p_month`, em
vez de só no termo resolvido.** Resolveria o mesmo caso, mas mexe no cálculo da cobrança em vez de no
registro do contrato — mais superfície, mais risco, e deixaria o histórico de termos dizendo uma
coisa (`setup 0`) e a fatura outra.

**Bloquear a renegociação no front enquanto houver implantação pendente no mesmo mês.** Resolveria a
janela de setembro de 2026 sem tocar no banco, mas ao custo de proibir uma operação legítima, e
deixaria a armadilha de pé para o próximo cliente.

**Deixar como está (renegociou, zerou).** Descartado por Diego: contraria o acordo comercial e
falharia em silêncio, que é o que a regra de trava LOUD do projeto proíbe.

## Consequências

- Toda versão nova de um contrato carrega a implantação da anterior. O histórico passa a repetir
  `setup_fee_cents`/`setup_due_month` em todas as versões de um mesmo contrato — é intencional, é o
  que faz `platform_resolve_terms` continuar achando a taxa.
- Copiar a taxa mesmo depois de ela ter sido cobrada é inócuo: o preview exige
  `setup_due_month = p_month` **e** nenhum demonstrativo fechado com linha `setup`.
- Não existe mais caminho pelo app para **cancelar** uma implantação lançada errada. Já não existia:
  a tabela é append-only (trigger `platform_commercial_terms_immutable`) e a trava recusa reaplicar.
  Correção de implantação errada continua sendo operação manual, fora do app, com ADR próprio.
- Primeiro contrato não muda em nada: sem termo anterior, não há o que herdar.

## Como reverter

Restaurar o corpo de `platform_save_terms` de `20260907210746_corrigir_regex_setup_due_month.sql`
(a única diferença é o bloco de herança). Nenhuma outra função depende da mudança.
