import React, { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const mapStyles = {
  light: {
    label: 'Light (Flat)',
    style: 'mapbox://styles/mapbox/light-v10',
    projection: 'mercator'
  },
  dark: {
    label: 'Dark (Flat)',
    style: 'mapbox://styles/mapbox/dark-v10',
    projection: 'mercator'
  },
  streets: {
    label: 'Streets (Flat)',
    style: 'mapbox://styles/mapbox/streets-v11',
    projection: 'mercator'
  },
  satellite: {
    label: 'Satellite (Flat)',
    style: 'mapbox://styles/mapbox/satellite-v9',
    projection: 'mercator'
  },
  outdoors: {
    label: 'Outdoors (Flat)',
    style: 'mapbox://styles/mapbox/outdoors-v11',
    projection: 'mercator'
  },
  'globe-streets': {
    label: '3D Globe (Streets)',
    style: 'mapbox://styles/mapbox/streets-v12',
    projection: 'globe'
  }
};

export default function App() {
  const [target, setTarget] = useState('openai.com');
  const [hops, setHops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mapStyleKey, setMapStyleKey] = useState('streets');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const fetchTraceroute = () => {
    setHops([]);
    setLoading(true);

    const es = new EventSource(`http://localhost:3000/trace?target=${target}`);

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
    });

    es.onerror = (err) => {
      console.error('SSE error:', err);
      es.close();
      setLoading(false);
    };
  };

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
      // 🧭 Submarine cables
      map.addSource('cables', {
        type: 'geojson',
        data: '/cables.json'
      });
      map.addLayer({
        id: 'cable-lines',
        type: 'line',
        source: 'cables',
        paint: {
          'line-color': '#00ffff',
          'line-width': 1.2,
          'line-opacity': 0.6
        }
      });

      // 🏁 Landing points
      map.addSource('landings', {
        type: 'geojson',
        data: '/landings.json'
      });
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

      // Popup for cables
      map.on('click', 'cable-lines', (e) => {
        const name = e.features[0].properties.name;
        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setText(`Cable: ${name}`)
          .addTo(map);
      });

      // Popup for landings
      map.on('click', 'landing-points', (e) => {
        const name = e.features[0].properties.name;
        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setText(`Landing: ${name}`)
          .addTo(map);
      });
    });

    // 🔵 Hop markers
    hops.forEach(hop => {
      if (typeof hop.lat === 'number' && typeof hop.lon === 'number') {
        new mapboxgl.Marker()
          .setLngLat([hop.lon, hop.lat])
          .setPopup(
            new mapboxgl.Popup().setText(
              `${hop.hop}: ${hop.ip} (${hop.city || 'Unknown'}, ${hop.country || 'Unknown'})`
            )
          )
          .addTo(map);
      }
    });

    return () => {
      try {
        if (map && map._container) map.remove();
      } catch (e) {
        console.warn('Map cleanup error:', e);
      }
    };
  }, [hops, mapStyleKey]);

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>TraceRoute Visualizer</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          fetchTraceroute();
        }}
        style={{ marginBottom: '1rem' }}
      >
        <input
          type="text"
          value={target}
          onChange={e => setTarget(e.target.value)}
          style={{ padding: '0.5rem', fontSize: '1rem', width: '300px' }}
        />
        <button
          type="submit"
          style={{ marginLeft: '0.5rem', padding: '0.5rem 1rem' }}
        >
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
        <pre style={{ background: '#f0f0f0', padding: '1rem', whiteSpace: 'pre-wrap' }}>
          {hops.map(h => {
            const city = h.city || 'Unknown';
            const country = h.country || 'Unknown';
            return `${h.hop}. ${h.ip} - ${city}, ${country}`;
          }).join('\n')}
        </pre>
      )}

      <div ref={mapRef} id="map" style={{ height: '500px', marginTop: '1rem' }} />
    </div>
  );
}
