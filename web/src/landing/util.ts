// Small helpers shared by the landing modules.

export const RM: boolean = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const FINE: boolean = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/// The first receipt anchored on Monad mainnet. The hero, the receipt scene and the barcodes all draw from it.
export const FIRST_RECEIPT = "0x1b443b455e55360cec874215c9d1ae3113794f6d3a6c2a0c480387b12e35c5f2";
export const HASH = FIRST_RECEIPT.slice(2);

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
