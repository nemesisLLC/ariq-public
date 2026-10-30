import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseSearchCoordinates,searchPlaces,type Settlement} from '../app/atlas/placeSearch.ts';
import {recommendationInput,parseFarm} from '../app/atlas/workspace.ts';
const places=JSON.parse(fs.readFileSync(new URL('../public/data/uzbekistan-places.json',import.meta.url),'utf8').replace(/^\uFEFF/,'')).places as Settlement[];
test('local settlement search resolves alternate spellings to actual GeoNames coordinates',()=>{
 const english=searchPlaces(places,'Samarkand')[0],uzbek=searchPlaces(places,'Samarqand')[0],russian=searchPlaces(places,'Самарканд')[0];
 assert.equal(english.id,uzbek.id);assert.equal(english.id,russian.id);assert.ok(Math.abs(english.lat-39.65)<.02);assert.ok(Math.abs(english.lon-66.97)<.02);assert.ok(searchPlaces(places,'Payariq').length>0);assert.deepEqual(searchPlaces(places,'not-a-real-village-xyz'),[]);
});
test('coordinate search has explicit latitude longitude order and rejects out-of-coverage locations',()=>{
 assert.deepEqual(parseSearchCoordinates('39.725, 66.915'),[66.915,39.725]);assert.equal(parseSearchCoordinates('66.915,39.725'),null);assert.equal(parseSearchCoordinates('NaN, Infinity'),null);assert.equal(parseSearchCoordinates('12, 30'),null);
});
test('drawn field request preserves coordinates and omits unknown scientific inputs',()=>{
 const farm=parseFarm({version:1,name:'test',cropId:'winter-wheat',plantingDate:'2026-10-01',boundary:[[66.915,39.725],[66.916,39.725],[66.916,39.726],[66.915,39.726]]});
 const input=recommendationInput(farm);assert.ok(input.areaHa>.94&&input.areaHa<.97);assert.ok(input.latitude>39.725&&input.latitude<39.726);assert.ok(input.longitude>66.915&&input.longitude<66.916);assert.equal('soil' in input,false);assert.equal('applicationEfficiency' in input,false);assert.equal(input.plantingDate,'2026-10-01');
});
