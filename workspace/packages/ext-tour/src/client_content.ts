import { startTransaction } from "@sentry/browser";
import { init as sentryInit, sentryTxReport } from "@fable/common/dist/sentry";
import { openDb, putDataInDb, DB_NAME, OBJECT_STORE, OBJECT_KEY, OBJECT_KEY_VALUE } from "@fable/common/dist/db-utils";
import { Msg } from "./msg";
import { FrameDataToBeProcessed } from "./types";
import { BATCH_SIZE } from "./utils";
import { version } from "../package.json";

sentryInit("extension", version);

function createDataDiv(id: string, content: string): HTMLDivElement {
  const div = (document.getElementById(id) || document.createElement("div")) as HTMLDivElement;
  div.setAttribute("id", id);
  div.textContent = content;
  div.style.display = "none";
  return div;
}
function createTotalScreensCountDiv(count: number) {
  return createDataDiv("total-screen-count", String(count));
}

function createOrUpdateNumberOfScreensReceivedCountDiv(count: number) {
  return createDataDiv("number-of-screens-received-count", String(count));
}

function createOrUpdateRedirectReadyDiv(shouldRedirect: number) {
  return createDataDiv("redirect-ready", String(shouldRedirect));
}

export interface DBData {
  id: string;
  screensData: string;
  cookies: string;
  screenStyleData: string;
  version: string;
}

function init() {
  let numberOfScreensReceived: number = 0;
  let totalScreenCount: number = 0;
  const screensData: FrameDataToBeProcessed[][] = [];
  let cookiesData: any;
  let cookiesDataReceived = false;
  let styleData: any;
  let styleDataReceived = false;
  let commitReceived = false;
  let dataVersion: string;
  let versionReceived = false;

  chrome.runtime.sendMessage({ type: Msg.CLIENT_CONTENT_INIT });

  chrome.runtime.onMessage.addListener(async (message) => {
    switch (message.type) {
      case Msg.SAVE_TOTAL_SCREEN_COUNT_IN_EXCHANGE_DIV: {
        totalScreenCount = message.data.totalScreenCount;
        console.log("[totalCount]", totalScreenCount);
        const totalScreenCountDiv = createTotalScreensCountDiv(message.data.totalScreenCount);
        document.body.appendChild(totalScreenCountDiv);
        break;
      }

      case Msg.SAVE_TOUR_DATA: {
        console.log("[commit]", 1);
        commitReceived = true;
        break;
      }

      case Msg.SAVE_SCREENS_DATA_IN_EXCHANGE_DIV: {
        numberOfScreensReceived += BATCH_SIZE;
        const numberOfScreensReceivedCountDiv = createOrUpdateNumberOfScreensReceivedCountDiv(
          Math.min(numberOfScreensReceived, totalScreenCount)
        );
        document.body.appendChild(numberOfScreensReceivedCountDiv);
        screensData.push(...message.data.screensData);
        break;
      }

      case Msg.SAVE_COOKIES_DATA_IN_EXCHANGE_DIV: {
        console.log("[ck_rec]", 1);
        cookiesData = message.data.cookiesData;
        cookiesDataReceived = true;
        break;
      }

      case Msg.SAVE_STYLE_DATA: {
        console.log("[sd_rec]", 1);
        styleData = message.data.screenStyleData;
        styleDataReceived = true;
        break;
      }

      case Msg.SAVE_VERSION_DATA: {
        dataVersion = message.data.version;
        versionReceived = true;
        console.log("[v]", dataVersion);
        // Version will alaways be written in main dom as the existing handshake code in prep-tour works on
        // version being available on dom
        const versionDiv = createDataDiv("version-data", dataVersion);
        document.body.appendChild(versionDiv);
        break;
      }

      default: {
        break;
      }
    }

    if (styleDataReceived && cookiesDataReceived && commitReceived && versionReceived) {
      setTimeout(async () => {
        const transaction = startTransaction({ name: "dataTransferToClientContent" });
        const db = await openDb(DB_NAME, OBJECT_STORE, 1, OBJECT_KEY);
        const dbData: DBData = {
          id: OBJECT_KEY_VALUE,
          screensData: JSON.stringify(screensData),
          cookies: JSON.stringify(cookiesData),
          screenStyleData: JSON.stringify(styleData),
          version: dataVersion
        };
        sentryTxReport(transaction, "screenscount", screensData.length, "byte");
        if (screensData.length) {
          await putDataInDb(db, "screensDataStore", dbData);
        }
        db.close();
        const versionDiv = createOrUpdateRedirectReadyDiv(1);
        document.body.appendChild(versionDiv);
      }, 500);
    }
  });
}

init();

