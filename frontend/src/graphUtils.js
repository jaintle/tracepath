// graphUtils.js - Fixed version

export function buildCableGraph(cables, landings) {
    const graph = {};
    const coordMap = {};
    const PROXIMITY_THRESHOLD = 50; // km - how close a cable endpoint must be to a landing
    
    // Create coordinate lookup by creating keys from coordinates
    const coordKey = ([lon, lat]) => `${lon.toFixed(3)},${lat.toFixed(3)}`;
    
    // Map all landing coordinates
    landings.features.forEach(landing => {
      const coords = landing.geometry.coordinates;
      const key = coordKey(coords);
      coordMap[key] = coords;
    });
    
    // Helper function to find closest landing to a coordinate
    const findClosestLanding = (coord) => {
      let closest = null;
      let minDist = Infinity;
      
      landings.features.forEach(landing => {
        const landingCoord = landing.geometry.coordinates;
        const dist = haversineDistance(
          { lat: coord[1], lon: coord[0] },
          { lat: landingCoord[1], lon: landingCoord[0] }
        );
        
        if (dist < minDist && dist < PROXIMITY_THRESHOLD) {
          minDist = dist;
          closest = {
            key: coordKey(landingCoord),
            coord: landingCoord,
            name: landing.properties.name
          };
        }
      });
      
      return closest;
    };
    
    // Process each cable
    cables.features.forEach(cable => {
      const geometry = cable.geometry;
      let coordinates = [];
      
      // Handle different geometry types
      if (geometry.type === 'LineString') {
        coordinates = geometry.coordinates;
      } else if (geometry.type === 'MultiLineString') {
        // Flatten MultiLineString into single array
        coordinates = geometry.coordinates.flat();
      }
      
      if (coordinates.length < 2) return;
      
      // Get start and end points of the cable
      const startCoord = coordinates[0];
      const endCoord = coordinates[coordinates.length - 1];
      
      // Find closest landings to start and end points
      const startLanding = findClosestLanding(startCoord);
      const endLanding = findClosestLanding(endCoord);
      
      if (startLanding && endLanding && startLanding.key !== endLanding.key) {
        // Add to graph
        if (!graph[startLanding.key]) graph[startLanding.key] = [];
        if (!graph[endLanding.key]) graph[endLanding.key] = [];
        
        // Add bidirectional connections
        graph[startLanding.key].push({
          to: endLanding.key,
          cableName: cable.properties.name,
          geometry: coordinates
        });
        
        graph[endLanding.key].push({
          to: startLanding.key,
          cableName: cable.properties.name,
          geometry: [...coordinates].reverse()
        });
      }
    });
    
    return { graph, coordMap };
  }
  
  export function findCablePathDFS(graph, start, end, visited = new Set()) {
    if (start === end) return [start];
    if (visited.has(start)) return null;
    
    visited.add(start);
    
    for (const edge of graph[start] || []) {
      if (!visited.has(edge.to)) {
        const path = findCablePathDFS(graph, edge.to, end, new Set(visited));
        if (path) return [start, ...path];
      }
    }
    
    return null;
  }
  
  // Helper function for distance calculation
  function haversineDistance(a, b) {
    const toRad = deg => deg * (Math.PI / 180);
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const aVal = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  }