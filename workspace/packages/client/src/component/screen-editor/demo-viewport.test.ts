import { getDemoViewportHeight } from './demo-viewport';

describe('Customer Portal desktop viewport', () => {
  it('fits the full login form without shortening taller recordings', () => {
    expect(getDemoViewportHeight('customer-portal-ffvb6n1yroikgoti', 630)).toBe(850);
    expect(getDemoViewportHeight('customer-portal-ffvb6n1yroikgoti', 1080)).toBe(1080);
  });

  it('preserves other demos, including similarly named copies', () => {
    expect(getDemoViewportHeight('other-demo', 630)).toBe(630);
    expect(getDemoViewportHeight('customer-portal-copy', 630)).toBe(630);
  });
});
