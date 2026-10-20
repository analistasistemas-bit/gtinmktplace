# ADR-0188 — Marca por produto; marca própria configurável

- **Status:** aceito
- **Data:** 2026-10-20
- **Emenda:** [ADR-0186](0186-marca-propria-por-organizacao.md) (marca própria deixa de forçar a marca na montagem)
- **Relaciona:** ADR-0016 (BRAND no UPDATE), ADR-0060 (gate admin/suporte full), ADR-0088/0157 (UP, delta de atributos),
  ADR-0135 (proteção de colunas por trigger)
- **Spec/plano:** `docs/superpowers/specs/2026-10-20-marca-por-produto-design.md`,
  `docs/superpowers/plans/2026-10-20-marca-por-produto.md`

## Contexto

O ADR-0186 ligou a marca própria por SQL só na Zaven e fez a marca da org valer para todo produto. Diego quer:
configurar a marca própria pela tela Organizações; o cadastro pelo Estoque nascer com a marca da org, com a opção de
outra marca num produto (camisa Lacoste revendida original → Lacoste); trocar a marca depois, mesmo publicado, indo
ao ML na hora; e a planilha seguir usando a coluna FORNECEDOR.

## Decisão

1. **A marca fica no produto:** `familias.marca` (null = vale o fornecedor). Regras puras em
   `_shared/categoria/marca-org.ts`: CREATE `marca → fornecedor → marca_padrao → 'Avil'`; UPDATE/split
   `marca → fornecedor → (não envia BRAND)` — preserva o contrato do ADR-0016 para a Avil.
2. **Default e herança no banco** (trigger `familias_marca_default`, BEFORE INSERT): família nova de um produto que
   já existe herda a marca da mais recente (lida com `FOR SHARE`) e impõe a BRAND — **a marca do produto vence a
   planilha** (decisão do Diego, 20/10); produto novo de lote `manual` em org com marca própria nasce com
   `marca_padrao`; planilha nasce null. Também cobre front antigo durante o rollout.
3. **Proteção** (molde ADR-0135): o membro não muda `familias.marca`, nem BRAND/MANUFACTURER em `atributos_ml`,
   nem `organizations.marca_propria/marca_padrao` pelo PostgREST. Só backend.
4. **Edição:** edge `atualizar-marca-familia` (admin ou suporte `full`, auditado) → RPC `gravar_marca_familia`
   (trava raiz e famílias; recusa `pendente/processando/publicando` e `mudando_composicao`; reescreve
   `atributos_ml`; incrementa `marca_sync_versao`; status `pendente`) → worker `sincronizar-marca-ml`.
5. **Worker** passa a usar a marca do produto, serializado por lease (`adquirir_lease_marca`), descarta job de
   versão antiga, grava status durável (`pendente/ok/erro`) e se reagenda até a família UP convergir (máx. 5).
   Legacy fora: status `erro` com orientação.
6. **Configuração:** `usuarios` ação `set_marca_org` (super-admin); `marca_da_org()` para o front.

## Consequências

- A marca própria agora só define o default do cadastro; trocar o nome da marca da org não altera produtos já
  cadastrados.
- Produto da Zaven entrando por planilha usa o FORNECEDOR como marca (risco aceito pelo Diego).
- **Nunca republicar**: a troca é só `PUT {attributes}`; o ML move os SKUs UP para um `family_id` novo e o worker
  regrava o vínculo local depois de convergir.
