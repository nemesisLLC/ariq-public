import type { CopilotContextSnapshot } from './context-bus';
import type { Language } from '../../lib/i18n-labels';

/** Workflow help is local: it works even when the model is unavailable. */
export function workflowGuide(c: CopilotContextSnapshot, language: Language) {
  const l = (en: string, uz: string, ru: string) => language === 'uz' ? uz : language === 'ru' ? ru : en;
  if (c.view !== 'farm') return {
    title: l('Start with your field', 'Dalangizdan boshlang', 'Начните со своего поля'),
    text: l('Choose “Find my field”, then search for your village or tap your land on the map.', '“Dalamni topish”ni tanlang, so‘ng qishlog‘ingizni qidiring yoki xaritada yeringizni bosing.', 'Нажмите «Найти моё поле», затем найдите своё село или выберите участок на карте.'),
    action: 'farm', button: l('Find my field', 'Dalamni topish', 'Найти моё поле'),
  };
  if (c.analysisStatus === 'loading') return { title: l('Checking your field', 'Dala tekshirilmoqda', 'Проверяем ваше поле'), text: l('ARIQ is checking the soil and weather. Your water outlook will appear here.', 'ARIQ tuproq va ob-havoni tekshirmoqda. Suv prognozi shu yerda ko‘rinadi.', 'ARIQ проверяет почву и погоду. Здесь появится прогноз потребности в воде.') };
  if (c.analysisStatus === 'error') return { title: l('Try the field check again', 'Dalani qayta tekshiring', 'Повторите проверку поля'), text: l('Your field is still here. Close this help and choose “Retry” to check again.', 'Dalangiz saqlangan. Yordamni yoping va “Qayta urinish”ni tanlang.', 'Поле сохранено. Закройте помощь и нажмите «Повторить».') };
  if (c.tool === 'futures') return { title: l('Try a different season', 'Boshqa mavsumni sinang', 'Попробуйте другой сезон'), text: l('Change one setting, then compare it with your current plan. These are estimates, not a harvest promise.', 'Bitta sozlamani o‘zgartiring va hozirgi reja bilan solishtiring. Bu hosil kafolati emas, taxmin.', 'Измените один параметр и сравните с текущим планом. Это оценка, а не обещание урожая.') };
  if (c.analysisStatus === 'ready') return { title: l('Read your water outlook', 'Suv prognozini ko‘ring', 'Посмотрите прогноз воды'), text: l('Start with crop water use and expected rain. Check your soil before deciding how much to irrigate.', 'Ekin suv sarfi va kutilayotgan yomg‘irdan boshlang. Sug‘orishdan oldin tuproqni tekshiring.', 'Посмотрите расход воды культурой и ожидаемые осадки. Проверьте почву, прежде чем решать, сколько поливать.') };
  if (c.step === 2) return { title: l('Choose your crop', 'Ekinni tanlang', 'Выберите культуру'), text: l('Choose what you grow and the date you planted it. Then choose “Understand my field”.', 'Ekin va ekish sanasini tanlang. So‘ng “Dalamni tushunish”ni bosing.', 'Выберите культуру и дату посева. Затем нажмите «Изучить моё поле».') };
  if (c.step === 1) return { title: l('Outline your field', 'Dala chegarasini belgilang', 'Обведите своё поле'), text: l('Choose the rectangle tool and mark two opposite corners, or use the polygon tool to mark each corner. Then confirm the boundary.', 'To‘rtburchak vositasida qarama-qarshi ikki burchakni yoki ko‘pburchak vositasida barcha burchaklarni belgilang. So‘ng chegarani tasdiqlang.', 'Выберите прямоугольник и отметьте два противоположных угла или многоугольник и отметьте все углы. Затем подтвердите границу.') };
  return { title: l('Find your land', 'Yeringizni toping', 'Найдите свой участок'), text: l('Search for your village or tap the map. You can also try the example farm first.', 'Qishlog‘ingizni qidiring yoki xaritani bosing. Avval namunaviy dalani ham sinashingiz mumkin.', 'Найдите своё село или нажмите на карту. Можно сначала попробовать пример поля.') };
}
