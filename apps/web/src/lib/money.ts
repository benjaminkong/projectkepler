const nf = new Intl.NumberFormat("en-SG");
export const psf = (n: number) => `$${nf.format(n)}`;
export const millions = (n: number) => `$${(n / 1_000_000).toLocaleString("en-SG", { maximumFractionDigits: 1 })}M`;
