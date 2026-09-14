import {
  init as sentryInit,
  BrowserTracing,
  Replay, Transaction,
  BrowserOptions,
  withScope,
  captureMessage,
  captureException,
} from '@sentry/react';
import { isProdEnv } from './utils';

type Target = 'client' | 'extension' | 'background' | 'client-preview';

const DSN_KEY_CLIENT = 'https://fb9d18e316c749079ad14a6d6fa70f7b@o4505113177620480.ingest.sentry.io/4505114454917120';
const DSN_KEY_EXT = 'https://62b1df8a61314adfbf35374d53498a43@o4505113177620480.ingest.sentry.io/4505114458062848';

export const init = (target: Target, version: string) => {
  if (!isProdEnv() || process.env.REACT_APP_DISABLE_TELEMETRY === 'true') {
    return;
  }

  let initOptions: BrowserOptions = {};

  const environment = process.env.REACT_APP_ENVIRONMENT;

  switch (target) {
    case 'client-preview':
      initOptions = {
        dsn: DSN_KEY_CLIENT,
        integrations: [new BrowserTracing()],
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        environment,
        release: `client@${version}`,
      };
      break;
    case 'client':
      initOptions = {
        dsn: DSN_KEY_CLIENT,
        integrations: [new BrowserTracing(), new Replay()],
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        environment,
        release: `client@${version}`,
      };
      break;
    case 'extension':
      initOptions = {
        dsn: DSN_KEY_EXT,
        integrations: [new BrowserTracing()],
        tracesSampleRate: 1.0,
        environment,
        release: `extension@${version}`
      };
      break;
    case 'background':
      initOptions = {
        dsn: DSN_KEY_EXT,
        tracesSampleRate: 1.0,
        environment,
        release: `extension@${version}`
      };
      break;
    default:
      initOptions = {};
      break;
  }

  sentryInit(initOptions);
};

export const sentryTxReport = (
  transaction: Transaction | undefined,
  measureName: string,
  measureValue: number,
  measureUnit: string,
  shouldFinish = true
) => {
  if (!isProdEnv() || process.env.REACT_APP_DISABLE_TELEMETRY === 'true' || !transaction) {
    return;
  }

  transaction.setMeasurement(measureName, measureValue, measureUnit);
  shouldFinish && transaction.finish();
};

export function sentryCaptureMessage(message: string, data?: string, filename: string = 'errordata.txt') {
  withScope(scope => {
    if (data) {
      scope.addAttachment({ filename, data });
    }
    captureMessage(message);
  });
}

export function sentryCaptureException(error: Error, data?: string, filename: string = 'errordata.txt') {
  withScope(scope => {
    if (data) {
      scope.addAttachment({ filename, data });
    }
    captureException(error);
  });
}

