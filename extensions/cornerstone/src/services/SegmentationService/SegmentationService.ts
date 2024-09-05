import { Types as OhifTypes, PubSubService } from '@ohif/core';
import {
  cache,
  Enums as csEnums,
  geometryLoader,
  eventTarget,
  utilities as csUtils,
  Types as csTypes,
  getEnabledElementByViewportId,
  imageLoader,
  Types,
} from '@cornerstonejs/core';
import {
  Enums as csToolsEnums,
  segmentation as cstSegmentation,
  Types as cstTypes,
  utilities as cstUtils,
} from '@cornerstonejs/tools';
import isEqual from 'lodash.isequal';
import { Types as ohifTypes } from '@ohif/core';
import { easeInOutBell, reverseEaseInOutBell } from '../../utils/transitions';
import { Segment, Segmentation, SegmentationConfig } from './SegmentationServiceTypes';
import { mapROIContoursToRTStructData } from './RTSTRUCT/mapROIContoursToRTStructData';
import {
  LabelmapConfig,
  LabelmapSegmentationData,
  LabelmapSegmentationDataVolume,
} from '@cornerstonejs/tools/types/LabelmapTypes';
import { ColorLUT } from '@cornerstonejs/core/types';

const LABELMAP = csToolsEnums.SegmentationRepresentations.Labelmap;
const CONTOUR = csToolsEnums.SegmentationRepresentations.Contour;

const EVENTS = {
  // fired when the segmentation is updated (e.g. when a segment is added, removed, or modified, locked, visibility changed etc.)
  SEGMENTATION_UPDATED: 'event::segmentation_updated',
  // fired when the segmentation data (e.g., labelmap pixels) is modified
  SEGMENTATION_DATA_MODIFIED: 'event::segmentation_data_modified',
  // fired when the segmentation is added to the cornerstone
  SEGMENTATION_ADDED: 'event::segmentation_added',
  // fired when segmentation representation is added
  SEGMENTATION_REPRESENTATION_ADDED: 'event::segmentation_representation_added',
  // fired when the segmentation is removed
  SEGMENTATION_REMOVED: 'event::segmentation_removed',
  // fired when segmentation representation is removed
  SEGMENTATION_REPRESENTATION_REMOVED: 'event::segmentation_representation_removed',
  // fired when the configuration for the segmentation is changed (e.g., brush size, render fill, outline thickness, etc.)
  SEGMENTATION_CONFIGURATION_CHANGED: 'event::segmentation_configuration_changed',
  // fired when the active segment is loaded in SEG or RTSTRUCT
  SEGMENT_LOADING_COMPLETE: 'event::segment_loading_complete',
  // loading completed for all segments
  SEGMENTATION_LOADING_COMPLETE: 'event::segmentation_loading_complete',
};

const VALUE_TYPES = {};

const SEGMENT_CONSTANT = {
  opacity: 255,
  isVisible: true,
  isLocked: false,
};

const VOLUME_LOADER_SCHEME = 'cornerstoneStreamingImageVolume';

class SegmentationService extends PubSubService {
  static REGISTRATION = {
    name: 'segmentationService',
    altName: 'SegmentationService',
    create: ({ servicesManager }: OhifTypes.Extensions.ExtensionParams): SegmentationService => {
      return new SegmentationService({ servicesManager });
    },
  };

  segmentations: Record<string, Segmentation>;
  readonly servicesManager: AppTypes.ServicesManager;
  highlightIntervalId = null;
  readonly EVENTS = EVENTS;

  constructor({ servicesManager }) {
    super(EVENTS);
    this.segmentations = {};

    this.servicesManager = servicesManager;

    this._initSegmentationService();
  }

  public destroy = () => {
    eventTarget.removeEventListener(
      csToolsEnums.Events.SEGMENTATION_MODIFIED,
      this._onSegmentationModifiedFromSource
    );

    eventTarget.removeEventListener(
      csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
      this._onSegmentationDataModified
    );

    // remove the segmentations from the cornerstone
    Object.keys(this.segmentations).forEach(segmentationId => {
      this._removeSegmentationFromCornerstone(segmentationId);
    });

    this.segmentations = {};
    this.listeners = {};
  };

  /**
   * Adds a new segment to the specified segmentation.
   * @param segmentationId - The ID of the segmentation to add the segment to.
   * @param viewportId: The ID of the viewport to add the segment to, it is used to get the representation, if it is not
   * provided, the first available representation for the segmentationId will be used.
   * @param config - An object containing the configuration options for the new segment.
   *   - segmentIndex: (optional) The index of the segment to add. If not provided, the next available index will be used.
   *   - properties: (optional) An object containing the properties of the new segment.
   *     - label: (optional) The label of the new segment. If not provided, a default label will be used.
   *     - color: (optional) The color of the new segment in RGB format. If not provided, a default color will be used.
   *     - opacity: (optional) The opacity of the new segment. If not provided, a default opacity will be used.
   *     - visibility: (optional) Whether the new segment should be visible. If not provided, the segment will be visible by default.
   *     - isLocked: (optional) Whether the new segment should be locked for editing. If not provided, the segment will not be locked by default.
   *     - active: (optional) Whether the new segment should be the active segment to be edited. If not provided, the segment will not be active by default.
   */
  public addSegment(
    segmentationId: string,
    config: {
      segmentIndex?: number;
      viewportId?: string;
      properties?: {
        label?: string;
        color?: ohifTypes.RGB;
        opacity?: number;
        visibility?: boolean;
        isLocked?: boolean;
        active?: boolean;
      };
    } = {}
  ): void {
    if (config?.segmentIndex === 0) {
      throw new Error('Segment index 0 is reserved for "no label"');
    }

    const { segmentationRepresentationUID, segmentation } =
      this._getSegmentationInfo(segmentationId);

    let segmentIndex = config.segmentIndex;
    if (!segmentIndex) {
      // grab the next available segment index
      segmentIndex = segmentation.segments.length === 0 ? 1 : segmentation.segments.length;
    }

    if (this._getSegmentInfo(segmentation, segmentIndex)) {
      throw new Error(`Segment ${segmentIndex} already exists`);
    }

    const rgbaColor = cstSegmentation.config.color.getSegmentIndexColor(
      segmentationRepresentationUID,
      segmentIndex
    );

    segmentation.segments[segmentIndex] = {
      label: config.properties?.label ?? `Segment ${segmentIndex}`,
      segmentIndex: segmentIndex,
      color: [rgbaColor[0], rgbaColor[1], rgbaColor[2]],
      opacity: rgbaColor[3],
      isVisible: true,
      isLocked: false,
    };

    segmentation.segmentCount++;

    // make the newly added segment the active segment
    this._setActiveSegment(segmentationId, segmentIndex);

    const suppressEvents = true;
    if (config.properties !== undefined) {
      const { color: newColor, opacity, isLocked, visibility, active } = config.properties;

      if (newColor !== undefined) {
        this._setSegmentColor(
          segmentationId,
          segmentIndex,
          newColor,
          config.viewportId,
          suppressEvents
        );
      }

      if (opacity !== undefined) {
        this._setSegmentOpacity(
          segmentationId,
          segmentIndex,
          opacity,
          config.viewportId,
          suppressEvents
        );
      }

      if (visibility !== undefined) {
        this._setSegmentVisibility(
          segmentationId,
          segmentIndex,
          visibility,
          config.viewportId,
          suppressEvents
        );
      }

      if (active === true) {
        this._setActiveSegment(segmentationId, segmentIndex, suppressEvents);
      }

      if (isLocked !== undefined) {
        this._setSegmentLocked(segmentationId, segmentIndex, isLocked, suppressEvents);
      }
    }

    if (segmentation.activeSegmentIndex === null) {
      this._setActiveSegment(segmentationId, segmentIndex, suppressEvents);
    }

    // Todo: this includes non-hydrated segmentations which might not be
    // persisted in the store
    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  }

  public removeSegment(segmentationId: string, segmentIndex: number): void {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    if (segmentIndex === 0) {
      throw new Error('Segment index 0 is reserved for "no label"');
    }

    if (!this._getSegmentInfo(segmentation, segmentIndex)) {
      return;
    }

    segmentation.segmentCount--;

    segmentation.segments[segmentIndex] = null;

    // Get volume and delete the labels
    // Todo: handle other segmentations other than labelmap
    const labelmapVolume = this.getLabelmapVolume(segmentationId);

    const { dimensions } = labelmapVolume;
    const voxelManager = labelmapVolume.voxelManager;

    // Set all values of this segment to zero and get which frames have been edited.
    const frameLength = dimensions[0] * dimensions[1];
    const numFrames = dimensions[2];

    let voxelIndex = 0;

    const modifiedFrames = new Set() as Set<number>;

    for (let frame = 0; frame < numFrames; frame++) {
      for (let p = 0; p < frameLength; p++) {
        if (voxelManager.getAtIndex(voxelIndex) === segmentIndex) {
          voxelManager.setAtIndex(voxelIndex, 0);
          modifiedFrames.add(frame);
        }

        voxelIndex++;
      }
    }

    const modifiedFramesArray: number[] = Array.from(modifiedFrames);

    // Trigger texture update of modified segmentation frames.
    cstSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
      segmentationId,
      modifiedFramesArray
    );

    if (segmentation.activeSegmentIndex === segmentIndex) {
      const segmentIndices = Object.keys(segmentation.segments);

      const newActiveSegmentIndex = segmentIndices.length ? Number(segmentIndices[0]) : 1;

      this._setActiveSegment(segmentationId, newActiveSegmentIndex, true);
    }

    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  }

  public setSegmentVisibility(
    segmentationId: string,
    segmentIndex: number,
    isVisible: boolean,
    viewportId?: string,
    suppressEvents = false
  ): void {
    this._setSegmentVisibility(segmentationId, segmentIndex, isVisible, viewportId, suppressEvents);
  }

  public setSegmentLocked(segmentationId: string, segmentIndex: number, isLocked: boolean): void {
    const suppressEvents = false;
    this._setSegmentLocked(segmentationId, segmentIndex, isLocked, suppressEvents);
  }

  /**
   * Toggles the locked state of a segment in a segmentation.
   * @param segmentationId - The ID of the segmentation.
   * @param segmentIndex - The index of the segment to toggle.
   */
  public toggleSegmentLocked(segmentationId: string, segmentIndex: number): void {
    const segmentation = this.getSegmentation(segmentationId);
    const segment = this._getSegmentInfo(segmentation, segmentIndex);
    const isLocked = !segment.isLocked;
    this._setSegmentLocked(segmentationId, segmentIndex, isLocked);
  }

  public setSegmentColor(
    segmentationId: string,
    segmentIndex: number,
    color: ohifTypes.RGB,
    viewportId?: string
  ): void {
    this._setSegmentColor(segmentationId, segmentIndex, color, viewportId);
  }

  public setSegmentRGBA = (
    segmentationId: string,
    segmentIndex: number,
    rgbaColor: csTypes.Color,
    viewportId?: string
  ): void => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const suppressEvents = true;
    this._setSegmentOpacity(segmentationId, segmentIndex, rgbaColor[3], viewportId, suppressEvents);

    this._setSegmentColor(
      segmentationId,
      segmentIndex,
      [rgbaColor[0], rgbaColor[1], rgbaColor[2]],
      viewportId,
      suppressEvents
    );

    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  };

  public setSegmentOpacity(
    segmentationId: string,
    segmentIndex: number,
    opacity: number,
    viewportId?: string
  ): void {
    this._setSegmentOpacity(segmentationId, segmentIndex, opacity, viewportId);
  }

  public setActiveSegmentationForViewport(segmentationId: string, viewportId?: string): void {
    const suppressEvents = false;
    this._setActiveSegmentationForViewport(segmentationId, viewportId, null, suppressEvents);
  }

  public setActiveSegment(segmentationId: string, segmentIndex: number): void {
    this._setActiveSegment(segmentationId, segmentIndex, false);
  }

  /**
   * Get all segmentations.
   *
   * * @param filterNonHydratedSegmentations - If true, only return hydrated segmentations
   * hydrated segmentations are those that have been loaded and persisted
   * in the state, but non hydrated segmentations are those that are
   * only created for the SEG displayset (SEG viewport) and the user might not
   * have loaded them yet fully.
   *

   * @return Array of segmentations
   */
  public getSegmentations(viewportId?: string): Segmentation[] {
    const segmentations = this._getSegmentations();

    if (!viewportId) {
      return segmentations;
    }

    const representations = cstSegmentation.state.getSegmentationRepresentations(viewportId);

    return representations.map(representation => this.segmentations[representation.segmentationId]);
  }

  private _getSegmentations(): Segmentation[] {
    const segmentations = this.arrayOfObjects(this.segmentations);
    return segmentations && segmentations.map(m => this.segmentations[Object.keys(m)[0]]);
  }

  public getActiveSegmentation(): Segmentation {
    const segmentations = this.getSegmentations();

    return segmentations.find(segmentation => segmentation.isActive);
  }

  public getActiveSegment() {
    const activeSegmentation = this.getActiveSegmentation();
    const { activeSegmentIndex, segments } = activeSegmentation;

    if (activeSegmentIndex === null) {
      return;
    }

    return segments[activeSegmentIndex];
  }

  /**
   * Get specific segmentation by its id.
   *
   * @param segmentationId If of the segmentation
   * @return segmentation instance
   */
  public getSegmentation(segmentationId: string): Segmentation {
    return this.segmentations[segmentationId];
  }

  public addOrUpdateSegmentation(
    segmentation: Segmentation,
    suppressEvents = false,
    notYetUpdatedAtSource = false
  ): string {
    const { id: segmentationId } = segmentation;
    let cachedSegmentation = this.segmentations[segmentationId];
    if (cachedSegmentation) {
      // Update the segmentation (mostly for assigning metadata/labels)
      Object.assign(cachedSegmentation, segmentation);

      this._updateCornerstoneSegmentations({
        segmentationId,
        notYetUpdatedAtSource,
      });

      if (!suppressEvents) {
        this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
          segmentation: cachedSegmentation,
        });
      }

      return segmentationId;
    }

    const representationType = segmentation.type;
    const representationData = segmentation.representationData[representationType];
    cstSegmentation.addSegmentations([
      {
        segmentationId,
        representation: {
          type: representationType,
          data: {
            ...representationData,
          },
        },
      },
    ]);

    this.segmentations[segmentationId] = {
      ...segmentation,
      label: segmentation.label || '',
      segments: segmentation.segments || [null],
      activeSegmentIndex: segmentation.activeSegmentIndex ?? null,
      segmentCount: segmentation.segmentCount ?? 0,
      isActive: false,
      isVisible: true,
    };

    cachedSegmentation = this.segmentations[segmentationId];

    this._updateCornerstoneSegmentations({
      segmentationId,
      notYetUpdatedAtSource: true,
    });

    if (!suppressEvents) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_ADDED, {
        segmentation: cachedSegmentation,
      });
    }

    return cachedSegmentation.id;
  }

  public async createSegmentationForSEGDisplaySet(
    segDisplaySet,
    segmentationId?: string,
    suppressEvents = false
  ): Promise<string> {
    // Todo: we only support creating labelmap for SEG displaySets for now
    const representationType = LABELMAP;

    segmentationId = segmentationId ?? segDisplaySet.displaySetInstanceUID;
    const defaultScheme = this._getDefaultSegmentationScheme();

    const referencedDisplaySetInstanceUID = segDisplaySet.referencedDisplaySetInstanceUID;
    const referencedDisplaySet = this.servicesManager.services.displaySetService.getDisplaySetByUID(
      referencedDisplaySetInstanceUID
    );

    const images = referencedDisplaySet.instances;

    if (!images.length) {
      throw new Error('No instances were provided for the referenced display set of the SEG');
    }

    const imageIds = images.map(image => image.imageId);

    const derivedSegmentationImages =
      await imageLoader.createAndCacheDerivedLabelmapImages(imageIds);

    const segmentationImageIds = derivedSegmentationImages.map(image => image.imageId);
    segDisplaySet.images = derivedSegmentationImages;

    const segmentsInfo = segDisplaySet.segMetadata.data;

    const segmentation: Segmentation = {
      ...defaultScheme,
      id: segmentationId,
      displaySetInstanceUID: segDisplaySet.displaySetInstanceUID,
      type: representationType,
      label: segDisplaySet.SeriesDescription,
      colorLUTIndex: null,
      FrameOfReferenceUID:
        segDisplaySet.FrameOfReferenceUID ?? segDisplaySet.instance.FrameOfReferenceUID,
      representationData: {
        [LABELMAP]: {
          imageIds: segmentationImageIds,
        },
      },
    };

    const cachedSegmentation = this.getSegmentation(segmentationId);
    if (cachedSegmentation) {
      // if the labelmap with the same segmentationId already exists, we can
      // just assume that the segmentation is already created and move on with
      // updating the state
      return this.addOrUpdateSegmentation(
        Object.assign(segmentation, cachedSegmentation),
        suppressEvents
      );
    }

    const { labelmapBufferArray } = segDisplaySet;

    if (!labelmapBufferArray) {
      throw new Error('SEG reading failed');
    }

    // now we need to chop the volume array into chunks and set the scalar data for each derived segmentation image
    const volumeScalarData = new Uint8Array(labelmapBufferArray[0]);

    // We should parse the segmentation as separate slices to support overlapping segments.
    // This parsing should occur in the CornerstoneJS library adapters.
    // For now, we use the volume returned from the library and chop it here.
    for (let i = 0; i < derivedSegmentationImages.length; i++) {
      const voxelManager = derivedSegmentationImages[i].voxelManager as Types.IVoxelManager<number>;
      const scalarData = voxelManager.getScalarData();
      scalarData.set(volumeScalarData.slice(i * scalarData.length, (i + 1) * scalarData.length));
      voxelManager.setScalarData(scalarData);
    }

    segmentation.segments = segmentsInfo.map((segmentInfo, segmentIndex) => {
      if (segmentIndex === 0) {
        return;
      }

      const {
        SegmentedPropertyCategoryCodeSequence,
        SegmentNumber,
        SegmentLabel,
        SegmentAlgorithmType,
        SegmentAlgorithmName,
        SegmentedPropertyTypeCodeSequence,
        rgba,
      } = segmentInfo;

      const { x, y, z } = segDisplaySet.centroids.get(segmentIndex) || { x: 0, y: 0, z: 0 };
      // const centerWorld = derivedVolume.imageData.indexToWorld([x, y, z]);

      segmentation.cachedStats = {
        ...segmentation.cachedStats,
        segmentCenter: {
          ...segmentation.cachedStats.segmentCenter,
          [segmentIndex]: {
            center: {
              image: [x, y, z],
              // world: centerWorld,
            },
            modifiedTime: segDisplaySet.SeriesDate,
          },
        },
      };

      return {
        label: SegmentLabel || `Segment ${SegmentNumber}`,
        segmentIndex: Number(SegmentNumber),
        category: SegmentedPropertyCategoryCodeSequence
          ? SegmentedPropertyCategoryCodeSequence.CodeMeaning
          : '',
        type: SegmentedPropertyTypeCodeSequence
          ? SegmentedPropertyTypeCodeSequence.CodeMeaning
          : '',
        algorithmType: SegmentAlgorithmType,
        algorithmName: SegmentAlgorithmName,
        color: rgba,
        opacity: 255,
        isVisible: true,
        isLocked: false,
      };
    });

    segmentation.segmentCount = segmentsInfo.length - 1;

    segDisplaySet.isLoaded = true;

    this._broadcastEvent(EVENTS.SEGMENTATION_LOADING_COMPLETE, {
      segmentationId,
      segDisplaySet,
    });

    return this.addOrUpdateSegmentation(segmentation, suppressEvents);
  }

  public async createSegmentationForRTDisplaySet(
    rtDisplaySet,
    segmentationId?: string,
    suppressEvents = false
  ): Promise<string> {
    // Todo: we currently only have support for contour representation for initial
    // RT display
    const representationType = CONTOUR;
    segmentationId = segmentationId ?? rtDisplaySet.displaySetInstanceUID;
    const { structureSet } = rtDisplaySet;

    if (!structureSet) {
      throw new Error(
        'To create the contours from RT displaySet, the displaySet should be loaded first, you can perform rtDisplaySet.load() before calling this method.'
      );
    }

    const defaultScheme = this._getDefaultSegmentationScheme();
    const rtDisplaySetUID = rtDisplaySet.displaySetInstanceUID;

    const allRTStructData = mapROIContoursToRTStructData(structureSet, rtDisplaySetUID);

    // sort by segmentIndex
    allRTStructData.sort((a, b) => a.segmentIndex - b.segmentIndex);

    const geometryIds = allRTStructData.map(({ geometryId }) => geometryId);

    const segmentation: Segmentation = {
      ...defaultScheme,
      id: segmentationId,
      displaySetInstanceUID: rtDisplaySetUID,
      type: representationType,
      label: rtDisplaySet.SeriesDescription,
      representationData: {
        [CONTOUR]: {
          geometryIds,
        },
      },
    };

    const cachedSegmentation = this.getSegmentation(segmentationId);

    if (cachedSegmentation) {
      // if the labelmap with the same segmentationId already exists, we can
      // just assume that the segmentation is already created and move on with
      // updating the state
      return this.addOrUpdateSegmentation(
        Object.assign(segmentation, cachedSegmentation),
        suppressEvents
      );
    }

    if (!structureSet.ROIContours?.length) {
      throw new Error(
        'The structureSet does not contain any ROIContours. Please ensure the structureSet is loaded first.'
      );
    }
    const segmentsCachedStats = {};
    const initializeContour = async rtStructData => {
      const { data, id, color, segmentIndex, geometryId } = rtStructData;

      // catch error instead of failing to allow loading to continue
      try {
        const geometry = await geometryLoader.createAndCacheGeometry(geometryId, {
          geometryData: {
            data,
            id,
            color,
            frameOfReferenceUID: structureSet.frameOfReferenceUID,
            segmentIndex,
          },
          type: csEnums.GeometryType.Contour,
        });

        const contourSet = geometry.data;
        const centroid = (contourSet as csTypes.IContourSet).getCentroid();

        segmentsCachedStats[segmentIndex] = {
          center: { world: centroid },
          modifiedTime: rtDisplaySet.SeriesDate, // we use the SeriesDate as the modifiedTime since this is the first time we are creating the segmentation
        };

        segmentation.segments[segmentIndex] = {
          label: id,
          segmentIndex,
          color,
          ...SEGMENT_CONSTANT,
        };

        const numInitialized = Object.keys(segmentsCachedStats).length;

        // Calculate percentage completed
        const percentComplete = Math.round((numInitialized / allRTStructData.length) * 100);
        this._broadcastEvent(EVENTS.SEGMENT_LOADING_COMPLETE, {
          percentComplete,
          // Note: this is not the geometryIds length since there might be
          // some missing ROINumbers
          numSegments: allRTStructData.length,
        });
      } catch (e) {
        console.warn(e);
      }
    };

    const promiseArray = [];

    for (let i = 0; i < allRTStructData.length; i++) {
      const promise = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          initializeContour(allRTStructData[i]).then(() => {
            resolve();
          });
        }, 0);
      });

      promiseArray.push(promise);
    }

    await Promise.all(promiseArray);

    segmentation.segmentCount = allRTStructData.length;
    rtDisplaySet.isLoaded = true;

    segmentation.cachedStats = {
      ...segmentation.cachedStats,
      segmentCenter: {
        ...segmentation.cachedStats.segmentCenter,
        ...segmentsCachedStats,
      },
    };

    this._broadcastEvent(EVENTS.SEGMENTATION_LOADING_COMPLETE, {
      segmentationId,
      rtDisplaySet,
    });

    return this.addOrUpdateSegmentation(segmentation, suppressEvents);
  }

  // Todo: this should not run on the main thread
  public calculateCentroids = (
    segmentationId: string,
    segmentIndex?: number
  ): Map<number, { x: number; y: number; z: number; world: number[] }> => {
    const segmentation = this.getSegmentation(segmentationId);
    const volume = this.getLabelmapVolume(segmentationId);
    const { dimensions, imageData } = volume;
    const volumeVoxelManager = volume.voxelManager;
    const [dimX, dimY, numFrames] = dimensions;
    const frameLength = dimX * dimY;

    const segmentIndices = segmentIndex
      ? [segmentIndex]
      : segmentation.segments
          .filter(segment => segment?.segmentIndex)
          .map(segment => segment.segmentIndex);

    const segmentIndicesSet = new Set(segmentIndices);

    const centroids = new Map();
    for (const index of segmentIndicesSet) {
      centroids.set(index, { x: 0, y: 0, z: 0, count: 0 });
    }

    let voxelIndex = 0;
    for (let frame = 0; frame < numFrames; frame++) {
      for (let p = 0; p < frameLength; p++) {
        const segmentIndex = volumeVoxelManager.getAtIndex(voxelIndex++) as number;
        if (segmentIndicesSet.has(segmentIndex)) {
          const centroid = centroids.get(segmentIndex);
          centroid.x += p % dimX;
          centroid.y += (p / dimX) | 0;
          centroid.z += frame;
          centroid.count++;
        }
      }
    }

    const result = new Map();
    for (const [index, centroid] of centroids) {
      const count = centroid.count;
      const normalizedCentroid = {
        x: centroid.x / count,
        y: centroid.y / count,
        z: centroid.z / count,
        world: null,
      };
      normalizedCentroid.world = imageData.indexToWorld([
        normalizedCentroid.x,
        normalizedCentroid.y,
        normalizedCentroid.z,
      ]);
      result.set(index, normalizedCentroid);
    }

    this.setCentroids(segmentationId, result);
    return result;
  };

  private setCentroids = (
    segmentationId: string,
    centroids: Map<number, { image: number[]; world?: number[] }>
  ): void => {
    const segmentation = this.getSegmentation(segmentationId);
    const imageData = this.getLabelmapVolume(segmentationId).imageData; // Assuming this method returns imageData

    if (!segmentation.cachedStats) {
      segmentation.cachedStats = { segmentCenter: {} };
    } else if (!segmentation.cachedStats.segmentCenter) {
      segmentation.cachedStats.segmentCenter = {};
    }

    for (const [segmentIndex, centroid] of centroids) {
      let world = centroid.world;

      // If world coordinates are not provided, calculate them
      if (!world || world.length === 0) {
        world = imageData.indexToWorld(centroid.image) as number[];
      }

      segmentation.cachedStats.segmentCenter[segmentIndex] = {
        center: {
          image: centroid.image,
          world: world,
        },
      };
    }

    this.addOrUpdateSegmentation(segmentation, true, true);
  };

  public jumpToSegmentCenter(
    segmentationId: string,
    segmentIndex: number,
    viewportId: string,
    highlightAlpha = 0.9,
    highlightSegment = true,
    animationLength = 750,
    highlightHideOthers = false,
    highlightFunctionType = 'ease-in-out' // todo: make animation functions configurable from outside
  ): void {
    const center = this._getSegmentCenter(segmentationId, segmentIndex);

    if (!center?.world) {
      return;
    }

    const { world } = center;

    // need to find which viewports are displaying the segmentation
    const viewportIds = this.getViewportIdsWithSegmentation(segmentationId);

    viewportIds.forEach(viewportId => {
      const { viewport } = getEnabledElementByViewportId(viewportId);
      cstUtils.viewport.jumpToWorld(viewport as csTypes.IVolumeViewport, world);

      if (highlightSegment) {
        this.highlightSegment(
          segmentationId,
          segmentIndex,
          viewportId,
          highlightAlpha,
          animationLength,
          highlightHideOthers,
          highlightFunctionType
        );
      }
    });
  }

  public highlightSegment(
    segmentationId: string,
    segmentIndex: number,
    viewportId?: string,
    alpha = 0.9,
    animationLength = 750,
    hideOthers = true,
    highlightFunctionType = 'ease-in-out'
  ): void {
    if (this.highlightIntervalId) {
      clearInterval(this.highlightIntervalId);
    }

    const segmentation = this.getSegmentation(segmentationId);

    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      viewportId
    );

    const { type } = segmentationRepresentation;
    const { segments } = segmentation;

    const highlightFn =
      type === LABELMAP ? this._highlightLabelmap.bind(this) : this._highlightContour.bind(this);

    const adjustedAlpha = type === LABELMAP ? alpha : 1 - alpha;

    highlightFn(
      segmentIndex,
      adjustedAlpha,
      hideOthers,
      segments,
      viewportId,
      animationLength,
      segmentationRepresentation
    );
  }

  public createSegmentationForDisplaySet = async (
    displaySetInstanceUID: string,
    options?: {
      segmentationId?: string;
      FrameOfReferenceUID?: string;
      label: string;
      representationType?: csToolsEnums.SegmentationRepresentations;
    }
  ): Promise<string> => {
    const { displaySetService } = this.servicesManager.services;

    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

    // Todo: we currently only support labelmap for segmentation for a displaySet
    const representationType = options?.representationType ?? LABELMAP;

    const volumeId = this._getVolumeIdForDisplaySet(displaySet);
    const segmentationId = options?.segmentationId ?? `${csUtils.uuidv4()}`;
    const referenceImageIds = displaySet.images.map(image => image.imageId);
    const derivedImages = await imageLoader.createAndCacheDerivedLabelmapImages(referenceImageIds);

    const segImageIds = derivedImages.map(image => image.imageId);

    const defaultScheme = this._getDefaultSegmentationScheme();

    const segmentation: Segmentation = {
      ...defaultScheme,
      id: segmentationId,
      displaySetInstanceUID,
      label: options?.label,
      // We should set it as active by default, as it created for display
      isActive: true,
      type: representationType,
      FrameOfReferenceUID: (options?.FrameOfReferenceUID ||
        displaySet.instances?.[0]?.FrameOfReferenceUID) as string,
      representationData: {
        [LABELMAP]: {
          imageIds: segImageIds,
          referencedVolumeId: volumeId,
          referencedImageIds: referenceImageIds,
        },
      },
      description: `S${displaySet.SeriesNumber}: ${displaySet.SeriesDescription}`,
    };

    this.addOrUpdateSegmentation(segmentation);

    return segmentationId;
  };

  /**
   * Toggles the visibility of a segmentation in the state, and broadcasts the event.
   * Note: this method does not update the segmentation state in the source. It only
   * updates the state, and there should be separate listeners for that.
   * @param ids segmentation ids
   */
  public toggleSegmentationVisibility = (segmentationId: string): void => {
    this._toggleSegmentationVisibility(segmentationId, false);
  };

  /**
   * Adds a segmentation representation to a specified viewport.
   *
   * @param params - The parameters for adding the segmentation representation.
   * @param params.viewportId - The ID of the viewport to add the representation to.
   * @param params.segmentationId - The ID of the segmentation to represent.
   * @param [params.segmentationRepresentationUID=null] - The UID of an existing segmentation representation. If provided and valid, this representation will be used; otherwise, a new one will be created.
   * @param [params.hydrateSegmentation=false] - Whether to hydrate the segmentation if it's not already hydrated.
   * @param [params.representationType=csToolsEnums.SegmentationRepresentations.Labelmap] - The type of representation to create if a new one is needed.
   * @param [params.suppressEvents=false] - Whether to suppress broadcasting of events related to this operation.
   * @returns A promise that resolves when the operation is complete.
   * @throws Error if the specified segmentation is not found.
   */

  public addSegmentationRepresentationToViewport = async ({
    viewportId,
    segmentationId,
    useExistingRepresentationIfExist = false,
    hydrateSegmentation = false,
    representationType = csToolsEnums.SegmentationRepresentations.Labelmap,
    suppressEvents = false,
  }: {
    viewportId: string;
    segmentationId: string;
    hydrateSegmentation?: boolean;
    useExistingRepresentationIfExist?: boolean;
    representationType?: csToolsEnums.SegmentationRepresentations;
    suppressEvents?: boolean;
  }): Promise<void> => {
    const segmentation = this.getSegmentation(segmentationId);

    if (!segmentation) {
      throw new Error(`Segmentation with segmentationId ${segmentationId} not found.`);
    }

    if (hydrateSegmentation) {
      segmentation.hydrated = true;
    }

    let addedSegmentationRepresentationUID = null;

    const representations =
      cstSegmentation.state.getSegmentationRepresentationsForSegmentation(segmentationId);
    const alreadyHasRepresentation = representations?.length > 0;

    if (useExistingRepresentationIfExist && alreadyHasRepresentation) {
      const representation = representations[0];
      cstSegmentation.addSegmentationRepresentations(viewportId, [
        {
          type: representationType,
          segmentationId,
          options: {
            segmentationRepresentationUID: representation.segmentationRepresentationUID,
          },
        },
      ]);

      addedSegmentationRepresentationUID = representation.segmentationRepresentationUID;
    } else {
      addedSegmentationRepresentationUID = await this.createNewRepresentation(
        viewportId,
        segmentationId,
        segmentation,
        representationType
      );
    }

    this._setActiveSegmentationForViewport(
      segmentationId,
      viewportId,
      addedSegmentationRepresentationUID
    );

    await this.updateSegmentProperties(segmentation, segmentationId, viewportId);

    if (!suppressEvents) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, { segmentation });
      this._broadcastEvent(this.EVENTS.SEGMENTATION_REPRESENTATION_ADDED, {
        segmentationRepresentationUID: addedSegmentationRepresentationUID,
        segmentationId,
        viewportId,
      });
    }
  };

  private createNewRepresentation = async (
    viewportId: string,
    segmentationId: string,
    segmentation: Segmentation,
    representationType: csToolsEnums.SegmentationRepresentations
  ): Promise<string> => {
    const colorLUT = this.createColorLUT(segmentation);
    const colorLUTIndex = cstSegmentation.config.color.addColorLUT(colorLUT);

    const [uid] = await cstSegmentation.addSegmentationRepresentations(viewportId, [
      {
        segmentationId,
        type: representationType,
        options: { colorLUTOrIndex: colorLUTIndex },
      },
    ]);

    return uid;
  };

  private createColorLUT = (segmentation: Segmentation): ColorLUT => {
    const colorLUT = Array.from({ length: segmentation.segments.length }, (_, index) => {
      if (index === 0) {
        return [0, 0, 0, 0];
      }
      const segment = segmentation.segments[index];
      return segment ? [...segment.color, 255] : [0, 0, 0, 0];
    }) as ColorLUT;

    return colorLUT;
  };

  private updateSegmentProperties = async (
    segmentation: Segmentation,
    segmentationId: string,
    viewportId: string
  ): Promise<void> => {
    for (const segment of segmentation.segments) {
      if (segment == null) {
        continue;
      }

      const { segmentIndex, isLocked, isVisible, opacity } = segment;
      const suppressEvents = true;

      if (opacity !== undefined) {
        await this._setSegmentOpacity(
          segmentationId,
          segmentIndex,
          opacity,
          viewportId,
          suppressEvents
        );
      }

      if (isVisible !== undefined) {
        await this._setSegmentVisibility(
          segmentationId,
          segmentIndex,
          isVisible,
          viewportId,
          suppressEvents
        );
      }

      if (isLocked) {
        await this._setSegmentLocked(segmentationId, segmentIndex, isLocked, suppressEvents);
      }
    }
  };

  public setSegmentRGBAColor = (
    segmentationId: string,
    segmentIndex: number,
    rgbaColor,
    viewportId?: string
  ) => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    this._setSegmentOpacity(
      segmentationId,
      segmentIndex,
      rgbaColor[3],
      viewportId, // viewportId
      true
    );
    this._setSegmentColor(
      segmentationId,
      segmentIndex,
      [rgbaColor[0], rgbaColor[1], rgbaColor[2]],
      viewportId, // viewportId
      true
    );

    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  };

  public getViewportIdsWithSegmentation = (segmentationId: string): string[] => {
    const viewportIds = cstSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
    return viewportIds;
  };

  public hydrateSegmentation = (segmentationId: string, suppressEvents = false): void => {
    const segmentation = this.getSegmentation(segmentationId);

    if (!segmentation) {
      throw new Error(`Segmentation with segmentationId ${segmentationId} not found.`);
    }
    segmentation.hydrated = true;

    // Not all segmentations have dipslaySets, some of them are derived in the client
    this._setDisplaySetIsHydrated(segmentationId, true);

    if (!suppressEvents) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _setDisplaySetIsHydrated(displaySetUID: string, isHydrated: boolean): void {
    const { displaySetService } = this.servicesManager.services;
    const displaySet = displaySetService.getDisplaySetByUID(displaySetUID);

    if (!displaySet) {
      return;
    }

    displaySet.isHydrated = isHydrated;
    displaySetService.setDisplaySetMetadataInvalidated(displaySetUID, false);

    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation: this.getSegmentation(displaySetUID),
    });
  }

  private _highlightLabelmap(
    segmentIndex: number,
    alpha: number,
    hideOthers: boolean,
    segments: Segment[],
    viewportId: string,
    animationLength: number,
    segmentationRepresentation: cstTypes.SegmentationRepresentation
  ) {
    const newSegmentSpecificConfig = {
      [segmentIndex]: {
        [LABELMAP]: {
          fillAlpha: alpha,
        },
      },
    };

    if (hideOthers) {
      for (let i = 0; i < segments.length; i++) {
        if (i !== segmentIndex) {
          newSegmentSpecificConfig[i] = {
            [LABELMAP]: {
              fillAlpha: 0,
            },
          };
        }
      }
    }

    const { fillAlpha } = this.getConfiguration(viewportId);

    let startTime: number = null;
    const animation = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / animationLength, 1);

      cstSegmentation.config.setSegmentIndexConfig(
        segmentationRepresentation.segmentationRepresentationUID,
        segmentIndex,
        {
          [segmentIndex]: {
            [LABELMAP]: {
              fillAlpha: easeInOutBell(progress, fillAlpha),
            },
          },
        }
      );

      if (progress < 1) {
        requestAnimationFrame(animation);
      } else {
        cstSegmentation.config.setSegmentIndexConfig(
          segmentationRepresentation.segmentationRepresentationUID,
          segmentIndex,
          {}
        );
      }
    };

    requestAnimationFrame(animation);
  }

  private _highlightContour(
    segmentIndex: number,
    alpha: number,
    hideOthers: boolean,
    segments: Segment[],
    viewportId: string,
    animationLength: number,
    segmentationRepresentation: cstTypes.SegmentationRepresentation
  ) {
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const progress = (currentTime - startTime) / animationLength;
      if (progress >= 1) {
        cstSegmentation.config.setSegmentIndexConfig(
          segmentationRepresentation.segmentationRepresentationUID,
          segmentIndex,
          {}
        );
        return;
      }

      const reversedProgress = reverseEaseInOutBell(progress, 0.1);
      cstSegmentation.config.setSegmentIndexConfig(
        segmentationRepresentation.segmentationRepresentationUID,
        segmentIndex,
        {
          [segmentIndex]: {
            [CONTOUR]: {
              outlineOpacity: reversedProgress,
              fillAlpha: reversedProgress,
            },
          },
        }
      );

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
  public removeSegmentationRepresentationFromViewport({
    viewportId,
    segmentationRepresentationUIDsIds,
    segmentationId,
  }: {
    viewportId: string;
    segmentationRepresentationUIDsIds?: string[];
    segmentationId?: string;
  }): void {
    const uids =
      segmentationRepresentationUIDsIds || segmentationId
        ? cstSegmentation.state
            .getSegmentationRepresentationsForSegmentation(segmentationId)
            .map(rep => rep.segmentationRepresentationUID)
        : cstSegmentation.state
            .getSegmentationRepresentations(viewportId)
            .map(rep => rep.segmentationRepresentationUID);

    cstSegmentation.removeSegmentationRepresentationsFromViewport(viewportId, uids);

    this._broadcastEvent(this.EVENTS.SEGMENTATION_REPRESENTATION_REMOVED, {
      segmentationRepresentationUIDs: uids,
    });
  }

  /**
   * Removes a segmentation and broadcasts the removed event.
   *
   * @param {string} segmentationId The segmentation id
   */
  public remove(segmentationId: string): void {
    const segmentation = this.segmentations[segmentationId];
    const wasActive = segmentation.isActive;

    if (!segmentationId || !segmentation) {
      console.warn(`No segmentationId provided, or unable to find segmentation by id.`);
      return;
    }

    const { updatedViewportIds } = this._removeSegmentationFromCornerstone(segmentationId);

    delete this.segmentations[segmentationId];

    // If this segmentation was active, and there is another segmentation, set another one active.

    if (wasActive) {
      const remainingSegmentations = this._getSegmentations();

      const remainingHydratedSegmentations = remainingSegmentations.filter(
        segmentation => segmentation.hydrated
      );

      if (remainingHydratedSegmentations.length) {
        const { id } = remainingHydratedSegmentations[0];

        updatedViewportIds.forEach(viewportId => {
          this._setActiveSegmentationForViewport(id, viewportId, null);
        });
      }
    }

    this._setDisplaySetIsHydrated(segmentationId, false);

    this._broadcastEvent(this.EVENTS.SEGMENTATION_REMOVED, {
      segmentationId,
    });
  }

  public getSegmentationRepresentationsForViewport(
    viewportId: string
  ): cstTypes.SegmentationRepresentation[] {
    return cstSegmentation.state.getSegmentationRepresentations(viewportId);
  }

  public getConfiguration = (viewportId?: string): SegmentationConfig => {
    const brushSize = 1;

    const brushThresholdGate = 1;

    const segmentationRepresentations = this.getSegmentationRepresentationsForViewport(viewportId);

    const typeToUse = segmentationRepresentations?.[0]?.type || LABELMAP;

    const config = cstSegmentation.config.getGlobalConfig();
    const { renderInactiveRepresentations } = config;

    const representation = config.representations[typeToUse];

    const {
      renderOutline,
      outlineWidthActive,
      renderFill,
      fillAlpha,
      fillAlphaInactive,
      outlineOpacity,
      outlineOpacityInactive,
    } = representation as LabelmapConfig;

    return {
      brushSize,
      brushThresholdGate,
      fillAlpha,
      fillAlphaInactive,
      outlineWidthActive,
      renderFill,
      renderInactiveRepresentations,
      renderOutline,
      outlineOpacity,
      outlineOpacityInactive,
    };
  };

  public setConfiguration = (configuration: SegmentationConfig): void => {
    const {
      fillAlpha,
      fillAlphaInactive,
      outlineWidthActive,
      outlineOpacity,
      renderFill,
      renderInactiveRepresentations,
      renderOutline,
    } = configuration;

    const setConfigValueIfDefined = (key, value, transformFn = null) => {
      if (value !== undefined) {
        const transformedValue = transformFn ? transformFn(value) : value;
        this._setSegmentationConfig(key, transformedValue);
      }
    };

    setConfigValueIfDefined('renderOutline', renderOutline);
    setConfigValueIfDefined('outlineWidthActive', outlineWidthActive);
    setConfigValueIfDefined('outlineOpacity', outlineOpacity, v => v / 100);
    setConfigValueIfDefined('fillAlpha', fillAlpha, v => v / 100);
    setConfigValueIfDefined('renderFill', renderFill);
    setConfigValueIfDefined('fillAlphaInactive', fillAlphaInactive, v => v / 100);
    setConfigValueIfDefined('outlineOpacityInactive', fillAlphaInactive, v =>
      Math.max(0.75, v / 100)
    );

    if (renderInactiveRepresentations !== undefined) {
      const config = cstSegmentation.config.getGlobalConfig();
      config.renderInactiveRepresentations = renderInactiveRepresentations;
      cstSegmentation.config.setGlobalConfig(config);
    }

    this._broadcastEvent(this.EVENTS.SEGMENTATION_CONFIGURATION_CHANGED, this.getConfiguration());
  };

  public getLabelmapVolume = (segmentationId: string) => {
    if (!this.segmentations?.[segmentationId]) {
      return;
    }

    const labelmapVolumeData = this.segmentations[segmentationId].representationData
      .Labelmap as LabelmapSegmentationDataVolume;

    const volumeId = labelmapVolumeData.volumeId;

    return cache.getVolume(volumeId);
  };

  public getLabelmapReferencedVolume = (segmentationId: string) => {
    const labelmapVolumeData = this.segmentations[segmentationId].representationData
      .Labelmap as LabelmapSegmentationDataVolume;

    const volumeId = labelmapVolumeData.referencedVolumeId;

    return cache.getVolume(volumeId);
  };

  public setSegmentLabel(segmentationId: string, segmentIndex: number, label: string) {
    this._setSegmentLabel(segmentationId, segmentIndex, label);
  }

  public shouldRenderSegmentation(viewportDisplaySetInstanceUIDs, segmentationFrameOfReferenceUID) {
    if (!viewportDisplaySetInstanceUIDs?.length) {
      return false;
    }

    const { displaySetService } = this.servicesManager.services;

    let shouldDisplaySeg = false;

    // check if the displaySet is sharing the same frameOfReferenceUID
    // with the new segmentation
    for (const displaySetInstanceUID of viewportDisplaySetInstanceUIDs) {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      // Todo: this might not be ideal for use cases such as 4D, since we
      // don't want to show the segmentation for all the frames
      if (
        displaySet.isReconstructable &&
        displaySet?.images?.[0]?.FrameOfReferenceUID === segmentationFrameOfReferenceUID
      ) {
        shouldDisplaySeg = true;
        break;
      }
    }

    return shouldDisplaySeg;
  }

  private _getDefaultSegmentationScheme(): Partial<Segmentation> {
    return {
      activeSegmentIndex: 1,
      cachedStats: {},
      label: '',
      segmentsLocked: [],
      displayText: [],
      hydrated: false, // by default we don't hydrate the segmentation for SEG displaySets
      segmentCount: 0,
      segments: [],
      isVisible: true,
      isActive: false,
    };
  }

  private _setActiveSegmentationForViewport(
    segmentationId: string,
    viewportId: string,
    segmentationRepresentationUID?: string,
    suppressEvents = false
  ) {
    let representationUIDToUse = segmentationRepresentationUID;
    const targetSegmentation = this.getSegmentation(segmentationId);

    if (!segmentationRepresentationUID) {
      const segmentations = this._getSegmentations();

      if (targetSegmentation === undefined) {
        throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
      }

      segmentations.forEach(segmentation => {
        segmentation.isActive = segmentation.id === segmentationId;
      });

      const representation = this._getSegmentationRepresentation(segmentationId, viewportId);

      if (!representation) {
        throw new Error('Must add representation to viewport before setting segments');
      }

      representationUIDToUse = representation.segmentationRepresentationUID;
    }

    cstSegmentation.activeSegmentation.setActiveSegmentationRepresentation(
      viewportId,
      representationUIDToUse
    );

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation: targetSegmentation,
      });
    }
  }

  private _toggleSegmentationVisibility = (segmentationId: string, suppressEvents = false) => {
    const segmentation = this.segmentations[segmentationId];

    if (!segmentation) {
      throw new Error(`Segmentation with segmentationId ${segmentationId} not found.`);
    }

    segmentation.isVisible = !segmentation.isVisible;

    this._updateCornerstoneSegmentationVisibility(segmentationId);

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _setActiveSegment(segmentationId: string, segmentIndex: number, suppressEvents = false) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    cstSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, segmentIndex);

    segmentation.activeSegmentIndex = segmentIndex;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  private _getSegmentInfo(segmentation: Segmentation, segmentIndex: number) {
    const segments = segmentation.segments;

    if (!segments) {
      return;
    }

    if (segments && segments.length > 0) {
      return segments[segmentIndex];
    }
  }

  private _getVolumeIdForDisplaySet(displaySet) {
    const volumeLoaderSchema = displaySet.volumeLoaderSchema ?? VOLUME_LOADER_SCHEME;

    return `${volumeLoaderSchema}:${displaySet.displaySetInstanceUID}`;
  }

  private _setSegmentColor = (
    segmentationId: string,
    segmentIndex: number,
    color: ohifTypes.RGB,
    viewportId?: string,
    suppressEvents = false
  ) => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(`Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`);
    }

    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      viewportId
    );

    if (!segmentationRepresentation) {
      throw new Error('Must add representation to viewport before setting segments');
    }
    const { segmentationRepresentationUID } = segmentationRepresentation;

    const rgbaColor = cstSegmentation.config.color.getSegmentIndexColor(
      segmentationRepresentationUID,
      segmentIndex
    );

    cstSegmentation.config.color.setSegmentIndexColor(segmentationRepresentationUID, segmentIndex, [
      ...color,
      rgbaColor[3],
    ]);

    segmentInfo.color = color;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _getSegmentCenter(segmentationId, segmentIndex) {
    const segmentation = this.getSegmentation(segmentationId);

    if (!segmentation) {
      return;
    }

    const { cachedStats } = segmentation;

    if (!cachedStats) {
      return;
    }

    const { segmentCenter } = cachedStats;

    if (!segmentCenter) {
      return;
    }

    const { center } = segmentCenter[segmentIndex];

    return center;
  }

  private _setSegmentLocked(
    segmentationId: string,
    segmentIndex: number,
    isLocked: boolean,
    suppressEvents = false
  ) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(`Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`);
    }

    segmentInfo.isLocked = isLocked;

    cstSegmentation.segmentLocking.setSegmentIndexLocked(segmentationId, segmentIndex, isLocked);

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  private _setSegmentVisibility(
    segmentationId: string,
    segmentIndex: number,
    isVisible: boolean,
    viewportId?: string,
    suppressEvents = false
  ) {
    const { segmentationRepresentationUID, segmentation } = this._getSegmentationInfo(
      segmentationId,
      viewportId
    );

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      return;
    }

    segmentInfo.isVisible = isVisible;

    cstSegmentation.config.visibility.setSegmentIndexVisibility(
      viewportId,
      segmentationRepresentationUID,
      segmentIndex,
      isVisible
    );

    // make sure to update the isVisible flag on the segmentation
    // if a segment becomes invisible then the segmentation should be invisible
    // in the status as well, and show correct icon
    segmentation.isVisible = segmentation.segments
      .filter(Boolean)
      .every(segment => segment.isVisible);

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  private _setSegmentOpacity = (
    segmentationId: string,
    segmentIndex: number,
    opacity: number,
    viewportId?: string,
    suppressEvents = false
  ) => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(`Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`);
    }

    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      viewportId
    );

    if (!segmentationRepresentation) {
      throw new Error('Must add representation to viewport before setting segments');
    }
    const { segmentationRepresentationUID } = segmentationRepresentation;

    const rgbaColor = cstSegmentation.config.color.getSegmentIndexColor(
      segmentationRepresentationUID,
      segmentIndex
    );

    cstSegmentation.config.color.setSegmentIndexColor(segmentationRepresentationUID, segmentIndex, [
      rgbaColor[0],
      rgbaColor[1],
      rgbaColor[2],
      opacity,
    ]);

    segmentInfo.opacity = opacity;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _setSegmentLabel(
    segmentationId: string,
    segmentIndex: number,
    segmentLabel: string,
    suppressEvents = false
  ) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(`Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`);
    }

    segmentInfo.label = segmentLabel;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  /**
   * Retrieves the segmentation representation for a given segmentation ID and viewport ID.
   * If the viewport ID is not provided, it retrieves the first representation for the segmentation ID.
   *
   * @param segmentationId - The ID of the segmentation.
   * @param viewportId - The ID of the viewport. Optional.
   * @returns segmentation representation, or undefined if not found.
   */
  private _getSegmentationRepresentation(segmentationId, viewportId) {
    if (!viewportId) {
      const reps =
        cstSegmentation.state.getSegmentationRepresentationsForSegmentation(segmentationId);

      if (reps.length === 0) {
        return;
      }

      return reps[0];
    }

    const representation = cstSegmentation.state
      .getSegmentationRepresentations(viewportId)
      ?.find(representation => representation.segmentationId === segmentationId);

    return representation;
  }

  private _setSegmentationConfig = (property, value) => {
    // Todo: currently we only support global config, and we get the type
    // from the first segmentation
    const typeToUse = this.getSegmentations()[0].type;

    const { cornerstoneViewportService } = this.servicesManager.services;

    const config = cstSegmentation.config.getGlobalConfig();

    config.representations[typeToUse][property] = value;

    // Todo: add non global (representation specific config as well)
    cstSegmentation.config.setGlobalConfig(config);

    const renderingEngine = cornerstoneViewportService.getRenderingEngine();
    const viewportIds = cornerstoneViewportService.getViewportIds();

    renderingEngine.renderViewports(viewportIds);
  };

  private _initSegmentationService() {
    // Connect Segmentation Service to Cornerstone3D.
    eventTarget.addEventListener(
      csToolsEnums.Events.SEGMENTATION_MODIFIED,
      this._onSegmentationModifiedFromSource
    );

    eventTarget.addEventListener(
      csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
      this._onSegmentationDataModified
    );
  }

  private _onSegmentationDataModified = evt => {
    const { segmentationId } = evt.detail;

    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      // Part of add operation, not update operation, exit early.
      return;
    }

    this._broadcastEvent(this.EVENTS.SEGMENTATION_DATA_MODIFIED, {
      segmentation,
    });
  };

  private _onSegmentationModifiedFromSource = evt => {
    const { segmentationId } = evt.detail;

    const segmentation = this.segmentations[segmentationId];

    if (segmentation === undefined) {
      // Part of add operation, not update operation, exit early.
      return;
    }

    const segmentationState = cstSegmentation.state.getSegmentation(segmentationId);

    if (!segmentationState) {
      return;
    }

    const { activeSegmentIndex, cachedStats, segmentsLocked, label, type } = segmentationState;

    if (![LABELMAP, CONTOUR].includes(type)) {
      throw new Error(
        `Unsupported segmentation type: ${type}. Only ${LABELMAP} and ${CONTOUR} are supported.`
      );
    }

    const representationData = segmentationState.representationData[type];

    // TODO: handle other representations when available in cornerstone3D
    const segmentationSchema = {
      ...segmentation,
      activeSegmentIndex,
      cachedStats,
      displayText: [],
      id: segmentationId,
      label,
      segmentsLocked,
      type,
      representationData: {
        [type]: {
          ...representationData,
        },
      },
    };

    try {
      this.addOrUpdateSegmentation(segmentationSchema);
    } catch (error) {
      console.warn(`Failed to add/update segmentation ${segmentationId}`, error);
    }
  };

  /**
   * Retrieves the segmentation information for a given segmentation ID and viewport ID.
   * @param segmentationId - The ID of the segmentation.
   * @param viewportId - The ID of the viewport (optional).
   * @returns An object containing the segmentation representation UID and the segmentation itself.
   * @throws An error if no segmentation is found for the given segmentation ID, or if the representation is not added to the viewport.
   */
  private _getSegmentationInfo(segmentationId: string, viewportId?: string) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }
    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      viewportId
    );

    if (!segmentationRepresentation) {
      throw new Error('Must add representation to viewport before setting segments');
    }

    const { segmentationRepresentationUID } = segmentationRepresentation;

    return { segmentationRepresentationUID, segmentation };
  }

  private _removeSegmentationFromCornerstone(segmentationId: string) {
    // TODO: This should be from the configuration
    const removeFromCache = true;
    const segmentationState = cstSegmentation.state;
    const sourceSegState = segmentationState.getSegmentation(segmentationId);
    const updatedViewportIds: Set<string> = new Set();

    if (!sourceSegState) {
      return;
    }

    const viewportIds = segmentationState.getViewportIdsWithSegmentation(segmentationId);

    viewportIds.forEach(viewportId => {
      const segmentationRepresentations =
        segmentationState.getSegmentationRepresentations(viewportId);

      const UIDsToRemove = [];
      segmentationRepresentations.forEach(representation => {
        if (representation.segmentationId === segmentationId) {
          UIDsToRemove.push(representation.segmentationRepresentationUID);
          updatedViewportIds.add(viewportId);
        }
      });

      // remove segmentation representations
      cstSegmentation.removeSegmentationRepresentations(
        viewportId,
        UIDsToRemove,
        true // immediate
      );
    });

    // cleanup the segmentation state too
    segmentationState.removeSegmentation(segmentationId);

    if (removeFromCache && cache.getVolumeLoadObject(segmentationId)) {
      cache.removeVolumeLoadObject(segmentationId);
    }

    return { updatedViewportIds: [...updatedViewportIds] };
  }

  private _updateCornerstoneSegmentations({ segmentationId, notYetUpdatedAtSource }) {
    if (notYetUpdatedAtSource === false) {
      return;
    }
    const segmentationState = cstSegmentation.state;
    const sourceSegmentation = segmentationState.getSegmentation(segmentationId);
    const segmentation = this.segmentations[segmentationId];
    const { label, cachedStats } = segmentation;

    // Update the label in the source if necessary
    if (sourceSegmentation.label !== label) {
      sourceSegmentation.label = label;
    }

    if (!isEqual(sourceSegmentation.cachedStats, cachedStats)) {
      sourceSegmentation.cachedStats = cachedStats;
    }
  }

  private _updateCornerstoneSegmentationVisibility = segmentationId => {
    const segmentationState = cstSegmentation.state;
    const viewportIds = segmentationState.getViewportIdsWithSegmentation(segmentationId);

    viewportIds.forEach(viewportId => {
      const segmentationRepresentations =
        cstSegmentation.state.getSegmentationRepresentations(viewportId);

      if (segmentationRepresentations.length === 0) {
        return;
      }

      // Todo: this finds the first segmentation representation that matches the segmentationId
      // If there are two labelmap representations from the same segmentation, this will not work
      const representation = segmentationRepresentations.find(
        representation => representation.segmentationId === segmentationId
      );

      const segmentsHidden = cstSegmentation.config.visibility.getHiddenSegmentIndices(
        viewportId,
        representation.segmentationRepresentationUID
      );
      const currentVisibility = segmentsHidden.size === 0 ? true : false;
      const newVisibility = !currentVisibility;

      cstSegmentation.config.visibility.setSegmentationRepresentationVisibility(
        viewportId,
        representation.segmentationRepresentationUID,
        newVisibility
      );

      // update segments visibility
      const { segmentation } = this._getSegmentationInfo(segmentationId, viewportId);

      const segments = segmentation.segments.filter(Boolean);

      segments.forEach(segment => {
        segment.isVisible = newVisibility;
      });
    });
  };

  private _getViewportIdsWithSegmentation(segmentationId: string) {
    const segmentationState = cstSegmentation.state;
    const viewportIds = segmentationState.getViewportIdsWithSegmentation(segmentationId);

    return viewportIds;
  }

  /**
   * Converts object of objects to array.
   *
   * @return {Array} Array of objects
   */
  private arrayOfObjects = obj => {
    return Object.entries(obj).map(e => ({ [e[0]]: e[1] }));
  };
}

export default SegmentationService;
export { EVENTS, VALUE_TYPES };
