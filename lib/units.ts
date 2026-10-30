/**
 * Centralized display-unit conversions (Feature 5). All simulation math is
 * canonical SI (ha, mm, degC, m3, t/ha). These pure functions only convert
 * for display; switching display units never changes a simulation result.
 * Factors: 1 ha = 2.47105381 acres; 1 mm = 0.0393700787 in;
 * 1 m3 = 264.172052 US gallons; 1 t/ha = 892.179 lb/acre.
 */
export const UNITS = {
  metric: { area: 'ha', depth: 'mm', temperature: 'degC', volume: 'm3', yield: 't/ha' },
  us: { area: 'acre', depth: 'in', temperature: 'degF', volume: 'gal', yield: 'lb/acre' },
} as const;
export type UnitSystem = keyof typeof UNITS;
export const haToAcres = (ha: number): number => ha * 2.47105381;
export const acresToHa = (acres: number): number => acres / 2.47105381;
export const mmToInches = (mm: number): number => mm * 0.0393700787;
export const inchesToMm = (inches: number): number => inches / 0.0393700787;
export const celsiusToFahrenheit = (c: number): number => (c * 9) / 5 + 32;
export const fahrenheitToCelsius = (f: number): number => ((f - 32) * 5) / 9;
export const m3ToUsGallons = (m3: number): number => m3 * 264.172052;
export const usGallonsToM3 = (gal: number): number => gal / 264.172052;
export const tPerHaToLbPerAcre = (t: number): number => t * 892.179;
export const lbPerAcreToTPerHa = (lb: number): number => lb / 892.179;
export function convertDepth(mm: number, system: UnitSystem): number { return system === 'us' ? mmToInches(mm) : mm; }
export function convertVolume(m3: number, system: UnitSystem): number { return system === 'us' ? m3ToUsGallons(m3) : m3; }
export function convertArea(ha: number, system: UnitSystem): number { return system === 'us' ? haToAcres(ha) : ha; }
export function convertTemperature(c: number, system: UnitSystem): number { return system === 'us' ? celsiusToFahrenheit(c) : c; }
export function convertYield(tPerHa: number, system: UnitSystem): number { return system === 'us' ? tPerHaToLbPerAcre(tPerHa) : tPerHa; }
export const metresToFeet = (m: number): number => m / 0.3048;
export const feetToMetres = (ft: number): number => ft * 0.3048;
export const kgHaToLbAc = (kgHa: number): number => kgHa * 0.892179;
export const lbAcToKgHa = (lbAc: number): number => lbAc / 0.892179;
