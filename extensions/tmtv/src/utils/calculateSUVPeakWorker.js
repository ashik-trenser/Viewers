import { utilities } from '@cornerstonejs/core';
import { utilities as cstUtils } from '@cornerstonejs/tools';
import { vec3 } from 'gl-matrix';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { expose } from 'comlink';

const createVolume = ({ dimensions, origin, direction, spacing, metadata, scalarData }) => {
  const imageData = vtkImageData.newInstance();
  imageData.setDimensions(dimensions);
  imageData.setOrigin(origin);
  imageData.setDirection(direction);
  imageData.setSpacing(spacing);

  const scalarArray = vtkDataArray.newInstance({
    name: 'Pixels',
    numberOfComponents: 1,
    values: scalarData,
  });

  imageData.getPointData().setScalars(scalarArray);

  imageData.modified();

  const voxelManager = utilities.VoxelManager.createScalarVolumeVoxelManager({
    scalarData,
    dimensions,
    numberOfComponents: 1,
  });
  return {
    imageData,
    metadata,
    voxelManager,
  };
};
/**
 * This method calculates the SUV peak on a segmented ROI from a reference PET
 * volume. If a rectangle annotation is provided, the peak is calculated within that
 * rectangle. Otherwise, the calculation is performed on the entire volume which
 * will be slower but same result.
 * @param viewport Viewport to use for the calculation
 * @param labelmap Labelmap from which the mask is taken
 * @param referenceVolume PET volume to use for SUV calculation
 * @param toolData [Optional] list of toolData to use for SUV calculation
 * @param segmentIndex The index of the segment to use for masking
 * @returns
 */
function calculateSuvPeak({ labelmapProps, referenceVolumeProps, annotations, segmentIndex = 1 }) {
  const labelmapInfo = createVolume(labelmapProps);
  const referenceInfo = createVolume(referenceVolumeProps);

  if (referenceInfo.metadata.Modality !== 'PT') {
    return;
  }

  const { dimensions, imageData: labelmapImageData } = labelmapInfo;
  const { imageData: referenceVolumeImageData } = referenceInfo;

  let boundsIJK;
  // Todo: using the first annotation for now
  if (annotations?.length && annotations[0].data?.cachedStats) {
    const { projectionPoints } = annotations[0].data.cachedStats;
    const pointsToUse = [].concat(...projectionPoints); // cannot use flat() because of typescript compiler right now

    const rectangleCornersIJK = pointsToUse.map(world => {
      const ijk = vec3.fromValues(0, 0, 0);
      referenceVolumeImageData.worldToIndex(world, ijk);
      return ijk;
    });

    boundsIJK = cstUtils.boundingBox.getBoundingBoxAroundShape(rectangleCornersIJK, dimensions);
  }

  let max = 0;
  let maxIJK = [0, 0, 0];
  let maxLPS = [0, 0, 0];

  const callback = ({ pointIJK, pointLPS }) => {
    const value = labelmapInfo.voxelManager.getAtIJKPoint(pointIJK);

    if (value !== segmentIndex) {
      return;
    }

    const referenceValue = referenceInfo.voxelManager.getAtIJKPoint(pointIJK);

    if (referenceValue > max) {
      max = referenceValue;
      maxIJK = pointIJK;
      maxLPS = pointLPS;
    }
  };

  labelmapInfo.voxelManager.forEach(callback, {
    boundsIJK,
    imageData: labelmapImageData,
    isInObject: () => true,
    returnPoints: true,
  });

  const direction = labelmapImageData.getDirection().slice(0, 3);

  /**
   * 2. Find the bottom and top of the great circle for the second sphere (1cc sphere)
   * V = (4/3)πr3
   */
  const radius = Math.pow(1 / ((4 / 3) * Math.PI), 1 / 3) * 10;
  const diameter = radius * 2;

  const secondaryCircleWorld = vec3.create();
  const bottomWorld = vec3.create();
  const topWorld = vec3.create();
  referenceVolumeImageData.indexToWorld(maxIJK, secondaryCircleWorld);
  vec3.scaleAndAdd(bottomWorld, secondaryCircleWorld, direction, -diameter / 2);
  vec3.scaleAndAdd(topWorld, secondaryCircleWorld, direction, diameter / 2);
  const suvPeakCirclePoints = [bottomWorld, topWorld];

  /**
   * 3. Find the Mean and Max of the 1cc sphere centered on the suv Max of the previous
   * sphere
   */
  let count = 0;
  let acc = 0;
  const suvPeakMeanCallback = ({ value }) => {
    acc += value;
    count += 1;
  };

  cstUtils.pointInSurroundingSphereCallback(
    referenceVolumeImageData,
    suvPeakCirclePoints,
    suvPeakMeanCallback
  );

  const mean = acc / count;

  return {
    max,
    maxIJK,
    maxLPS,
    mean,
  };
}

const obj = {
  calculateSuvPeak,
};

expose(obj);
