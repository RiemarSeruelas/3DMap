export const siteOptions = [
  {
    id: "savoury",
    name: "Savoury Block",
    subtitle: "Production and process area",
    image: "/maps/savoury-placeholder.jpg",
  },
  {
    id: "rd",
    name: "Research and Development",
    subtitle: "R&D laboratories and test areas",
    image: "/maps/rd-placeholder.jpg",
  },
  {
    id: "hr",
    name: "Human Resource",
    subtitle: "HR and people services",
    image: "/maps/hr-placeholder.jpg",
  },
  {
    id: "engineering",
    name: "Engineering",
    subtitle: "Utilities, workshop, and maintenance",
    image: "/maps/engineering-placeholder.jpg",
  },
  {
    id: "dressings",
    name: "Dressings",
    subtitle: "Dressings manufacturing area",
    image: "/maps/dressings-placeholder.jpg",
  },
];

/*
  This creates a simple tour with only ONE panorama scene.

  Example:
  panorama: "/panos/savoury/admin.jpg"

  Means your file should be placed here:
  public/panos/savoury/admin.jpg
*/
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

const rdLabTour = createSingleSceneTour({
  id: "rd-lab-tour",
  name: "R&D Laboratory Tour",
  sceneId: "RDLab",
  sceneTitle: "R&D Laboratory",
  panorama: "/panos/rd/lab.jpg",
});

const hrOfficeTour = createSingleSceneTour({
  id: "hr-office-tour",
  name: "HR Office Tour",
  sceneId: "HROffice",
  sceneTitle: "HR Office",
  panorama: "/panos/hr/office.jpg",
});

const engineeringWorkshopTour = createSingleSceneTour({
  id: "engineering-workshop-tour",
  name: "Engineering Workshop Tour",
  sceneId: "EngineeringWorkshop",
  sceneTitle: "Engineering Workshop",
  panorama: "/panos/engineering/workshop.jpg",
});

const engineeringUtilitiesTour = createSingleSceneTour({
  id: "engineering-utilities-tour",
  name: "Engineering Utilities Tour",
  sceneId: "EngineeringUtilities",
  sceneTitle: "Utilities Area",
  panorama: "/panos/engineering/utilities.jpg",
});

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

  rd: {
    id: "rd",
    name: "Research and Development",
    mapImage: "/maps/rd-placeholder.jpg",

    areas: [
      {
        id: "rd-lab",
        name: "R&D Laboratory",
        points: "20,25 55,20 65,42 45,60 22,55",
        tour: rdLabTour,
      },
    ],
  },

  hr: {
    id: "hr",
    name: "Human Resource",
    mapImage: "/maps/hr-placeholder.jpg",

    areas: [
      {
        id: "hr-office",
        name: "HR Office",
        points: "30,30 70,30 72,65 28,68",
        tour: hrOfficeTour,
      },
    ],
  },

  engineering: {
    id: "engineering",
    name: "Engineering",
    mapImage: "/maps/engineering-placeholder.jpg",

    areas: [
      {
        id: "engineering-workshop",
        name: "Engineering Workshop",
        points: "12,40 38,32 55,44 52,72 25,80",
        tour: engineeringWorkshopTour,
      },
      {
        id: "engineering-utilities",
        name: "Utilities Area",
        points: "60,25 88,28 86,62 66,70 55,50",
        tour: engineeringUtilitiesTour,
      },
    ],
  },

  dressings: {
    id: "dressings",
    name: "Dressings",
    mapImage: "/maps/dressings-placeholder.jpg",

    areas: [
      {
        id: "dressings-main",
        name: "Dressings Main Area",
        points: "18,35 48,22 78,36 70,74 32,80",
        tour: dressingsMainTour,
      },
    ],
  },
};