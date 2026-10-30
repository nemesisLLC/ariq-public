type Daily = {time:string[];temperature_2m_max:(number|null)[];temperature_2m_min:(number|null)[];precipitation_sum:(number|null)[];rain_sum:number[];showers_sum:number[];et0_fao_evapotranspiration:number[]};
export type Forecast = {daily:Daily;units:Record<string,string>;timezone:string;latitude:number;longitude:number;retrievedAt:string;source:string};

export async function fetchWeather(lat:number,lon:number,fetcher:typeof fetch=fetch):Promise<Forecast>{
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Invalid forecast location.');
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({latitude:String(lat),longitude:String(lon),daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,showers_sum,et0_fao_evapotranspiration',timezone:'auto',forecast_days:'7'}).toString();
  const response=await fetcher(url,{signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!response.ok)throw new Error('Forecast source unavailable.');
  const data=await response.json();
  const daily=data.daily, units=data.daily_units;
  if(!daily||!Array.isArray(daily.time)||daily.time.length!==7||!daily.time.every((v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)))throw new Error('Incomplete forecast dates.');
  for(const key of ['rain_sum','showers_sum','et0_fao_evapotranspiration']){
    if(!Array.isArray(daily[key])||daily[key].length!==7||!daily[key].every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||units?.[key]!=='mm')throw new Error('Incomplete forecast water data or unsupported units.');
  }
  for(const key of ['temperature_2m_max','temperature_2m_min','precipitation_sum'])if(!Array.isArray(daily[key])||daily[key].length!==7||!daily[key].every((v:unknown)=>v===null||(typeof v==='number'&&Number.isFinite(v))))throw new Error('Incomplete forecast display data.');
  if(!Number.isFinite(data.latitude)||!Number.isFinite(data.longitude)||typeof data.timezone!=='string')throw new Error('Missing forecast grid metadata.');
  new Intl.DateTimeFormat('en',{timeZone:data.timezone});
  return {daily,units,timezone:data.timezone,latitude:data.latitude,longitude:data.longitude,retrievedAt:new Date().toISOString(),source:url.href};
}
