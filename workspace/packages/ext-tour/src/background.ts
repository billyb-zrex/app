import { sentryCaptureException, init as sentryInit } from "@fable/common/dist/sentry";
import { sleep, snowflake } from "@fable/common/dist/utils";
import {
  SerDoc,
  NODE_NAME,
  ThemeStats,
  ThemeBorderRadiusCandidatePerNode,
  ThemeColorCandidatPerNode
} from "@fable/common/dist/types";
import { AGGRESSIVE_BUFFER_PRESERVATION, getActiveTab, PURIFY_DOM_SERIALIZATION, SettingState } from "./common";
import { Msg, MsgPayload } from "./msg";
import {
  IExtStoredState,
  IUser,
  RecordingStatus,
  ReqScreenResize,
  ReqScreenshotData,
  ScreenSerDataFromCS,
  ScreenSerStartData,
  ScriptInitReportedData,
  ScriptInitRequiredData,
  SerializeFrameData,
  StopRecordingData,
} from "./types";
import { BATCH_SIZE, isCrossOrigin } from "./utils";
import { version } from "../package.json";

sentryInit("background", version);

const APP_CLIENT_ENDPOINT = process.env.REACT_APP_CLIENT_ENDPOINT as string;

const APP_STATE_IDENTITY = "app_state_identity";
const APP_RECORDING_STATE = "app_state_recording";
const FRAMES_TO_PROCESS = "frames_to_process";
const FRAMES_TO_PROCESS_ORDER = "order_of_frames_to_process";
const TABS_TO_TRACK = "app_update_listnr_for_tab_ids";
const FRAMES_IN_TAB = "frames_in_tab";
const SCREEN_DATA_FINISHED = "screen_data_finished";
const SCREEN_STYLE_DATA = "screen_style_data";

interface FrameDataToBeProcessed {
  oid: number;
  frameId: number;
  tabId: number;
  type: "serdom" | "thumbnail" | "sigstop" | "sigskip";
  data: SerDoc | string;
  interactionCtx: ScreenSerDataFromCS["interactionCtx"] | null;
}

chrome.runtime.onInstalled.addListener(async () => {
  const isOnboardingFlowAlreadyTriggered = (await chrome.storage.local.get("ONBOARDING_STATE")).ONBOARDING_STATE || 0;
  if (!isOnboardingFlowAlreadyTriggered) {
    chrome.tabs.query({ url: `${APP_CLIENT_ENDPOINT}/welcome*` }, (tabs) => {
      let openTab: chrome.tabs.Tab | null = null;

      for (const tab of tabs) {
        if (tab.url?.includes("#install-extension")) {
          openTab = tab;
          break;
        }
      }
      if (openTab && openTab.id) {
        chrome.tabs.update(openTab.id, { url: `${APP_CLIENT_ENDPOINT}/onboarding`, active: true });
      } else {
        chrome.tabs.create({ url: `${APP_CLIENT_ENDPOINT}/onboarding` });
      }
    });
    await chrome.storage.local.set({ ONBOARDING_STATE: 1 });
  }
});

chrome.runtime.onMessageExternal.addListener(
  (data, sender, sendResponse) => {
    if (data && data.message && data.message === "version") {
      sendResponse({ version });
    }
    // used for capture screen editor screenshot. commented as not required for AI v1
    // if (data && data.sender && data.sender === "fable") {
    //   const lastTabCaptureImageData = await chrome.tabs.captureVisibleTab({ format: "png" });
    //   sendResponse({ data: lastTabCaptureImageData });
    // }
    return true;
  }
);

const LOCKS: Record<string, number> = {};
async function acquireLock(key: string) {
  return new Promise(resolve => {
    const timer = setInterval(async () => {
      const isLockAlreadyAcquired = LOCKS[key];
      if (isLockAlreadyAcquired) {
        // wait, until the lock is released
      } else {
        LOCKS[key] = 1;
        clearTimeout(timer);
        resolve(1);
      }
    }, 5);
  });
}

async function releaseLock(key: string) {
  delete LOCKS[key];
}

async function addFrameDataToProcessList(id: number, frameDataToProcess: FrameDataToBeProcessed): Promise<void> {
  const key = `${FRAMES_TO_PROCESS}/${id}`;
  await acquireLock(key);
  const allFramesToProcess = (await chrome.storage.local.get(key))[key] || [];
  allFramesToProcess.push(frameDataToProcess);
  await chrome.storage.local.set({
    [key]: allFramesToProcess,
  });
  await releaseLock(key);

  await acquireLock(FRAMES_TO_PROCESS_ORDER);
  const framesToProcessOrder: string[] = (await chrome.storage.local.get(FRAMES_TO_PROCESS_ORDER))[FRAMES_TO_PROCESS_ORDER] || [];
  if (framesToProcessOrder.indexOf(key) === -1) { framesToProcessOrder.push(key); }
  await chrome.storage.local.set({
    [FRAMES_TO_PROCESS_ORDER]: framesToProcessOrder
  });
  await releaseLock(FRAMES_TO_PROCESS_ORDER);
}

type TSessionFinish = "na" | "submit" | "skip";
let timer: number = 0;
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") return;
  for (const [storageKey, { newValue: val }] of Object.entries(changes)) {
    if (storageKey.startsWith(FRAMES_TO_PROCESS) && val) {
      const framesInTab = (await chrome.storage.local.get(FRAMES_IN_TAB))[FRAMES_IN_TAB] || {};
      const tVal = val as FrameDataToBeProcessed[];
      let allFramesRecorded = false;
      let isThumbnailCaptured = false;
      let sessionFinishedType : TSessionFinish = "na";
      const tabId = tVal[0].tabId;
      const frames = ((framesInTab[tabId] || []) as number[]).reduce((s, n) => {
        s[n] = 1;
        return s;
      }, {} as Record<number, number>);
      for (const item of tVal) {
        if (item.type === "thumbnail") {
          isThumbnailCaptured = true;
        } else if (item.type === "sigstop" || item.type === "sigskip") {
          sessionFinishedType = item.type === "sigstop" ? "submit" : "skip";
        } else {
          delete frames[item.frameId];
        }
      }

      if (sessionFinishedType === "na") {
        return;
      }

      // This is a failsafe mechanism to end the recording once the sigstop signal is received and the system waits for
      // 5 seconds from the last msg received but message from some frames are not yet received (apparently)
      // This might happen if a frame gets deleted without reloading the page, hence FRAMES_IN_TAB never gets to know
      // that a frame gets deleted from body. This is observed in ga sometimes
      clearFinishTimer();
      timer = setTimeout(finishAppRecording(storageKey, tVal, sessionFinishedType), 5000) as unknown as number;

      allFramesRecorded = Object.keys(frames).length === 0;
      if (!allFramesRecorded || !isThumbnailCaptured) {
        return;
      }

      clearFinishTimer();
      // TODO this timeout was added for the case where the last  screen (with sigstop) got
      // finished before all the other screens. We wait for a while to get all the other data
      // that are still getting populated. The proper way to fix this wold be to wait for all the
      // frames data to be gathered.
      await sleep(750);
      finishAppRecording(storageKey, tVal, sessionFinishedType)();
    }
  }
});

function clearFinishTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
}

function finishAppRecording(
  storageKey: string,
  tVal: Object,
  sessionFinishedType: TSessionFinish
): () => Promise<void> {
  return async (): Promise<void> => {
    const finishedScreens = (await chrome.storage.local.get(SCREEN_DATA_FINISHED))[SCREEN_DATA_FINISHED] || [];
    const allRecordedScreenKeys: string[] = (await chrome.storage.local.get(FRAMES_TO_PROCESS_ORDER))[FRAMES_TO_PROCESS_ORDER] || [];
    for (const key of allRecordedScreenKeys) {
      if (key === storageKey) {
        continue;
      }
      const screen = (await chrome.storage.local.get(key))[key];
      if (!screen) {
        continue;
      }
      finishedScreens.push(screen);
    }
    finishedScreens.push(tVal);
    await Promise.all([
      chrome.storage.local.remove(allRecordedScreenKeys.concat(storageKey)),
      chrome.storage.local.set({
        [FRAMES_TO_PROCESS_ORDER]: []
      })
    ]);

    await chrome.storage.local.set({
      [SCREEN_DATA_FINISHED]: finishedScreens,
    });
    await chrome.storage.local.set({
      [FRAMES_IN_TAB]: {},
    });

    try {
      if (sessionFinishedType === "submit") {
        const newTab = await chrome.tabs.create({
          url: `${APP_CLIENT_ENDPOINT}/preptour`
        });

        await chrome.scripting.executeScript({
          target: { tabId: newTab.id! },
          files: ["client_content.js"],
        });
      } else {
        await chrome.storage.local.remove(SCREEN_DATA_FINISHED);
        await chrome.storage.local.remove(SCREEN_STYLE_DATA);
      }
    } catch (e) {
      const debugData = await chrome.storage.local.get(null);
      console.warn(">>> DEBUG DATA <<<", debugData);
      throw e;
    } finally {
      await resetAppState();
      await chrome.runtime.sendMessage({
        type: Msg.RECORDING_CREATE_OR_DELETE_COMPLETED,
      });
    }
  };
}

async function resetAppState(): Promise<void> {
  const tabsThatWasBeingTracked = (await chrome.storage.local.get(TABS_TO_TRACK))[TABS_TO_TRACK] || {};
  await Promise.all([
    ...Object.keys(tabsThatWasBeingTracked).map(tabId => chrome.tabs.reload(+tabId)),
    chrome.storage.local.set({
      [APP_RECORDING_STATE]: RecordingStatus.Idle,
      [TABS_TO_TRACK]: {},
    }),
  ]);
}

async function getPersistentExtState(): Promise<IExtStoredState> {
  const identity = (await chrome.storage.local.get(APP_STATE_IDENTITY))[APP_STATE_IDENTITY] as IUser | undefined;
  const recordingStatus = (await chrome.storage.local.get(APP_RECORDING_STATE))[APP_RECORDING_STATE]
    || RecordingStatus.Idle;

  return {
    identity: identity || null,
    recordingStatus,
  };
}

async function processStyleInfo(newScreenStyle: ThemeStats) {
  const storedScreenStyleData: ThemeStats = (await chrome.storage.local.get(SCREEN_STYLE_DATA))[SCREEN_STYLE_DATA]
      || {};
  const storedNodeColors: ThemeColorCandidatPerNode = storedScreenStyleData.nodeColor || {
    [NODE_NAME.a]: {},
    [NODE_NAME.button]: {},
    [NODE_NAME.div]: {},
  } as ThemeColorCandidatPerNode;

  const newNodeColor: ThemeColorCandidatPerNode = newScreenStyle.nodeColor;
  for (const [tag, colorMap] of Object.entries(newNodeColor)) {
    let storedColorMap: Record<string, number>;

    if (tag in storedNodeColors) storedColorMap = (storedNodeColors as any)[tag];
    else storedColorMap = (storedNodeColors as any)[tag] = {};

    for (const [color, occurrence] of Object.entries(colorMap)) {
      if (color in storedColorMap) storedColorMap[color] += occurrence;
      else storedColorMap[color] = occurrence;
    }
  }
  storedScreenStyleData.nodeColor = storedNodeColors;

  const storedNodeBorderRadius: ThemeBorderRadiusCandidatePerNode = storedScreenStyleData.nodeBorderRadius || {
    [NODE_NAME.a]: {},
    [NODE_NAME.button]: {},
    [NODE_NAME.div]: {},
  } as ThemeBorderRadiusCandidatePerNode;

  const newNodeBorderRadius = newScreenStyle.nodeBorderRadius;
  for (const [tag, borderRadiusMap] of Object.entries(newNodeBorderRadius)) {
    let storedBrMap: Record<string, number>;

    if (tag in storedNodeBorderRadius) storedBrMap = (storedNodeBorderRadius as any)[tag];
    else storedBrMap = (storedNodeBorderRadius as any)[tag] = {};

    for (const [br, occurrence] of Object.entries(borderRadiusMap)) {
      if (br in storedBrMap) storedBrMap[br] += occurrence;
      else storedBrMap[br] = occurrence;
    }
  }
  storedScreenStyleData.nodeBorderRadius = storedNodeBorderRadius;

  chrome.storage.local.set(
    {
      [SCREEN_STYLE_DATA]: storedScreenStyleData,
    }
  );
}

async function getDeviceAndTabDim() {
  const dim = {
    // dimension of document window (tab)
    tabWidth: -1,
    tabHeight: -1,
    // dimension of browser. window size + browser's ui elements
    browserWidth: -1,
    browserHeight: -1,
    // dimension of device screen
    screenWidth: -1,
    screenHeight: -1,
    // dimension of jsut the browser's ui elements
    browserUiElsOffsetWidth: -1,
    browserUiElsOffsetHeight: -1,
    fallbackTabWidth: 1200,
    fallbackTabHeight: 800,
    ar: 1.5,
    suggestResize: false,
    winId: -1,
    inited: false
  };

  const activeTab = await chrome.tabs.query({ currentWindow: true, active: true });
  if (activeTab[0] && activeTab[0].id && activeTab[0].width && activeTab[0].height) {
    dim.tabWidth = activeTab[0].width;
    dim.tabHeight = activeTab[0].height;

    const screenDim = await getFavourableScreenDimension(activeTab[0]);
    dim.screenWidth = screenDim.screenWidth || -1;
    dim.screenHeight = screenDim.screenHeight || -1;

    const browser = await chrome.windows.get(activeTab[0].windowId);
    dim.browserWidth = browser.width || -1;
    dim.browserHeight = browser.height || -1;

    if (dim.screenWidth > 0 && dim.screenHeight > 0 && dim.browserWidth > 0 && dim.browserHeight > 0) {
      dim.browserUiElsOffsetWidth = Math.max(0, dim.browserWidth - dim.tabWidth);
      dim.browserUiElsOffsetHeight = Math.max(0, dim.browserHeight - dim.tabHeight);
      dim.inited = true;

      // If the current aspect ratio is almost reaching target aspect ratio then we don't show option to resize
      const currentAr = (dim.tabWidth / dim.tabHeight) * 10;
      dim.suggestResize = Math.round(currentAr) !== (dim.ar * 10);
      dim.winId = activeTab[0].windowId;
    }
  }
  return dim;
}

function getScreenDim() {
  return {
    screenWidth: window.screen.availWidth,
    screenHeight: window.screen.availHeight
  };
}

function getFavourableScreenDimension(tab: chrome.tabs.Tab) {
  return chrome.scripting.executeScript({
    target: {
      tabId: tab.id!,
    },
    func: getScreenDim
  }).then(results => {
    const result = results.filter(r => r.frameId === 0).map(r => r.result);
    return (result[0] && result[0].screenWidth && result[0].screenHeight) ? result[0] : {
      screenWidth: -1,
      screenHeight: -1
    };
  });
}

async function getAllCookies(): Promise<chrome.cookies.Cookie[]> {
  let cookies: chrome.cookies.Cookie[] = [];
  let hasErr = false;
  try {
    // Support for Cookies Having Independent Partitioned State
    // https://developers.google.com/privacy-sandbox/cookies/chips
    cookies = (await (chrome.cookies.getAll as any)({ partitionKey: {} })) as chrome.cookies.Cookie[];
  } catch (err) {
    hasErr = true;
    sentryCaptureException(err as Error);
  }

  if (hasErr || cookies.length === 0) {
    cookies = await chrome.cookies.getAll({});
  }

  return cookies;
}

/**
 * This is how auto stitching of screens works based on user interaction
 *
 * A tab can have multiple frames (iframes). Each frame works as a separate browsing context. The content script is
 * injected to the top frame (frameId == 0) and all the cross-origin frames.
 *
 * Once the content script is injected, it registers listeners to be able to connect to the background page via
 * messaging, and it installs onclick listener on body during the capture phase of the event. Note, for the same
 * origin frame within a frame where the content script is injected, further onclick listeners are added. We don't
 * inject content script to same-origin frames.
 *
 * Every time user clicks on an element of a frame we serialize the whole frame by hooking on to the capture event
 * as mentioned above. The source frame where the interaction has happened, then sends a message to background page with
 * serialized json (for that frame) with `{ eventType: 'source' }`. This is to identify the originating frame where
 * the event has occurred. At this point we have a partial view of the tab, where serialization happened only for one
 * frame (out of many other frames) in the tab.
 *
 * Once the source event has reached to background page, background page asks all the other frames on the same tab to
 * pass their respective serialized json. We call this event { eventType: 'cascade' }. This time all the frame but the
 * originating frame passes their respective serialized json.
 *
 * Once we receive all the serialized json from the frames, we conclude that serialization of the whole tab is
 * completed.
 *
 * We need to uniquely identify the serialized json across multiple interaction, for that an id is generated that is
 * of kind [snowflake](https://blog.twitter.com/engineering/en_us/a/2010/announcing-snowflake). These are loosely
 * monotonically increasing ids that can be out of order if they were generated inside 1ms. This id is passed back
 * and forth via messaging.
 */
let lastTabCaptureImageData = "";
chrome.runtime.onMessage.addListener(async (msg: MsgPayload<any>, sender) => {
  let endMsg : "sigstop" | "sigskip" = "sigstop";
  switch (msg.type) {
    case Msg.INIT: {
      const state = await getPersistentExtState();
      const dims = await getDeviceAndTabDim();

      // First try to take the full height, then width = height * 1.5 (aspect ratio)
      // if width > available screenWidth then take full width, calculate height = width / 1.5
      const ar = 1.5; // aspect ratio
      // Getting appropriate height for the borwser window (displayheight - browser ui element) is what the
      // document can accept
      let suggestedHeight = dims.screenHeight - dims.browserUiElsOffsetHeight;
      let suggestedWidth = suggestedHeight * ar;
      // If browser is wider than the screen. Browser width is page width + browser's ui
      if ((suggestedWidth + dims.browserUiElsOffsetWidth) > dims.screenWidth) {
        suggestedWidth = dims.screenWidth - dims.browserUiElsOffsetWidth;
        suggestedHeight = suggestedWidth / ar;

        if (suggestedHeight + dims.browserUiElsOffsetHeight > dims.screenHeight) {
          suggestedHeight = dims.fallbackTabHeight;
          suggestedWidth = dims.fallbackTabWidth;
        }
      }
      await chrome.runtime.sendMessage({
        type: Msg.INITED,
        data: {
          state,
          dim: {
            suggestResize: dims.suggestResize,
            suggestedHeight,
            suggestedWidth
          }
        }
      });
      break;
    }

    case Msg.WIN_RESIZE: {
      const tMsg = msg as MsgPayload<ReqScreenResize>;
      const w = tMsg.data.w;
      const h = tMsg.data.h;

      const dims = await getDeviceAndTabDim();
      if (!dims.inited) return;

      await chrome.windows.update(dims.winId, {
        width: (w + dims.browserUiElsOffsetWidth),
        height: h + dims.browserUiElsOffsetHeight
      });

      await chrome.runtime.sendMessage({
        type: Msg.WIN_ON_RESIZE,
        data: {
          dim: { w, h, suggestResize: false }
        }
      });
      break;
    }

    case Msg.TAKE_SCREENSHOT: {
      const tMsg = msg as MsgPayload<ReqScreenshotData>;
      // Only take screenshot of the tab once
      if (sender.frameId === 0) {
        try {
          // Sometime when the user is clicking on the page rapidly captureVisibleTab throws an error saying
          // the quota is exceeded. In this case we pickup images from last capture. This image is stored in
          // a local variable because the service worker won't get killed at that time
          lastTabCaptureImageData = await chrome.tabs.captureVisibleTab();
        } catch (e) {
          console.warn("Error while capturing tab. Error", (e as Error).message);
        } finally {
          await addFrameDataToProcessList(tMsg.data.id, {
            oid: tMsg.data.id,
            frameId: 0,
            tabId: sender.tab!.id!,
            type: "thumbnail",
            data: lastTabCaptureImageData,
            interactionCtx: null,
          });
        }
      }
      break;
    }

    case Msg.SCRIPT_INIT: {
      // Exchanges data that are not accessible in content script by default, and needed to be passed from background
      // script like frameId
      const tMsg = msg as MsgPayload<ScriptInitRequiredData>;
      if (sender.tab && sender.tab.id) {
        await chrome.tabs.sendMessage<MsgPayload<ScriptInitReportedData>>(
          sender.tab.id!,
          { type: Msg.SCRIPT_INIT_DATA, data: { frameId: sender.frameId || 0, scriptId: tMsg.data.scriptId } }
        );
      }
      break;
    }

    case Msg.FRAME_SERIALIZATION_START: {
      const tMsg = msg as MsgPayload<ScreenSerStartData>;
      const frameId = sender.frameId === undefined ? -1 : sender.frameId;
      if (tMsg.data.eventType === "source") {
        chrome.tabs.sendMessage<MsgPayload<SerializeFrameData>>(
          sender.tab!.id!,
          { type: Msg.SERIALIZE_FRAME, data: { srcFrameId: frameId, id: tMsg.data.id } }
        );
      }
      break;
    }

    case Msg.FRAME_SERIALIZED: {
      const tMsg = msg as MsgPayload<ScreenSerDataFromCS>;
      const frameId = sender.frameId === undefined ? -1 : sender.frameId;
      await addFrameDataToProcessList(tMsg.data.id, {
        frameId,
        oid: tMsg.data.id,
        tabId: sender.tab!.id!,
        type: "serdom",
        data: tMsg.data.serDoc,
        interactionCtx: tMsg.data.interactionCtx,
      });
      // INFO This iterates some html elements to figure out what are the dominant color etc
      //      It's made part of this message, that could lead to slowness of the page. As serialization and
      //      style stats calculation are synchronous ops. If there is delay in page oeprations, we can completely
      //      detached this calculation from frame serialization
      await processStyleInfo(tMsg.data.screenStyle);
      break;
    }

    case Msg.RESET_STATE: {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ ONBOARDING_STATE: 1 });
      break;
    }

    case Msg.START_RECORDING: {
      await resetAppState();
      await chrome.storage.local.set({
        [APP_RECORDING_STATE]: RecordingStatus.Recording,
      });
      await startRecording();
      break;
    }

    case Msg.REINJECT_CONTENT_SCRIPT: {
      const tab = await getActiveTab();
      if (!(tab && tab.id)) {
        throw new Error("Active tab not found. Are you focused on the browser?");
      }
      await injectContentScriptInCrossOriginFrames({ id: tab.id!, url: tab.url! });
      break;
    }

    case Msg.DELETE_RECORDING: {
      await chrome.storage.local.set({
        [APP_RECORDING_STATE]: RecordingStatus.Deleting,
      });
      endMsg = "sigskip";
    }

    // eslint-disable-next-line no-fallthrough
    case Msg.STOP_RECORDING: {
      await chrome.storage.local.set({
        [APP_RECORDING_STATE]: RecordingStatus.Stopping,
      });
      await stopRecording();
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const id = snowflake();
      // this has to be the first message for us to know that messagw with the following id gonna be the last
      // interaction
      await addFrameDataToProcessList(id, {
        frameId: 0,
        oid: id,
        tabId: tab.id!,
        type: endMsg,
        data: "",
        interactionCtx: null,
      });
      await chrome.tabs.sendMessage<MsgPayload<StopRecordingData>>(tab.id!, {
        type: Msg.STOP_RECORDING,
        data: { id }
      });
      clearLoadingIcon(tab.id!);
      break;
    }

    case Msg.CLIENT_CONTENT_INIT: {
      if (!sender.tab) {
        break;
      }
      const data = await chrome.storage.local.get(SCREEN_DATA_FINISHED);
      const cookies = process.env.REACT_APP_CAPTURE_COOKIES === "false" ? [] : await getAllCookies();
      const screenStyleData: ThemeStats = (await chrome.storage.local.get(SCREEN_STYLE_DATA))[SCREEN_STYLE_DATA] || {};

      await chrome.tabs.sendMessage(sender.tab.id!, {
        type: Msg.SAVE_TOTAL_SCREEN_COUNT_IN_EXCHANGE_DIV,
        data: { totalScreenCount: data[SCREEN_DATA_FINISHED].length ?? 0 }
      });

      for (let i = 0; i < data[SCREEN_DATA_FINISHED].length; i += BATCH_SIZE) {
        await chrome.tabs.sendMessage(sender.tab.id!, {
          type: Msg.SAVE_SCREENS_DATA_IN_EXCHANGE_DIV,
          data: { screensData: data[SCREEN_DATA_FINISHED].slice(i, i + BATCH_SIZE) || [] }
        });
      }

      await chrome.tabs.sendMessage(sender.tab.id!, {
        type: Msg.SAVE_COOKIES_DATA_IN_EXCHANGE_DIV,
        data: { cookiesData: cookies }
      });

      await chrome.tabs.sendMessage(sender.tab.id!, {
        type: Msg.SAVE_STYLE_DATA,
        data: { screenStyleData }
      });

      await chrome.tabs.sendMessage(sender.tab.id!, {
        type: Msg.SAVE_VERSION_DATA,
        data: { version: "3" }
      });

      await chrome.tabs.sendMessage(sender.tab.id!, { type: Msg.SAVE_TOUR_DATA });

      await chrome.storage.local.remove(SCREEN_DATA_FINISHED);
      await chrome.storage.local.remove(SCREEN_STYLE_DATA);
      break;
    }

    case Msg.INIT_REGISTERED_CONTENT_SCRIPTS: {
      await chrome.scripting.unregisterContentScripts();
      initRegisteredContentScripts();
      break;
    }

    case Msg.__TEST__: {
      // WARN for testing
      // const store = await chrome.cookies.getAllCookieStores();
      // const cookies = await chrome.cookies.getAll({});
      // const pcookies = await (chrome.cookies.getAll as any)({ partitionKey: {} });
      // const tab = await getActiveTab();
      // const framesInPage = (await chrome.webNavigation.getAllFrames({
      //   tabId: tab!.id as number,
      // })) || [];

      // console.log(">>> [ frames ]", framesInPage);
      // console.log(">> [store]", store);
      // console.log(">> [cookies]", cookies);
      // console.log(">> [partitioned cookies]", pcookies);
      // console.log(">> [filtered]", cookies.filter(_ => _.name === "vscode-secret-key-path" || _.name === "vscode-cli-secret-half" || _.name === "WorkstationJwtPartitioned"));
      // console.log(">> [filtered]", (pcookies as chrome.cookies.Cookie[]).filter(_ => _.name === "vscode-secret-key-path" || _.name === "vscode-cli-secret-half" || _.name === "WorkstationJwtPartitioned"));
      break;
    }

    default:
      break;
  }
});

function showLoadingIcon(tabId: number) {
  return Promise.all([
    chrome.action.setBadgeText({
      tabId,
      text: "🔘",
    }),
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: "#FEDF64"
    })
  ]);
}

function clearLoadingIcon(tabId: number) {
  chrome.action.setBadgeText({
    tabId,
    text: "",
  });
}

async function injectContentScriptInCrossOriginFrames(tab: { id: number, url: string }) {
  // Cross-origin frames document are not accessible because of CORS hence we inject separate scripts to all
  // cross-origin frames. The same origin frames are read from inside the parent frame itself
  const framesInPage = (await chrome.webNavigation.getAllFrames({
    tabId: tab.id,
  })) || [];
  const crossOriginFrameIds: Array<number> = [];
  for (const frame of framesInPage) {
    const crossOrigin = isCrossOrigin(tab.url || "", frame.url);
    if (frame.frameId === 0 || crossOrigin) {
      // Will inject content script to main frame (frameId==0) as well as all cross-origin frames
      crossOriginFrameIds.push(frame.frameId);
    }
  }

  const framesInTab = (await chrome.storage.local.get(FRAMES_IN_TAB))[FRAMES_IN_TAB] || {};
  framesInTab[`${tab.id}`] = crossOriginFrameIds;
  await chrome.storage.local.set({ [FRAMES_IN_TAB]: framesInTab });
  if (crossOriginFrameIds.length) {
    await chrome.scripting.executeScript<Array<any>, SerDoc>({
      target: { tabId: tab.id, frameIds: crossOriginFrameIds },
      files: ["content.js"],
    });
  }
}

function registerContentScriptWithId(id: string, script: string): void {
  chrome.scripting
    .registerContentScripts([{
      id,
      js: [script],
      persistAcrossSessions: false,
      matches: ["https://*/*"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
    }])
    .then(() => {
    })
    .catch((err) => sentryCaptureException(err));
}

function initRegisteredContentScripts() {
  const drawingBufferScriptId = "fable/preservedrawingbuffer";
  const purifyDomScriptId = "fable/purifydom";

  chrome.scripting.getRegisteredContentScripts()
    .then((scripts) => {
      const scriptExists = scripts.find(script => script.id === drawingBufferScriptId);
      const purifyDomScriptExists = scripts.find(script => script.id === purifyDomScriptId);

      chrome.storage.local.get([PURIFY_DOM_SERIALIZATION, AGGRESSIVE_BUFFER_PRESERVATION], (result) => {
        const purifyDom = result[PURIFY_DOM_SERIALIZATION] || SettingState.OFF;
        const aggressiveBuffer = result[AGGRESSIVE_BUFFER_PRESERVATION] || SettingState.ON;

        if (aggressiveBuffer === SettingState.ON && !scriptExists) {
          registerContentScriptWithId(drawingBufferScriptId, "preserve_drawing_buffer.js");
        }

        if (purifyDom === SettingState.ON && !purifyDomScriptExists) {
          registerContentScriptWithId(purifyDomScriptId, "purify_dom_serialization.js");
        }
      });
    }).catch(err => sentryCaptureException(err));
}

initRegisteredContentScripts();

async function onTabStateUpdate(tabId: number, info: chrome.tabs.TabChangeInfo) {
  const tabsToLookFor = (await chrome.storage.local.get(TABS_TO_TRACK))[TABS_TO_TRACK] || {};
  if (info.status === "complete" && tabId in tabsToLookFor) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;
    tabsToLookFor[tabId] = tab.url;
    await chrome.storage.local.set({
      [TABS_TO_TRACK]: tabsToLookFor
    });
    await injectContentScriptInCrossOriginFrames({ id: tabId, url: tab.url || "" });
    await showLoadingIcon(tabId);
  }
}

async function onTabActive(activeInfo: chrome.tabs.TabActiveInfo) {
  const tabsToLookFor = (await chrome.storage.local.get(TABS_TO_TRACK))[TABS_TO_TRACK] || {};
  if (activeInfo.tabId in tabsToLookFor) return;

  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!tab) return;

  tabsToLookFor[activeInfo.tabId] = tab.url;
  await chrome.storage.local.set({
    [TABS_TO_TRACK]: tabsToLookFor
  });
  await injectContentScriptInCrossOriginFrames({ id: activeInfo.tabId, url: tab.url || "" });
  await showLoadingIcon(activeInfo.tabId);
}

async function startRecording(): Promise<void> {
  const tab = await getActiveTab();
  if (!(tab && tab.id)) {
    throw new Error("Active tab not found. Are you focused on the browser?");
  }

  chrome.tabs.onUpdated.addListener(onTabStateUpdate);
  chrome.tabs.onActivated.addListener(onTabActive);
  await Promise.all([
    await chrome.storage.local.set({
      [TABS_TO_TRACK]: { [tab.id]: tab.url }
    }),
    await showLoadingIcon(tab.id),
    await injectContentScriptInCrossOriginFrames({ id: tab.id!, url: tab.url! }),
    await chrome.tabs.sendMessage(tab.id!, { type: Msg.SHOW_COUNTDOWN_MODAL }),
  ]);
}

async function stopRecording() {
  chrome.tabs.onUpdated.removeListener(onTabStateUpdate);
  chrome.tabs.onActivated.removeListener(onTabActive);
}

