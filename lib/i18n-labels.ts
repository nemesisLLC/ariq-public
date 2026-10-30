/**
 * Stable machine-readable identifiers with en/uz/ru display labels (Feature 5).
 * Simulations emit ids (crop ids, metric ids, warning codes); rendering code
 * localizes through this table. Language choice never affects calculations.
 */
export type Language = 'en' | 'uz' | 'ru';
export const LABELS: Record<string, Record<Language, string>> = {
  'crop.cotton': { en: 'Cotton', uz: 'Paxta', ru: 'Хлопчатник' },
  'crop.winter-wheat': { en: 'Winter wheat', uz: 'Kuzgi bug‘doy', ru: 'Озимая пшеница' },
  'crop.maize': { en: 'Maize (grain)', uz: 'Makkajo‘xori (don)', ru: 'Кукуруза (зерно)' },
  'crop.alfalfa': { en: 'Alfalfa', uz: 'Beda', ru: 'Люцерна' },
  'crop.tomato': { en: 'Tomato', uz: 'Pomidor', ru: 'Томат' },
  'crop.potato': { en: 'Potato', uz: 'Kartoshka', ru: 'Картофель' },
  'crop.sunflower': { en: 'Sunflower', uz: 'Kungaboqar', ru: 'Подсолнечник' },
  'crop.melon': { en: 'Melon', uz: 'Qovun', ru: 'Дыня' },
  'metric.etCropMm': { en: 'Seasonal crop water demand (mm)', uz: 'Mavsumiy ekin suv talabi (mm)', ru: 'Сезонная потребность культуры в воде (мм)' },
  'metric.irrigationGrossM3': { en: 'Irrigation water required at field gate (m3)', uz: 'Dala darvozasida talab qilinadigan sug‘orish suvi (m3)', ru: 'Требуемая вода у поля (м3)' },
  'metric.relativeYieldRetained': { en: 'Relative potential yield retained (water only)', uz: 'Saqlanib qolgan nisbiy potensial hosil (faqat suv)', ru: 'Сохранившийся относительный потенциальный урожай (только вода)' },
  'metric.relativeYieldLost': { en: 'Relative yield lost to water stress', uz: 'Suv stressidan yo‘qotilgan nisbiy hosil', ru: 'Относительные потери урожая от водного стресса' },
  'metric.stressDays': { en: 'Water-stress days', uz: 'Suv stressi kunlari', ru: 'Дни водного стресса' },
  'warning.water-only-yield-impact': { en: 'Yield impact covers water only; nutrients, disease, pests, salinity and heat damage are excluded.', uz: 'Hosil ta‘siri faqat suvga tegishli; ozuqa, kasallik, zararkunanda, sho‘rlanish va issiqlik zarari hisobga olinmagan.', ru: 'Влияние на урожай учитывает только воду; питание, болезни, вредители, засоление и тепловой ущерб исключены.' },
  'warning.illustrative-soil-preset': { en: 'Illustrative reference soil used; it does not describe this field.', uz: 'Namunaviy ma‘lumot tuproq ishlatilgan; u shu dalani tavsiflamaydi.', ru: 'Использована иллюстративная справочная почва; она не описывает это поле.' },
  'warning.historical-analog-not-forecast': { en: 'Weather beyond the short forecast is a historical analog scenario, not a long-range forecast.', uz: 'Qisqa prognozdan keyingi ob-havo tarixiy analog ssenariy; uzoq muddatli prognoz emas.', ru: 'Погода за пределами краткого прогноза — исторический аналоговый сценарий, а не долгосрочный прогноз.' },
  'warning.supply-unconstrained-assumption': { en: 'No season supply limit was supplied; irrigation assumes water is available when due.', uz: 'Mavsumiy suv limiti berilmagan; sug‘orish kerak bo‘lganda suv bor deb hisoblanadi.', ru: 'Лимит сезонного водоснабжения не задан; предполагается, что вода доступна при необходимости.' },
  'warning.temperature-via-et0-factor-simplified': { en: 'Temperature change is represented by a simplified ET0 sensitivity factor, not a Penman-Monteith recalculation.', uz: 'Harorat o‘zgarishi soddalashtirilgan ET0 sezgirlik omili bilan ifodalangan; Penman-Monteith qayta hisobi emas.', ru: 'Изменение температуры представлено упрощённым фактором чувствительности ET0, а не пересчётом Пенмана-Монтейта.' },
  'scenario.baseline': { en: 'Baseline', uz: 'Bazaviy', ru: 'Базовый' },
  'scenario.modified': { en: 'Modified', uz: 'O‘zgartirilgan', ru: 'Изменённый' },
};
export function label(id: string, language: Language): string {
  return LABELS[id]?.[language] ?? id;
}
