export const siteOptions = [
  {
    id: "savoury",
    name: "Savoury Block",
    subtitle: "Production and process area",
    image: "/maps/savoury-placeholder.jpg",
  },
  {
    id: "dressings",
    name: "Dressings",
    subtitle: "Dressings manufacturing area",
    image: "/maps/dressings-placeholder.jpg",
  },
];

function createSingleSceneTour({
  id,
  name,
  sceneId,
  sceneTitle,
  panorama,
}) {
  return {
    id,
    name,
    version: 1,

    settings: {
      firstScene: sceneId,
      defaultHfov: 110,
      mobileHfov: 90,
    },

    scenes: {
      [sceneId]: {
        id: sceneId,
        title: sceneTitle,
        label: sceneTitle,
        panorama,

        minimap: {
          x: 50,
          y: 50,
        },

        view: {
          initialYaw: 0,
          initialPitch: 0,
          initialHfov: 110,
        },
      },
    },

    connections: [],
  };
}

/* ================= SAVOURY TOURS ================= */

const savouryAdminTour = createSingleSceneTour({
  id: "savoury-admin-tour",
  name: "Savoury Admin Tour",
  sceneId: "SavouryAdmin",
  sceneTitle: "Savoury Admin",
  panorama: "/panos/sea.jpg",
});

const savouryProcessTour = createSingleSceneTour({
  id: "savoury-process-tour",
  name: "Savoury Process Tour",
  sceneId: "SavouryProcess",
  sceneTitle: "Savoury Process Area",
  panorama: "/panos/drone.jpg",
});

const savouryProductTour = {
  id: "savoury-product-tour",
  name: "Savoury Product Tour",
  version: 1,

  settings: {
    firstScene: "ProductEntrance",
    defaultHfov: 110,
    mobileHfov: 90,
  },

  scenes: {
    ProductEntrance: {
      id: "ProductEntrance",
      title: "Product Entrance",
      label: "Entrance",
      panorama: "/panos/drone.jpg",

      minimap: {
        x: 50,
        y: 80,
      },

      view: {
        initialYaw: 0,
        initialPitch: 0,
        initialHfov: 110,
      },
    },

    ProductMiddle: {
      id: "ProductMiddle",
      title: "Product Middle Area",
      label: "Middle",
      panorama: "/panos/heaven.jpg",

      minimap: {
        x: 50,
        y: 50,
      },

      view: {
        initialYaw: 0,
        initialPitch: 0,
        initialHfov: 110,
      },
    },

    ProductEnd: {
      id: "ProductEnd",
      title: "Product End Area",
      label: "End",
      panorama: "/panos/river.jpg",

      minimap: {
        x: 50,
        y: 20,
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
      id: "product-entrance-to-middle",
      from: "ProductEntrance",
      to: "ProductMiddle",
      label: "Go Forward",
      type: "move",
      hotspot: {
        yaw: 0,
        pitch: -8,
        icon: "↑",
      },
    },

    {
      id: "product-middle-to-entrance",
      from: "ProductMiddle",
      to: "ProductEntrance",
      label: "Go Back",
      type: "move",
      hotspot: {
        yaw: 180,
        pitch: -8,
        icon: "↓",
      },
    },

    {
      id: "product-middle-to-end",
      from: "ProductMiddle",
      to: "ProductEnd",
      label: "Go Forward",
      type: "move",
      hotspot: {
        yaw: 0,
        pitch: -8,
        icon: "↑",
      },
    },

    {
      id: "product-end-to-middle",
      from: "ProductEnd",
      to: "ProductMiddle",
      label: "Go Back",
      type: "move",
      hotspot: {
        yaw: 180,
        pitch: -8,
        icon: "↓",
      },
    },
  ],
};

const savouryEngineeringTour = createSingleSceneTour({
  id: "savoury-engineering-tour",
  name: "Savoury Engineering Tour",
  sceneId: "SavouryEngineering",
  sceneTitle: "Savoury Engineering Area",
  panorama: "/panos/room.jpg",
});

const savouryProductionTour = createSingleSceneTour({
  id: "savoury-production-tour",
  name: "Savoury Production Tour",
  sceneId: "SavouryProduction",
  sceneTitle: "Savoury Production Area",
  panorama: "/panos/heaven.jpg",
});

const savouryQATour = createSingleSceneTour({
  id: "savoury-qa-tour",
  name: "Savoury Quality Assurance Tour",
  sceneId: "SavouryQA",
  sceneTitle: "Savoury Quality Assurance Area",
  panorama: "/panos/sea.jpg",
});

const savouryLogisticsTour = createSingleSceneTour({
  id: "savoury-logistics-tour",
  name: "Savoury Logistics Tour",
  sceneId: "SavouryLogistics",
  sceneTitle: "Savoury Logistics Area",
  panorama: "/panos/drone.jpg",
});

/* ================= OTHER SAMPLE TOURS ================= */

const dressingsMainTour = createSingleSceneTour({
  id: "dressings-main-tour",
  name: "Dressings Main Tour",
  sceneId: "DressingsMain",
  sceneTitle: "Dressings Main Area",
  panorama: "/panos/dressings/main.jpg",
});

/* ================= FACTORY MAPS ================= */

export const factoryMaps = {
  savoury: {
    id: "savoury",
    name: "Savoury Block",
    mapImage: "/maps/savoury-placeholder.jpg",

    areas: [
      {
        id: "savoury-admin",
        name: "Savoury Admin",
        points: "1.5,4 60.5,3.3 60.5,20 2.6,21",
        tour: savouryAdminTour,
      },
      {
        id: "savoury-process",
        name: "Savoury Process Area",
        points: "61,5 92.4,4.6 92.4,40 61.5,40.7",
        tour: savouryProcessTour,
      },
      {
        id: "savoury-product",
        name: "Savoury Product Area",
        points: "2.6,21 60.5,20 61.5,40.7 92.4,40 93,98 7,100",
        tour: savouryProductTour,
      },
      {
        id: "savoury-eng",
        name: "Savoury Engineering Area",
        points: "3.2,27 16.7,26.4 19,59 4.7,59",
        tour: savouryEngineeringTour,
      },
      {
        id: "savoury-production",
        name: "Savoury Production Area",
        points: "28,36 49.6,35.7 49.8,41.2 28,41.5",
        tour: savouryProductionTour,
      },
      {
        id: "savoury-QA",
        name: "Savoury Quality Assurance Area",
        points: "41.2,50.3 56.2,50 56.2,56 41.2,56.3",
        tour: savouryQATour,
      },
      {
        id: "savoury-Logistics",
        name: "Savoury Logistics Area",
        points: "66.5,84.4 83,84 83,89 66.5,89.5",
        tour: savouryLogisticsTour,
      },
    ],
  },

  dressings: {
    id: "dressings",
    name: "Dressings",
    mapImage: "/maps/dressings-placeholder.jpg",

    areas: [
      {
        id: "dressings-relishes",
        name: "Dressings Relishes Area",
        points: "12.2,14.9 20.5,14.8 20.8,24.7 13,24.7",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-prodhalal",
        name: "Dressings Production (Halal) Area",
        points: "36.3, 34 54,34 54,39.6 36.3,39.6",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-logistics",
        name: "Dressings Logistics Area",
        points: "15.3,56 27.4,56 27.4,61 15.3,61",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-engineering",
        name: "Dressings Engineering Area",
        points: "34,48 44,48 44,53 34,53",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-qa",
        name: "Dressings Quality Assurance Area",
        points: "45.8, 48.5 54.5,48.5 54.5,45.3 54.5,45.3 56.5,45.3 56.5, 53.4 45.8, 53.4",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-palletshed",
        name: "Dressings Pallet Shipment Area",
        points: "23.6, 78 30.8,78 30.8,84 23.6,84",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-fgloading",
        name: "Dressings Finished Goods Loading Area",
        points: "35, 77 53,77 53,85 35,85",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-wastedisposal",
        name: "Dressings Waste Disposal Area",
        points: "35, 87 56,87 56,92 35,92",
        tour: dressingsMainTour,
      },
      {
        id: "dressings-prodnonhalal",
        name: "Dressings Production (Non-Halal) Area",
        points: "85,2.4 97.4,2.4 96.4,21.5 84,21.5",
        tour: dressingsMainTour,
      },
    ],
  },
};