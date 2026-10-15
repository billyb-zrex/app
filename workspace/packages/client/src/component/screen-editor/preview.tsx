import { JourneyData, ScreenData } from '@fable/common/dist/types';
import React from 'react';
import { ScreenType } from '@fable/common/dist/api-contract';
import raiseDeferredError from '@fable/common/dist/deferred-error';
import { P_RespScreen } from '../../entity-processor';
import { scrollIframeEls } from './scroll-util';
import * as Tags from './preview-styled';
import { deserFrame } from './utils/deser';
import { createFableRtUmbrlDivWrapper, getFableRtUmbrlDivWrapper } from '../annotation/utils';
import { ANN_ZOOMED, FABLE_IFRAME_GENERIC_CLASSNAME, SCREEN_SIZE_MSG } from '../../constants';
import LogoWatermark from '../watermark/logo-watermark';
import { IframePos, EditItem, ScreenSizeData, Quadrant, QuadrantType, InternalEvents, Payload_Navigation } from '../../types';
import { applyEditsToSerDom } from './utils/edits';
import { getCustomTopLeftAndScale, getScaleOfElement, MAX_ZOOM_SCALE, scaleRect } from '../../utils';
import { OnNavigationEvent } from '../../container/player';
import { Rect } from '../base/hightligher-base';

export interface IOwnProps {
  resizeSignal: number;
  journey: JourneyData | null;
  showWatermark: boolean;
  allEdits: EditItem[];
  screen: P_RespScreen;
  screenData: ScreenData;
  hidden: boolean;
  innerRefs?: React.MutableRefObject<HTMLIFrameElement | null>[];
  onBeforeFrameBodyDisplay: (params: { nestedFrames: HTMLIFrameElement[] }) => void;
  onFrameAssetLoad: () => void;
  isScreenPreview: boolean;
  playMode: boolean;
  isResponsive: boolean;
  viewportHeight?: number;
  heightOffset: number;
  borderColor?: string;
  onIframeClick?: ()=>void;
  enableZoomPan: boolean;
  showShadowAroundFrame?: boolean;
}

export interface DeSerProps {
  partOfSvgEl: number;
  shadowRoot?: ShadowRoot;
  shadowParent: ShadowRoot | null;
}

const IFRAME_DEFAULT_DOC = '<!DOCTYPE html><html><head></head><body></body></html>';

export const ROOT_EMBED_IFRAME_ID = `fab-reifi-${Math.random() * (10 ** 4) | 0}`;

const PREVIEW_BOX_SHADOW_DATA = {
  OFFSET_X: 0,
  OFFSET_Y: 0,
  BLUR_RADIUS: 10,
  SPREAD_RADIUS: 2,
  COLOR: 'rgba(33, 33, 33)'
} as const;

const PREVIEW_BOX_SHADOW = `
${PREVIEW_BOX_SHADOW_DATA.OFFSET_X}px 
${PREVIEW_BOX_SHADOW_DATA.OFFSET_Y}px 
${PREVIEW_BOX_SHADOW_DATA.BLUR_RADIUS}px 
${PREVIEW_BOX_SHADOW_DATA.SPREAD_RADIUS}px 
${PREVIEW_BOX_SHADOW_DATA.COLOR}`;

function previewShadowSizeExtenstion(shouldShowShadow: boolean): {shadowWidth: number, shadowHeight: number} {
  if (!shouldShowShadow) {
    return { shadowHeight: 0, shadowWidth: 0 };
  }
  const { BLUR_RADIUS, SPREAD_RADIUS } = PREVIEW_BOX_SHADOW_DATA;
  const shadowWidth = (2 * (BLUR_RADIUS + SPREAD_RADIUS));
  const shadowHeight = (2 * (BLUR_RADIUS + SPREAD_RADIUS));
  return { shadowWidth, shadowHeight };
}

interface IOwnState {
  renderComplete: boolean;
}

export default class ScreenPreview extends React.PureComponent<IOwnProps, IOwnState> {
  static readonly ATTR_ORIG_VAL_SAVE_ATTR_NAME = 'fab-orig-val-t';

  // eslint-disable-next-line react/no-unused-class-component-methods
  scaleFactor: number = 1;

  embedFrameRef: React.MutableRefObject<HTMLIFrameElement | null> = React.createRef();

  frameOfReferenceElRef: React.MutableRefObject<HTMLDivElement | null> = React.createRef();

  frameWrapperRef: React.MutableRefObject<HTMLDivElement | null> = React.createRef();

  watermarkRef: React.MutableRefObject<HTMLAnchorElement | null> = React.createRef();

  nestedFrames: Array<HTMLIFrameElement> = [];

  // eslint-disable-next-line class-methods-use-this
  sendIframeScreenSizeData: () => void = () => {};

  private assetLoadingPromises: Promise<unknown>[] = [];

  private frameLoadingPromises: Promise<unknown>[] = [];

  constructor(props: IOwnProps) {
    super(props);
    this.state = {
      renderComplete: false,
    };
  }

  deserDomIntoFrame = async (frame: HTMLIFrameElement): Promise<void> => {
    /*
     * FIXME By default assume all pages are responsive via css
     *       But there will always be pages like gmail, analytics where responsiveness is implemented via js
     *       For those cases ask user to select if the page is responsive or not.
     *       If it's responsive don't apply any scaling / zooming
     *       If it's not responsive for chrome apply zoom, for firefox apply the following logic.
     *       For scaling, always do width fitting and height should take up the whole height of parent
     */

    // This calculation is to make transform: scale work like zoom property.
    // We can't use Zoom property as it's only supported by chrome and some version of ie.
    //
    // There might be pages (Google Analytics) that are not responsive and while capturing from extension it was
    // captured from a different dimension than a screen that is used to preview the screen.
    //
    // To support screen dimension interchangeably, we have to zoom in / zoom out the screen keeping the aspect ratio
    // same. The following calculation is done >>>
    //
    // 1. Calculate the boundingRect for iframe before we scale. Ideally that's the actual dimension of the frame.
    // 2. Figure out the scale factor for the current screen vs the screen the page was captured
    // 3. Apply scale to the element (wrt origin 0, 0 ; default scaling is centered)
    // 4. Now the container is visually smaller (for scale < 1) than the original one before it was scaled
    // 5. Figure out what's the new height and width with the scale applied

    this.handleScreenResponsiveness();

    const doc = frame?.contentDocument;
    const frameBody = doc?.body;
    const frameHtml = doc?.documentElement;
    if (doc) {
      if (frameHtml && frameBody) {
        let screenData = this.props.screenData;
        if (this.props.screen.type === ScreenType.SerDom) {
          screenData = applyEditsToSerDom(this.props.allEdits, this.props.screenData);
        }
        deserFrame(
          screenData.docTree,
          doc,
          screenData.version,
          this.frameLoadingPromises,
          this.assetLoadingPromises,
          this.nestedFrames,
          this.props.screen.type === ScreenType.Img,
        );
        while (this.frameLoadingPromises.length) {
          await this.frameLoadingPromises.shift();
        }
        frame.contentDocument.body.setAttribute('dxdy', '0,0');
      } else {
        throw new Error("Can't find body of embed iframe");
      }
    } else {
      throw new Error("Can't find document of embed iframe");
    }
  };

  componentDidUpdate(prevProps: Readonly<IOwnProps>, prevState: Readonly<{}>, snapshot?: any): void {
    if (this.props.showWatermark && (prevProps.showWatermark !== this.props.showWatermark)) {
      this.handleScreenResponsiveness();
    }

    if (prevProps.isResponsive !== this.props.isResponsive
      || prevProps.viewportHeight !== this.props.viewportHeight) {
      this.handleScreenResponsiveness();
    }

    /**
     * In the previous code fit height / fit width
     * was determined for an image screen from responsive column of screen db.
     * Right now responsiveness of demo and screen fit-height & fit-width are two independent things
     * and could be applied with one another. We haven't changed the name of the column hence we are still
     * using screen.responsive property, but in reality it's just 1/true -> fit-height and 0/false -> fit-width
     */
    if (prevProps.screen.responsive !== this.props.screen.responsive) {
      this.handleImgScreenResponsiveness();
    }

    if (prevProps.resizeSignal !== this.props.resizeSignal) {
      this.handleScreenResponsiveness();
    }

    if (prevProps.hidden !== this.props.hidden) {
      // Since we prerender some screens, we only capture keyboard event if iframe is visible.
      if (!this.props.hidden) {
        this.installListeners();
        this.sendIframeScreenSizeData();
      } else this.removeListeners();
    }
  }

  componentWillUnmount(): void {
    this.removeListeners();
  }

  installListeners() {
    if (this.embedFrameRef.current && this.embedFrameRef.current.contentWindow) {
      this.embedFrameRef.current.contentWindow.focus();
      this.embedFrameRef.current.contentWindow.document.addEventListener('keyup', this.onKeyup);
    } else {
      raiseDeferredError(new Error('Count not register keyboard listeners'));
    }
  }

  removeListeners() {
    if (this.embedFrameRef.current && this.embedFrameRef.current.contentWindow) {
      this.embedFrameRef.current.contentWindow.document.removeEventListener('keyup', this.onKeyup);
    }
    document.removeEventListener(InternalEvents.OnNavigation, this.onMessage);
  }

  // TODO the internal and external events are a little bit messy and does not have proper structure / convention.
  //      fix it if we ever release external events.
  onKeyup = (e: KeyboardEvent) => {
    if (e.keyCode === 39 || e.keyCode === 40 || e.keyCode === 76 || e.keyCode === 68) {
      // if key pressed is right arrow (39) or down arrow (40) or l (76) or d (68)
      this.embedFrameRef.current!.contentWindow?.postMessage({
        type: 'f-go-next-ann',
      });
    } else if (e.keyCode === 37 || e.keyCode === 38 || e.keyCode === 74 || e.keyCode === 65) {
      // if key pressed is left arrow (37) or down up (38) or j (74) or a (65)
      this.embedFrameRef.current!.contentWindow?.postMessage({
        type: 'f-go-prev-ann',
      });
    }
  };

  onMessage = (e: OnNavigationEvent) : void => {
    if (!e.detail) return;
    const { box, screenId, annotationType } = e.detail;
    if (screenId === this.props.screen.id) {
      if (annotationType === 'voiceover') {
        const quadrant = this.determineQuadrant(box);
        this.zoomToQuadrant(quadrant, box, e.detail);
      } else {
        this.zoomToQuadrant({ to: QuadrantType.Reset }, box, e.detail);
      }
    }
  };

  componentDidMount(): void {
    const frame = this.embedFrameRef.current;
    if (!frame) {
      throw new Error("Can't find embed iframe");
    }

    if (this.props.screen.type === ScreenType.SerDom
      && !this.props.enableZoomPan) {
      // TODO: handle responsive screens
      document.addEventListener(InternalEvents.OnNavigation, this.onMessage);
    }

    frame.onload = () => {
      const timer = setTimeout(async () => {
        await this.deserDomIntoFrame(frame);
        /* requestAnimationFrame */setTimeout(() => {
          const doc = frame.contentDocument;
          const frameBody = doc?.body;
          // Make the iframe visible after all the assets are loaded
          Promise.all(this.assetLoadingPromises).then(() => {
            // create a elative container that would contain all the falbe related els
            if (frameBody) {
              let umbrellaDiv = getFableRtUmbrlDivWrapper(doc);
              if (!umbrellaDiv) {
                umbrellaDiv = createFableRtUmbrlDivWrapper(doc);
              }
              this.props.onBeforeFrameBodyDisplay({
                nestedFrames: this.nestedFrames,
              });
              this.assetLoadingPromises.length = 0;
              if (this.props.screen.type === ScreenType.Img) {
                const screenImage = doc.getElementById('img')!;
                if (screenImage && !screenImage.style.boxShadow) {
                  screenImage.style.boxShadow = '0 0 5px 2px rgba(0, 0, 0, 0.3)';
                }
                this.handleImgScreenResponsiveness();
              }
              if (this.props.isScreenPreview) {
                scrollIframeEls(this.props.screenData.version, doc);
              }
              this.props.onFrameAssetLoad();
              if (!this.props.hidden) this.installListeners();
              this.setState({ renderComplete: true });
            }
          });

          if (frameBody && this.props.onIframeClick) {
            frameBody.onclick = () => this.props.onIframeClick!();
          }
        }, 100);
        // If the screen is prerendered (hence hidden) we wait for 2seconds before we start rendering as
        // the rendered screen might do scrolling to the element and this is a arbritary time to wait so that
        // the scroll animation is closer to 60fps.
        // TODO A better way to detect scroll is to update a global variable about scrolling status.
        clearTimeout(timer);
      }, this.props.hidden ? 1000 : 16);
    };
  }

  handleWatermarkPositioning = (
    top: number,
    height: number,
    left: number,
    width: number,
    heightOffset: number
  ): void => {
    const watermarkEl = this.watermarkRef.current;
    const GUTTER = 16 - (heightOffset ? 4 : 2);
    if (!watermarkEl) return;

    // INFO this code is not executed as we have stopped supporting module on the right
    /* if (
      this.props.journey
      && this.props.journey.flows.length
      && this.props.journey.positioning === CreateJourneyPositioning.Right_Bottom
    ) {
      watermarkEl.style.left = `${Math.round((left) + (HORIZONTAL_PADDING_FACTOR * this.scaleFactor))}px`;
      watermarkEl.style.transform = 'translate(0%, -100%)';
    } */
    watermarkEl.style.left = `${Math.round((left) + (width * this.scaleFactor) - GUTTER)}px`;
    watermarkEl.style.top = `${Math.round((top) + (height * this.scaleFactor) + heightOffset - GUTTER)}px`;
  };

  prepareSendIframeScreenSizeData = (scaleFactor: number, iframePos: IframePos): void => {
    this.sendIframeScreenSizeData = () => window.postMessage({
      scaleFactor,
      screenId: this.props.screen.id,
      type: SCREEN_SIZE_MSG,
      iframePos
    }, '*');
    !this.props.hidden && this.sendIframeScreenSizeData();
  };

  initialiseFrameComponentPosition(el: HTMLElement): void {
    el.style.position = 'absolute';
    el.style.transformOrigin = '0 0';
    el.style.top = `${this.props.heightOffset}px`;
    el.style.left = '0px';
  }

  handleScreenResponsiveness = (): void => {
    const frame = this.embedFrameRef.current;
    const referenceFrame = this.frameOfReferenceElRef.current;
    const frameWrapper = this.frameWrapperRef.current;

    const { shadowHeight, shadowWidth } = previewShadowSizeExtenstion(Boolean(this.props.showShadowAroundFrame));
    if (!frame || !referenceFrame || !frameWrapper) {
      throw new Error("Can't find embed iframe");
    }

    const origFrameViewPort = referenceFrame.parentElement!.parentElement!.getBoundingClientRect();
    this.initialiseFrameComponentPosition(referenceFrame);
    this.initialiseFrameComponentPosition(frame);
    this.initialiseFrameComponentPosition(frameWrapper);

    if (this.props.screen.type === ScreenType.Img) {
      this.handleImgScreenResponsiveness();
    }

    origFrameViewPort.height -= this.props.heightOffset;

    // When browser frame is present (embed route) we show a border of 2px around the iframe to make it look like a browser frame
    // When that happens the iframe's dimension needs to be reduced by 4px (2px either side)
    // When browser window is not present (live route) we show border of 1px arond the iframe
    const heightWidthAdjustment = this.props.heightOffset ? 4 : 0;
    frameWrapper.style.borderColor = this.props.borderColor || 'transparent';
    if (this.props.heightOffset) {
      // when heightOffset is present that means frame is present hence we don't show the top border
      frameWrapper.style.borderTop = 'none';
    }

    if (!this.props.isResponsive) {
      // INFO for now we use a constant image scaling size of 1280 / 720 (with ratio 16:9)
      const vpdW = this.props.screen.type === ScreenType.SerDom ? this.props.screenData.vpd.w : 1280;
      const vpdH = this.props.screen.type === ScreenType.SerDom
        ? (this.props.viewportHeight ?? this.props.screenData.vpd.h) : 720;

      const scaleX = (origFrameViewPort.width - shadowWidth) / vpdW;
      const scaleY = (origFrameViewPort.height - shadowHeight) / vpdH;
      const scale = Math.min(scaleX, scaleY);
      // eslint-disable-next-line react/no-unused-class-component-methods
      this.scaleFactor = scale;

      // We apply border around the iframe to have a
      const adjustedVpdW = vpdW - heightWidthAdjustment;
      const adjustedVpdH = vpdH - heightWidthAdjustment;

      referenceFrame.style.transform = `scale(${scale})`;
      referenceFrame.style.transformOrigin = '0 0';
      referenceFrame.style.position = 'absolute';
      referenceFrame.style.width = `${vpdW - heightWidthAdjustment}px`;
      referenceFrame.style.height = `${vpdH - heightWidthAdjustment}px`;

      frameWrapper.style.position = 'absolute';

      frame.style.width = `${vpdW - heightWidthAdjustment}px`;
      frame.style.height = `${vpdH - heightWidthAdjustment}px`;
      frame.style.transform = `scale(${scale})`;
      frame.style.transformOrigin = '0 0';

      const viewPortAfterScaling = referenceFrame.getBoundingClientRect();

      const iframePos: ScreenSizeData['iframePos'] = {
        left: viewPortAfterScaling.left,
        top: viewPortAfterScaling.top - this.props.heightOffset,
        height: viewPortAfterScaling.height,
        width: viewPortAfterScaling.width,
        heightOffset: this.props.heightOffset
      };

      if (origFrameViewPort.width > viewPortAfterScaling.width) {
        frame.style.left = `${(origFrameViewPort.width - viewPortAfterScaling.width) / 2}px`;
        referenceFrame.style.left = `${(origFrameViewPort.width - viewPortAfterScaling.width) / 2}px`;
        frameWrapper.style.left = `${(origFrameViewPort.width - viewPortAfterScaling.width) / 2}px`;
        iframePos.left = (origFrameViewPort.width - viewPortAfterScaling.width) / 2;
      }
      if (origFrameViewPort.height > viewPortAfterScaling.height) {
        const scaledOffset = this.props.heightOffset;
        frame.style.top = `${((origFrameViewPort.height - viewPortAfterScaling.height) / 2) + (scaledOffset)}px`;
        referenceFrame.style.top = `${((origFrameViewPort.height - viewPortAfterScaling.height) / 2) + (scaledOffset)}px`;
        frameWrapper.style.top = frame.style.top;
        iframePos.top = ((origFrameViewPort.height - viewPortAfterScaling.height) / 2) + (scaledOffset);
      }

      frameWrapper.style.width = `${viewPortAfterScaling.width}px`;
      frameWrapper.style.height = `${viewPortAfterScaling.height}px`;

      frame.style.transform = `scale(${scale})`;

      frame.style.top = '0px';
      frame.style.left = '0px';

      referenceFrame.style.top = '0px';
      referenceFrame.style.left = '0px';

      this.handleWatermarkPositioning(
        (origFrameViewPort.height - viewPortAfterScaling.height) / 2,
        adjustedVpdH,
        (origFrameViewPort.width - viewPortAfterScaling.width) / 2,
        adjustedVpdW,
        this.props.heightOffset
      );

      this.prepareSendIframeScreenSizeData(scale, iframePos);
      frame.style.background = 'white';

      return;
    }
    frame.style.width = `${origFrameViewPort.width - shadowWidth - heightWidthAdjustment}px`;
    frame.style.height = `${origFrameViewPort.height - shadowHeight - heightWidthAdjustment}px`;
    frame.style.left = '0';
    frame.style.top = '0';

    referenceFrame.style.width = `${origFrameViewPort.width - shadowWidth - heightWidthAdjustment}px`;
    referenceFrame.style.height = `${origFrameViewPort.height - shadowHeight - heightWidthAdjustment}px`;
    referenceFrame.style.left = '0';
    referenceFrame.style.top = '0';

    frameWrapper.style.width = `${origFrameViewPort.width - shadowWidth - heightWidthAdjustment}px`;
    frameWrapper.style.height = `${origFrameViewPort.height - shadowHeight - heightWidthAdjustment}px`;
    frameWrapper.style.left = '0';
    frameWrapper.style.top = `${this.props.heightOffset}px`;
    // eslint-disable-next-line react/no-unused-class-component-methods
    this.scaleFactor = 1;
    frame.style.transform = 'scale(1)';

    this.handleWatermarkPositioning(
      0,
      origFrameViewPort.height,
      0,
      origFrameViewPort.width,
      this.props.heightOffset
    );
    const iframePos: ScreenSizeData['iframePos'] = {
      left: origFrameViewPort.left,
      top: origFrameViewPort.top + this.props.heightOffset,
      height: origFrameViewPort.height,
      width: origFrameViewPort.width,
      heightOffset: this.props.heightOffset,
    };
    this.prepareSendIframeScreenSizeData(1, iframePos);
    frame.style.background = 'white';
  };

  handleImgScreenResponsiveness = (): void => {
    const frame = this.embedFrameRef.current!;
    const origFrameViewPort = frame.parentElement!.getBoundingClientRect();

    const doc = frame.contentDocument!;
    const screenImage = doc.getElementById('img');
    origFrameViewPort.height -= this.props.heightOffset;

    if (screenImage) {
      if (this.props.screen.responsive) {
        screenImage.style.width = 'auto';
        screenImage.style.height = `${origFrameViewPort.height}px`;
      } else {
        screenImage.style.width = '100%';
        screenImage.style.height = 'auto';
      }
    }
  };

  zoomToQuadrant = (quadrant: Quadrant, box: Rect, relayObj: Payload_Navigation): void => {
    const frame = this.embedFrameRef.current;
    const referenceFrame = this.frameOfReferenceElRef.current;
    if (!frame || !referenceFrame) return;
    const referenceFrameScaleValues = getScaleOfElement(referenceFrame);
    const referenceFrameScale = Math.min(referenceFrameScaleValues.scaleX, referenceFrameScaleValues.scaleY);
    const referenceElRect = referenceFrame.getBoundingClientRect();
    frame.style.transition = 'transform 2s cubic-bezier(0.42, 0, 0.01, 0.95)';

    const parentWidth = referenceElRect.width;
    const parentHeight = referenceElRect.height;
    let scaleValue : number | null = null;
    let translatedX: number = 0;
    let translatedY: number = 0;

    switch (quadrant.to) {
      case QuadrantType.TopLeft: {
        translatedX = 0;
        translatedY = 0;
        scaleValue = MAX_ZOOM_SCALE;
        frame.style.transform = `scale(${MAX_ZOOM_SCALE * referenceFrameScale}) translate(0%, 0%)`;
        break;
      }

      case QuadrantType.TopRight: {
        const percentZoom = -(MAX_ZOOM_SCALE - 1) / MAX_ZOOM_SCALE;
        translatedX = percentZoom * (parentWidth) * MAX_ZOOM_SCALE;
        translatedY = 0;
        scaleValue = MAX_ZOOM_SCALE;
        const translateX = percentZoom * 100;
        frame.style.transform = `scale(${MAX_ZOOM_SCALE * referenceFrameScale}) translate(${translateX}% , 0%)`;
        break;
      }

      case QuadrantType.BottomLeft: {
        const percentZoom = -(MAX_ZOOM_SCALE - 1) / MAX_ZOOM_SCALE;
        translatedX = 0;
        translatedY = percentZoom * (parentHeight * MAX_ZOOM_SCALE);
        scaleValue = MAX_ZOOM_SCALE;
        const translateY = (percentZoom) * 100;
        frame.style.transform = `scale(${MAX_ZOOM_SCALE * referenceFrameScale}) translate(0% , ${translateY}%)`;
        break;
      }

      case QuadrantType.BottomRight: {
        const percentZoom = -(MAX_ZOOM_SCALE - 1) / MAX_ZOOM_SCALE;
        translatedX = percentZoom * (parentWidth) * MAX_ZOOM_SCALE;
        translatedY = percentZoom * (parentHeight) * MAX_ZOOM_SCALE;
        scaleValue = MAX_ZOOM_SCALE;
        const translate = (percentZoom) * 100;
        frame.style.transform = `
        scale(${MAX_ZOOM_SCALE * referenceFrameScale}) translate(${translate}% , ${translate}%)
        `;
        break;
      }

      case QuadrantType.Custom: {
        const finalScaleToBeApplied = quadrant.scale * referenceFrameScale;
        scaleValue = quadrant.scale;
        const translateX = `${-quadrant.left}px`;
        const translateY = `${-quadrant.top}px`;

        translatedX = -quadrant.left * finalScaleToBeApplied;
        translatedY = -quadrant.top * finalScaleToBeApplied;

        frame.style.transform = `scale(${finalScaleToBeApplied}) translate(${translateX} , ${translateY})`;
        break;
      }

      default: {
        scaleValue = 1;
        frame.style.transform = `scale(${referenceFrameScale}) translate(0%, 0%)`;
        break;
      }
    }
    const scaledRect = scaleRect(box, scaleValue * referenceFrameScale);

    const boxNewCenterX = (scaledRect.left + translatedX) + scaledRect.width / 2;
    const boxNewCenterY = (scaledRect.top + translatedY) + scaledRect.height / 2;

    // INFO: right now preview component is aware of the el & annotation (bbox is required for quadrant calculation)
    //      that is currently in viewport.
    //
    //      This is a deperture in thought process that we had while building the preview component; We initially
    //      thought preview component would only render the screen and not acknowledge anything else.
    //
    //      In order to support zoom and pan we needed info of annotation box hence, this component now somewhat aware
    //      about the selected element; altought this ops is done via message passing, hence it's not a buring design
    //      change.
    //
    //      We also subscribe to events from annotation module (check receiveMessage method) and change the annotation
    //      box coordinate based on current transformation that is applied (zoom + pan). In future we might need to
    //      review this.
    //
    //      CURRENT EVENTS PASSING:
    //      [annotation] on navigation raise OnNavigation
    //      [preview] subscribe to event perform, zoom pan and raise ANN_ZOOMED with updated coordinate
    //      [player] subscribe to event and pass updated cooridnate to tracker

    window.postMessage({
      type: ANN_ZOOMED,
      centerX: boxNewCenterX,
      centerY: boxNewCenterY,
      ...relayObj
    });
  };

  determineQuadrant = (
    childRect: Rect
  ): Quadrant => {
    const referenceFrame = this.frameOfReferenceElRef.current;
    if (!referenceFrame) {
      return { to: QuadrantType.Reset };
    }

    const referenceFrameRect = referenceFrame.getBoundingClientRect();
    const referenceFrameScales = getScaleOfElement(referenceFrame);
    const dummyScale = Math.min(referenceFrameScales.scaleX, referenceFrameScales.scaleY);
    const parentWidth = referenceFrameRect.width / dummyScale;
    const parentHeight = referenceFrameRect.height / dummyScale;
    const parentCenterX = parentWidth / 2;
    const parentCenterY = parentHeight / 2;

    const spansVertical = childRect.top < parentCenterY && childRect.bottom > parentCenterY;
    const spansHorizontal = childRect.left < parentCenterX && childRect.right > parentCenterX;

    const isTop = childRect.bottom <= parentCenterY;
    const isBottom = childRect.top >= parentCenterY;
    const isLeft = childRect.right <= parentCenterX;
    const isRight = childRect.left >= parentCenterX;

    const quadrants: QuadrantType[] = [];

    if (isTop) {
      if (isLeft) quadrants.push(QuadrantType.TopLeft);
      if (isRight) quadrants.push(QuadrantType.TopRight);
    }
    if (isBottom) {
      if (isLeft) quadrants.push(QuadrantType.BottomLeft);
      if (isRight) quadrants.push(QuadrantType.BottomRight);
    }

    if (spansVertical || spansHorizontal || quadrants.length > 1) {
      const { top, left, scale } = getCustomTopLeftAndScale(parentWidth, parentHeight, childRect);
      return { to: QuadrantType.Custom, top, left, scale };
    }

    if (quadrants[0] === QuadrantType.Custom) {
      return { to: QuadrantType.Reset };
    }
    return { to: quadrants[0] };
  };

  render(): JSX.Element {
    const props = this.props.screenData.isHTML4 ? {} : { srcDoc: IFRAME_DEFAULT_DOC };
    return (
      <>
        <div
          ref={this.frameWrapperRef}
          style={{
            visibility: this.props.hidden ? 'hidden' : 'visible',
            overflow: 'hidden',
            position: 'absolute',
            height: '100%',
            borderWidth: `${Tags.getBorderWidthOfFrame(this.props.heightOffset)}px`,
            borderStyle: 'solid',
            borderColor: 'transparent',
            boxSizing: this.props.isResponsive ? 'content-box' : 'border-box',
            boxShadow: this.state.renderComplete && this.props.showShadowAroundFrame ? PREVIEW_BOX_SHADOW : 'none',
            borderRadius: this.props.showShadowAroundFrame ? '6px' : '0px'
          }}
        >
          <Tags.EmbedFrame
            key={this.props.screen.rid}
          // we added this because some html4 doc would not render properly across different machines
            src={this.props.screenData.isHTML4 ? '/aboutblankhtml4.html' : '/aboutblankhtml5.html'}
            title={this.props.screen.displayName}
            id={ROOT_EMBED_IFRAME_ID}
            className={`fable-iframe-${this.props.screen.id} ${FABLE_IFRAME_GENERIC_CLASSNAME}`}
            style={{
              visibility: this.props.hidden ? 'hidden' : 'visible',
              borderRadius: `${this.props.playMode ? 'none' : '20px'}`,
              background: 'transparent',
              boxShadow: this.props.playMode ? 'none' : 'rgba(67, 71, 85, 0.27) 0px 0px 0.25em, rgba(90, 125, 188, 0.05) 0px 0.25em 1em',
              position: 'absolute',
              transition: 'none',
            }}
            ref={ref => {
              this.embedFrameRef.current = ref;
              if (this.props.innerRefs) {
                this.props.innerRefs.forEach(r => r.current = ref);
              }
            }}
            heightOffset={this.props.heightOffset}
            {...props}
          />

          {/*
          this is a frame of reference div. Since the above iframe will be resized
          based on the zoom and pan, to get the reference of the original sizing, we will use the below
          frame of reference div whenever we will calculate the zoom and pan values
        */}
          <div
            style={{
              visibility: 'hidden',
            }}
            ref={this.frameOfReferenceElRef}
          />
        </div>
        {this.props.showWatermark && <LogoWatermark isHidden={this.props.hidden} watermarkRef={this.watermarkRef} />}
      </>
    );
  }
}
