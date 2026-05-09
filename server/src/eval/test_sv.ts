import { fetchStreetViewFacing, getStreetViewMetadata } from '../lib/streetview.ts';

const SPRING_TX = { lat: 30.0418892, lng: -95.5006362 };
const HOUSTON = { lat: 29.8603157, lng: -95.59039589999999 };

console.log('=== Spring TX metadata ===');
console.log(JSON.stringify(await getStreetViewMetadata(SPRING_TX.lat, SPRING_TX.lng, 80), null, 2));

console.log('=== Houston metadata (cul-de-sac, expect ZERO_RESULTS) ===');
console.log(JSON.stringify(await getStreetViewMetadata(HOUSTON.lat, HOUSTON.lng, 100), null, 2));

console.log('=== Spring TX fetch with image ===');
const sv = await fetchStreetViewFacing({ buildingLat: SPRING_TX.lat, buildingLng: SPRING_TX.lng });
if (sv) {
  console.log('OK', { heading: sv.heading.toFixed(1), date: sv.imageryDate, distance: sv.panoDistanceM.toFixed(1), bytes: sv.pngBytes.byteLength });
} else {
  console.log('null returned');
}
