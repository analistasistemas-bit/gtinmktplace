import { describe, expect, it } from 'vitest';
import { storageOwnerForUpload } from '../useUploadLote';

describe('storageOwnerForUpload', () => {
  it('usa o prefixo da organização em suporte full', () => {
    expect(storageOwnerForUpload('user-1', 'org-1', 'full')).toBe('org-1');
  });

  it('preserva o prefixo legado do membro', () => {
    expect(storageOwnerForUpload('user-1', 'org-1', null)).toBe('user-1');
  });
});
