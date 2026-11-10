# Galeria da cor: CORS do Storage para a composição no navegador (Task 12 → Task 16)

ADR-0201, Task 12. Este é o procedimento que fica pronto para a Task 16. **Nada foi aplicado em produção.**

## Por que importa

`comporImagemFinal` (`src/lib/galeria/compor.ts`) e `imagemValida` (`src/lib/galeria/exibicao.ts`) carregam a cena e a referência por URL assinada do bucket `imagens` com `crossOrigin = 'anonymous'`. Duas situações quebram o fluxo:

- **Resposta sem `Access-Control-Allow-Origin` válido para a origem do app:** o `<img>` não carrega. A composição recusa com "Não foi possível carregar a imagem para compor".
- **Canvas sujo:** não acontece. Sem CORS a imagem nem decodifica, então o canvas nunca fica sujo em silêncio. O Step 5 provou isso com um servidor sem cabeçalho (ver `evidencias/galeria-render/README.md`).

O upload do arquivo final usa `uploadToSignedUrl`: um `PUT` cross-origin com os cabeçalhos `authorization`, `x-upsert` e `content-type`. Ele exige preflight.

## O que foi medido em 10/11/2026 (só leitura, sem token válido, nada gravado)

O Supabase Storage não tem CORS por bucket. A política é do projeto e já responde com `*`.

```
GET /storage/v1/object/sign/imagens/nao-existe.jpg?token=x   (Origin: https://exemplo-app.onrender.com)
→ 400, access-control-allow-origin: *

OPTIONS /storage/v1/object/upload/sign/imagens/nao-existe.jpg?token=x
  (Access-Control-Request-Method: PUT; Request-Headers: authorization,x-upsert,content-type)
→ 200, access-control-allow-origin: *, allow-headers: authorization,x-upsert,content-type,
  allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,…, max-age: 3600
```

Conclusão provisória: **não há configuração a aplicar.** A Task 16 só confirma o caminho feliz, com objeto real e URL válida.

## Procedimento da Task 16 (com o Diego, origem do app `https://publiai.daludi.com.br`)

1. No app em produção, abrir a galeria de um anúncio de teste com imagem `gerada`. No DevTools → Network, conferir:
   - o GET da cena (URL assinada) volta 200 com `access-control-allow-origin: *` (ou igual à origem);
   - o console não mostra erro de CORS nem `SecurityError`.
2. Clicar em **Aprovar**. Conferir:
   - o preflight `OPTIONS …/object/upload/sign/imagens/<org>/galeria-ia/<familia>/finais/<id>-<nonce>.jpg` volta 200 com `x-upsert` liberado;
   - o `PUT` volta 200;
   - `galeria-aprovar` responde `{ status: 'aprovada' }`.
   - Premissa: a Task 2 fechou o prefixo `galeria-ia` para `authenticated`, e o `PUT` pela URL assinada emitida pela edge precisa passar mesmo assim. Se ele voltar 403 ou 400 de RLS, o problema é a política do Storage, não o CORS.
3. Pelo terminal, repetir o par de `curl` acima com `-H "Origin: https://publiai.daludi.com.br"` e uma URL assinada **real** (gerada pelo app). A resposta 200 do objeto precisa trazer `access-control-allow-origin`.
4. **Só se** o passo 1, 2 ou 3 mostrar o cabeçalho ausente (por exemplo, se o projeto passar a restringir origens): abrir chamado no Supabase ou ajustar a configuração de CORS do projeto pelo painel, porque o CLI não cobre isso. Registrar aqui a mudança, com data. Nada de CORS por bucket: o recurso não existe no Supabase Storage.
5. Medir também a CPU da `galeria-aprovar` implantada. Aprovar uma imagem real (o mesmo JPEG final) e ler a CPU nos logs da função: precisa ficar em ≤800 ms. No vitest local deu 143 ms de CPU, e em Deno local entre 45 e 85 ms por arquivo.
