import application from 'vinext/server/app-router-entry';
import science from './worker';
import {staticQueryPath} from './static-queries';
import {GET as waterData} from '../app/api/water-data/route';
import {GET as nearestWater} from '../app/api/water-data/nearest/route';
import {GET as weather} from '../app/api/weather/route';
import {NextRequest} from 'next/server';
import {POST as recommendation} from '../app/api/irrigation/recommendation/route';
import {POST as groundwater} from '../app/api/groundwater/route';
import {POST as soil} from '../app/api/soil-fertility/route';
import {POST as season} from '../app/api/irrigation/season/route';
import {GET as farmEvidence,POST as farmProfile} from '../app/api/farm-evidence/route';
import {POST as allocation} from '../app/api/irrigation/allocation/route';
import {initializeSoilGrid} from '../lib/soil-grid';
import {publicGuard,type PublicGuardEnv} from './public-guard';

initializeSoilGrid();
export {CopilotBudgetDO} from './copilot-budget-do';

const scientificRoutes: Record<string,(request:Request)=>Promise<Response>> = {
  '/api/irrigation/recommendation':recommendation,
  '/api/groundwater':groundwater,
  '/api/soil-fertility':soil,
  '/api/irrigation/season':season,
  '/api/farm-evidence':farmProfile,
  '/api/irrigation/allocation':allocation,
};

// Reuse the bounded API and refresh Worker; the rest is the full application.
export default {
  async fetch(request: Request,
    env: Parameters<typeof science.fetch>[1] & NonNullable<Parameters<typeof application.fetch>[1]> & PublicGuardEnv,
    ctx: Parameters<typeof science.fetch>[2]): Promise<Response> {
    const url = new URL(request.url);
    const blocked=await publicGuard(request,env);
    if(blocked)return blocked;
    const staticPath = request.method === 'GET' || request.method === 'HEAD' ? staticQueryPath(url) : null;
    if (staticPath && env.ASSETS) {
      const asset = await env.ASSETS.fetch(new Request(new URL(staticPath,url),request));
      if (asset.ok) return asset;
    }
    // Eagerly load the shared immutable dataset during isolate startup instead
    // of charging its lazy module initialization to the first farm request.
    if (request.method === 'GET' && url.pathname === '/api/water-data') return waterData(request);
    if (request.method === 'GET' && url.pathname === '/api/water-data/nearest') return nearestWater(request);
    if (request.method === 'GET' && url.pathname === '/api/farm-evidence') return farmEvidence(request);
    if (request.method === 'GET' && url.pathname === '/api/weather') return weather(new NextRequest(request));
    if (request.method === 'POST' && scientificRoutes[url.pathname]) return scientificRoutes[url.pathname](request);
    if (url.pathname === '/api/irrigation/investigate') {
      url.pathname='/api/copilot';
      return science.fetch(new Request(url,request),env,ctx);
    }
    if (url.pathname === '/api/data-refresh') {
      url.pathname = '/api/data-freshness';
      return science.fetch(new Request(url, request), env, ctx);
    }
    if (['/api/health', '/api/data-freshness', '/api/copilot',
      '/api/calculate/plan', '/api/calculate/schedule'].includes(url.pathname)) {
      return science.fetch(request, env, ctx);
    }
    return application.fetch(request, env, ctx);
  },
  scheduled: science.scheduled,
};
