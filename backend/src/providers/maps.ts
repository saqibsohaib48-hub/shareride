import { encodePolyline, haversineMeters, LatLng, Place } from '@share-ride/shared';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface RouteResult {
  distanceMeters: number;   // ROAD distance (driving)
  durationSeconds: number;
  polyline: string;         // encoded, precision 5
  provider: 'google' | 'mapbox' | 'mock';
  approximate: boolean;     // true only for the dev mock
}

export interface MapsProvider {
  route(origin: LatLng, destination: LatLng): Promise<RouteResult>;
  searchPlaces(query: string, countryCode?: string, near?: LatLng): Promise<Place[]>;
}

const mapsUnavailable = () => new AppError(502, 'MAPS_UNAVAILABLE', "We couldn't calculate the route right now. Please try again.");

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    logger.warn({ status: res.status, url: url.replace(/(key|access_token)=[^&]+/, '$1=***') }, 'maps provider error');
    throw mapsUnavailable();
  }
  return res.json();
}

/** Google Maps Platform — Routes API (driving distance) + Places API (New) text search. */
class GoogleMaps implements MapsProvider {
  constructor(private key: string) {}
  async route(o: LatLng, d: LatLng): Promise<RouteResult> {
    const data = await fetchJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
        destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
    });
    const r = data.routes?.[0];
    if (!r) throw new AppError(422, 'NO_ROUTE', 'No driving route was found between these locations.');
    return {
      distanceMeters: r.distanceMeters,
      durationSeconds: parseInt(String(r.duration).replace('s', ''), 10),
      polyline: r.polyline.encodedPolyline,
      provider: 'google',
      approximate: false,
    };
  }
  async searchPlaces(query: string, countryCode?: string, near?: LatLng): Promise<Place[]> {
    const data = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: query,
        regionCode: countryCode,
        pageSize: 6,
        ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {}),
      }),
    });
    return (data.places ?? []).map((p: any) => ({
      name: p.displayName?.text ?? p.formattedAddress,
      lat: p.location.latitude,
      lng: p.location.longitude,
      placeId: p.id,
    }));
  }
}

/** Mapbox — Directions API (driving) + Geocoding v6. */
class MapboxMaps implements MapsProvider {
  constructor(private token: string) {}
  async route(o: LatLng, d: LatLng): Promise<RouteResult> {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${o.lng},${o.lat};${d.lng},${d.lat}?geometries=polyline&overview=full&access_token=${this.token}`;
    const data = await fetchJson(url);
    const r = data.routes?.[0];
    if (!r) throw new AppError(422, 'NO_ROUTE', 'No driving route was found between these locations.');
    return { distanceMeters: Math.round(r.distance), durationSeconds: Math.round(r.duration), polyline: r.geometry, provider: 'mapbox', approximate: false };
  }
  async searchPlaces(query: string, countryCode?: string, near?: LatLng): Promise<Place[]> {
    const params = new URLSearchParams({ q: query, limit: '6', access_token: this.token });
    if (countryCode) params.set('country', countryCode.toLowerCase());
    if (near) params.set('proximity', `${near.lng},${near.lat}`);
    const data = await fetchJson(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
    return (data.features ?? []).map((f: any) => ({
      name: f.properties.full_address ?? f.properties.name,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      placeId: f.properties.mapbox_id,
    }));
  }
}

/**
 * DEV/TEST ONLY. Approximates road distance as straight-line × 1.25 and is flagged `approximate`.
 * Refused in production by config.ts — real pricing must use road distance.
 */
export const MOCK_PLACES: (Place & { country: string })[] = [
  { name: 'Dubai Marina, Dubai', lat: 25.0805, lng: 55.1403, country: 'AE' },
  { name: 'JLT, Dubai', lat: 25.0693, lng: 55.1413, country: 'AE' },
  { name: 'Downtown Dubai', lat: 25.1972, lng: 55.2744, country: 'AE' },
  { name: 'Deira, Dubai', lat: 25.2697, lng: 55.3095, country: 'AE' },
  { name: 'Dubai International Airport (DXB)', lat: 25.2532, lng: 55.3657, country: 'AE' },
  { name: 'Abu Dhabi Corniche', lat: 24.4764, lng: 54.3473, country: 'AE' },
  { name: 'Yas Island, Abu Dhabi', lat: 24.4889, lng: 54.6081, country: 'AE' },
  { name: 'Sharjah City Centre', lat: 25.3463, lng: 55.4209, country: 'AE' },
  { name: 'Ajman Corniche', lat: 25.4052, lng: 55.5136, country: 'AE' },
  { name: 'Ras Al Khaimah', lat: 25.8007, lng: 55.9762, country: 'AE' },
  { name: 'Al Ain', lat: 24.2075, lng: 55.7447, country: 'AE' },
  { name: 'Manhattan, New York', lat: 40.7831, lng: -73.9712, country: 'US' },
  { name: 'Philadelphia, PA', lat: 39.9526, lng: -75.1652, country: 'US' },
  { name: 'Boston, MA', lat: 42.3601, lng: -71.0589, country: 'US' },
  { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194, country: 'US' },
  { name: 'San Jose, CA', lat: 37.3382, lng: -121.8863, country: 'US' },
  { name: 'King\'s Cross, London', lat: 51.5308, lng: -0.1238, country: 'GB' },
  { name: 'Oxford', lat: 51.752, lng: -1.2577, country: 'GB' },
  { name: 'Manchester', lat: 53.4808, lng: -2.2426, country: 'GB' },
  { name: 'Birmingham', lat: 52.4862, lng: -1.8904, country: 'GB' },
  { name: 'Bandra, Mumbai', lat: 19.0596, lng: 72.8295, country: 'IN' },
  { name: 'Pune', lat: 18.5204, lng: 73.8567, country: 'IN' },
  { name: 'Connaught Place, New Delhi', lat: 28.6315, lng: 77.2167, country: 'IN' },
  { name: 'Jaipur', lat: 26.9124, lng: 75.7873, country: 'IN' },
  { name: 'Riyadh', lat: 24.7136, lng: 46.6753, country: 'SA' },
  { name: 'Jeddah', lat: 21.4858, lng: 39.1925, country: 'SA' },
  { name: 'Dammam', lat: 26.4207, lng: 50.0888, country: 'SA' },
];

class MockMaps implements MapsProvider {
  async route(o: LatLng, d: LatLng): Promise<RouteResult> {
    const straight = haversineMeters(o, d);
    if (straight < 200) throw new AppError(422, 'NO_ROUTE', 'Pickup and destination are too close together.');
    const distanceMeters = Math.round(straight * 1.25);
    const points: LatLng[] = Array.from({ length: 21 }, (_, i) => ({ lat: o.lat + ((d.lat - o.lat) * i) / 20, lng: o.lng + ((d.lng - o.lng) * i) / 20 }));
    return {
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / (80_000 / 3600)), // ~80 km/h
      polyline: encodePolyline(points),
      provider: 'mock',
      approximate: true,
    };
  }
  async searchPlaces(query: string, countryCode?: string): Promise<Place[]> {
    const qn = query.trim().toLowerCase();
    return MOCK_PLACES
      .filter((p) => (!countryCode || p.country === countryCode) && p.name.toLowerCase().includes(qn))
      .slice(0, 6)
      .map(({ country: _c, ...p }) => p);
  }
}

export function createMapsProvider(): MapsProvider {
  switch (config.MAP_PROVIDER) {
    case 'google':
      if (!config.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is required for MAP_PROVIDER=google');
      return new GoogleMaps(config.GOOGLE_MAPS_API_KEY);
    case 'mapbox':
      if (!config.MAPBOX_ACCESS_TOKEN) throw new Error('MAPBOX_ACCESS_TOKEN is required for MAP_PROVIDER=mapbox');
      return new MapboxMaps(config.MAPBOX_ACCESS_TOKEN);
    default:
      return new MockMaps();
  }
}

export const maps = createMapsProvider();
