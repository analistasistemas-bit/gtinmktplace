import { assinarShop, type CredsAssinatura } from './assinatura.ts';

/**
 * Sobe uma foto para o MediaSpace da Shopee e devolve o `image_id`.
 * A `sourceUrl` é a URL assinada do nosso Storage; baixamos o binário e
 * reenviamos como multipart/form-data (`POST /api/v2/media_space/upload_image`).
 *
 * Lança em qualquer falha (download, upload HTTP, ou erro de negócio Shopee) —
 * o worker trata como foto transiente (retentável).
 */
const PATH_UPLOAD = '/api/v2/media_space/upload_image';

interface RespostaUpload {
  error?: string;
  message?: string;
  response?: { image_info?: { image_id?: string }; image_id?: string };
}

export async function subirFotoShopee(
  host: string,
  creds: CredsAssinatura,
  accessToken: string,
  shopId: string,
  sourceUrl: string,
): Promise<string> {
  const imgResp = await fetch(sourceUrl);
  if (!imgResp.ok) {
    throw new Error(`Shopee upload: falha ao baixar a foto (${imgResp.status})`);
  }
  const blob = await imgResp.blob();

  const timestamp = Math.floor(Date.now() / 1000);
  const sign = await assinarShop(creds, PATH_UPLOAD, timestamp, accessToken, shopId);
  const params = new URLSearchParams({
    partner_id: creds.partnerId,
    timestamp: String(timestamp),
    sign,
    access_token: accessToken,
    shop_id: shopId,
  });

  const form = new FormData();
  form.append('image', blob, 'image.jpg');

  const resp = await fetch(`${host}${PATH_UPLOAD}?${params.toString()}`, {
    method: 'POST',
    body: form,
  });
  const json = (await resp.json().catch(() => ({}))) as RespostaUpload;
  if (!resp.ok || json.error) {
    throw new Error(`Shopee upload_image (${resp.status}): ${json.message || json.error || 'erro'}`);
  }
  const imageId = json.response?.image_info?.image_id ?? json.response?.image_id;
  if (!imageId) throw new Error('Shopee upload_image: sem image_id na resposta');
  return imageId;
}
