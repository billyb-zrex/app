import {
  Plan,
  RespCommonConfig,
  RespScreen,
  RespSubscription,
  RespDemoEntity,
  RespDemoEntityWithSubEntities,
  RespVanityDomain,
  EntityInfo,
  FrameSettings,
  Dataset,
  RespDataset,
  RespUploadUrl,
} from '@fable/common/dist/api-contract';
import {
  AnnBtnKeysWithProperty,
  AnnConfigKeysWithProperty,
  DEFAULT_ANN_DIMS,
  TourOptsKeysWithProperty,
  createLiteralProperty,
  deepcopy,
  getDisplayableTime,
  getSampleGlobalConfig,
  getSampleJourneyData,
  isProdEnv
} from '@fable/common/dist/utils';
import {
  AnnotationPositions,
  JourneyData,
  IAnnotationConfig,
  IAnnotationOriginConfig,
  ITourDataOpts,
  TourData,
  TourDataWoScheme,
  TourScreenEntity,
  VideoAnnotationPositions,
  PropertyType,
  IGlobalConfig,
  ITourLoaderData,
  AnnotationButtonSize,
  JourneyCTA,
  SerNode,
  CreateJourneyPositioning,
} from '@fable/common/dist/types';
import { DEFAULT_BLUE_BORDER_COLOR } from '@fable/common/dist/constants';
import { nanoid } from 'nanoid';
import Handlebars from 'handlebars';
import {
  AllEdits,
  EditItem,
  ElEditType,
  EditValueEncoding,
  IdxEncodingTypeText,
  IdxEncodingTypeImage,
  IdxEncodingTypeBlur,
  IdxEncodingTypeDisplay,
  IdxEncodingTypeMask,
  IdxEncodingTypeInput,
  SiteData,
  SiteDateKeysWithProperty,
  P_RespDemoHub,
  IDemoHubConfig,
  SimpleStyle,
  ElIdentifierType,
  GlobalEditFile,
  GlobalElEditValueEncoding,
  AllGlobalElEdits,
  EncodingTypeText,
  EncodingTypeImage,
  EncodingTypeBlur,
  EncodingTypeDisplay,
  EncodingTypeMask,
  EncodingTypeInput,
  DatasetConfig,
  GlobalElEditText,
  EncodingTypeInputValue
} from './types';
import { getDefaultDatasetConfig, getDefaultSiteData, getSampleDemoHubConfig, getSerNodeFidFromElPath, isVideoAnnotation as isVideoAnn, replaceVarsInAnnotation } from './utils';
import { isLeadFormPresentInHTMLStr } from './component/annotation-rich-text-editor/utils/lead-form-node-utils';
import { FeatureForPlan, FeaturePerPlan, PlanDetail } from './plans';
import { getSerNodeFromPath } from './component/screen-editor/utils/edits';
import { EMPTY_EL_PATH } from './constants';
import { normalizeGlobalConfig } from './core-defaults';

export function getNumberOfDaysFromNow(d: Date): [string, number] {
  const msDiffs = +d - +new Date();
  const days = Math.floor(msDiffs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((msDiffs / (1000 * 60 * 60)) % 24);
  const res = days > 0 ? `in ${days} ${days > 1 ? 'days' : 'day'}` : `in ${hours} ${hours > 1 ? 'hours' : 'hour'}`;

  return [res, days];
}

export interface P_RespSubscription extends RespSubscription {
  dTrialEndsOn: Date;
  dTrialStartedOn: Date;
  displayableTrialEndsOn: String;
}

export function processRawSubscriptionData(sub: RespSubscription): P_RespSubscription {
  const d = new Date(sub.trialEndsOn);
  const [readableDays, days] = getNumberOfDaysFromNow(d);
  return {
    ...sub,
    dTrialEndsOn: d,
    dTrialStartedOn: new Date(sub.trialStartedOn),
    displayableTrialEndsOn: readableDays ? `Expiring ${readableDays}` : 'Expired'
  };
}

/* ************************************************************************* */

export interface P_RespScreen extends RespScreen {
  urlStructured: URL;
  thumbnailUri: URL;
  dataFileUri: URL;
  editFileUri: URL;
  displayableUpdatedAt: string;
  related: P_RespScreen[];
  numUsedInTours: number;
  isRootScreen: boolean;
}

function getFileUris(
  screen: RespScreen,
  config: RespCommonConfig,
  publishForTour?: RespDemoEntity,
  isForExportedTour?: boolean,
  baseUrl?: string
): {editFileUri: URL, dataFileUri: URL} {
  const screenAssetPath = isForExportedTour ? `${baseUrl}/root/srn/` : config.screenAssetPath;
  const assetPrefixHash = screen.assetPrefixHash;
  const editFileName = publishForTour ? publishForTour.pubEditFileName : config.editFileName;
  const dataFileName = config.dataFileName;

  const dataFileUri = new URL(`${screenAssetPath}${assetPrefixHash}/${dataFileName}`);
  const editFileUri = new URL(`${screenAssetPath}${assetPrefixHash}/${editFileName}?ts=${+new Date()}`);

  return { editFileUri, dataFileUri };
}

export function processRawScreenData(screen: RespScreen, config: RespCommonConfig, publishForTour?: RespDemoEntity, isForExportedTour?: boolean, baseUrl?: string): P_RespScreen {
  const d = new Date(screen.updatedAt);
  const { editFileUri, dataFileUri } = getFileUris(screen, config, publishForTour, isForExportedTour, baseUrl);

  return {
    ...screen,
    createdAt: new Date(screen.createdAt),
    updatedAt: d,
    isRootScreen: screen.parentScreenId === 0,
    displayableUpdatedAt: getDisplayableTime(d),
    urlStructured: screen.url === ''
      ? new URL(`https://${screen.displayName.toLowerCase().trim().replace(/\W+/g, '-')}}.img.flbk.sharefable.com`)
      : new URL(screen.url),
    thumbnailUri: isForExportedTour ? new URL(`${config.commonAssetPath}${screen.thumbnail}`, baseUrl) : new URL(`${config.commonAssetPath}${screen.thumbnail}`),
    dataFileUri,
    editFileUri,
    related: [],
    numUsedInTours: 0,
  };
}

export function groupScreens(screens: P_RespScreen[]): P_RespScreen[] {
  const parentScreenMap: Record<number, P_RespScreen> = {};
  for (const s of screens) {
    if (s.isRootScreen) {
      parentScreenMap[s.id] = s;
    }
  }

  for (const s of screens) {
    if (s.isRootScreen) {
      continue;
    }
    parentScreenMap[s.parentScreenId].related.push(s);
  }

  const parentScreenArr: P_RespScreen[] = [];
  for (const s of Object.values(parentScreenMap)) {
    s.related.sort((m, n) => +n.updatedAt - +m.updatedAt);
    s.numUsedInTours = s.related.length;
    parentScreenArr.push(s);
  }
  return parentScreenArr.sort((m, n) => +n.updatedAt - +m.updatedAt);
}

/* ************************************************************************* */

export interface P_RespVanityDomain extends RespVanityDomain {
  displayableCreatedAt: string;
}

export function processRawVanityDomain(domain: RespVanityDomain): P_RespVanityDomain {
  const createdAt = new Date(domain.createdAt);
  return {
    ...domain,
    createdAt,
    displayableCreatedAt: getDisplayableTime(createdAt)
  };
}

/* ************************************************************************* */

export interface P_RespTour extends RespDemoEntity {
  dataFileUri: URL;
  editFileUri: URL;
  thumbnailUri: URL;
  displayableUpdatedAt: string;
  isPlaceholder: boolean;
  screens?: P_RespScreen[];
  loaderFileUri: URL;
  site: SiteData;
  pubDataFileUri: URL;
  stagingDataFileUri: URL;
  datasets?: P_Dataset[];
}

function getDataFileUri(
  tour: RespDemoEntity | RespDemoEntityWithSubEntities,
  config: RespCommonConfig,
  publishForTour?: RespDemoEntity,
  isForExportedTour?: boolean,
  baseUrl?: string
): URL {
  const tourAssetPath = isForExportedTour ? `${baseUrl}/root/tour/` : config.tourAssetPath;
  const assetPrefixHash = tour.assetPrefixHash;
  const dataFileName = publishForTour
    ? publishForTour.pubDataFileName
    : config.dataFileName;

  const dataFileUri = new URL(`${tourAssetPath}${assetPrefixHash}/${dataFileName}?ts=${+new Date()}`);

  return dataFileUri;
}

function getLoaderFileUri(
  tour: RespDemoEntity | RespDemoEntityWithSubEntities,
  config: RespCommonConfig,
  publishForTour?: RespDemoEntity,
  isForExportedTour?: boolean,
  baseUrl?: string,
): URL {
  const tourAssetPath = isForExportedTour ? `${baseUrl}/root/tour/` : config.tourAssetPath;
  const assetPrefixHash = tour.assetPrefixHash;
  const loaderFileName = publishForTour ? publishForTour.pubLoaderFileName : config.loaderFileName;
  const loaderFileUri = new URL(`${tourAssetPath}${assetPrefixHash}/${loaderFileName}?ts=${+new Date()}`);

  return loaderFileUri;
}

function getEditFileUri(
  tour: RespDemoEntity | RespDemoEntityWithSubEntities,
  config: RespCommonConfig,
  publishForTour?: RespDemoEntity,
  isForExportedTour?: boolean,
  baseUrl?: string
): URL {
  const tourAssetPath = isForExportedTour ? `${baseUrl}/root/tour/` : config.tourAssetPath;
  const assetPrefixHash = tour.assetPrefixHash;
  const editFileName = publishForTour ? publishForTour.pubEditFileName : config.editFileName;
  const editFileUri = new URL(`${tourAssetPath}${assetPrefixHash}/${editFileName}?ts=${+new Date()}`);

  return editFileUri;
}

export function processRawTourData(
  tour: RespDemoEntity | RespDemoEntityWithSubEntities,
  config: RespCommonConfig,
  globalOpts: IGlobalConfig = getSampleGlobalConfig(),
  isPlaceholder = false,
  publishForTour: RespDemoEntity | undefined = undefined,
  isForExportedTour: boolean = false,
  baseUrl: string = window.location.origin
): P_RespTour {
  globalOpts = normalizeGlobalConfig(globalOpts);
  const d = new Date(tour.updatedAt);

  let tTour;
  if ((tTour = (tour as RespDemoEntityWithSubEntities)).screens) {
    tTour.screens = tTour.screens.map(s => processRawScreenData(s, config, publishForTour, isForExportedTour, baseUrl));
  }

  const dataFileUri = getDataFileUri(tour, config, publishForTour, isForExportedTour, baseUrl);
  const loaderFileUri = getLoaderFileUri(tour, config, publishForTour, isForExportedTour, baseUrl);
  const editFileUri = getEditFileUri(tour, config, publishForTour, isForExportedTour, baseUrl);
  const site = processBrandData(normalizeBackwardCompatibilityForBrandData(tour, globalOpts), globalOpts);
  const thumbnailHash = tour.info ? tour.info.thumbnail : getDefaultThumbnailHash();
  const info = normalizeBackwardCompatibilityForEntityInfo(tour.info);

  const processedDatasets = tour.datasets?.map(ds => processRawDataset(ds, config, tour.owner, false, null, isForExportedTour, baseUrl));

  return {
    ...tour,
    globalOpts,
    info,
    createdAt: new Date(tour.createdAt),
    updatedAt: d,
    lastPublishedDate: tour.lastPublishedDate && new Date(tour.lastPublishedDate),
    thumbnailUri: isForExportedTour ? new URL(`${config.commonAssetPath}${thumbnailHash}`, baseUrl) : new URL(`${config.commonAssetPath}${thumbnailHash}`),
    displayableUpdatedAt: getDisplayableTime(d),
    dataFileUri,
    loaderFileUri,
    isPlaceholder,
    site,
    editFileUri,
    pubDataFileUri: getDataFileUri(tour, config, tour, isForExportedTour, baseUrl),
    stagingDataFileUri: getDataFileUri(tour, config, undefined, isForExportedTour, baseUrl),
    datasets: processedDatasets,
  } as P_RespTour;
}

export function preprocessAnnTextsToReplacePersVars(
  annotations: Record<string, IAnnotationConfig[]>,
  varMap: Record<string, string | Record<string, string>>,
): Record<string, IAnnotationConfig[]> {
  Object.keys(annotations).forEach(key => {
    annotations[key].map(ann => replaceVarsInAnnotation(ann, varMap));
  });
  return annotations;
}

export function preprocessEditTextsToReplacePersVars(
  edits: AllGlobalElEdits<ElEditType>,
  varMap: Record<string, string | Record<string, string>>
) : AllGlobalElEdits<ElEditType> {
  Object.keys(edits).forEach((key) => {
    replaceVarsInEdit(edits[key], varMap);
  });

  return edits;
}

function replaceVarsInEdit(
  editObj: Partial<Record<ElEditType, GlobalElEditValueEncoding[ElEditType]>>,
  varMap: Record<string, string | Record<string, string>>
): Partial<Record<ElEditType, GlobalElEditValueEncoding[ElEditType]>> {
  if (editObj[ElEditType.Text]) {
    const textEditObj: GlobalElEditText = editObj[ElEditType.Text] as GlobalElEditText;
    const editObjtextNewValueTemplate = Handlebars.compile(textEditObj.newValue);
    textEditObj.newValue = editObjtextNewValueTemplate(varMap);

    editObj[ElEditType.Text] = textEditObj;
  }

  return editObj;
}

export function getThemeAndAnnotationFromDataFile(data: TourData, globalOpts: IGlobalConfig, isLocal = true): {
  annotations: Record<string, IAnnotationConfig[]>,
  annotationsIdMap: Record<string, string[]>,
  opts: ITourDataOpts,
  journey: JourneyData
} {
  const annotationsPerScreen: Record<string, IAnnotationConfig[]> = {};
  const annotationsIdMapPerScreen: Record<string, string[]> = {};
  for (const [screenId, entity] of Object.entries(data.entities)) {
    if (entity.type === 'screen') {
      const anns: IAnnotationConfig[] = [];
      const ids: string[] = [];
      for (const [annId, ann] of Object.entries((entity as TourScreenEntity).annotations)) {
        ids.push(annId);
        anns.push(ann as IAnnotationConfig);
      }
      annotationsPerScreen[screenId] = isLocal ? (anns as IAnnotationConfig[]) : anns.map(remoteToLocalAnnotationConfig);
      annotationsIdMapPerScreen[screenId] = ids;
    } else {
      throw new Error('TODO not yet implemented');
    }
  }

  return {
    annotations: isLocal ? annotationsPerScreen : remoteToLocalAnnotationConfigMap(
      annotationsPerScreen as Record<string, IAnnotationOriginConfig[]>,
      data.opts,
      globalOpts,
    ),
    annotationsIdMap: annotationsIdMapPerScreen,
    opts: isLocal ? data.opts : processOpts(normalizeBackwardCompatibilityForOpts(data.opts), globalOpts),
    journey: processJourney(normalizeBackwardCompatibilityForJourney(data.journey, data.opts, globalOpts), globalOpts)
  };
}

export function compileValue(
  globalOpts: Object,
  path: string
): any {
  const opts = normalizeGlobalConfig(globalOpts);
  const keys : string[] = path.split('.').slice(1);
  return keys.reduce((acc, key) => acc[key], opts as any);
}

function processOpts(opts: ITourDataOpts, globalOpts: IGlobalConfig): ITourDataOpts {
  if (opts === null || opts === undefined) {
    return opts;
  }

  const newOpts = { ...opts };

  for (const key of TourOptsKeysWithProperty) {
    if (newOpts[key].type === PropertyType.REF) {
      newOpts[key]._val = compileValue(globalOpts, newOpts[key].from);
    }
  }

  return newOpts;
}

function processJourney(journey : JourneyData, globalOpts : IGlobalConfig) : JourneyData {
  const newJourney = { ...journey };

  if (newJourney.primaryColor.type === PropertyType.REF) {
    newJourney.primaryColor._val = compileValue(
      globalOpts,
      newJourney.primaryColor.from,
    );
  }

  if (newJourney.cta) {
    const keys: Array<keyof JourneyCTA> = ['text', 'navigateTo', 'size'];
    for (const key of keys) {
      if (newJourney.cta[key].type === PropertyType.REF) {
        newJourney.cta[key]._val = compileValue(
          globalOpts,
          newJourney.cta[key].from,
        );
      }
    }
  }

  return newJourney;
}

export function normalizeBackwardCompatibilityForLoader(
  loaderData : ITourLoaderData,
) : ITourLoaderData {
  if (typeof loaderData.logo.url === 'string') {
    loaderData.logo.url = createLiteralProperty(loaderData.logo.url as string);
  }

  if (typeof loaderData.loadingText === 'string') {
    loaderData.loadingText = createLiteralProperty(loaderData.loadingText);
  }
  return { ...loaderData };
}

export function processLoader(loaderData : ITourLoaderData, globalOpts : IGlobalConfig) : ITourLoaderData {
  if (loaderData.logo.url.type === PropertyType.REF) {
    loaderData.logo.url._val = compileValue(
      globalOpts,
      loaderData.logo.url.from,
    );
  }

  if (loaderData.loadingText.type === PropertyType.REF) {
    loaderData.loadingText._val = compileValue(
      globalOpts,
      loaderData.loadingText.from,
    );
  }

  return { ...loaderData };
}

/* ************************************************************************* */

const isEditToBeRemoved = (
  editType: ElEditType,
  editArray: EditValueEncoding[keyof EditValueEncoding]
): boolean => {
  switch (editType) {
    case ElEditType.Text:
      return editArray[IdxEncodingTypeText.NEW_VALUE] === null;

    case ElEditType.Image:
      return editArray[IdxEncodingTypeImage.NEW_VALUE] === null;

    case ElEditType.Blur:
      return editArray[IdxEncodingTypeBlur.NEW_BLUR_VALUE] === null;

    case ElEditType.Display:
      return editArray[IdxEncodingTypeDisplay.NEW_VALUE] === null;

    case ElEditType.Mask:
      return editArray[IdxEncodingTypeMask.NEW_STYLE] === null;

    case ElEditType.Input:
      return editArray[IdxEncodingTypeInput.NEW_VALUE] === null;

    case ElEditType.InputValue:
      return editArray[IdxEncodingTypeInput.NEW_VALUE] === null;

    default:
      return false;
  }
};

const isGlobalEditToBeRemoved = (
  editItem: GlobalElEditValueEncoding[keyof GlobalElEditValueEncoding]
): boolean => {
  switch (editItem.type) {
    case ElEditType.Text:
    case ElEditType.Image:
    case ElEditType.Input:
    case ElEditType.InputValue:
    case ElEditType.Display:
      return editItem.newValue === null;
    case ElEditType.Blur:
      return editItem.newBlurValue === null;

    case ElEditType.Mask:
      return editItem.newStyle === null;

    default:
      return false;
  }
};

export function mergeEdits(master: AllEdits<ElEditType>, incomingEdits: AllEdits<ElEditType>): AllEdits<ElEditType> {
  for (const path of Object.keys(incomingEdits)) {
    if (!(path in master)) {
      master[path] = incomingEdits[path];
    }

    if (path in master) {
      const perElEdit = incomingEdits[path];
      for (const editType of Object.keys(perElEdit)) {
        if (isEditToBeRemoved(+editType as ElEditType, perElEdit[+editType as ElEditType]!)) {
          delete master[path][+editType as ElEditType];
        } else {
          master[path][+editType as ElEditType] = perElEdit[+editType as ElEditType];
        }
      }
    } else {
      master[path] = incomingEdits[path];
    }
    const isMasterPathEmpty = Object.keys(master[path]).length === 0;
    if (isMasterPathEmpty) {
      delete master[path];
    }
  }

  return master;
}

export type GlobalEditsData = AllGlobalElEdits<ElEditType>

export function mergeGlobalEdits(
  master: GlobalEditsData,
  incomingEdits: GlobalEditsData,
): GlobalEditsData {
  for (const path of Object.keys(incomingEdits)) {
    if (!(path in master)) {
      master[path] = incomingEdits[path];
    }
    if (path in master) {
      const perElEdit = incomingEdits[path];
      for (const editType of Object.keys(perElEdit)) {
        if (isGlobalEditToBeRemoved(perElEdit[+editType as ElEditType]!)) {
          delete master[path][+editType as ElEditType];
        } else {
          master[path][+editType as ElEditType] = perElEdit[+editType as ElEditType];
        }
      }
    } else {
      master[path] = incomingEdits[path];
    }

    const isMasterPathEmpty = Object.keys(master[path]).length === 0;
    if (isMasterPathEmpty) {
      delete master[path];
    }
  }

  return master;
}

export function localToRemoteAnnotationConfig(lc: IAnnotationConfig): IAnnotationOriginConfig {
  return {
    id: lc.id,
    refId: lc.refId,
    grpId: lc.grpId,
    zId: lc.zId,
    bodyContent: lc.bodyContent,
    displayText: lc.displayText,
    buttons: lc.buttons,
    monoIncKey: lc.monoIncKey,
    createdAt: lc.createdAt,
    updatedAt: lc.updatedAt,
    positioning: lc.positioning,
    type: lc.type,
    size: lc.size,
    isHotspot: lc.isHotspot,
    hideAnnotation: lc.hideAnnotation,
    videoUrl: lc.videoUrl,
    hotspotElPath: lc.hotspotElPath,
    videoUrlHls: lc.videoUrlHls,
    videoUrlMp4: lc.videoUrlMp4,
    videoUrlWebm: lc.videoUrlWebm,
    showOverlay: lc.showOverlay,
    buttonLayout: lc.buttonLayout,
    selectionShape: lc.selectionShape,
    selectionEffect: lc.selectionEffect,
    targetElCssStyle: lc.targetElCssStyle,
    annCSSStyle: lc.annCSSStyle,
    customDims: lc.customDims,
    annotationSelectionColor: lc.annotationSelectionColor,
    isLeadFormPresent: lc.isLeadFormPresent,
    m_id: lc.m_id,
    scrollAdjustment: lc.scrollAdjustment,
    audio: lc.audio,
    voiceover: lc.voiceover,
    markedImage: lc.markedImage,
  };
}

export function remoteToLocalAnnotationConfig(rc: IAnnotationOriginConfig): IAnnotationConfig {
  return {
    ...rc,
    syncPending: false,
  };
}

export function remoteToLocalAnnotationConfigMap(
  config: Record<string, IAnnotationOriginConfig[]>,
  opts: ITourDataOpts,
  globalOpts: IGlobalConfig,
): Record<string, IAnnotationConfig[]> {
  const config2: Record<string, IAnnotationConfig[]> = {};
  for (const [screenId, anns] of Object.entries(config)) {
    config2[screenId] = anns.map(an => (
      remoteToLocalAnnotationConfig(
        processAnnotationConfig(
          normalizeBackwardCompatibility(an, opts),
          globalOpts
        )
      )));
  }
  return config2;
}

function processAnnotationConfig(
  anConfig : IAnnotationOriginConfig,
  globalOpts: IGlobalConfig
) : IAnnotationOriginConfig {
  const newAnConfig = { ...anConfig };

  for (const key of AnnConfigKeysWithProperty) {
    if (newAnConfig[key].type === PropertyType.REF) {
      newAnConfig[key]._val = compileValue(globalOpts, newAnConfig[key].from);
    }
  }

  newAnConfig.buttons.forEach(btn => {
    for (const key of AnnBtnKeysWithProperty) {
      if (btn[key].type === PropertyType.REF) {
        btn[key]._val = compileValue(globalOpts, btn[key].from);
      }
    }

    if (btn.hotspot && btn.hotspot.actionValue.type === PropertyType.REF) {
      btn.hotspot.actionValue._val = compileValue(
        globalOpts,
        btn.hotspot.actionValue.from,
      );
    }
  });

  return newAnConfig;
}

const replaceAbsoluteFontSizesWithCSSVars = (bodyContent: string): string => {
  const result = bodyContent
    .replaceAll('font-size: 18px', 'font-size: var(--f-font-normal)')
    .replaceAll('font-size: 24px', 'font-size: var(--f-font-large)')
    .replaceAll('font-size: 30px', 'font-size: var(--f-font-huge)');
  return result;
};

const DEMO_RESP_SUPPORTED_VERSION = 1714472243;

export function normalizeBackwardCompatibility(
  an: IAnnotationOriginConfig,
  opts: ITourDataOpts
): IAnnotationOriginConfig {
  if (an.createdAt < DEMO_RESP_SUPPORTED_VERSION) {
    an.bodyContent = replaceAbsoluteFontSizesWithCSSVars(an.bodyContent);
  }

  if (an.annotationSelectionColor === undefined || an.annotationSelectionColor === null) {
    // annotationSelectionColor was present in tour opts previous versions and now this config is moved to annotation cofnig
    const tOpts = opts as ITourDataOpts & { annotationSelectionColor?: string};
    an.annotationSelectionColor = createLiteralProperty(tOpts.annotationSelectionColor || DEFAULT_BLUE_BORDER_COLOR);
  }

  if (typeof an.annotationSelectionColor === 'string') {
    an.annotationSelectionColor = createLiteralProperty(an.annotationSelectionColor);
  }

  if (an.annotationSelectionColor._val === undefined || an.annotationSelectionColor._val === null) {
    // annotationSelectionColor was present in tour opts previous versions and now this config is moved to annotation cofnig
    const tOpts = opts as ITourDataOpts & { annotationSelectionColor?: string};
    an.annotationSelectionColor = createLiteralProperty(tOpts.annotationSelectionColor || DEFAULT_BLUE_BORDER_COLOR);
  }
  if (an.type === 'cover') an.isHotspot = false;
  else an.isHotspot = true;

  if (an.hideAnnotation === undefined || an.hideAnnotation === null) {
    an.hideAnnotation = false;
  }

  an.buttons.forEach(btn => {
    if (typeof btn.text === 'string') {
      btn.text = createLiteralProperty(btn.text);
    }
    if (typeof btn.style === 'string') {
      btn.style = createLiteralProperty(btn.style);
    }

    if (typeof btn.size === 'string') {
      btn.size = createLiteralProperty(btn.size);
    }

    if (btn.hotspot && typeof btn.hotspot.actionValue === 'string') {
      btn.hotspot.actionValue = createLiteralProperty(btn.hotspot.actionValue);
    }
  });

  if (an.videoUrl === undefined || an.videoUrl === null) {
    an.videoUrl = '';
  }

  if (an.videoUrlMp4 === undefined || an.videoUrlMp4 === null) {
    an.videoUrlMp4 = '';
  }

  if (an.videoUrlHls === undefined || an.videoUrlHls === null) {
    an.videoUrlHls = '';
  }

  if (an.videoUrlWebm === undefined || an.videoUrlWebm === null) {
    an.videoUrlWebm = '';
  }

  if (an.buttonLayout === undefined || an.buttonLayout === null) {
    an.buttonLayout = 'default';
  }

  if (an.selectionShape === undefined || an.selectionShape === null) {
    an.selectionShape = createLiteralProperty('box');
  }

  if (typeof an.selectionShape === 'string') {
    an.selectionShape = createLiteralProperty(an.selectionShape);
  }

  if (an.selectionShape._val === undefined || an.selectionShape._val === null) {
    an.selectionShape = createLiteralProperty('box');
  }

  if (an.selectionEffect === undefined || an.selectionEffect === null) {
    an.selectionEffect = createLiteralProperty('regular');
  }

  if (typeof an.selectionEffect === 'string') {
    an.selectionEffect = createLiteralProperty(an.selectionEffect);
  }

  if (an.selectionEffect._val === undefined || an.selectionEffect._val === null) {
    an.selectionEffect = createLiteralProperty('regular');
  }

  if (an.scrollAdjustment === undefined || an.scrollAdjustment === null) {
    an.scrollAdjustment = 'auto';
  }

  if (an.targetElCssStyle === undefined || an.targetElCssStyle === null) {
    an.targetElCssStyle = '';
  }

  if (an.annCSSStyle === undefined || an.annCSSStyle === null) {
    an.annCSSStyle = '';
  }

  if (an.customDims === undefined || an.customDims === null) {
    an.customDims = DEFAULT_ANN_DIMS;
  }

  if (an.zId === undefined || an.zId === null) {
    an.zId = an.refId;
  }

  if (an.audio === undefined || an.audio === null) {
    an.audio = null;
  }

  if (an.audio && (an.audio.fb === undefined || an.audio.fb === null)) {
    an.audio.fb = { url: an.audio.webm, type: 'audio/webm' };
  }

  if (an.isLeadFormPresent === undefined || an.isLeadFormPresent === null) {
    an.isLeadFormPresent = isLeadFormPresentInHTMLStr(an.bodyContent);
  }

  const isVideoAnnotation = isVideoAnn(an as IAnnotationConfig);
  if (isVideoAnnotation && an.positioning === AnnotationPositions.Auto) {
    an.positioning = VideoAnnotationPositions.BottomRight;
  }

  if (an.showOverlay === undefined || an.showOverlay === null) {
    // showOverlay was present in tour opts previous versions and now this config is moved to annotation cofnig
    const tOpts = opts as ITourDataOpts & { showOverlay?: boolean };
    if (!(tOpts.showOverlay === undefined || tOpts.showOverlay === null)) {
      an.showOverlay = !!tOpts.showOverlay;
    } else {
      an.showOverlay = true;
    }
  }

  if (an.m_id === undefined || an.m_id === null) {
    an.m_id = an.id;
  }

  if (an.voiceover === undefined) {
    an.voiceover = null;
  }

  if (an.markedImage === undefined) {
    an.markedImage = null;
  }

  return an;
}

// the atomicity of merge is not granular (property level changes), rather logical entity level.
// like if an annotation config needs to be merged we merge the full annotation config object as a whole
// not property of config level
export function mergeTourData(
  master: TourDataWoScheme,
  incoming: Partial<TourDataWoScheme>,
  convertLocalToRemote = false
): TourDataWoScheme {
  const newMaster = deepcopy(master);
  if (incoming.opts) {
    newMaster.opts = incoming.opts;
  }
  if (incoming.entities) {
    for (const [entityKey, entity] of Object.entries(incoming.entities)) {
      if (entity === null) {
        delete newMaster.entities[entityKey];
        continue;
      }

      if (entityKey in newMaster.entities) {
        if (entity.type === 'screen') {
          const newMasterScreenEntity = newMaster.entities[entityKey] as TourScreenEntity;
          const screenEntity = entity as TourScreenEntity;
          for (const [anId, ann] of Object.entries(screenEntity.annotations)) {
            if (ann === null) {
              if (!convertLocalToRemote) {
                // TODO take care of the type in a better way this keeps the null value to the local copy of
                // the annotation data, otherwise while merging to master it would have no information about
                // the annotation that to be deleted
                (newMasterScreenEntity.annotations as any)[anId] = null;
              } else {
                delete newMasterScreenEntity.annotations[anId];
              }
              continue;
            }
            const typedConfig = (convertLocalToRemote
              ? localToRemoteAnnotationConfig(ann as IAnnotationConfig)
              : ann) as IAnnotationOriginConfig;
            newMasterScreenEntity.annotations[anId] = typedConfig;
          }
        } else {
          throw new Error('TODO not yet implemented');
        }
      } else {
        newMaster.entities[entityKey] = entity;
      }
    }
  }
  if (incoming.journey) {
    newMaster.journey = incoming.journey;
  }

  return newMaster;
}

export function convertEditsToLineItems(
  editChunks: AllEdits<ElEditType>,
  editTypeLocal: boolean,
  serDom: SerNode
): EditItem[] {
  const editList: EditItem[] = [];
  for (const [key, edits] of Object.entries(editChunks)) {
    const [elIdentifier, elIdentifierType] = getElIdentifierInfoFromKey(key);
    for (const [type, editDetails] of Object.entries(edits)) {
      let fid = getFidFromEdit(+type, editDetails);
      if (!fid) {
        fid = getSerNodeFidFromElPath(serDom, elIdentifier);
      }

      let editKey;
      if (fid) {
        editKey = `fid/${fid}:${type}`;
      } else {
        editKey = `elpath/${key}:${type}`;
      }
      // Note: fid will be undefined if the demo was created before the diffs-fid feature,
      // in that case we will save elpath/elpathvalue as the fid it is not required now,
      // but it is saved this way to figure out if it is an actual fid or not if it is required in the future
      editList.push([editKey, elIdentifier, fid || `elpath/${key}`, +type, editTypeLocal, editDetails[0], editDetails,
        elIdentifierType, false,]);
    }
  }
  return editList;
}

export function convertGlobalEditsToLineItems(editChunks: GlobalEditFile['edits'], editTypeLocal: boolean): EditItem[] {
  const editList: EditItem[] = [];
  for (const [key, edits] of Object.entries(editChunks)) {
    const [elIdentifier, elIdentifierType] = getElIdentifierInfoFromKey(key);
    for (const [type, editDetails] of Object.entries(edits)) {
      const tupleEditDetails = convertGlobalElEditToTuple(editDetails)!;
      editList.push([
        `${key}:${type}`,
        EMPTY_EL_PATH,
        editDetails.fid,
        +type,
        editTypeLocal,
        editDetails.timeInSec,
        tupleEditDetails,
        elIdentifierType,
        true,
      ]);
    }
  }
  return editList;
}

const getFidFromEdit = (
  editType: ElEditType,
  editArray: EditValueEncoding[keyof EditValueEncoding]
): string | undefined => {
  switch (editType) {
    case ElEditType.Text:
      return editArray[IdxEncodingTypeText.FID];

    case ElEditType.Image:
      return editArray[IdxEncodingTypeImage.FID];

    case ElEditType.Blur:
      return editArray[IdxEncodingTypeBlur.FID];

    case ElEditType.Display:
      return editArray[IdxEncodingTypeDisplay.FID];

    case ElEditType.Mask:
      return editArray[IdxEncodingTypeMask.FID];

    case ElEditType.Input:
      return editArray[IdxEncodingTypeInput.FID];

    case ElEditType.InputValue:
      return editArray[IdxEncodingTypeInput.FID];

    default:
      return undefined;
  }
};

export const convertGlobalElEditToTuple = (
  globalEditItem: GlobalElEditValueEncoding[keyof GlobalElEditValueEncoding]
): EditValueEncoding[keyof EditValueEncoding] | null => {
  switch (globalEditItem.type) {
    case ElEditType.Text: {
      const tupleEditItem: EditValueEncoding[ElEditType.Text] = [
        globalEditItem.timeInSec,
        globalEditItem.oldValue,
        globalEditItem.newValue,
        globalEditItem.fid
      ];
      return tupleEditItem;
    }

    case ElEditType.Image: {
      const tupleEditItem: EditValueEncoding[ElEditType.Image] = [
        globalEditItem.timeInSec,
        globalEditItem.oldValue,
        globalEditItem.newValue,
        globalEditItem.height,
        globalEditItem.width,
        globalEditItem.fid
      ];
      return tupleEditItem;
    }

    case ElEditType.Blur: {
      const tupleEditItem: EditValueEncoding[ElEditType.Blur] = [
        globalEditItem.timeInSec,
        globalEditItem.oldBlurValue,
        globalEditItem.newBlurValue,
        globalEditItem.oldFilterPropertyValue,
        globalEditItem.newFilterPropertyValue,
        globalEditItem.fid
      ];
      return tupleEditItem;
    }

    case ElEditType.Display: {
      const tupleEditItem: EditValueEncoding[ElEditType.Display] = [
        globalEditItem.timeInSec,
        globalEditItem.oldValue,
        globalEditItem.newValue,
        globalEditItem.fid,
      ];
      return tupleEditItem;
    }

    case ElEditType.Mask: {
      const tupleEditItem: EditValueEncoding[ElEditType.Mask] = [
        globalEditItem.timeInSec,
        globalEditItem.newStyle,
        globalEditItem.oldStyle,
        globalEditItem.fid,
      ];
      return tupleEditItem;
    }

    case ElEditType.Input: {
      const tupleEditItem: EditValueEncoding[ElEditType.Input] = [
        globalEditItem.timeInSec,
        globalEditItem.oldValue,
        globalEditItem.newValue,
        globalEditItem.fid,
      ];
      return tupleEditItem;
    }

    case ElEditType.InputValue: {
      const tupleEditItem: EditValueEncoding[ElEditType.InputValue] = [
        globalEditItem.timeInSec,
        globalEditItem.oldValue,
        globalEditItem.newValue,
        globalEditItem.fid,
      ];
      return tupleEditItem;
    }

    default:
      return null;
  }
};

export const convertTupleToGlobalElEdit = <K extends keyof EditValueEncoding>(
  editType: K,
  edit: EditValueEncoding[K],
  srnId: number,
): GlobalElEditValueEncoding[keyof GlobalElEditValueEncoding] | null => {
  switch (editType) {
    case ElEditType.Text: {
      const editItem = edit as EncodingTypeText;
      const globalEditItem: GlobalElEditValueEncoding[ElEditType.Text] = {
        type: ElEditType.Text,
        timeInSec: editItem[IdxEncodingTypeText.TIMESTAMP],
        oldValue: editItem[IdxEncodingTypeText.OLD_VALUE],
        newValue: editItem[IdxEncodingTypeText.NEW_VALUE],
        fid: editItem[IdxEncodingTypeText.FID],
        srnId,
      };
      return globalEditItem;
    }

    case ElEditType.Image: {
      const editItem = edit as EncodingTypeImage;
      const globalEditItem: GlobalElEditValueEncoding[ElEditType.Image] = {
        type: ElEditType.Image,
        timeInSec: editItem[IdxEncodingTypeImage.TIMESTAMP],
        oldValue: editItem[IdxEncodingTypeImage.OLD_VALUE],
        newValue: editItem[IdxEncodingTypeImage.NEW_VALUE],
        height: editItem[IdxEncodingTypeImage.HEIGHT],
        width: editItem[IdxEncodingTypeImage.WIDTH],
        fid: editItem[IdxEncodingTypeImage.FID],
        srnId,
      };
      return globalEditItem;
    }

    case ElEditType.Blur: {
      const editItem = edit as EncodingTypeBlur;
      const globalEditItem: GlobalElEditValueEncoding[ElEditType.Blur] = {
        type: ElEditType.Blur,
        timeInSec: editItem[IdxEncodingTypeBlur.TIMESTAMP],
        oldBlurValue: editItem[IdxEncodingTypeBlur.OLD_BLUR_VALUE],
        newBlurValue: editItem[IdxEncodingTypeBlur.NEW_BLUR_VALUE],
        oldFilterPropertyValue: editItem[IdxEncodingTypeBlur.OLD_FILTER_VALUE],
        newFilterPropertyValue: editItem[IdxEncodingTypeBlur.NEW_FILTER_VALUE],
        fid: editItem[IdxEncodingTypeBlur.FID],
        srnId,
      };
      return globalEditItem;
    }

    case ElEditType.Display: {
      const editItem = edit as EncodingTypeDisplay;
      const globalEditItem: GlobalElEditValueEncoding[ElEditType.Display] = {
        type: ElEditType.Display,
        timeInSec: editItem[IdxEncodingTypeDisplay.TIMESTAMP],
        oldValue: editItem[IdxEncodingTypeDisplay.OLD_VALUE],
        newValue: editItem[IdxEncodingTypeDisplay.NEW_VALUE],
        fid: editItem[IdxEncodingTypeDisplay.FID],
        srnId,
      };
      return globalEditItem;
    }

    case ElEditType.Mask: {
      const editItem = edit as EncodingTypeMask;
      const globalEditItem: GlobalElEditValueEncoding[ElEditType.Mask] = {
        type: ElEditType.Mask,
        timeInSec: editItem[IdxEncodingTypeMask.TIMESTAMP],
        oldStyle: editItem[IdxEncodingTypeMask.OLD_STYLE],
        newStyle: editItem[IdxEncodingTypeMask.NEW_STYLE],
        fid: editItem[IdxEncodingTypeMask.FID],
        srnId,
      };
      return globalEditItem;
    }

    case ElEditType.Input: {
      const editItem = edit as EncodingTypeInput;
      const globalEditItem: GlobalElEditValueEncoding[ElEditType.Input] = {
        type: ElEditType.Input,
        timeInSec: editItem[IdxEncodingTypeInput.TIMESTAMP],
        oldValue: editItem[IdxEncodingTypeInput.OLD_VALUE],
        newValue: editItem[IdxEncodingTypeInput.NEW_VALUE],
        fid: editItem[IdxEncodingTypeInput.FID],
        srnId,
      };
      return globalEditItem;
    }

    case ElEditType.InputValue: {
      const editItem = edit as EncodingTypeInputValue;
      const globalEditItem: GlobalElEditValueEncoding[ElEditType.InputValue] = {
        type: ElEditType.InputValue,
        timeInSec: editItem[IdxEncodingTypeInput.TIMESTAMP],
        oldValue: editItem[IdxEncodingTypeInput.OLD_VALUE],
        newValue: editItem[IdxEncodingTypeInput.NEW_VALUE],
        fid: editItem[IdxEncodingTypeInput.FID],
        srnId,
      };
      return globalEditItem;
    }

    default:
      return null;
  }
};

/**
 * screen-level el identifiers will have just the path
 * demo-level el identifiers will have fid/fid
 */
function getElIdentifierInfoFromKey(key: string): [string, ElIdentifierType] {
  if (key.startsWith('fid/')) {
    const fid = key.split('fid/')[1];
    return [fid, ElIdentifierType.FID];
  }
  return [key, ElIdentifierType.PATH];
}

export function normalizeBackwardCompatibilityForOpts(opts: ITourDataOpts): ITourDataOpts {
  if (opts === null || opts === undefined) {
    return opts;
  }
  const newOpts = { ...opts };

  if (typeof newOpts.primaryColor === 'string') {
    const primaryColor = createLiteralProperty(newOpts.primaryColor);
    newOpts.primaryColor = primaryColor;
  }
  if (typeof newOpts.annotationBodyBackgroundColor === 'string') {
    const annBgColor = createLiteralProperty(newOpts.annotationBodyBackgroundColor);
    newOpts.annotationBodyBackgroundColor = annBgColor;
  }
  if (newOpts.annotationFontColor === undefined || newOpts.annotationFontColor === null) {
    newOpts.annotationFontColor = createLiteralProperty('#424242');
  }

  if (typeof newOpts.annotationFontColor === 'string') {
    newOpts.annotationFontColor = createLiteralProperty(newOpts.annotationFontColor);
  }

  if (newOpts.annotationFontColor._val === undefined || newOpts.annotationFontColor._val === null) {
    newOpts.annotationFontColor = createLiteralProperty('#424242');
  }

  if (newOpts.annotationFontFamily === undefined) {
    newOpts.annotationFontFamily = createLiteralProperty(null);
  }

  if (typeof newOpts.annotationFontFamily === 'string' || newOpts.annotationFontFamily === null) {
    newOpts.annotationFontFamily = createLiteralProperty(newOpts.annotationFontFamily);
  }

  if (newOpts.annotationFontFamily._val === undefined) {
    newOpts.annotationFontFamily = createLiteralProperty(null);
  }

  if (typeof newOpts.annotationBodyBorderColor === 'string') {
    const annBodyBorderClr = createLiteralProperty(newOpts.annotationBodyBorderColor);
    newOpts.annotationBodyBorderColor = annBodyBorderClr;
  }

  if (newOpts.borderRadius === undefined || newOpts.borderRadius === null) {
    newOpts.borderRadius = createLiteralProperty(4);
  }

  if (typeof newOpts.borderRadius === 'number') {
    newOpts.borderRadius = createLiteralProperty(newOpts.borderRadius);
  }

  if (newOpts.borderRadius._val === undefined || newOpts.borderRadius._val === null) {
    newOpts.borderRadius = createLiteralProperty(4);
  }

  if (newOpts.lf_pkf === undefined || newOpts.lf_pkf === null) {
    newOpts.lf_pkf = 'email';
  }

  if (newOpts.annotationPadding === undefined || newOpts.annotationPadding === null) {
    newOpts.annotationPadding = createLiteralProperty('14 14');
  }

  if (typeof newOpts.annotationPadding === 'string') {
    newOpts.annotationPadding = createLiteralProperty(newOpts.annotationPadding);
  }

  if (newOpts.annotationPadding._val === undefined || newOpts.annotationPadding._val === null) {
    newOpts.annotationPadding = createLiteralProperty('14 14');
  }

  if (newOpts.showFableWatermark === undefined || newOpts.showFableWatermark === null) {
    newOpts.showFableWatermark = createLiteralProperty(true);
  }

  if (typeof newOpts.showFableWatermark === 'boolean') {
    newOpts.showFableWatermark = createLiteralProperty(newOpts.showFableWatermark);
  }

  if (newOpts.showFableWatermark._val === undefined || newOpts.showFableWatermark._val === null) {
    newOpts.showFableWatermark = createLiteralProperty(true);
  }

  if (newOpts.showStepNum === undefined || newOpts.showStepNum === null) {
    newOpts.showStepNum = createLiteralProperty(true);
  }

  if (typeof newOpts.showStepNum === 'boolean') {
    newOpts.showStepNum = createLiteralProperty(newOpts.showStepNum);
  }

  if (newOpts.showStepNum._val === undefined || newOpts.showStepNum._val === null) {
    newOpts.showStepNum = createLiteralProperty(true);
  }

  if (newOpts.reduceMotionForMobile === undefined || newOpts.reduceMotionForMobile === null) {
    newOpts.reduceMotionForMobile = false;
  }

  return newOpts;
}

export function normalizeBackwardCompatibilityForJourney(
  journey: JourneyData,
  opts: ITourDataOpts,
  globalOpts: IGlobalConfig,
): JourneyData {
  if (journey === null || journey === undefined || Object.keys(journey).length === 0) {
    return getSampleJourneyData(globalOpts);
  }

  if (typeof journey.primaryColor === 'string') {
    const optsPrimaryColor = typeof opts.primaryColor === 'string' ? opts.primaryColor : opts.primaryColor._val;

    if (!journey.primaryColor) {
      journey.primaryColor = createLiteralProperty(optsPrimaryColor);
    } else {
      journey.primaryColor = createLiteralProperty(journey.primaryColor);
    }
  }

  if (!journey.primaryColor._val) {
    journey.primaryColor = createLiteralProperty(opts.primaryColor._val);
  }

  if (!journey.hideModuleOnLoad) {
    journey.hideModuleOnLoad = false;
  }

  if (journey.cta && typeof journey.cta.text === 'string') {
    journey.cta.text = createLiteralProperty(journey.cta.text);
  }

  if (journey.cta && typeof journey.cta.navigateTo === 'string') {
    journey.cta.navigateTo = createLiteralProperty(journey.cta.navigateTo);
  }

  if (journey.cta && typeof journey.cta.size === 'string') {
    journey.cta.size = createLiteralProperty(journey.cta.size as AnnotationButtonSize);
  }

  // We only have left positioning due to voiceover
  if (journey.positioning && journey.positioning === CreateJourneyPositioning.Right_Bottom) {
    journey.positioning = CreateJourneyPositioning.Left_Bottom;
  }

  return journey;
}

function processBrandData(siteData: SiteData, globalOpts: IGlobalConfig): SiteData {
  const newSiteData = { ...siteData };
  for (const key of SiteDateKeysWithProperty) {
    if (newSiteData[key].type === PropertyType.REF) {
      newSiteData[key]._val = compileValue(globalOpts, newSiteData[key].from);
    }
  }
  return newSiteData;
}

export function normalizeBackwardCompatibilityForBrandData(
  tour: RespDemoEntity,
  globalOpts: IGlobalConfig,
): SiteData {
  const defaultSiteData = getDefaultSiteData(tour, globalOpts);

  if (tour.site) {
    const siteData = tour.site as SiteData;
    if (typeof siteData.logo === 'string') {
      siteData.logo = createLiteralProperty(siteData.logo);
    }

    if (typeof siteData.navLink === 'string') {
      siteData.navLink = createLiteralProperty(siteData.navLink);
    }

    if (typeof siteData.ctaText === 'string') {
      siteData.ctaText = createLiteralProperty(siteData.ctaText);
    }

    if (typeof siteData.ctaLink === 'string') {
      siteData.ctaLink = createLiteralProperty(siteData.ctaLink);
    }
  }

  return {
    ...defaultSiteData,
    ...(tour.site || {})
  };
}

/*
  This method merge the featurePerPlan and userSpecificOverridesPerPlan and create a FeatureForPlan object
  which will store the detail for each feature according to users plan.
  eg. {
     no_of_demos: {
        test: Test.COUNT,
        value: '<=1',
        plan: Plan.SOLO
     },
     no_of_creator: {
      test: Test.COUNT,
      value: '<=1',
      plan: '*'
     }
  }
*/
export function mergeAndTransformFeaturePerPlan(
  featurePerPlan: FeaturePerPlan,
  userSpecificOverridesPerPlan : FeaturePerPlan | null | undefined,
  plan: Plan
): FeatureForPlan {
  const newFeaturePerPlan: FeaturePerPlan = { ...featurePerPlan, ...(userSpecificOverridesPerPlan || {}) };
  const featureForPlan: FeatureForPlan = {};

  for (const key in newFeaturePerPlan) {
    if (newFeaturePerPlan[key]) {
      let planFound = false;
      let forRemainingPlan: PlanDetail | null = null;
      const planDetails = newFeaturePerPlan[key].plans;
      const isInBeta = newFeaturePerPlan[key].isInBeta || false;
      const requireAccess = newFeaturePerPlan[key].requireAccess || false;
      for (const planDetail of planDetails) {
        if (planDetail.plan === plan) {
          featureForPlan[key] = { ...planDetail, isInBeta, requireAccess };
          planFound = true;
          break;
        } else if (planDetail.plan === '*') {
          forRemainingPlan = planDetail;
        }
      }

      if (!planFound) {
        featureForPlan[key] = { ...forRemainingPlan!, isInBeta, requireAccess };
      }
    }
  }

  return featureForPlan;
}

export function processRawDemoHubData(
  demoHub: RespDemoEntity,
  config: RespCommonConfig,
  globalOpts: IGlobalConfig = getSampleGlobalConfig(),
  publishForTour: RespDemoEntity | undefined = undefined

): P_RespDemoHub {
  const d = new Date(demoHub.updatedAt);
  const dataFileUri = getDHConfigFileUri(demoHub, config, publishForTour);
  const thumbnailHash = demoHub.info ? demoHub.info.thumbnail : getDefaultThumbnailHash();
  const info = normalizeBackwardCompatibilityForEntityInfo(demoHub.info);

  return {
    ...demoHub,
    info,
    thumbnailUri: new URL(`${config.commonAssetPath}${thumbnailHash}`),
    displayableUpdatedAt: getDisplayableTime(d),
    configFileUri: dataFileUri,
  };
}

export function processDemoHubConfig(
  data: P_RespDemoHub,
  demoHub: IDemoHubConfig,
  globalConfig : IGlobalConfig
): IDemoHubConfig {
  const normalizedDemoHub = normalizeBackwardCompatibilityDemoHubConfig(demoHub);

  if (normalizedDemoHub.logo.type === PropertyType.REF) {
    normalizedDemoHub.logo._val = compileValue(globalConfig, normalizedDemoHub.logo.from);
  }

  if (normalizedDemoHub.fontFamily.type === PropertyType.REF) {
    normalizedDemoHub.fontFamily._val = compileValue(globalConfig, normalizedDemoHub.fontFamily.from);
  }

  normalizedDemoHub.cta.forEach(cta => {
    if (cta.text.type === PropertyType.REF) {
      cta.text._val = compileValue(globalConfig, cta.text.from);
    }

    if (cta.id === 'see-all-demos') {
      cta.link = createLiteralProperty(`/hub/seeall/${data.rid}`);
    }

    if (cta.link.type === PropertyType.REF) {
      cta.link._val = compileValue(globalConfig, cta.link.from);
    }

    if (cta.type.type === PropertyType.REF) {
      cta.type._val = compileValue(globalConfig, cta.type.from);
    }

    if (cta.style.bgColorProp.type === PropertyType.REF) {
      cta.style.bgColorProp._val = compileValue(globalConfig, cta.style.bgColorProp.from);
    }
  });
  return normalizedDemoHub;
}

function normalizeBackwardCompatibilityDemoHubConfig(demoHub : IDemoHubConfig) : IDemoHubConfig {
  const sampleDemoHubConfig = getSampleDemoHubConfig();
  demoHub = {
    ...sampleDemoHubConfig,
    ...demoHub,
  };

  if (typeof (demoHub.see_all_page.demoModalStyles.overlay as SimpleStyle).fontColor === 'string') {
    delete (demoHub.see_all_page.demoModalStyles.overlay as any).fontColor;
  }

  if (typeof (demoHub.qualification_page.header.style as SimpleStyle).borderColor === 'string') {
    delete (demoHub.qualification_page.header.style as any).borderColor;
  }

  if (typeof (demoHub.see_all_page.header.style as SimpleStyle).borderColor === 'string') {
    delete (demoHub.see_all_page.header.style as any).borderColor;
  }

  demoHub.see_all_page.sections.forEach(section => {
    if ((section as any).simpleStyle) {
      delete (section as any).simpleStyle;
    }
  });

  if ((demoHub.see_all_page.demoCardStyles).card === undefined) {
    const demoHubCardStyle = demoHub.see_all_page.demoCardStyles as unknown as SimpleStyle;
    demoHub.see_all_page.demoCardStyles.card = { ...demoHubCardStyle };
    demoHub.see_all_page.demoCardStyles.cta = sampleDemoHubConfig.see_all_page.demoCardStyles.cta;
  }

  if (typeof (demoHub.see_all_page.demoCardStyles.cta.style as SimpleStyle).borderColor === 'string') {
    delete (demoHub.see_all_page.demoCardStyles.cta.style as any).borderColor;
  }

  demoHub.cta.forEach(btn => {
    if (typeof btn.text === 'string') {
      btn.text = createLiteralProperty(btn.text);
    }

    if (typeof btn.link === 'string') {
      btn.link = createLiteralProperty(btn.link);
    }

    if (typeof btn.type === 'string') {
      btn.type = createLiteralProperty(btn.type);
    }
  });

  demoHub.cta.forEach(btn => {
    if (typeof (btn.style as any).borderColor === 'string') {
      delete (btn.style as any).borderColor;
    }
    if ((btn.type._val as string) === 'solid') {
      btn.type._val = 'primary';
    }

    if ((btn.style as SimpleStyle).bgColor) {
      btn.style.bgColorProp = createLiteralProperty((btn.style as SimpleStyle).bgColor);
      delete (btn.style as any).bgColor;
    }
  });

  demoHub.qualification_page.qualifications.forEach((qual) => {
    if (typeof (qual.sidePanel.conStyle as SimpleStyle).borderRadius === 'number') {
      delete (qual.sidePanel.conStyle as any).borderRadius;
    }

    if ((qual as any).sidepanelCTA !== undefined) {
      delete (qual as any).sidepanelCTA;
    }

    qual.entries.forEach(qualEntry => {
      if (typeof (qualEntry.continueCTA.style as SimpleStyle).borderColor === 'string') {
        delete (qualEntry.continueCTA.style as any).borderColor;
      }
      if (typeof (qualEntry.continueCTA.style as SimpleStyle).bgColor === 'string') {
        delete (qualEntry.continueCTA.style as any).bgColor;
      }
      if (typeof (qualEntry.skipCTA.style as SimpleStyle).borderColor === 'string') {
        delete (qualEntry.skipCTA.style as any).borderColor;
      }
      if (typeof (qualEntry.skipCTA.style as SimpleStyle).bgColor === 'string') {
        delete (qualEntry.skipCTA.style as any).bgColor;
      }

      if ((qualEntry.continueCTA.type as string) === 'solid') {
        qualEntry.continueCTA.type = 'primary';
      }

      if ((qualEntry.skipCTA.type as string) === 'solid') {
        qualEntry.skipCTA.type = 'primary';
      }
    });
  });

  if (demoHub.see_all_page.leadForm === undefined) {
    demoHub.see_all_page.leadForm = sampleDemoHubConfig.see_all_page.leadForm;
    if (typeof ((demoHub.see_all_page as any).showLeadForm) === 'boolean') {
      demoHub.see_all_page.leadForm.showLeadForm = (demoHub.see_all_page as any).showLeadForm;
      delete (demoHub.see_all_page as any).showLeadForm;
    }
  } else if (demoHub.see_all_page.leadForm.continueCTA === undefined) {
    demoHub.see_all_page.leadForm.continueCTA = {
      style: sampleDemoHubConfig.see_all_page.leadForm.continueCTA.style,
      text: sampleDemoHubConfig.see_all_page.leadForm.continueCTA.text
    };
  }
  return demoHub;
}

function getDHConfigFileUri(dh: RespDemoEntity, config: RespCommonConfig, publishForTour?: RespDemoEntity): URL {
  const tourAssetPath = config.demoHubAssetPath;
  const assetPrefixHash = dh.assetPrefixHash;
  const dataFileName = publishForTour
    ? publishForTour.pubDataFileName
    : config.dataFileName;

  const configFileUri = new URL(`${tourAssetPath}${assetPrefixHash}/${dataFileName}?ts=${+new Date()}`);

  return configFileUri;
}

export const getDefaultThumbnailHash = (): string => {
  if (isProdEnv()) {
    return 'ph/placeholder1.png';
  }
  return 'ph/placeholder1.png';
};

export function normalizeBackwardCompatibilityForEntityInfo(info: EntityInfo): EntityInfo {
  const defaultInfo: EntityInfo = {
    thumbnail: getDefaultThumbnailHash(),
    frameSettings: FrameSettings.LIGHT,
  };

  if (!info) return defaultInfo;

  return {
    ...defaultInfo,
    ...info,
  };
}

// Dataset
export interface P_Dataset extends Dataset {
  dataFileUri: URL;
  displayablePublishedAt: string | null;
  presignedEditUri: URL | null;
}

export function processRawDataset(
  dataset: Dataset,
  config: RespCommonConfig,
  orgId: number,
  loadEditable: boolean,
  presignedUrl: RespUploadUrl | null = null,
  isForExportedTour: boolean = false,
  baseUrl: string = '',
): P_Dataset {
  const lastPublishedDate = dataset.lastPublishedDate;

  const dataFileUri = getDatasetDataFileUri(
    dataset.name,
    config,
    orgId,
    isForExportedTour,
    baseUrl,
    loadEditable ? 0 : dataset.lastPublishedVersion,
  );
  const displayablePublishedAt = lastPublishedDate
    ? getDisplayableTime(
      (new Date(dataset.lastPublishedDate))
    )
    : null;

  const respPresignedUrl = presignedUrl;
  const presignedEditUri = respPresignedUrl ? new URL(respPresignedUrl.url) : null;

  const processedDataset: P_Dataset = {
    ...dataset,
    dataFileUri,
    displayablePublishedAt,
    presignedEditUri,
  };

  return processedDataset;
}

export function processDatasetConfig(
  config: DatasetConfig
): DatasetConfig {
  const defaultConfig = getDefaultDatasetConfig();

  return {
    ...defaultConfig,
    ...config,
    data: {
      ...defaultConfig.data,
      ...config.data,
    }
  };
}

export function getDatasetDataFileUri(
  datasetName: string,
  config: RespCommonConfig,
  orgId: number,
  isForExportedTour: boolean,
  baseUrl: string,
  datasetVersion: number = 0,
): URL {
  const datasetPartInPath = '/ds';
  const datasetAssetPath = config.datasetAssetPath.split(datasetPartInPath)[0];
  const datasetFileName = config.datasetFileName
    .replace('%d', datasetVersion.toString())
    .replace('%s', datasetName);

  const dataFileUri = isForExportedTour ? new URL(`${datasetAssetPath}${orgId}${datasetPartInPath}/${datasetFileName}?ts=${+new Date()}`, baseUrl)
    : new URL(`${datasetAssetPath}${orgId}${datasetPartInPath}/${datasetFileName}?ts=${+new Date()}`);

  return dataFileUri;
}
