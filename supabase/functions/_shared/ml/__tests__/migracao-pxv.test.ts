import { describe, it, expect } from 'vitest';
import { validarElegibilidadeUPtin, dispararUPtin, lerStatusUPtin } from '../migracao-pxv';
import type { FetchLikeML } from '../migracao-pxv';

const resp = (body: unknown, status = 200): ReturnType<FetchLikeML> =>
  Promise.resolve(new Response(JSON.stringify(body), { status })) as ReturnType<FetchLikeML>;

describe('validarElegibilidadeUPtin', () => {
  it('is_valid true → elegível', async () => {
    const f: FetchLikeML = () => resp({ is_valid: true });
    expect(await validarElegibilidadeUPtin(f, 'tok', 'MLB1')).toEqual({ elegivel: true, causas: [] });
  });

  it('is_valid false → inelegível, repassando as causas do ML', async () => {
    const f: FetchLikeML = () => resp({
      is_valid: false,
      cause: [{ message: 'Item is not allowed to migrate.', reference: 'item.not_multivariant' }],
    });
    const r = await validarElegibilidadeUPtin(f, 'tok', 'MLB1');
    expect(r.elegivel).toBe(false);
    expect(r.causas[0]).toMatch(/not allowed to migrate/);
    expect(r.causas[0]).toMatch(/item.not_multivariant/);
  });

  // A doc mostra `code`/`reference` como placeholders (`0000`, `item.xxx`) e nunca publica o
  // catálogo real. Traduzir códigos que não conhecemos inventaria significado; o texto do ML vai
  // cru para o operador.
  it('inelegível sem causas legíveis ainda diz alguma coisa', async () => {
    const f: FetchLikeML = () => resp({ is_valid: false, cause: [] });
    const r = await validarElegibilidadeUPtin(f, 'tok', 'MLB1');
    expect(r.elegivel).toBe(false);
    expect(r.causas).toHaveLength(1);
  });

  // Fail-closed: sem `is_valid` afirmativo não se dispara nada irreversível. Um corpo inesperado
  // (mudança de contrato, resposta vazia) NÃO pode virar "pode migrar".
  it('resposta sem is_valid → inelegível, nunca elegível por omissão', async () => {
    const f: FetchLikeML = () => resp({});
    expect((await validarElegibilidadeUPtin(f, 'tok', 'MLB1')).elegivel).toBe(false);
  });

  it('erro HTTP lança com o status', async () => {
    const f: FetchLikeML = () => resp({ message: 'unauthorized' }, 401);
    await expect(validarElegibilidadeUPtin(f, 'tok', 'MLB1')).rejects.toThrow(/401/);
  });
});

describe('dispararUPtin', () => {
  it('200 → resolve, com o item_id no corpo', async () => {
    let visto: { url: string; body: string } | null = null;
    const f: FetchLikeML = (url, init) => {
      visto = { url, body: String(init?.body) };
      return resp({}, 200);
    };
    await dispararUPtin(f, 'tok', 'MLB1');
    expect(visto!.url).toBe('https://api.mercadolibre.com/sites/MLB/items/user_product_listings');
    expect(JSON.parse(visto!.body)).toEqual({ item_id: 'MLB1' });
  });

  // A doc só publica este endpoint com /sites/MLM/ (México). Usar MLB é inferência a partir do
  // padrão multi-site da API. Se a rota estiver errada, o operador precisa ler isso na mensagem —
  // "erro desconhecido" faria alguém procurar o problema no anúncio, não no endereço.
  it('404 explica que o endereço pode exigir outro site, e diz que nada foi iniciado', async () => {
    const f: FetchLikeML = () => resp('not found', 404);
    await expect(dispararUPtin(f, 'tok', 'MLB1')).rejects.toThrow(/MLM|inferência/i);
    await expect(dispararUPtin(f, 'tok', 'MLB1')).rejects.toThrow(/Nenhuma migração foi iniciada/i);
  });

  it('outros erros propagam o status do ML', async () => {
    const f: FetchLikeML = () => resp({ message: 'bad request' }, 400);
    await expect(dispararUPtin(f, 'tok', 'MLB1')).rejects.toThrow(/400/);
  });
});

describe('lerStatusUPtin', () => {
  // 404 aqui é "ainda não existe recurso de migração", não falha: logo após o POST o ML pode não
  // ter criado o registro. Tratar como erro faria o worker desistir no primeiro ciclo.
  it('404 → encontrada: false, sem lançar', async () => {
    const f: FetchLikeML = () => resp({}, 404);
    const r = await lerStatusUPtin(f, 'tok', 'MLB1');
    expect(r.encontrada).toBe(false);
    expect(r.ativacaoCompleta).toBeNull();
  });

  it('em andamento: timestamps nulos e filhos pending', async () => {
    const f: FetchLikeML = () => resp({
      item_id: 'MLB1', migration_completed: null, activation_completed: null,
      new_items: [{ new_item_id: 'MLB9', variation_id: 45674567, migration_status: 'pending' }],
    });
    const r = await lerStatusUPtin(f, 'tok', 'MLB1');
    expect(r.encontrada).toBe(true);
    expect(r.ativacaoCompleta).toBeNull();
    expect(r.novosItens).toEqual([{ itemId: 'MLB9', variationId: '45674567', status: 'pending' }]);
  });

  // `variation_id` vem NUMÉRICO no exemplo da doc; o snapshot guarda o id como string. Sem
  // normalizar, o casamento falharia por tipo e cairia num degrau mais fraco sem necessidade.
  it('variation_id numérico vira string', async () => {
    const f: FetchLikeML = () => resp({
      new_items: [{ new_item_id: 'MLB9', variation_id: 123 }],
    });
    expect((await lerStatusUPtin(f, 'tok', 'MLB1')).novosItens[0].variationId).toBe('123');
  });

  it('concluída: activation_completed preenchido', async () => {
    const f: FetchLikeML = () => resp({
      migration_completed: '2026-09-08T10:00:00Z',
      activation_completed: '2026-09-08T10:05:00Z',
      new_items: [
        { new_item_id: 'MLB9', variation_id: '1', migration_status: 'created' },
        { new_item_id: 'MLB8', variation_id: '2', migration_status: 'created' },
      ],
    });
    const r = await lerStatusUPtin(f, 'tok', 'MLB1');
    expect(r.ativacaoCompleta).toBe('2026-09-08T10:05:00Z');
    expect(r.novosItens).toHaveLength(2);
  });

  // Item sem id ou sem variation_id é inútil para o casamento e não pode entrar na lista fingindo
  // que serve — entraria como `undefined` e casaria com nada, ou pior, com outro `undefined`.
  it('descarta new_items incompletos', async () => {
    const f: FetchLikeML = () => resp({
      new_items: [
        { new_item_id: 'MLB9', variation_id: '1' },
        { new_item_id: 'MLB8' },
        { variation_id: '3' },
      ],
    });
    expect((await lerStatusUPtin(f, 'tok', 'MLB1')).novosItens).toHaveLength(1);
  });
});
