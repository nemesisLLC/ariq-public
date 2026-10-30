import type {Language} from '../../lib/i18n-labels';
export const local=(language:Language)=>(en:string,uz:string,ru:string)=>language==='uz'?uz:language==='ru'?ru:en;
export const UNKNOWN_LABELS:Record<string,[string,string,string]>={
 'groundwater.depthToWaterM':['Groundwater depth','Yer osti suvi chuqurligi','Глубина грунтовых вод'],
 'soil.initialDepletionMm':['Measured soil moisture','O‘lchangan tuproq namligi','Измеренная влажность почвы'],
 'water.supplyAndConnectivity':['Water supply and connection','Suv ta’minoti va ulanish','Подача воды и подключение'],
 'soil.labTest':['Laboratory soil test','Laboratoriya tuproq tahlili','Лабораторный анализ почвы'],
 'farm.areaHa':['Field area','Dala maydoni','Площадь поля'],
};
export const stageName=(id:string,language:Language)=>local(language)(...({initial:['Establishment','Unib chiqish','Начальная стадия'],development:['Development','Rivojlanish','Развитие'],mid:['Mid season','Mavsum o‘rtasi','Середина сезона'],late:['Late season','Mavsum oxiri','Конец сезона']} as Record<string,[string,string,string]>)[id]??[id,id,id]);
