export const mapData = {
  id: "factory-tour",
  name: "Factory Tour",
  version: 1,

  settings: {
    firstScene: "Sea",
    defaultHfov: 110,
    mobileHfov: 90,
  },

  scenes: {
    Sea: {
      id: "Sea",
      title: "Sea",
      label: "Sea",
      panorama: "/panos/sea.jpg",

      minimap: {
        x: 50,
        y: 52,
      },

      view: {
        initialYaw: 0,
        initialPitch: 0,
        initialHfov: 110,
      },
    },

    Rome: {
      id: "Rome",
      title: "Rome",
      label: "Rome",
      panorama: "/panos/drone.jpg",

      minimap: {
        x: 50,
        y: 22,
      },

      view: {
        initialYaw: 0,
        initialPitch: 0,
        initialHfov: 110,
      },
    },

    River: {
      id: "River",
      title: "River",
      label: "River",
      panorama: "/panos/river.jpg",

      minimap: {
        x: 50,
        y: 82,
      },

      view: {
        initialYaw: 0,
        initialPitch: 0,
        initialHfov: 110,
      },
    },

    Room: {
      id: "Room",
      title: "Room",
      label: "Room",
      panorama: "/panos/room.jpg",

      minimap: {
        x: 18,
        y: 52,
      },

      view: {
        initialYaw: 0,
        initialPitch: 0,
        initialHfov: 110,
      },
    },

    Heaven: {
      id: "Heaven",
      title: "Heaven",
      label: "Heaven",
      panorama: "/panos/heaven.jpg",

      minimap: {
        x: 82,
        y: 52,
      },

      view: {
        initialYaw: 0,
        initialPitch: 0,
        initialHfov: 110,
      },
    },
  },

  connections: [
    {
      id: "sea-to-rome",
      from: "Sea",
      to: "Rome",
      label: "Rome",
      type: "move",
      hotspot: {
        yaw: 0,
        pitch: -10,
        icon: "↑",
      },
    },
    {
      id: "sea-to-room",
      from: "Sea",
      to: "Room",
      label: "Room",
      type: "move",
      hotspot: {
        yaw: -90,
        pitch: -8,
        icon: "←",
      },
    },
    {
      id: "sea-to-heaven",
      from: "Sea",
      to: "Heaven",
      label: "Heaven",
      type: "move",
      hotspot: {
        yaw: 90,
        pitch: -8,
        icon: "→",
      },
    },

    {
      id: "rome-to-river",
      from: "Rome",
      to: "River",
      label: "River",
      type: "move",
      hotspot: {
        yaw: 0,
        pitch: -10,
        icon: "↑",
      },
    },
    {
      id: "rome-to-sea",
      from: "Rome",
      to: "Sea",
      label: "Sea",
      type: "move",
      hotspot: {
        yaw: 180,
        pitch: -10,
        icon: "↓",
      },
    },
    {
      id: "rome-to-room",
      from: "Rome",
      to: "Room",
      label: "Room",
      type: "move",
      hotspot: {
        yaw: -90,
        pitch: -8,
        icon: "←",
      },
    },
    {
      id: "rome-to-heaven",
      from: "Rome",
      to: "Heaven",
      label: "Heaven",
      type: "move",
      hotspot: {
        yaw: 90,
        pitch: -8,
        icon: "→",
      },
    },

    {
      id: "river-to-rome",
      from: "River",
      to: "Rome",
      label: "Rome",
      type: "move",
      hotspot: {
        yaw: 180,
        pitch: -10,
        icon: "↓",
      },
    },
    {
      id: "river-to-room",
      from: "River",
      to: "Room",
      label: "Room",
      type: "move",
      hotspot: {
        yaw: -90,
        pitch: -8,
        icon: "←",
      },
    },
    {
      id: "river-to-heaven",
      from: "River",
      to: "Heaven",
      label: "Heaven",
      type: "move",
      hotspot: {
        yaw: 90,
        pitch: -8,
        icon: "→",
      },
    },

    {
      id: "room-to-sea",
      from: "Room",
      to: "Sea",
      label: "Sea",
      type: "move",
      hotspot: {
        yaw: 0,
        pitch: -10,
        icon: "↑",
      },
    },
    {
      id: "room-to-rome",
      from: "Room",
      to: "Rome",
      label: "Rome",
      type: "move",
      hotspot: {
        yaw: 90,
        pitch: -8,
        icon: "→",
      },
    },
    {
      id: "room-to-river",
      from: "Room",
      to: "River",
      label: "River",
      type: "move",
      hotspot: {
        yaw: 180,
        pitch: -10,
        icon: "↓",
      },
    },

    {
      id: "heaven-to-sea",
      from: "Heaven",
      to: "Sea",
      label: "Sea",
      type: "move",
      hotspot: {
        yaw: 0,
        pitch: -10,
        icon: "↑",
      },
    },
    {
      id: "heaven-to-rome",
      from: "Heaven",
      to: "Rome",
      label: "Rome",
      type: "move",
      hotspot: {
        yaw: -90,
        pitch: -8,
        icon: "←",
      },
    },
    {
      id: "heaven-to-river",
      from: "Heaven",
      to: "River",
      label: "River",
      type: "move",
      hotspot: {
        yaw: 180,
        pitch: -10,
        icon: "↓",
      },
    },
  ],
};