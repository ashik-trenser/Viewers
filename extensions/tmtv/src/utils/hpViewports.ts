const ctAXIAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'ctAXIAL',
    viewportType: 'volume',
    orientation: 'axial',
    toolGroupId: 'ctToolGroup',
    initialImageOptions: {
      // index: 5,
      preset: 'first', // 'first', 'last', 'middle'
    },
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'axialSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
    ],
  },
  displaySets: [
    {
      id: 'ctDisplaySet',
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const ctSAGITTAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'ctSAGITTAL',
    viewportType: 'volume',
    orientation: 'sagittal',
    toolGroupId: 'ctToolGroup',
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'sagittalSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
    ],
  },
  displaySets: [
    {
      id: 'ctDisplaySet',
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};
const ctCORONAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'ctCORONAL',
    viewportType: 'volume',
    orientation: 'coronal',
    toolGroupId: 'ctToolGroup',
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'coronalSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
    ],
  },
  displaySets: [
    {
      id: 'ctDisplaySet',
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const ptAXIAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'ptAXIAL',
    viewportType: 'volume',
    background: [1, 1, 1],
    orientation: 'axial',
    toolGroupId: 'ptToolGroup',
    initialImageOptions: {
      // index: 5,
      preset: 'first', // 'first', 'last', 'middle'
    },
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'axialSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ptWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
      {
        type: 'voi',
        id: 'ptFusionWLSync',
        source: true,
        target: false,
        options: {
          syncColormap: false,
        },
      },
    ],
  },
  displaySets: [
    {
      options: {
        voi: {
          custom: 'getPTVOIRange',
        },
        voiInverted: true,
      },
      id: 'ptDisplaySet',
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const ptSAGITTAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'ptSAGITTAL',
    viewportType: 'volume',
    orientation: 'sagittal',
    background: [1, 1, 1],
    toolGroupId: 'ptToolGroup',
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'sagittalSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ptWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
      {
        type: 'voi',
        id: 'ptFusionWLSync',
        source: true,
        target: false,
        options: {
          syncColormap: false,
        },
      },
    ],
  },
  displaySets: [
    {
      options: {
        voi: {
          custom: 'getPTVOIRange',
        },
        voiInverted: true,
      },
      id: 'ptDisplaySet',
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const ptCORONAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'ptCORONAL',
    viewportType: 'volume',
    orientation: 'coronal',
    background: [1, 1, 1],
    toolGroupId: 'ptToolGroup',
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'coronalSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ptWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
      {
        type: 'voi',
        id: 'ptFusionWLSync',
        source: true,
        target: false,
        options: {
          syncColormap: false,
        },
      },
    ],
  },
  displaySets: [
    {
      options: {
        voi: {
          custom: 'getPTVOIRange',
        },
        voiInverted: true,
      },
      id: 'ptDisplaySet',
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const fusionAXIAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'fusionAXIAL',
    viewportType: 'volume',
    orientation: 'axial',
    toolGroupId: 'fusionToolGroup',
    initialImageOptions: {
      // index: 5,
      preset: 'first', // 'first', 'last', 'middle'
    },
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'axialSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ctWLSync',
        source: false,
        target: true,
      },
      {
        type: 'voi',
        id: 'fusionWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
      {
        type: 'voi',
        id: 'ptFusionWLSync',
        source: false,
        target: true,
        options: {
          syncColormap: false,
        },
      },
    ],
  },
  displaySets: [
    {
      id: 'ctDisplaySet',
    },
    {
      id: 'ptDisplaySet',
      options: {
        colormap: {
          name: 'hsv',
          opacity: [
            { value: 0, opacity: 0 },
            { value: 0.1, opacity: 0.9 },
            { value: 1, opacity: 0.95 },
          ],
        },
        voi: {
          custom: 'getPTVOIRange',
        },
      },
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const fusionSAGITTAL = {
  viewportOptions: {
    viewportId: 'fusionSAGITTAL',
    viewportType: 'volume',
    orientation: 'sagittal',
    toolGroupId: 'fusionToolGroup',
    // initialImageOptions: {
    //   index: 180,
    //   preset: 'middle', // 'first', 'last', 'middle'
    // },
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'sagittalSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ctWLSync',
        source: false,
        target: true,
      },
      {
        type: 'voi',
        id: 'fusionWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
      {
        type: 'voi',
        id: 'ptFusionWLSync',
        source: false,
        target: true,
        options: {
          syncColormap: false,
        },
      },
    ],
  },
  displaySets: [
    {
      id: 'ctDisplaySet',
    },
    {
      id: 'ptDisplaySet',
      options: {
        colormap: {
          name: 'hsv',
          opacity: [
            { value: 0, opacity: 0 },
            { value: 0.1, opacity: 0.9 },
            { value: 1, opacity: 0.95 },
          ],
        },
        voi: {
          custom: 'getPTVOIRange',
        },
      },
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const fusionCORONAL = {
  viewportOptions: {
    viewportId: 'fusionCoronal',
    viewportType: 'volume',
    orientation: 'coronal',
    toolGroupId: 'fusionToolGroup',
    // initialImageOptions: {
    //   index: 180,
    //   preset: 'middle', // 'first', 'last', 'middle'
    // },
    syncGroups: [
      {
        type: 'cameraPosition',
        id: 'coronalSync',
        source: true,
        target: true,
      },
      {
        type: 'voi',
        id: 'ctWLSync',
        source: false,
        target: true,
      },
      {
        type: 'voi',
        id: 'fusionWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
      {
        type: 'voi',
        id: 'ptFusionWLSync',
        source: false,
        target: true,
        options: {
          syncColormap: false,
        },
      },
    ],
  },
  displaySets: [
    {
      id: 'ctDisplaySet',
    },
    {
      id: 'ptDisplaySet',
      options: {
        colormap: {
          name: 'hsv',
          opacity: [
            { value: 0, opacity: 0 },
            { value: 0.1, opacity: 0.9 },
            { value: 1, opacity: 0.95 },
          ],
        },
        voi: {
          custom: 'getPTVOIRange',
        },
      },
    },
  ],
  overlays: [
    {
      id: 'appLabelmap',
    },
  ],
};

const mipSAGITTAL: AppTypes.HangingProtocol.Viewport = {
  viewportOptions: {
    viewportId: 'mipSagittal',
    viewportType: 'volume',
    orientation: 'sagittal',
    background: [1, 1, 1],
    toolGroupId: 'mipToolGroup',
    syncGroups: [
      {
        type: 'voi',
        id: 'ptWLSync',
        source: true,
        target: true,
        options: {
          syncColormap: true,
        },
      },
      {
        type: 'voi',
        id: 'ptFusionWLSync',
        source: true,
        target: false,
        options: {
          syncColormap: false,
        },
      },
    ],

    // Custom props can be used to set custom properties which extensions
    // can react on.
    customViewportProps: {
      // We use viewportDisplay to filter the viewports which are displayed
      // in mip and we set the scrollbar according to their rotation index
      // in the cornerstone extension.
      hideOverlays: true,
    },
  },
  displaySets: [
    {
      options: {
        blendMode: 'MIP',
        slabThickness: 'fullVolume',
        voi: {
          custom: 'getPTVOIRange',
        },
        voiInverted: true,
      },
      id: 'ptDisplaySet',
    },
  ],
  // overlays: [
  //   {
  //     id: 'appLabelmap',
  //   },
  // ],
};

export {
  ctAXIAL,
  ctSAGITTAL,
  ctCORONAL,
  ptAXIAL,
  ptSAGITTAL,
  ptCORONAL,
  fusionAXIAL,
  fusionSAGITTAL,
  fusionCORONAL,
  mipSAGITTAL,
};
