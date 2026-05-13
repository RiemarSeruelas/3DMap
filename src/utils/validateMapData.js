export function validateMapData(map) {
  const errors = [];
  const warnings = [];

  if (!map) {
    errors.push("Map data is missing.");
    return { errors, warnings };
  }

  if (!map.id) {
    warnings.push("Map has no id.");
  }

  if (!map.name) {
    warnings.push("Map has no name.");
  }

  if (!map.settings) {
    errors.push("Map settings are missing.");
  }

  if (!map.scenes || Object.keys(map.scenes).length === 0) {
    errors.push("Map has no scenes.");
  }

  if (!Array.isArray(map.connections)) {
    errors.push("Map connections must be an array.");
  }

  const firstScene = map.settings?.firstScene;

  if (firstScene && !map.scenes?.[firstScene]) {
    errors.push(`First scene "${firstScene}" does not exist in scenes.`);
  }

  Object.entries(map.scenes || {}).forEach(([sceneId, scene]) => {
    if (!scene.id) {
      warnings.push(`Scene "${sceneId}" has no id.`);
    }

    if (!scene.title) {
      errors.push(`Scene "${sceneId}" has no title.`);
    }

    if (!scene.panorama) {
      errors.push(`Scene "${sceneId}" has no panorama path.`);
    }

    if (!scene.minimap) {
      errors.push(`Scene "${sceneId}" has no minimap position.`);
    }

    if (scene.minimap) {
      if (typeof scene.minimap.x !== "number") {
        errors.push(`Scene "${sceneId}" minimap.x must be a number.`);
      }

      if (typeof scene.minimap.y !== "number") {
        errors.push(`Scene "${sceneId}" minimap.y must be a number.`);
      }
    }

    if (!scene.view) {
      warnings.push(`Scene "${sceneId}" has no initial view settings.`);
    }
  });

  const connectionIds = new Set();

  (map.connections || []).forEach((connection, index) => {
    const name = connection.id || `connection-${index}`;

    if (!connection.id) {
      warnings.push(`Connection at index ${index} has no id.`);
    }

    if (connection.id) {
      if (connectionIds.has(connection.id)) {
        errors.push(`Duplicate connection id: "${connection.id}".`);
      }

      connectionIds.add(connection.id);
    }

    if (!connection.from) {
      errors.push(`${name} has no "from" scene.`);
    }

    if (!connection.to) {
      errors.push(`${name} has no "to" scene.`);
    }

    if (connection.from && !map.scenes?.[connection.from]) {
      errors.push(`${name} has invalid from scene: "${connection.from}".`);
    }

    if (connection.to && !map.scenes?.[connection.to]) {
      errors.push(`${name} has invalid target scene: "${connection.to}".`);
    }

    if (!connection.label) {
      warnings.push(`${name} has no label.`);
    }

    if (!connection.hotspot) {
      errors.push(`${name} has no hotspot data.`);
    }

    if (connection.hotspot) {
      if (typeof connection.hotspot.yaw !== "number") {
        errors.push(`${name} hotspot.yaw must be a number.`);
      }

      if (typeof connection.hotspot.pitch !== "number") {
        errors.push(`${name} hotspot.pitch must be a number.`);
      }

      if (!connection.hotspot.icon) {
        warnings.push(`${name} has no hotspot icon.`);
      }
    }
  });

  return { errors, warnings };
}