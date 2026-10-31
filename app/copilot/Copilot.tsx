'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Language } from '../../lib/i18n-labels';
import type { UnitSystem } from '../../lib/units';
import { conversationStore, copilotUiStore, readCopilotContext, subscribeCopilotContext, type ChatTurn, type CopilotContextSnapshot } from './context-bus';
import { buildCards, proactiveSuggestions } from './cards';
import { fitWindow, type UiState } from './window';
import { workflowGuide } from './guide';
import { useFormat } from '../atlas/ui';
import './copilot.css';

const STR = {
  en: { name: 'ARIQ Copilot', sub: 'Water intelligence assistant', open: 'Open ARIQ Copilot', close: 'Close', minimize: 'Minimize', restore: 'Restore', dock: 'Dock side', send: 'Send', ask: 'Ask about your land and water…', thinking: 'Working with ARIQ’s scientific tools…', unavailable: 'Copilot is temporarily unavailable. ARIQ’s calculators and atlas keep working.', budget: 'The Copilot usage budget is exhausted for now. ARIQ’s scientific tools remain available.', privacy: 'When you ask, the relevant field facts below are sent to Meta’s model. Numbers always come from ARIQ’s deterministic engines.', sending: 'Context sent to the model', inspect: 'Advanced details (developer)', tools: 'Tools used', suggestions: 'Suggested questions', disclaimer: 'Modelled estimates are labelled as modelled. Proximity to water never proves access or rights.' },
  uz: { name: 'ARIQ Copilot', sub: 'Suv intellekti yordamchisi', open: 'ARIQ Copilotni ochish', close: 'Yopish', minimize: 'Yig‘ish', restore: 'Tiklash', dock: 'Yon tomonga mahkamlash', send: 'Yuborish', ask: 'Yeringiz va suvingiz haqida so‘rang…', thinking: 'ARIQ ilmiy vositalari bilan ishlayapman…', unavailable: 'Copilot vaqtincha mavjud emas. ARIQ kalkulyatorlari va atlasi ishlashda davom etadi.', budget: 'Copilot byudjeti hozircha tugadi. ARIQ ilmiy vositalari mavjud.', privacy: 'Savol berganingizda, quyidagi dala ma’lumotlari Meta modeliga yuboriladi. Raqamlar doimo ARIQ deterministik dvigatellaridan olinadi.', sending: 'Modelga yuborilgan kontekst', inspect: 'Kengaytirilgan tafsilotlar (dasturchi)', tools: 'Ishlatilgan vositalar', suggestions: 'Tavsiya etilgan savollar', disclaimer: 'Modellashtirilgan baholar shunday belgilanadi. Suvga yaqinlik huquq yoki foydalanishni isbotlamaydi.' },
  ru: { name: 'ARIQ Copilot', sub: 'Ассистент водного интеллекта', open: 'Открыть ARIQ Copilot', close: 'Закрыть', minimize: 'Свернуть', restore: 'Развернуть', dock: 'Закрепить сбоку', send: 'Отправить', ask: 'Спросите о вашей земле и воде…', thinking: 'Работаю с научными инструментами ARIQ…', unavailable: 'Copilot временно недоступен. Калькуляторы и атлас ARIQ продолжают работать.', budget: 'Бюджет Copilot на сейчас исчерпан. Научные инструменты ARIQ доступны.', privacy: 'Когда вы задаёте вопрос, приведённые ниже данные поля отправляются модели Meta. Числа всегда поступают из детерминированных движков ARIQ.', sending: 'Контекст, отправленный модели', inspect: 'Дополнительно (для разработчика)', tools: 'Использованные инструменты', suggestions: 'Предлагаемые вопросы', disclaimer: 'Модельные оценки помечены как модельные. Близость к воде не доказывает доступ или права.' },
} as const;

const UI_KEY = 'ariq-copilot-ui-v1';
const loadUi = (): UiState => { let saved: unknown; try { saved = JSON.parse(localStorage.getItem(UI_KEY) ?? 'null'); } catch {} return fitWindow(saved, innerWidth, innerHeight); };

export default function Copilot({ language, units, atlasContext, onAction }: {
  language: Language; units: UnitSystem;
  atlasContext: CopilotContextSnapshot;
  onAction?: (a: { type: string; latitude?: number; longitude?: number }) => void;
}) {
  const s = STR[language];
  const bus = useSyncExternalStore(subscribeCopilotContext, readCopilotContext, readCopilotContext);
  const context: CopilotContextSnapshot = bus.view === 'atlas' ? { ...atlasContext } : { ...bus };
  const format = useFormat(language, context.units ?? units);
  const [open, setOpenState] = useState(copilotUiStore.open);
  const setOpen = (v: boolean) => { copilotUiStore.open = v; setOpenState(v); };
  const [ui, setUi] = useState<UiState>(loadUi);
  const [turns, setTurns] = useState<ChatTurn[]>(conversationStore.turns);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null), launcherRef = useRef<HTMLButtonElement>(null), sending = useRef(false);

  useEffect(() => {
    const fit = () => setUi(u => fitWindow(u, innerWidth, innerHeight));
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  useEffect(() => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} }, [ui]);
  useEffect(() => { const openIt = () => setOpen(true); addEventListener('ariq-open-copilot', openIt); return () => removeEventListener('ariq-open-copilot', openIt); }, []);
  useEffect(() => { conversationStore.turns = turns; }, [turns]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [turns, busy, open]);
  useEffect(() => {
    if (!open || status !== 'unknown') return;
    fetch('/api/copilot').then(r => r.json()).then(j => setStatus(j.available ? 'available' : 'unavailable')).catch(() => setStatus('unavailable'));
  }, [open, status]);

  const suggestions = proactiveSuggestions(context, language);
  const guide = workflowGuide(context, language);
  const local = (en: string, uz: string, ru: string) => language === 'uz' ? uz : language === 'ru' ? ru : en;
  const ctxLabel = [context.view === 'farm' ? (context.region ?? 'farm') : 'atlas', context.cropId].filter(Boolean).join(' · ');
  const sig = `${context.view}|${context.step ?? ''}|${context.tool ?? ''}|${context.analysisStatus ?? ''}|${context.cropId ?? ''}|${context.hasBoundary ? 1 : 0}`;
  const [dismissedSig, setDismissedSig] = useState('');

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || sending.current) return;
    sending.current = true;
    setDraft('');
    const history = turns.slice(-6).map(t => ({ role: t.role, text: t.text.slice(0, 1000) }));
    setTurns(t => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res = await fetch('/api/copilot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q, language, units: context.units ?? units, history,
          context: { latitude: context.latitude, longitude: context.longitude, cropId: context.cropId, plantingDate: context.plantingDate, areaHa: context.areaHa, view: context.view, step: context.step, hasBoundary: context.hasBoundary, region: context.region, soilBasis: context.soilBasis, tool: context.tool },
        }),
      });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (res.status === 503 || data?.kind === 'copilot-disabled') { setStatus('unavailable'); setTurns(t => [...t, { role: 'assistant', text: s.unavailable, unavailable: true }]); return; }
      if (res.status === 429 || data?.kind === 'copilot-budget-exhausted') { setTurns(t => [...t, { role: 'assistant', text: s.budget, unavailable: true }]); return; }
      if (!res.ok || !data) throw new Error('copilot');
      const ex = data.explanation as { title?: string; summary?: string; caveats?: string[] } | undefined;
      const trace = (data.trace as { tool?: string; status: string }[] | undefined)?.filter(t => t.tool && t.status === 'completed').map(t => t.tool!) ?? [];
      const actions = (data.actions as ChatTurn['actions']) ?? [];
      setTurns(t => [...t, { role: 'assistant', text: ex?.summary ?? 'ARIQ', title: ex?.title, caveats: ex?.caveats, tools: trace, cards: buildCards(data.toolResults, language), actions, ctx: ctxLabel }]);
    } catch {
      setTurns(t => [...t, { role: 'assistant', text: s.unavailable, unavailable: true }]);
    } finally { sending.current = false; setBusy(false); }
  }, [busy, turns, language, units, context, s, ctxLabel]);

  const close = () => { setOpen(false); requestAnimationFrame(() => launcherRef.current?.focus()); };
  if (!open) return <button ref={launcherRef} className="copilot-launcher" onClick={() => setOpen(true)} aria-label={s.open}><svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 5 11 12 6-12 5-5 12-5-12-12-5 12-6Z" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M20 11v18M11 20h18" stroke="currentColor" strokeWidth="1.2" /></svg><span>{local('Help with this step', 'Shu bosqichda yordam', 'Помощь на этом шаге')}</span></button>;

  const panelStyle = ui.dock === 'none' ? { left: ui.x, top: ui.y, width: ui.w, height: ui.minimized ? undefined : ui.h } : undefined;
  return <section ref={panelRef} tabIndex={-1} className={`copilot-panel dock-${ui.dock} ${ui.minimized ? 'is-min' : ''}`} style={panelStyle} aria-label={s.name} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
    <header
      onPointerDown={e => { if (ui.dock !== 'none' || (e.target as HTMLElement).closest('button')) return; drag.current = { dx: e.clientX - ui.x, dy: e.clientY - ui.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!drag.current) return; setUi(u => fitWindow({ ...u, x: e.clientX - drag.current!.dx, y: e.clientY - drag.current!.dy }, innerWidth, innerHeight)); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <div className="copilot-id"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 5 11 12 6-12 5-5 12-5-12-12-5 12-6Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg><div><strong>{s.name}</strong><small>{s.sub}</small></div><i className={status === 'available' ? 'on' : ''} aria-hidden="true" /></div>
      <div className="copilot-win">
        <button aria-label={s.dock} onClick={() => setUi(u => ({ ...u, dock: u.dock === 'right' ? 'left' : u.dock === 'left' ? 'none' : 'right' }))}>⇋</button>
        <button aria-label={ui.minimized ? s.restore : s.minimize} onClick={() => setUi(u => ({ ...u, minimized: !u.minimized }))}>{ui.minimized ? '▢' : '—'}</button>
        <button aria-label={s.close} onClick={close}>×</button>
      </div>
    </header>
    {!ui.minimized && <>
      <div className="copilot-guide" aria-live="polite"><strong>{guide.title}</strong><p>{guide.text}</p>{guide.action && <button onClick={() => { dispatchEvent(new CustomEvent('ariq-open-tool', { detail: { tool: guide.action } })); close(); }}>{guide.button}</button>}</div>
      <div className="copilot-scroll" ref={scrollRef} role="log" aria-label={s.name} aria-busy={busy}>
        {dismissedSig !== sig && <details className="copilot-suggest"><summary>{s.suggestions}</summary><button className="copilot-dismiss" aria-label={local('Hide suggestions', 'Tavsiyalarni yashirish', 'Скрыть подсказки')} onClick={() => setDismissedSig(sig)}>×</button>{suggestions.map(sg => <button key={sg.q} disabled={busy && !sg.action} onClick={() => { if (sg.action) { dispatchEvent(new CustomEvent('ariq-open-tool', { detail: { tool: sg.action } })); close(); } else void send(sg.q); }}>{sg.q}</button>)}</details>}
        {turns.map((t, i) => <div key={i} className={`copilot-entry ${t.role}`}>
          {t.ctx && i > 0 && turns[i - 1].ctx !== t.ctx && <div className="copilot-ctx-divider">{t.ctx}</div>}
          <article className={`copilot-turn ${t.role}`}>
          {t.title && <strong>{t.title}</strong>}
          <p>{t.text}</p>
          {t.cards?.map((c, j) => c.kind === 'waterway'
            ? <div key={j} className="copilot-card"><strong>{c.name}</strong><small>{c.type}{c.distanceKm !== undefined ? ` · ${c.distanceKm.toFixed(2)} km` : ''}{c.region ? ` · ${c.region}` : ''}</small></div>
            : c.kind === 'demand'
              ? <div key={j} className="copilot-card"><strong>{local('Estimated water needs', 'Taxminiy suv talabi', 'Оценка потребности в воде')}</strong>{c.etCropMm !== undefined && <small>{local('Crop water use', 'Ekin suv sarfi', 'Расход воды культурой')}: {format.depth(c.etCropMm)}</small>}{c.deficitMm !== undefined && <small>{local('Water use minus useful rain', 'Suv sarfi va foydali yomg‘ir farqi', 'Расход за вычетом полезных осадков')}: {format.depth(c.deficitMm)}</small>}{c.stressDate && <small>{local('Soil may get too dry from', 'Tuproq qurishi mumkin bo‘lgan sana', 'Почва может стать слишком сухой с')}: {format.date(c.stressDate)}</small>}{c.missing && c.missing.length > 0 && <small>{local('More field details are needed for a watering plan.', 'Sug‘orish rejasi uchun dala haqida qo‘shimcha ma’lumot kerak.', 'Для плана полива нужны дополнительные данные о поле.')}</small>}</div>
              : <div key={j} className="copilot-card scenario"><strong>{c.label}</strong>{c.retainedPct !== undefined && <span className="copilot-pct">{c.retainedPct}%</span>}{c.note && <small>{c.note}</small>}</div>)}
          {t.actions?.some(a => ['flyToLocation', 'highlightWaterSources', 'showScenarioComparison', 'displayYieldImpact', 'animateSeasonTimeline', 'displayForecast'].includes(a.type)) && <div className="copilot-actions">
            {t.actions.filter(a => a.type === 'flyToLocation').map((a, j) => <button key={`f${j}`} onClick={() => onAction?.(a)}>◎ {language === 'uz' ? 'Xaritada ko‘rsatish' : language === 'ru' ? 'Показать на карте' : 'Show on map'}</button>)}
            {t.actions.filter(a => a.type === 'highlightWaterSources').map((a, j) => <button key={`h${j}`} onClick={() => { const f = a.features?.[0]; if (f) onAction?.({ type: 'flyToLocation', longitude: f.coordinates[0], latitude: f.coordinates[1] }); }}>◎ {language === 'uz' ? 'Suv manbaini belgilash' : language === 'ru' ? 'Выделить источник воды' : 'Highlight water source'}</button>)}
            {t.actions.some(a => ['showScenarioComparison', 'displayYieldImpact', 'animateSeasonTimeline'].includes(a.type)) && <button onClick={() => dispatchEvent(new CustomEvent('ariq-open-tool', { detail: { tool: 'futures' } }))}>↗ {language === 'uz' ? 'Water Futures’da ochish' : language === 'ru' ? 'Открыть в Water Futures' : 'Open in Water Futures'}</button>}
            {t.actions.some(a => a.type === 'displayForecast') && <button onClick={() => dispatchEvent(new CustomEvent('ariq-open-tool', { detail: { tool: null } }))}>↗ {language === 'uz' ? 'Dala tahlilini ko‘rish' : language === 'ru' ? 'Посмотреть анализ поля' : 'View field analysis'}</button>}
          </div>}
          {t.tools && t.tools.length > 0 && <details className="copilot-inspect"><summary>{s.tools}</summary><small>{t.tools.join(', ')}</small></details>}
          {t.caveats?.map(c => <small key={c} className="copilot-caveat">{c}</small>)}
          </article>
        </div>)}
        {busy && <p className="copilot-thinking" role="status">{s.thinking}</p>}
      </div>
      <details className="copilot-sharing"><summary>{local('Before you ask', 'Savol berishdan oldin', 'Перед вопросом')}</summary><p>{s.privacy}</p><p>{local('Shared field facts', 'Yuboriladigan dala ma’lumotlari', 'Передаваемые данные поля')}: {[context.region, context.cropId, context.plantingDate, context.latitude != null && context.longitude != null ? `${context.latitude}, ${context.longitude}` : null, context.areaHa != null ? `${context.areaHa} ha` : null].filter(Boolean).join(' · ') || local('No field selected', 'Dala tanlanmagan', 'Поле не выбрано')}</p><p>{s.disclaimer}</p></details>
      <form className="copilot-form" onSubmit={e => { e.preventDefault(); void send(draft); }}>
        <label className="sr-only" htmlFor="copilot-q">{s.ask}</label>
        <input id="copilot-q" name="question" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value)} placeholder={s.ask} maxLength={1000} />
        <button type="submit" disabled={busy || !draft.trim()}>{s.send}</button>
      </form>
      <div className="copilot-resize" aria-hidden="true"
        onPointerDown={e => { resize.current = { x: e.clientX, y: e.clientY, w: ui.w, h: ui.h }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!resize.current) return; setUi(u => fitWindow({ ...u, w: resize.current!.w + e.clientX - resize.current!.x, h: resize.current!.h + e.clientY - resize.current!.y }, innerWidth, innerHeight)); }}
        onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }} />
    </>}
  </section>;
}
