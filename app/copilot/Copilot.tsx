'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Language } from '../../lib/i18n-labels';
import type { UnitSystem } from '../../lib/units';
import { conversationStore, copilotUiStore, readCopilotContext, subscribeCopilotContext, type ChatTurn, type CopilotContextSnapshot } from './context-bus';
import './copilot.css';

export type CopilotAction = { type: string; latitude?: number; longitude?: number };

const STR = {
  en: { name: 'ARIQ Copilot', sub: 'Water intelligence assistant', open: 'Open ARIQ Copilot', close: 'Close', minimize: 'Minimize', restore: 'Restore', dock: 'Dock side', send: 'Send', ask: 'Ask about your land and water…', thinking: 'Working with ARIQ’s scientific tools…', unavailable: 'Copilot is temporarily unavailable. ARIQ’s calculators and atlas keep working.', budget: 'The Copilot usage budget is exhausted for now. ARIQ’s scientific tools remain available.', privacy: 'When you ask, the relevant field facts below are sent to Meta’s model. Numbers always come from ARIQ’s deterministic engines.', sending: 'Context sent to the model', inspect: 'Inspect underlying ARIQ results', tools: 'Tools used', suggestions: 'Suggested questions', disclaimer: 'Modelled estimates are labelled as modelled. Proximity to water never proves access or rights.' },
  uz: { name: 'ARIQ Copilot', sub: 'Suv intellekti yordamchisi', open: 'ARIQ Copilotni ochish', close: 'Yopish', minimize: 'Yig‘ish', restore: 'Tiklash', dock: 'Yon tomonga mahkamlash', send: 'Yuborish', ask: 'Yeringiz va suvingiz haqida so‘rang…', thinking: 'ARIQ ilmiy vositalari bilan ishlayapman…', unavailable: 'Copilot vaqtincha mavjud emas. ARIQ kalkulyatorlari va atlasi ishlashda davom etadi.', budget: 'Copilot byudjeti hozircha tugadi. ARIQ ilmiy vositalari mavjud.', privacy: 'Savol berganingizda, quyidagi dala ma’lumotlari Meta modeliga yuboriladi. Raqamlar doimo ARIQ deterministik dvigatellaridan olinadi.', sending: 'Modelga yuborilgan kontekst', inspect: 'ARIQ natijalarini ko‘rish', tools: 'Ishlatilgan vositalar', suggestions: 'Tavsiya etilgan savollar', disclaimer: 'Modellashtirilgan baholar shunday belgilanadi. Suvga yaqinlik huquq yoki foydalanishni isbotlamaydi.' },
  ru: { name: 'ARIQ Copilot', sub: 'Ассистент водного интеллекта', open: 'Открыть ARIQ Copilot', close: 'Закрыть', minimize: 'Свернуть', restore: 'Развернуть', dock: 'Закрепить сбоку', send: 'Отправить', ask: 'Спросите о вашей земле и воде…', thinking: 'Работаю с научными инструментами ARIQ…', unavailable: 'Copilot временно недоступен. Калькуляторы и атлас ARIQ продолжают работать.', budget: 'Бюджет Copilot на сейчас исчерпан. Научные инструменты ARIQ доступны.', privacy: 'Когда вы задаёте вопрос, приведённые ниже данные поля отправляются модели Meta. Числа всегда поступают из детерминированных движков ARIQ.', sending: 'Контекст, отправленный модели', inspect: 'Посмотреть исходные результаты ARIQ', tools: 'Использованные инструменты', suggestions: 'Предлагаемые вопросы', disclaimer: 'Модельные оценки помечены как модельные. Близость к воде не доказывает доступ или права.' },
} as const;

const SUGGESTIONS: Record<string, { en: string; uz: string; ru: string }[]> = {
  atlas: [
    { en: 'Help me find a field', uz: 'Dala topishga yordam bering', ru: 'Помогите найти поле' },
    { en: 'Show documented water infrastructure near a place I pick', uz: 'Tanlagan joyim yaqinidagi hujjatlashtirilgan suv infratuzilmasini ko‘rsating', ru: 'Покажите документированную водную инфраструктуру рядом с выбранным местом' },
    { en: 'Explain how ARIQ calculates irrigation needs', uz: 'ARIQ sug‘orish ehtiyojini qanday hisoblashini tushuntiring', ru: 'Объясните, как ARIQ рассчитывает потребность в поливе' },
  ],
  farm: [
    { en: 'Explain my water requirements', uz: 'Suv talablarimni tushuntiring', ru: 'Объясните мои потребности в воде' },
    { en: 'What is the biggest uncertainty in my field evidence?', uz: 'Dala dalillarimdagi eng katta noaniqlik nima?', ru: 'Какая главная неопределённость в данных моего поля?' },
    { en: 'When could my crop experience water stress?', uz: 'Ekinim qachon suv stressiga uchrashi mumkin?', ru: 'Когда моя культура может испытать водный стресс?' },
    { en: 'What happens during a drought with less irrigation supply?', uz: 'Sug‘orish suvi kamaysa, qurg‘oqchilikda nima bo‘ladi?', ru: 'Что будет в засуху при меньшем объёме полива?' },
  ],
};

type UiState = { x: number; y: number; w: number; h: number; dock: 'none' | 'left' | 'right'; minimized: boolean };
const UI_KEY = 'ariq-copilot-ui-v1';
const loadUi = (): UiState => { try { const raw = localStorage.getItem(UI_KEY); if (raw) return { x: 24, y: 90, w: 392, h: 560, dock: 'none', minimized: false, ...JSON.parse(raw) }; } catch {} return { x: 24, y: 90, w: 392, h: 560, dock: 'none', minimized: false }; };

export default function Copilot({ language, units, atlasContext, onAction }: {
  language: Language; units: UnitSystem;
  atlasContext: CopilotContextSnapshot;
  onAction?: (a: CopilotAction) => void;
}) {
  const s = STR[language];
  const bus = useSyncExternalStore(subscribeCopilotContext, readCopilotContext, readCopilotContext);
  const context: CopilotContextSnapshot = bus.view === 'atlas' ? { ...atlasContext } : { ...bus };
  const [open, setOpenState] = useState(copilotUiStore.open);
  const setOpen = (v: boolean) => { copilotUiStore.open = v; setOpenState(v); };
  const [ui, setUi] = useState<UiState>(loadUi);
  const [turns, setTurns] = useState<ChatTurn[]>(conversationStore.turns);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const [lastResults, setLastResults] = useState<unknown>(null);
  const [lastActions, setLastActions] = useState<CopilotAction[]>([]);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} }, [ui]);
  useEffect(() => { const openIt = () => setOpen(true); addEventListener('ariq-open-copilot', openIt); return () => removeEventListener('ariq-open-copilot', openIt); }, []);
  useEffect(() => { conversationStore.turns = turns; }, [turns]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [turns, busy, open]);
  useEffect(() => {
    if (!open || status !== 'unknown') return;
    fetch('/api/copilot').then(r => r.json()).then(j => setStatus(j.available ? 'available' : 'unavailable')).catch(() => setStatus('unavailable'));
  }, [open, status]);

  const suggestions = SUGGESTIONS[context.view === 'farm' ? 'farm' : 'atlas'];

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setDraft('');
    const history = turns.slice(-6).map(t => ({ role: t.role, text: t.text }));
    setTurns(t => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res = await fetch('/api/copilot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q, language, units, history,
          context: { latitude: context.latitude, longitude: context.longitude, cropId: context.cropId, plantingDate: context.plantingDate, areaHa: context.areaHa, view: context.view, step: context.step, hasBoundary: context.hasBoundary, region: context.region, soilBasis: context.soilBasis, tool: context.tool },
        }),
      });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (res.status === 503 || data?.kind === 'copilot-disabled') { setStatus('unavailable'); setTurns(t => [...t, { role: 'assistant', text: s.unavailable, unavailable: true }]); return; }
      if (res.status === 429 || data?.kind === 'copilot-budget-exhausted') { setTurns(t => [...t, { role: 'assistant', text: s.budget, unavailable: true }]); return; }
      if (!res.ok || !data) throw new Error('copilot');
      const ex = data.explanation as { title?: string; summary?: string; caveats?: string[] } | undefined;
      const trace = (data.trace as { tool?: string; status: string }[] | undefined)?.filter(t => t.tool && t.status === 'completed').map(t => t.tool!) ?? [];
      setLastResults(data.toolResults ?? null);
      setLastActions((data.actions as CopilotAction[] | undefined) ?? []);
      setTurns(t => [...t, { role: 'assistant', text: ex?.summary ?? 'ARIQ', title: ex?.title, caveats: ex?.caveats, tools: trace }]);
    } catch {
      setTurns(t => [...t, { role: 'assistant', text: s.unavailable, unavailable: true }]);
    } finally { setBusy(false); }
  }, [busy, turns, language, units, context, s]);

  if (!open) return <button className="copilot-launcher" onClick={() => setOpen(true)} aria-label={s.open}><svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 5 11 12 6-12 5-5 12-5-12-12-5 12-6Z" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M20 11v18M11 20h18" stroke="currentColor" strokeWidth="1.2" /></svg><span>{s.name}</span><i aria-hidden="true" /></button>;

  const panelStyle = ui.dock === 'none' ? { left: ui.x, top: ui.y, width: ui.w, height: ui.minimized ? undefined : ui.h } : undefined;
  return <section className={`copilot-panel dock-${ui.dock} ${ui.minimized ? 'is-min' : ''}`} style={panelStyle} aria-label={s.name}>
    <header
      onPointerDown={e => { if (ui.dock !== 'none' || (e.target as HTMLElement).closest('button')) return; drag.current = { dx: e.clientX - ui.x, dy: e.clientY - ui.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!drag.current) return; setUi(u => ({ ...u, x: Math.min(Math.max(8, e.clientX - drag.current!.dx), innerWidth - 120), y: Math.min(Math.max(8, e.clientY - drag.current!.dy), innerHeight - 60) })); }}
      onPointerUp={() => { drag.current = null; }}
    >
      <div className="copilot-id"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 5 11 12 6-12 5-5 12-5-12-12-5 12-6Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg><div><strong>{s.name}</strong><small>{s.sub}</small></div><i className={status === 'available' ? 'on' : ''} aria-hidden="true" /></div>
      <div className="copilot-win">
        <button aria-label={s.dock} onClick={() => setUi(u => ({ ...u, dock: u.dock === 'right' ? 'left' : u.dock === 'left' ? 'none' : 'right' }))}>⇋</button>
        <button aria-label={ui.minimized ? s.restore : s.minimize} onClick={() => setUi(u => ({ ...u, minimized: !u.minimized }))}>{ui.minimized ? '▢' : '—'}</button>
        <button aria-label={s.close} onClick={() => setOpen(false)}>×</button>
      </div>
    </header>
    {!ui.minimized && <>
      <p className="copilot-privacy">{s.privacy}</p>
      <div className="copilot-context" aria-label={s.sending}>{[context.view, context.region, context.cropId, context.plantingDate, context.hasBoundary ? 'boundary ✓' : null, context.tool].filter(Boolean).join(' · ') || context.view}</div>
      <div className="copilot-scroll" ref={scrollRef}>
        {turns.length === 0 && <div className="copilot-suggest"><span>{s.suggestions}</span>{suggestions.map(q => <button key={q.en} onClick={() => void send(q[language])}>{q[language]}</button>)}</div>}
        {turns.map((t, i) => <article key={i} className={`copilot-turn ${t.role}`}>
          {t.title && <strong>{t.title}</strong>}
          <p>{t.text}</p>
          {t.tools && t.tools.length > 0 && <small>{s.tools}: {t.tools.join(', ')}</small>}
          {t.caveats?.map(c => <small key={c} className="copilot-caveat">{c}</small>)}
        </article>)}
        {busy && <p className="copilot-thinking" role="status">{s.thinking}</p>}
        {lastActions.length > 0 && <div className="copilot-actions">{lastActions.filter(a => a.type === 'flyToLocation').map((a, i) => <button key={i} onClick={() => onAction?.(a)}>◎ {language === 'uz' ? 'Xaritada ko‘rsatish' : language === 'ru' ? 'Показать на карте' : 'Show on map'}</button>)}</div>}
        {lastResults != null && <details className="copilot-inspect"><summary>{s.inspect}</summary><pre>{JSON.stringify(lastResults, null, 2).slice(0, 6000)}</pre></details>}
      </div>
      <p className="copilot-disclaimer">{s.disclaimer}</p>
      <form className="copilot-form" onSubmit={e => { e.preventDefault(); void send(draft); }}>
        <label className="sr-only" htmlFor="copilot-q">{s.ask}</label>
        <input id="copilot-q" value={draft} onChange={e => setDraft(e.target.value)} placeholder={s.ask} maxLength={1000} />
        <button type="submit" disabled={busy || !draft.trim()}>{s.send}</button>
      </form>
      <div className="copilot-resize" aria-hidden="true"
        onPointerDown={e => { resize.current = { x: e.clientX, y: e.clientY, w: ui.w, h: ui.h }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!resize.current) return; setUi(u => ({ ...u, w: Math.min(680, Math.max(320, resize.current!.w + e.clientX - resize.current!.x)), h: Math.min(760, Math.max(360, resize.current!.h + e.clientY - resize.current!.y)) })); }}
        onPointerUp={() => { resize.current = null; }} />
    </>}
  </section>;
}
