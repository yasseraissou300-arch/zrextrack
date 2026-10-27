import { describe, it, expect } from 'vitest';
import { prettyProduct, statusBadge, formatDA } from '@/lib/ui/order-display';

describe('prettyProduct', () => {
  it('sépare le nom et la variante ZRExpress', () => {
    expect(prettyProduct('Veste EMY( EMY )( 48 / Grenat ) : - 1')).toEqual({
      name: 'Veste EMY',
      variant: '48 / Grenat',
    });
  });
  it('texte libre sans parenthèses', () => {
    expect(prettyProduct('Pontalon lain sport beige M  :  - 1')).toEqual({
      name: 'Pontalon lain sport beige M',
      variant: '',
    });
  });
  it('vide', () => {
    expect(prettyProduct(null)).toEqual({ name: '—', variant: '' });
  });
});

describe('statusBadge / formatDA', () => {
  it('libellés connus et repli', () => {
    expect(statusBadge('livre').label).toBe('Livrée');
    expect(statusBadge('inconnu').label).toBe('inconnu');
  });
  it('format DA', () => {
    expect(formatDA(4900).replace(/\s/g, ' ')).toBe('4 900 DA');
  });
});
