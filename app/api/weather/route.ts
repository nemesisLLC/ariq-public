import {NextRequest,NextResponse} from 'next/server';
import {fetchWeather} from '../../../lib/weather';
export async function GET(request:NextRequest){
 const lat=Number(request.nextUrl.searchParams.get('lat')),lon=Number(request.nextUrl.searchParams.get('lon'));
 if(!request.nextUrl.searchParams.has('lat')||!request.nextUrl.searchParams.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return NextResponse.json({error:'Select a valid location.'},{status:400});
 try{
  return NextResponse.json(await fetchWeather(lat,lon));
 }catch{return NextResponse.json({error:'The weather source could not be reached. Retry to request a fresh forecast.'},{status:502});}
}
