'use client';
import type { Language } from '../../lib/i18n-labels';
import type { CopilotContextSnapshot, ResultCard } from './context-bus';

/** Turn raw deterministic tool outputs into readable farmer-facing cards. Numbers pass through untouched from ARIQ engines. */
export function buildCards(results: unknown, language: Language): ResultCard[] {
  if (!results || typeof results !== 'object') return [];
  const r = results as Record<string, never>;
  const cards: ResultCard[] = [];
  const near = (r.nearby_water_sources as { results?: { name: string; kind: string; distanceKm: number; region?: string }[] } | undefined)?.results
    ?? (r.search_water_sources as { results?: { name: string; kind: string; region?: string }[] } | undefined)?.results;
  for (const f of (near ?? []).slice(0, 5)) cards.push({ kind: 'waterway', name: f.name, type: f.kind, distanceKm: (f as { distanceKm?: number }).distanceKm, region: f.region });
  const rec = r.irrigation_recommendation as { demand?: { totalEtCropMm?: number; totalDeficitMm?: number } | null; outlook?: { firstStressDateWithoutIrrigation?: string | null }; missingInputs?: { field: string }[] } | undefined;
  if (rec) cards.push({ kind: 'demand', etCropMm: rec.demand?.totalEtCropMm, deficitMm: rec.demand?.totalDeficitMm, stressDate: rec.outlook?.firstStressDateWithoutIrrigation ?? undefined, missing: rec.missingInputs?.map(m => m.field) });
  const pct = (v: unknown) => typeof v === 'number' ? Math.round(v * 1000) / 10 : undefined;
  const season = r.season_simulation as { summary?: { relativeYieldRetained?: { low?: number; median?: number; high?: number } } } | undefined;
  if (season?.summary?.relativeYieldRetained) {
    const t = season.summary.relativeYieldRetained;
    cards.push({ kind: 'scenario', label: language === 'uz' ? 'Mavsum ssenariysi: saqlangan nisbiy hosil' : language === 'ru' ? 'Сезонный сценарий: сохранённый относительный урожай' : 'Season scenario: relative yield retained', retainedPct: pct(t.median), note: t.low !== undefined && t.high !== undefined ? `${pct(t.low)}–${pct(t.high)}%` : undefined });
  }
  const cmp = r.compare_drought_strategies as { droughtVsBaseline?: { modifiedYieldRetained?: number; baselineYieldRetained?: number }; rainFactor?: number; analogYear?: number } | undefined;
  if (cmp?.droughtVsBaseline) cards.push({ kind: 'scenario', label: language === 'uz' ? `Qurg‘oqchilik ssenariysi (${cmp.analogYear})` : language === 'ru' ? `Сценарий засухи (${cmp.analogYear})` : `Drought scenario (${cmp.analogYear})`, retainedPct: pct(cmp.droughtVsBaseline.modifiedYieldRetained), note: cmp.droughtVsBaseline.baselineYieldRetained !== undefined ? `${language === 'ru' ? 'база' : language === 'uz' ? 'baza' : 'baseline'} ${pct(cmp.droughtVsBaseline.baselineYieldRetained)}%` : undefined });
  return cards;
}

/** Deterministic proactive suggestions from real workflow state. Local only — never a paid model call. */
export function proactiveSuggestions(c: CopilotContextSnapshot, language: Language): { q: string; action?: string }[] {
  const L = (en: string, uz: string, ru: string) => language === 'uz' ? uz : language === 'ru' ? ru : en;
  if (c.view === 'farm') {
    if (c.tool === 'futures') return [{ q: L('What happens with 30% less irrigation water?', 'Sug‘orish suvi 30 foiz kamaysa nima bo‘ladi?', 'Что будет при снижении поливной воды на 30%?') }, { q: L('Compare irrigation strategies for my field', 'Dalam uchun sug‘orish strategiyalarini solishtiring', 'Сравните стратегии полива для моего поля') }];
    if (c.analysisStatus === 'ready') return [{ q: L('What is the largest uncertainty in my field analysis?', 'Dala tahlilimdagi eng katta noaniqlik nima?', 'Какая главная неопределённость в анализе моего поля?') }, { q: L('Open Water Futures for my field', 'Dalam uchun Water Futures oching', 'Откройте Water Futures для моего поля'), action: 'futures' }];
    if (c.soilBasis === 'regional-fallback') return [{ q: L('Why is my soil estimate uncertain here?', 'Bu yerda tuproq bahosi nima uchun noaniq?', 'Почему оценка почвы здесь неопределённа?') }];
    if (c.step === 2 && c.cropId) return [{ q: L('Estimate my crop water requirements', 'Ekinimning suv talabini baholang', 'Оцените потребность моей культуры в воде') }];
    if (c.step === 1 && !c.hasBoundary) return [{ q: L('How do I draw my field boundary correctly?', 'Dala chegarasini qanday to‘g‘ri chizaman?', 'Как правильно очертить границу поля?') }];
    return [{ q: L('Explain my water requirements', 'Suv talablarimni tushuntiring', 'Объясните мои потребности в воде') }];
  }
  return [
    { q: L('Help me find a field', 'Dala topishga yordam bering', 'Помогите найти поле') },
    { q: L('Show documented water infrastructure near a place I pick', 'Tanlagan joyim yaqinidagi hujjatlashtirilgan suv infratuzilmasini ko‘rsating', 'Покажите документированную водную инфраструктуру рядом с выбранным местом') },
  ];
}

export type CopilotAction = { type: string; latitude?: number; longitude?: number };

