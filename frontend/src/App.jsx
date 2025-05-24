import React, { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { buildCableGraph, findCablePathDFS } from './graphUtils.js';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const haversineDistance = (a, b) => {
  const toRad = deg => deg * (Math.PI / 180);
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const aVal = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
};

const mapStyles = {
  light: { label: 'Light (Flat)', style: 'mapbox://styles/mapbox/light-v10', projection: 'mercator' },
  dark: { label: 'Dark (Flat)', style: 'mapbox://styles/mapbox/dark-v10', projection: 'mercator' },
  streets: { label: 'Streets (Flat)', style: 'mapbox://styles/mapbox/streets-v11', projection: 'mercator' },
  satellite: { label: 'Satellite (Flat)', style: 'mapbox://styles/mapbox/satellite-v9', projection: 'mercator' },
  outdoors: { label: 'Outdoors (Flat)', style: 'mapbox://styles/mapbox/outdoors-v11', projection: 'mercator' },
  'globe-streets': { label: '3D Globe (Streets)', style: 'mapbox://styles/mapbox/streets-v12', projection: 'globe' }
};

export default function App() {
  const [target, setTarget] = useState('google.com');
  const [hops, setHops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mapStyleKey, setMapStyleKey] = useState('streets');
  const [mapReady, setMapReady] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const eventSourceRef = useRef(null);

  const fetchTraceroute = () => {
    // Clean up existing EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setHops([]);
    setLoading(true);
    setMapReady(false);
    setDebugInfo('');

    const es = new EventSource(`http://localhost:3000/trace?target=${target}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const hopData = JSON.parse(event.data);
        setHops(prev => [...prev, hopData]);
      } catch (e) {
        console.warn('Invalid hop data:', event.data);
      }
    };

    es.addEventListener('end', () => {
      setLoading(false);
      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = (err) => {
      console.error('SSE error:', err);
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
    };
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (!hops.length || !mapRef.current) return;

    try {
      if (mapInstanceRef.current && mapInstanceRef.current._container) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    } catch (e) {
      console.warn('Mapbox remove() failed:', e);
    }

    const { style, projection } = mapStyles[mapStyleKey];
    if (!style) return;

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style,
      center: [hops[0].lon || 0, hops[0].lat || 0],
      zoom: 2,
      projection
    });

    mapInstanceRef.current = map;

    map.on('load', () => {
      setMapReady(true);

      // Add cable data with error handling
      Promise.all([
        fetch('/cables.json').then(res => res.json()).catch(err => {
          console.error('Failed to load cables:', err);
          return { features: [] };
        }),
        fetch('/landings.json').then(res => res.json()).catch(err => {
          console.error('Failed to load landings:', err);
          return { features: [] };
        })
      ]).then(([cables, landings]) => {
        // Add cables layer
        if (cables.features.length > 0) {
          map.addSource('cables', { type: 'geojson', data: cables });
          map.addLayer({
            id: 'cable-lines',
            type: 'line',
            source: 'cables',
            paint: {
              'line-color': '#00ffff',
              'line-width': 1.2,
              'line-opacity': 0.2
            }
          });
        }

        // Add landings layer
        if (landings.features.length > 0) {
          map.addSource('landings', { type: 'geojson', data: landings });
          map.addLayer({
            id: 'landing-points',
            type: 'circle',
            source: 'landings',
            paint: {
              'circle-radius': 3,
              'circle-color': '#ff69b4',
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 1
            }
          });
        }
      });

      // Add click handlers
      map.on('click', 'cable-lines', (e) => {
        const name = e.features[0].properties.name;
        new mapboxgl.Popup().setLngLat(e.lngLat).setText(`Cable: ${name}`).addTo(map);
      });

      map.on('click', 'landing-points', (e) => {
        const name = e.features[0].properties.name;
        new mapboxgl.Popup().setLngLat(e.lngLat).setText(`Landing: ${name}`).addTo(map);
      });

      // Add hop markers
      hops.forEach(hop => {
        if (typeof hop.lat === 'number' && typeof hop.lon === 'number') {
          new mapboxgl.Marker()
            .setLngLat([hop.lon, hop.lat])
            .setPopup(new mapboxgl.Popup().setText(`${hop.hop}: ${hop.ip} (${hop.city || 'Unknown'}, ${hop.country || 'Unknown'})`))
            .addTo(map);
        }
      });
    });
  }, [hops, mapStyleKey]);

  const animateLine = async (coords, map, id) => {
    if (!coords || coords.length < 2) return;
    
    const feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords }
    };
  
    // Remove existing layer and source with same ID (if exists)
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  
    map.addSource(id, { type: 'geojson', data: feature });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#ffaa00',
        'line-width': 3,
        'line-dasharray': [2, 4]
      }
    });
  
    // Animate the line
    let offset = 0;
    await new Promise(resolve => {
      const animate = () => {
        offset += 1;
        try {
          map.setPaintProperty(id, 'line-dasharray', [2, 4 + (offset % 20)]);
        } catch (e) {
          console.warn('Animation paint property failed:', e);
        }
        if (offset < 40) requestAnimationFrame(animate);
        else resolve();
      };
      animate();
    });
  };

  const animateTrace = async () => {
    if (!mapInstanceRef.current || !mapReady || hops.length < 2) return;
  
    const map = mapInstanceRef.current;
    let debugLog = [];
    
    try {
      // Load data with error handling
      const [cables, landings] = await Promise.all([
        fetch('/cables.json').then(res => res.json()).catch(() => ({ features: [] })),
        fetch('/landings.json').then(res => res.json()).catch(() => ({ features: [] }))
      ]);

      debugLog.push(`Loaded ${cables.features.length} cables, ${landings.features.length} landings`);

      if (cables.features.length === 0 || landings.features.length === 0) {
        debugLog.push('⚠️ Missing cable or landing data - falling back to direct lines');
        setDebugInfo(debugLog.join('\n'));
        
        // Fallback to direct line animation
        for (let i = 0; i < hops.length - 1; i++) {
          const a = hops[i];
          const b = hops[i + 1];
          if (a.lat && a.lon && b.lat && b.lon) {
            await animateLine([[a.lon, a.lat], [b.lon, b.lat]], map, `direct-${i}`);
            await new Promise(r => setTimeout(r, 500));
          }
        }
        return;
      }

      const { graph, coordMap } = buildCableGraph(cables, landings);
      
      debugLog.push(`Built graph with ${Object.keys(graph).length} nodes`);
      debugLog.push(`Coordinate map has ${Object.keys(coordMap).length} entries`);

      const coordKey = ([lon, lat]) => `${lon.toFixed(3)},${lat.toFixed(3)}`;
      
      const getClosestCoordKey = ({ lat, lon }) => {
        let closest = null;
        let minDist = Infinity;
        for (const key in coordMap) {
          const coord = coordMap[key];
          const dist = haversineDistance({ lat, lon }, { lat: coord[1], lon: coord[0] });
          if (dist < minDist) {
            minDist = dist;
            closest = key;
          }
        }
        return { key: closest, distance: minDist };
      };
  
      for (let i = 0; i < hops.length - 1; i++) {
        const a = hops[i];
        const b = hops[i + 1];
        if (!a.lat || !a.lon || !b.lat || !b.lon) continue;
  
        map.flyTo({ center: [b.lon, b.lat], zoom: 3, speed: 0.5 });
  
        const closestA = getClosestCoordKey({ lat: a.lat, lon: a.lon });
        const closestB = getClosestCoordKey({ lat: b.lat, lon: b.lon });
        
        debugLog.push(`Hop ${i}: ${a.city || a.ip} → ${b.city || b.ip}`);
        debugLog.push(`  Closest landing A: ${closestA.distance.toFixed(1)}km away`);
        debugLog.push(`  Closest landing B: ${closestB.distance.toFixed(1)}km away`);
        
        if (!closestA.key || !closestB.key || !coordMap[closestA.key] || !coordMap[closestB.key]) {
          debugLog.push(`  ⚠️ Using direct line (no valid landings found)`);
          await animateLine([[a.lon, a.lat], [b.lon, b.lat]], map, `fallback-${i}`);
          continue;
        }
        
        const coordA = coordMap[closestA.key];
        const coordB = coordMap[closestB.key];
  
        // Animate to landing
        await animateLine([[a.lon, a.lat], coordA], map, `to-${i}`);
  
        // Find cable path
        const path = findCablePathDFS(graph, closestA.key, closestB.key);
  
        if (path && path.length > 1) {
          debugLog.push(`  🌊 Found submarine path with ${path.length - 1} segments`);
          
          for (let j = 0; j < path.length - 1; j++) {
            const from = path[j];
            const to = path[j + 1];
            const edge = graph[from]?.find(e => e.to === to);
            
            if (edge && edge.geometry) {
              debugLog.push(`    ${j + 1}. ${edge.cableName}`);
              await animateLine(edge.geometry, map, `cable-${i}-${j}`);
            }
          }
        } else {
          debugLog.push(`  ⚠️ No submarine path found - using direct sea route`);
          await animateLine([coordA, coordB], map, `fallback-sea-${i}`);
        }
  
        // Animate from landing to destination
        await animateLine([coordB, [b.lon, b.lat]], map, `from-${i}`);
        await new Promise(r => setTimeout(r, 300));
      }
      
    } catch (error) {
      debugLog.push(`❌ Error: ${error.message}`);
      console.error('Animation error:', error);
    }
    
    setDebugInfo(debugLog.join('\n'));
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>TraceRoute Visualizer</h1>

      <form onSubmit={(e) => { e.preventDefault(); fetchTraceroute(); }} style={{ marginBottom: '1rem' }}>
        <input 
          type="text" 
          value={target} 
          onChange={e => setTarget(e.target.value)} 
          style={{ padding: '0.5rem', fontSize: '1rem', width: '300px' }} 
          placeholder="Enter domain or IP"
        />
        <button type="submit" style={{ marginLeft: '0.5rem', padding: '0.5rem 1rem' }}>
          Trace
        </button>
      </form>

      <label style={{ marginBottom: '1rem', display: 'block' }}>
        Map Style:{' '}
        <select 
          value={mapStyleKey} 
          onChange={(e) => setMapStyleKey(e.target.value)} 
          style={{ padding: '0.3rem', fontSize: '1rem' }}
        >
          {Object.entries(mapStyles).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
      </label>

      {loading ? (
        <p>Tracing...</p>
      ) : (
        <>
          <button 
            onClick={animateTrace} 
            style={{ padding: '0.5rem 1rem', marginBottom: '1rem' }}
            disabled={!mapReady || hops.length < 2}
          >
            Start Trace Animation
          </button>
          
          {debugInfo && (
            <div style={{ background: '#f0f8ff', padding: '1rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
              <h3>Debug Info:</h3>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{debugInfo}</pre>
            </div>
          )}
          
          <pre style={{ background: '#f0f0f0', padding: '1rem', whiteSpace: 'pre-wrap' }}>
            {hops.map(h => `${h.hop}. ${h.ip} - ${h.city || 'Unknown'}, ${h.country || 'Unknown'}`).join('\n')}
          </pre>
        </>
      )}

      <div ref={mapRef} id="map" style={{ height: '500px', marginTop: '1rem' }} />
    </div>
  );
}