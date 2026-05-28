# Foto-capa por família — Design

**Status:** aprovado em brainstorming (2026-05-28)
**Escopo:** ajuste de M3 (antes do M4)
**Autor:** Diego + Claude

---

## Goal

Permitir que o operador associe **uma imagem-banner por família** que entrará como a **primeira foto da galeria** do anúncio publicado no Mercado Livre — entregando, dentro do que o API público do ML permite a vendedor comum, o mesmo efeito visual que o rich content "Detalhes do produto" das marcas com catálogo oficial.

## Motivação

Diego viu anúncios de marcas grandes (Samsung, etc.) com seções ricas de "Detalhes do produto" e quis algo parecido para os anúncios PubliAI. Investigação técnica confirmou:

- "Detalhes do produto" rico é do **catálogo oficial ML**, controlado pela própria equipe ML em conjunto com a marca dona — vendedor não sobe via API
- Para aviamentos da Daludi, esse caminho é inviável (não é marca catalogada, nicho não justifica negociação manual com ML)
- O caminho viável é **a galeria de fotos** (`pictures[]` no payload ML): a primeira foto aparece em destaque no topo do anúncio, ocupando o mesmo espaço visual que o rich content das marcas

A solução é deixar o operador subir uma imagem-banner por família (montada externamente em Canva/Photoshop) que ocupa a posição `pictures[0]` do anúncio.

## Arquitetura

### 1. Storage

- Bucket existente `imagens` (mesmo das fotos de variação)
- Nova subpasta `capas/` para separar das fotos de cor
- Path completo: `imagens/{user_id}/capas/{codigoPai}.jpeg`

### 2. Schema (migration aditiva)

```sql
ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS capa_storage_path text;
```

- Nullable — capa é opcional, sem ela o fluxo publica normal
- Sem foreign key, sem unique — o path é informativo
- RLS já existente em `familias` (por `user_id`) cobre o novo campo automaticamente

### 3. Convenção de nomes de arquivo

| Padrão de nome | Destino | Comportamento |
|---|---|---|
| `00012345.jpeg` (8 dígitos zero-padded) | Foto de variação (M3, já existe) | Casa com `variacoes.codigo`, atualiza `variacoes.imagem_storage_path` |
| `CAPA_00012345.jpeg` | Foto-capa da família | Casa com `familias.codigo_pai` (após normalizar para 8 dígitos), atualiza `familias.capa_storage_path` |

O prefixo é literal `CAPA_` (maiúsculo, underline), seguido pelo código de 8 dígitos zero-padded.

### 4. Fluxo de upload (extensão do M3)

- Mesma drop-zone na tela de Revisão (`DropZoneImagensExistente`)
- Mesma Edge Function `upload-imagens-lote` — estendida para detectar prefixo
- Operador arrasta tudo junto (fotos de cor + capas) num único drag — o backend separa por prefixo

#### Edge Function `upload-imagens-lote` — mudanças

Para cada arquivo recebido:

1. Extrair nome sem extensão
2. **Se começa com `CAPA_`**:
   - Remover prefixo → fica `00012345`
   - Validar 8 dígitos
   - Buscar `familias` com esse `codigo_pai` no lote
   - Sem match → contar em `capas_sem_match`
   - Com match → fazer upload em `imagens/{user_id}/capas/{codigoPai}.jpeg`, atualizar `familias.capa_storage_path`, contar em `capas_ok`
3. **Senão (lógica atual)**:
   - Validar 8 dígitos
   - Buscar `variacoes` com esse `codigo` no lote (lógica M3 atual)

Resposta JSON ganha 2 campos novos:

```typescript
{
  ok: number;              // fotos de variação ok (M3)
  ja_tinha: number;        // fotos de variação que substituíram (M3)
  sem_match: number;       // fotos de variação sem match (M3)
  capas_ok: number;        // NOVO: capas que entraram
  capas_sem_match: number; // NOVO: capas sem família correspondente
  erros: string[];         // erros mantidos (M3)
}
```

Substituir uma capa **apaga a anterior** do storage antes de subir a nova (evita lixo).

### 5. UI da Revisão

#### Card colapsado (`FamiliaRow`)

- Adicionar **thumb 40×40** ao lado do título (`familia.titulo`)
- Sem capa → placeholder cinza com ícone de imagem (use `Image` do `lucide-react`)
- Com capa → `<img>` apontando para URL assinada do bucket
- Click no thumb expande a família (atalho conveniente)

#### Card expandido (`FamiliaExpanded`)

Nova seção no topo da expansão (antes da grade de variações):

- **Thumb 200×200** centralizado ou alinhado à esquerda
- Botões abaixo:
  - **"Trocar foto"** → abre file picker (input type=file, accept=image/jpeg,image/png). Sobe diretamente via mesma Edge Function `upload-imagens-lote` passando 1 arquivo com prefixo `CAPA_`
  - **"Remover capa"** → confirma e dispara DELETE: apaga do storage + zera `familias.capa_storage_path`
- Sem capa: exibe placeholder grande + só o botão "Subir capa" (file picker)

#### Avisos opcionais (não-bloqueantes)

- Nenhum aviso obrigatório — capa é opcional por design
- Se quiser visualizar quantas famílias estão sem capa, conta-se em runtime sem nova aba (pode entrar em uma versão futura)

### 6. Validações

| Regra | Onde validada |
|---|---|
| Extensão `.jpeg` ou `.jpg` ou `.png` | Frontend antes do upload + Edge Function |
| Tamanho ≤ 10 MB | Edge Function |
| Resolução mínima 500×500 | **Não validar agora** — confiar no operador; ML rejeita no publish se for muito pequena |
| Aspect ratio | Sem restrição — operador monta como quiser |
| Nome casa com 8 dígitos pós-prefixo | Edge Function (regex) |

### 7. Impacto em M4 (publish ML) — apenas registro, não implementar

Quando o serviço de publish (M4) montar o payload ML, a ordem do `pictures[]` será:

```
[
  capa (se familias.capa_storage_path != null),
  foto_pai (se existir arquivo do código PAI),
  foto_variacao_1,
  foto_variacao_2,
  ...
]
```

Capa **sempre primeira** quando existe — é o que garante o destaque visual no topo do anúncio.

## Componentes envolvidos

### Backend

- `supabase/migrations/2026XXXXXXXXXX_capa_familia.sql` — nova migration aditiva (1 coluna)
- `supabase/functions/upload-imagens-lote/index.ts` — estender lógica de match
- `supabase/functions/_shared/` — possivelmente extrair helper `matchPorPrefixo()` se ficar feio

### Frontend

- `src/lib/database.types.ts` — regenerar tipos após migration
- `src/lib/tipos-dominio.ts` — adicionar campo `capaStoragePath?: string` em `Familia`
- `src/lib/queries.ts` — adicionar query auxiliar pra URL assinada (ou usar pública se bucket for público)
- `src/lib/upload-imagens.ts` — adicionar helper específico pra subir capa por família
- `src/components/familia-row.tsx` — adicionar thumb 40×40
- `src/components/familia-expanded.tsx` — adicionar seção da capa com botões
- `src/components/foto-capa-familia.tsx` — **novo**: componente isolado da seção de capa
- `src/pages/Revisao.tsx` — atualizar `lidarArquivosDrop` pra mostrar os contadores novos de capa

### Testes

- `supabase/functions/upload-imagens-lote/__tests__/match-capa.test.ts` — unit tests do match com prefixo
- Render tests dos novos componentes não obrigatórios (UI cosmética)

## Fora de escopo (deixar pra depois)

- ❌ Geração automática de banner por IA (o operador monta no Canva)
- ❌ Validação de resolução mínima no upload (deixar o ML reprovar se for o caso)
- ❌ Aba "famílias sem capa" na Revisão (sem bloqueio, sem aba dedicada)
- ❌ Crop/edição inline (sai do escopo do MVP)
- ❌ Múltiplas capas por família (uma só)
- ❌ Edição da posição `pictures[0]` no payload (M4)
- ❌ Galeria expandida com várias imagens-banner (overkill)

## Critério de "pronto"

1. Migration aplicada com sucesso (coluna `capa_storage_path` em `familias`)
2. Upload em lote: arrastar `CAPA_00012345.jpeg` junto com `00012345.jpeg` separa corretamente
3. Card colapsado mostra thumb (ou placeholder) + título sem quebrar layout
4. Card expandido permite Trocar e Remover capa, com refresh imediato da UI
5. Edge Function retorna contadores `capas_ok` / `capas_sem_match` no body
6. Toast/status de upload na Revisão mostra os novos contadores (ex.: "3 capas · 2 sem match")
7. Testes existentes do M3 continuam passando
8. Build + types check verde
9. ROADMAP / TASKS / CLAUDE.md atualizados marcando o ajuste como concluído

## Riscos identificados

| Risco | Mitigação |
|---|---|
| Operador esquece o prefixo `CAPA_` e arquivos viram foto de variação errada | Documentar claramente no tooltip da drop-zone; contador `capas_ok=0` no retorno é sinal de problema |
| Edge Function fica complexa demais com dois fluxos | Se ultrapassar ~150 linhas, extrair helpers em `_shared/upload/match.ts` |
| Substituir capa deixa órfão no storage se falhar entre delete e upload | Fazer upload primeiro, atualizar coluna, depois delete antigo (ordem segura) |
| Diego subir imagem grande demais (10 MB+) | Limite no servidor + mensagem clara de erro |

## Workflow esperado de implementação

Seguir `superpowers:writing-plans` pra gerar o plano de tarefas, depois `superpowers:subagent-driven-development` para execução com TDD em tarefas isoladas. Mesma cadência do M3.
