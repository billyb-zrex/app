import {
  AnnotationButtonSize,
  AnnotationButtonStyle,
  AnnotationPositions,
  AnnotationSelectionEffect,
  CreateJourneyPositioning,
  CustomAnnDims,
  IAnnotationButton_WithProperty,
  IAnnotationConfig,
  IAnnotationConfig_WithProperty,
  IGlobalConfig,
  ITourDataOpts,
  Property,
  PropertyType,
  TourData,
  TourDataOpts_WithProperty
} from './types';
import { SchemaVersion } from './api-contract';
import { DEFAULT_BLUE_BORDER_COLOR } from './constants';

export function isSameOrigin(origin1: string, origin2: string): boolean {
  const url1 = new URL(origin1);
  const url2 = new URL(origin2);

  return url1.host === url2.host;
}

export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function getDisplayableTime(d: Date): string {
  const now = +new Date();
  const dMs = +d;
  const diff = now - dMs;

  const aMin = 60 * 1000;
  const anHour = 60 * aMin;
  const aDay = 24 * anHour;

  if (diff < aMin) {
    return 'Just now';
  }

  if (diff < anHour) {
    const mins = (diff / aMin) | 0;
    return `${mins} min${mins > 1 ? 's' : ''} ago`;
  }

  if (diff < aDay) {
    const hrs = (diff / anHour) | 0;
    return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  }

  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

// eslint-disable-next-line no-promise-executor-return
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function getCurrentUtcUnixTime(): number {
  return Math.floor(new Date().getTime() / 1000);
}

export function deepcopy<T>(obj: T): T {
  if ('structuredClone' in window && typeof structuredClone === 'function') {
    return structuredClone(obj) as T;
  }
  return JSON.parse(JSON.stringify(obj));
}

export function trimSpaceAndNewLine(txt: string): string {
  return txt
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join('\n');
}

export function getRandomId(): string {
  return `${+new Date() / 1000 | 0}${Math.random().toString(16).substring(2, 15)}`;
}

export function snowflake(): number {
  return parseInt(`${+new Date()}${(Math.random() * 1000) | 0}`, 10);
}

export const createLiteralProperty = <T>(val : T) : Property<T> => ({
  type: PropertyType.LITERAL,
  from: '',
  _val: val
});

export const createGlobalProperty = <T>(
  val : T,
  from : typeof GlobalPropsPath[keyof typeof GlobalPropsPath])
  : Property<T> => (
    {
      type: PropertyType.REF,
      from: from as string,
      _val: val
    }
  );

export const getDefaultTourOpts = (globalOpts: IGlobalConfig): ITourDataOpts => ({
  lf_pkf: 'email',
  main: '',
  primaryColor: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.primaryColor),
    GlobalPropsPath.primaryColor,
  ),
  annotationBodyBackgroundColor: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.annBodyBgColor),
    GlobalPropsPath.annBodyBgColor,
  ),
  annotationBodyBorderColor: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.annBorderColor),
    GlobalPropsPath.annBorderColor,
  ),
  annotationFontColor: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.fontColor),
    GlobalPropsPath.fontColor,
  ),
  monoIncKey: 0,
  createdAt: getCurrentUtcUnixTime(),
  updatedAt: getCurrentUtcUnixTime(),
  annotationFontFamily: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.fontFamily),
    GlobalPropsPath.fontFamily,
  ),
  borderRadius: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.annBorderRadius),
    GlobalPropsPath.annBorderRadius,
  ),
  annotationPadding: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.annConPad),
    GlobalPropsPath.annConPad,
  ),
  showFableWatermark: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.showWatermark),
    GlobalPropsPath.showWatermark,
  ),
  showStepNum: createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.showStepNo),
    GlobalPropsPath.showStepNo,
  ),
  reduceMotionForMobile: false,
});

export function getSampleJourneyData(globalOpts: IGlobalConfig) {
  return {
    positioning: CreateJourneyPositioning.Left_Bottom,
    title: '',
    flows: [],
    primaryColor: createGlobalProperty(
      compileValue(globalOpts, GlobalPropsPath.primaryColor),
      GlobalPropsPath.primaryColor,
    ),
    hideModuleOnLoad: false,
    hideModuleOnMobile: false,
  };
}

export function createEmptyTourDataFile(globalOpts: IGlobalConfig): TourData {
  return {
    v: SchemaVersion.V1,
    lastUpdatedAtUtc: -1,
    opts: getDefaultTourOpts(globalOpts),
    entities: {},
    diagnostics: {},
    journey: getSampleJourneyData(globalOpts),
  };
}

export const DEFAULT_ANN_DIMS: CustomAnnDims = {
  width: 256,
};

export const SAMPLE_ANN_CONFIG_TEXT = 'Write a brief description of what your buyer should expect from this particular module of your product';
export const getSampleConfig = (
  elPath: string,
  grpId: string,
  globalOpts: IGlobalConfig,
  text: string = SAMPLE_ANN_CONFIG_TEXT,
  nextBtnText: string | null = null,
  richText: string | null = '',
  isAiIntroOrOutro: boolean = false,
): IAnnotationConfig => {
  richText = richText || `<p class="editor-paragraph" dir="ltr"><span>${text}</span></p>`;
  const isCoverAnn = elPath === '$';
  const id = getRandomId();

  const nextButtonText = nextBtnText ? createLiteralProperty(nextBtnText) : createGlobalProperty(
    compileValue(globalOpts, GlobalPropsPath.nextBtnText),
    GlobalPropsPath.nextBtnText,
  );

  const size = isAiIntroOrOutro ? 'large'
    : isCoverAnn || (nextButtonText._val as string).length > 12 ? 'medium' : 'small';

  return {
    selectionEffect: createGlobalProperty(
      compileValue(globalOpts, GlobalPropsPath.selEffect),
      GlobalPropsPath.selEffect
    ),
    annotationSelectionColor: createGlobalProperty(
      compileValue(globalOpts, GlobalPropsPath.selColor),
      GlobalPropsPath.selColor
    ),
    id: isCoverAnn ? `$#${id}` : elPath,
    refId: id,
    grpId,
    zId: id,
    createdAt: getCurrentUtcUnixTime(),
    updatedAt: getCurrentUtcUnixTime(),
    bodyContent: richText,
    displayText: text,
    positioning: AnnotationPositions.Auto,
    monoIncKey: 0,
    syncPending: true,
    type: isCoverAnn ? 'cover' : 'default',
    size,
    customDims: DEFAULT_ANN_DIMS,
    isHotspot: !isCoverAnn,
    hideAnnotation: false,
    videoUrl: '', // legacy
    videoUrlHls: '',
    videoUrlMp4: '',
    videoUrlWebm: '',
    targetElCssStyle: '',
    annCSSStyle: '',
    showOverlay: true,
    // TODO : refactor it in such a way that only this 'hotspotElPath' property is enough
    // to convey if the ann has an hotspot. For eg. this will be null when hotspot toggle is off
    // it will be "." when hotspot toggle is on and will have a path like "1.1.2.2" when it is a granular hotspot
    hotspotElPath: null,
    buttons: [{
      id: getRandomId(),
      type: 'next',
      style: createGlobalProperty(
        compileValue(globalOpts, GlobalPropsPath.nextBtnStyle),
        GlobalPropsPath.nextBtnStyle,
      ),
      size: createGlobalProperty(
        compileValue(globalOpts, GlobalPropsPath.ctaSize),
        GlobalPropsPath.ctaSize,
      ),
      text: nextButtonText,
      order: 9999,
      hotspot: null,
    }, {
      id: getRandomId(),
      type: 'prev',
      style: createGlobalProperty(
        compileValue(globalOpts, GlobalPropsPath.prevBtnStyle),
        GlobalPropsPath.prevBtnStyle,
      ),
      size: createGlobalProperty(
        compileValue(globalOpts, GlobalPropsPath.ctaSize),
        GlobalPropsPath.ctaSize,
      ),
      text: createGlobalProperty(
        compileValue(globalOpts, GlobalPropsPath.prevBtnText),
        GlobalPropsPath.prevBtnText,
      ),
      order: 0,
      hotspot: null
    }],
    buttonLayout: 'default',
    selectionShape: createGlobalProperty(
      compileValue(globalOpts, GlobalPropsPath.selShape),
      GlobalPropsPath.selShape,
    ),
    isLeadFormPresent: false,
    m_id: elPath,
    scrollAdjustment: 'auto',
    audio: null,
    voiceover: null,
    markedImage: null,
  };
};

export const getSampleGlobalConfig = (): IGlobalConfig => ({
  logo: 'https://s3.amazonaws.com/app.sharefable.com/favicon.png',
  companyUrl: 'https://sharefable.com',
  demoLoadingText: 'Setting up the interactive demo for you',
  fontFamily: '',
  primaryColor: '#7567ff',
  ctaSize: AnnotationButtonSize.Medium,
  annBodyBgColor: '#FFFFFF',
  annBorderColor: '#BDBDBD',
  fontColor: '#424242',
  annBorderRadius: 4,
  annConPad: '14 14',
  selColor: DEFAULT_BLUE_BORDER_COLOR,
  selShape: 'box',
  selEffect: 'regular',
  showStepNo: true,
  showWatermark: true,
  nextBtnText: 'Next',
  nextBtnStyle: AnnotationButtonStyle.Primary,
  prevBtnText: 'Back',
  prevBtnStyle: AnnotationButtonStyle.Primary,
  customBtn1Text: 'Book a demo',
  customBtn1Style: AnnotationButtonStyle.Primary,
  customBtn1URL: 'https://www.sharefable.com/get-a-demo',

  monoIncKey: 1,
  createdAt: getCurrentUtcUnixTime(),
  updatedAt: getCurrentUtcUnixTime(),
  version: 1,
});

export const isProdEnv = () => {
  const isProd = (process.env.REACT_APP_ENVIRONMENT === 'prod') || (process.env.REACT_APP_ENVIRONMENT === 'staging');
  return isProd;
};

export const getImgScreenData = () => ({
  version: '2023-01-10',
  vpd: {
    h: -1,
    w: -1
  },
  docTree: {
    type: 1,
    name: 'html',
    attrs: {
      lang: 'en',
      'fable-stf': '0',
      'fable-slf': '0',
      style: 'width: 100%; height: 100%;'
    },
    props: {},
    chldrn: [
      {
        type: 1,
        name: 'head',
        attrs: {
          'fable-stf': '0',
          'fable-slf': '0'
        },
        props: {},
        chldrn: [
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'meta',
            attrs: {
              charset: 'UTF-8',
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {},
            chldrn: []
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'meta',
            attrs: {
              'http-equiv': 'X-UA-Compatible',
              content: 'IE=edge',
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {},
            chldrn: []
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'meta',
            attrs: {
              name: 'viewport',
              content: 'width=device-width, initial-scale=1.0',
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {},
            chldrn: []
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'title',
            attrs: {
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {},
            chldrn: [
              {
                type: 3,
                name: '#text',
                attrs: {},
                props: {
                  textContent: 'Image iframe'
                },
                chldrn: []
              }
            ]
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'style',
            attrs: {
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {
              cssRules: 'body { margin: 0px; padding: 0px; } #img { width: 100%; height: auto; } '
            },
            chldrn: []
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          }
        ]
      },
      {
        type: 8,
        name: '#text',
        attrs: {},
        props: {},
        chldrn: []
      },
      {
        type: 1,
        name: 'body',
        attrs: {
          'fable-stf': '0',
          'fable-slf': '0',
          style: 'visibility: visible;width: 100%; min-height: 100vh;display: flex;align-items: center;justify-content: center;'
        },
        props: {},
        chldrn: [
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'img',
            attrs: {
              id: 'img',
              src: '',
              style: 'box-shadow: 0 0 5px 2px rgba(0, 0, 0, 0.3);',
              alt: 'Image',
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {
            },
            chldrn: []
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 8,
            name: '#text',
            attrs: {},
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'div',
            attrs: {
              id: 'fable-0-cm-presence',
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {},
            chldrn: []
          },
          {
            type: 1,
            name: 'div',
            attrs: {
              id: 'fable-0-de-presence',
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {},
            chldrn: []
          },
          {
            type: 8,
            name: 'div',
            attrs: {
              style: '\n    \n    display: flex !important;\n    background-color: #7567FF !important;\n    top:-10000px; \n    left:-10000px;\n    position: fixed !important;\n    border-radius: 28px !important;\n    justify-content: center !important;\n    align-items: center !important;\n    padding: 8px 24px !important;\n    gap: 8px !important;\n    z-index: 9999999 !important;\n  \n    top: 670px !important;\n    left: 1297px !important;\n  ',
              class: 'fable-dont-ser',
              'fable-stf': '0',
              'fable-slf': '0'
            },
            props: {},
            chldrn: []
          }
        ]
      }
    ]
  }
});

export function hexToRGB(colorValue: string) {
  return {
    red: parseInt(colorValue.substring(1, 3), 16),
    green: parseInt(colorValue.substring(3, 5), 16),
    blue: parseInt(colorValue.substring(5, 7), 16),
  };
}

export const rgbToHex = (rgb: string) : string => {
  const rgbValues = rgb.match(/\d+/g);

  const r = parseInt(rgbValues![0], 10);
  const g = parseInt(rgbValues![1], 10);
  const b = parseInt(rgbValues![2], 10);

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

const globalProps = '$globalProps';

export const GlobalPropsPath = {
  logo: `${globalProps}.logo`,
  companyUrl: `${globalProps}.companyUrl`,
  demoLoadingText: `${globalProps}.demoLoadingText`,
  fontFamily: `${globalProps}.fontFamily`,
  primaryColor: `${globalProps}.primaryColor`,
  ctaSize: `${globalProps}.ctaSize`,
  annBodyBgColor: `${globalProps}.annBodyBgColor`,
  annBorderColor: `${globalProps}.annBorderColor`,
  fontColor: `${globalProps}.fontColor`,
  annBorderRadius: `${globalProps}.annBorderRadius`,
  annConPad: `${globalProps}.annConPad`,
  selColor: `${globalProps}.selColor`,
  selShape: `${globalProps}.selShape`,
  selEffect: `${globalProps}.selEffect`,
  showStepNo: `${globalProps}.showStepNo`,
  showWatermark: `${globalProps}.showWatermark`,
  nextBtnText: `${globalProps}.nextBtnText`,
  nextBtnStyle: `${globalProps}.nextBtnStyle`,
  prevBtnText: `${globalProps}.prevBtnText`,
  prevBtnStyle: `${globalProps}.prevBtnStyle`,
  customBtn1Text: `${globalProps}.customBtn1Text`,
  customBtn1Style: `${globalProps}.customBtn1Style`,
  customBtn1URL: `${globalProps}.customBtn1URL`
} as const;

export function compileValue(
  globalOpts : IGlobalConfig,
  path :typeof GlobalPropsPath[keyof typeof GlobalPropsPath]
): any {
  const opts: Record<string, any> = { ...getSampleGlobalConfig() };
  for (const [key, value] of Object.entries(globalOpts || {})) {
    if (value !== undefined && value !== null) opts[key] = value;
  }
  const keys : string[] = path.split('.').slice(1);
  return keys.reduce((acc, key) => acc[key], opts as any);
}

export const getDefaultLiteralTourOpts = (): ITourDataOpts => ({
  lf_pkf: 'email',
  main: '',
  primaryColor: createLiteralProperty('#7567FF'),
  annotationBodyBackgroundColor: createLiteralProperty('#FFFFFF'),
  annotationBodyBorderColor: createLiteralProperty('#BDBDBD'),
  annotationFontColor: createLiteralProperty('#424242'),
  monoIncKey: 0,
  createdAt: getCurrentUtcUnixTime(),
  updatedAt: getCurrentUtcUnixTime(),
  annotationFontFamily: createLiteralProperty(null),
  borderRadius: createLiteralProperty(4),
  annotationPadding: createLiteralProperty('14 14'),
  showFableWatermark: createLiteralProperty(true),
  showStepNum: createLiteralProperty(true),
  reduceMotionForMobile: false,
});

export const AnnBtnKeysWithProperty: Array<keyof IAnnotationButton_WithProperty> = [
  'text', 'style', 'size'
];

export const AnnConfigKeysWithProperty: Array<keyof IAnnotationConfig_WithProperty> = [
  'selectionEffect', 'selectionEffect', 'annotationSelectionColor'
];

export const TourOptsKeysWithProperty: Array<keyof TourDataOpts_WithProperty> = [
  'primaryColor', 'annotationBodyBackgroundColor', 'annotationBodyBorderColor',
  'annotationFontFamily', 'annotationFontColor', 'borderRadius', 'showFableWatermark',
  'annotationPadding', 'showStepNum',
];

function removeTrailingCommaIfPresent(str: string) {
  if (str.endsWith(',')) {
    return str.slice(0, -1);
  }
  return str;
}

export function getUrlsFromSrcset(srcset: string): string[] {
  const matches = (srcset || '').trim().match(/(?:\S+\s+\d+[wx](?:,\s*|$))|(?:\S+)(?:,\s*|$)/g);
  return matches ? matches.map(match => {
    const parts = match.trim().split(/\s+/);
    if (parts.length > 1) {
      return parts[0];
    } if (parts.length === 1) {
      return removeTrailingCommaIfPresent(parts[0]);
    }
    return match.trim();
  }) : [];
}
