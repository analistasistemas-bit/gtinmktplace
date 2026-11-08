# ADR-0197 — Tabela oficial de CEST na entrada por nota

- **Status:** aceito
- **Data:** 2026-11-07
- **Relaciona:** ADR-0181 D-10 (prefill fiscal da nota), ADR-0187 (tabela `ncm_oficial`), ADR-0135
  (cadastro fiscal), ADR-0043 (migrations só por CLI)
- **Plano:** `docs/superpowers/plans/2026-11-07-tabela-oficial-cest.md`

## Contexto

Em 07/11 a Daludi deu entrada numa nota sem CEST em nenhum item. O ADR-0181 D-10 obriga o operador a
preencher o campo ou declarar "Este NCM não tem CEST vigente", sem ajuda: 26 de 28 produtos da Daludi
estão sem CEST. A tabela NCM→CEST tinha ficado fora do escopo. Diego pediu o preenchimento automático
quando o XML não trouxer o CEST.

Medido no Convênio ICMS 142/2018 (CONFAZ, 07/11/2026) contra os 10.516 NCMs vigentes:

| Resultado para o NCM | Códigos |
|---|---|
| Sem nenhum CEST | 7.993 |
| 1 CEST, por NCM completo (8 dígitos) | 254 |
| 1 CEST, só por prefixo (4 a 7 dígitos) | 1.153 |
| Vários CESTs | 1.116 |

O convênio lista NCM parcial e descreve a mercadoria em texto ("exceto..."). Prefixo não prova
enquadramento: o multivitamínico 21069030 casa por prefixo com CESTs de bebidas e de ração.

## Decisão

1. **Tabela `cest_oficial`**, global e sem `org_id`, RLS só leitura para `authenticated`, como a
   `ncm_oficial`: `cest`, `ncm_prefixo` (4 a 8 dígitos), `anexo`, `item`, `descricao`. Chave
   `(cest, ncm_prefixo)`. Fonte: Anexos II a XXV, sem redações anteriores nem itens revogados. O
   Anexo XXVI (porta a porta) fica fora porque as orgs não vendem nessa modalidade. O XXVII (escala
   industrial não relevante) repete CESTs dos outros anexos.
2. **Consulta só em SQL:** `cest_candidatos(p_ncm)` devolve **todas** as correspondências, do prefixo
   mais longo ao mais curto, com `exato = (length(ncm_prefixo) = 8)`. O comprimento ordena e nunca
   exclui: um prefixo curto pode descrever outra mercadoria do mesmo NCM.
3. **Comportamento na entrada por nota, só quando o XML não trouxe CEST:**
   - **Um único CEST em todas as correspondências, e por NCM completo:** preenche o campo como sugestão,
     com selo próprio e a descrição oficial. O "Conferi" geral continua obrigatório, porque 8 dígitos
     não provam enquadramento: a descrição do convênio também conta.
   - **Vários CESTs, ou CEST só por prefixo:** não preenche. Mostra os candidatos com a descrição, e o
     operador escolhe com um clique ou declara que o produto não se enquadra.
   - **Nenhum candidato:** a tela avisa, e a declaração **continua obrigatória**. "Não consta nesta
     versão da tabela" não prova inexistência, por defasagem ou por reclassificação de NCM.
   - **Erro ou consulta em andamento:** mesma regra do ADR-0181 D-10 (preencher ou declarar).
4. **Declaração nova:** "Este NCM não tem CEST vigente" vira **"Este produto não se enquadra em CEST"**,
   porque o NCM pode ter CEST para outras mercadorias.
5. **Preenchimento controlado:** toda escrita passa por `mudarFiscal`, que já derruba o "Conferi".
   Apagar o CEST sugerido não o devolve, e digitação manual nunca é sobrescrita. Trocar o NCM limpa o
   CEST que a tabela preencheu e reavalia.
6. **Selo pelo valor:** "Veio da nota" só aparece quando o valor bate com o XML. Valor que consta dos
   candidatos leva "Sugerido pela tabela oficial — confira" com a descrição, mesmo se digitado, porque
   a descrição ajuda a conferir. Valor fora dos candidatos não leva selo.
7. **Sem mudança no gate:** publicação e `camposFiscaisFaltantes` seguem validando só o formato. CEST
   vindo no XML não é conferido contra a tabela.
8. **Anomalias da fonte são explícitas:** o gerador falha em anomalia desconhecida. Vírgula final é
   normalizada. NCM truncado não é corrigido por suposição: o token é ignorado e registrado na lista do
   script. CEST residual sem NCM (`01.999.00`) não entra, pois não há como consultá-lo.
9. **Atualização manual por migration**, como no ADR-0187: `scripts/cest/gerar-sql.ts` lê o HTML do
   CONFAZ e emite SQL para `supabase migration new cest_refresh_<AAAAMMDD>`.

## Consequências

- A tabela sugere, não decide: o enquadramento continua sendo do operador e do contador.
- Convênio novo exige refresh manual. Enquanto isso, um NCM incluído aparece como "não consta", e a
  declaração obrigatória segura o caso.
- Tela Fiscal, cadastro sem nota e planilha ficam como estão.
- O repo é público e o dado também.

## Emenda D-7 (2026-11-07) — CEST inexistente trava o salvamento

Caso real: o 00000208 da Daludi foi salvo com CEST `3304999`, que não existe no convênio. O ML recusou
o push (`10088 Invalid cest`) e o anúncio ficou "Fiscal pendente", com o motivo visível só no tooltip.
Decisão do Diego:

- **CEST que não existe em `cest_oficial` é recusado ao salvar**, no dialog (botão travado, erro no
  campo) e nas edges `atualizar-fiscal-familia` e `cadastrar-produto` (`_shared/fiscal/cest-oficial.ts`,
  400 com a mensagem; erro de leitura falha fechado).
- **CEST que existe mas não casa com o NCM só gera aviso.** A tabela continua sugerindo, não decidindo
  o enquadramento.
- O dialog fiscal de Publicados/Estoque passa a mostrar os candidatos do NCM, sem autopreencher.
- Vale também para CEST vindo no XML da nota: o ML recusa CEST inexistente qualquer que seja a origem.
  Isso substitui a segunda frase do D-7. A planilha (`ingest-lote`) segue validada só pelo formato.
- Risco aceito: um CEST criado por convênio novo antes do refresh da tabela é recusado até a migration
  de refresh; a saída é salvar sem CEST, que é opcional.
