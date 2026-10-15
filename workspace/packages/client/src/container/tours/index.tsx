import ExportImport from '../../component/export-import';
/* eslint-disable no-useless-escape */
import { CaretRightOutlined, LoadingOutlined, PlusOutlined } from '@ant-design/icons';
import { traceEvent } from '@fable/common/dist/amplitude';
import { ReqTourPropUpdate, RespCommonConfig, RespOrg, RespScreen, RespSubscription, RespUser, ScreenType } from '@fable/common/dist/api-contract';
import { CmnEvtProp, IAnnotationConfig, LoadingStatus, ScreenData, SerNode, TourData, TourScreenEntity } from '@fable/common/dist/types';
import { Modal, message } from 'antd';
import React, { ReactElement } from 'react';
import { connect } from 'react-redux';
import JSZip from 'jszip';
import {
  createNewTour,
  deleteTour,
  duplicateTour,
  getAllTours,
  getCustomDomains,
  getSubscriptionOrCheckoutNew,
  publishTour,
  renameTour,
  updateTourProp
} from '../../action/creator';
import { AMPLITUDE_EVENTS } from '../../amplitude/events';
import * as GTags from '../../common-styled';
import Button from '../../component/button';
import { StepContainer } from '../../component/ext-download';
import Header from '../../component/header';
import HomeDropDown from '../../component/homepage/home-dropdown';
import Input from '../../component/input';
import TopLoader from '../../component/loader/top-loader';
import SidePanel from '../../component/side-panel';
import SkipLink from '../../component/skip-link';
import TextArea from '../../component/text-area';
import EmptyTourState from '../../component/tour/empty-state';
import TourCard from '../../component/tour/tour-card';
import UpgradeModal from '../../component/upgrade/upgrade-modal';
import { TOP_LOADER_DURATION } from '../../constants';
import { P_RespScreen, P_RespSubscription, P_RespTour, P_RespVanityDomain, processRawScreenData } from '../../entity-processor';
import { FeatureForPlan } from '../../plans';
import { TState } from '../../reducer';
import { WithRouterProps, withRouter } from '../../router-hoc';
import { FeatureAvailability, Ops } from '../../types';
import SelectorComponent from '../../user-guides/selector-component';
import TourCardGuide from '../../user-guides/tour-card-guide';
import { createIframeSrc, fallbackFeatureAvailability, getExportBaseUrl, isExtensionInstalled, isFeatureAvailable, isMediaAnnotation } from '../../utils';
import * as Tags from './styled';
import Upgrade from '../../component/upgrade';
import ProductUrlInput from '../../component/open-product-url-btn';

const userGuides = [TourCardGuide];

interface Files {
  name: string,
  hasScreensData?: boolean,
  data?: string,
  url?: string,
  hasAssets?: boolean,
  isAsset?: boolean,
}
// TODO[now] delete code and states for upgrade modal if not required

interface IDispatchProps {
  getAllTours: () => void;
  createNewTour: (tourName: string, description: string) => void;
  renameTour: (tour: P_RespTour, newVal: string, newDescription: string) => void;
  duplicateTour: (tour: P_RespTour, displayName: string) => void;
  deleteTour: (tourRid: string) => void;
  publishTour: (tour: P_RespTour) => Promise<boolean>,
  updateTourProp: <T extends keyof ReqTourPropUpdate>(
    rid: string,
    tourProp: T,
    value: ReqTourPropUpdate[T]
  ) => void,
  getVanityDomains: () => void;
  getSubscriptionOrCheckoutNew: ()=> Promise<RespSubscription>;
}

export enum CtxAction {
  NA = 'na',
  Rename = 'rename',
  Duplicate = 'duplicate',
  Create = 'create',
  Export = 'export'
}

const mapDispatchToProps = (dispatch: any): IDispatchProps => ({
  publishTour: (tour) => dispatch(publishTour(tour)),
  getAllTours: () => dispatch(getAllTours(false)),
  createNewTour: (tourName: string, description: string) => dispatch(createNewTour(true, tourName, 'new', description)),
  renameTour: (tour: P_RespTour, newDisplayName: string, newDescription: string) => dispatch(
    renameTour(tour, newDisplayName, newDescription)
  ),
  duplicateTour: (tour: P_RespTour, displayName: string) => dispatch(duplicateTour(tour, displayName)),
  deleteTour: (tourRid: string) => dispatch(deleteTour(tourRid)),
  updateTourProp: <T extends keyof ReqTourPropUpdate>(
    rid: string,
    tourProp: T,
    value: ReqTourPropUpdate[T]
  ) => dispatch(updateTourProp(rid, tourProp, value)),
  getVanityDomains: () => dispatch(getCustomDomains()),
  getSubscriptionOrCheckoutNew: () => dispatch(getSubscriptionOrCheckoutNew()),
});

interface IAppStateProps {
  tours: P_RespTour[];
  userCreatedTours: P_RespTour[];
  subs: P_RespSubscription | null;
  allToursLoadingStatus: LoadingStatus;
  principal: RespUser | null;
  opsInProgress: Ops;
  org: RespOrg | null;
  featurePlan: FeatureForPlan | null;
  vanityDomains: P_RespVanityDomain[] | null;
}

const mapStateToProps = (state: TState): IAppStateProps => ({
  tours: state.default.tours,
  userCreatedTours: state.default.tours,
  subs: state.default.subs,
  principal: state.default.principal,
  org: state.default.org,
  allToursLoadingStatus: state.default.allToursLoadingStatus,
  opsInProgress: state.default.opsInProgress,
  featurePlan: state.default.featureForPlan,
  vanityDomains: state.default.vanityDomains,

});

interface IOwnProps {
  title: string;
}
type IProps = IOwnProps & IAppStateProps & IDispatchProps & WithRouterProps<{}>;
interface IOwnStateProps {
  showModal: boolean;
  selectedTour: P_RespTour | null;
  ctxAction: CtxAction;
  isExtInstalled: boolean;
  showUpgradeModal: boolean;
  createNewDemoFeatureAvailable: FeatureAvailability;
  shouldShowOnboardingVideoModal: boolean;
  baseUrl: string;
  exportingDemo: boolean;
}
const { confirm } = Modal;

class Tours extends React.PureComponent<IProps, IOwnStateProps> {
  renameOrDuplicateOrCreateIpRef: React.RefObject<HTMLInputElement> = React.createRef();

  interval : null | NodeJS.Timeout = null;

  renameOrDuplicateOrCreateDescRef: React.RefObject<HTMLTextAreaElement> = React.createRef();

  constructor(props: IProps) {
    super(props);
    this.state = {
      showModal: false,
      selectedTour: null,
      ctxAction: CtxAction.NA,
      isExtInstalled: false,
      showUpgradeModal: false,
      createNewDemoFeatureAvailable: fallbackFeatureAvailability,
      shouldShowOnboardingVideoModal: false,
      baseUrl: '',
      exportingDemo: false
    };
  }

  componentDidMount(): void {
    this.props.getAllTours();
    document.title = this.props.title;
    isExtensionInstalled()
      .then((isExtInstalled) => {
        this.setState({ isExtInstalled });
      });

    if (!this.state.isExtInstalled) {
      this.interval = setInterval(() => isExtensionInstalled()
        .then((isExtInstalled) => {
          isExtInstalled && this.clearExtensionInstallInterval();
          this.setState({ isExtInstalled });
        }), 3000);
    } else this.clearExtensionInstallInterval();

    if (this.props.featurePlan) this.handleFeatureAvailable();

    const baseUrl = getExportBaseUrl('');
    this.setState({ baseUrl });
    this.props.getVanityDomains();
  }

  clearExtensionInstallInterval = () : void => {
    if (this.interval) { clearInterval(this.interval); }
  };

  componentWillUnmount(): void {
    this.clearExtensionInstallInterval();
  }

  componentDidUpdate(prevProps: Readonly<IProps>, prevState: Readonly<IOwnStateProps>): void {
    if (prevProps.opsInProgress !== this.props.opsInProgress) {
      if (this.props.opsInProgress === Ops.DuplicateTour) {
        message.warning({
          content: 'Demo duplication is in progress! Please don\'t close this tab',
        });
      } else if (this.props.opsInProgress === Ops.None) {
        message.info({
          content: 'Duplication successful!',
          duration: 2
        });
      }
    }

    if (prevState.showModal !== this.state.showModal && this.state.showModal
      && !(this.state.ctxAction === CtxAction.Create || this.state.ctxAction === CtxAction.Export)) {
      setTimeout(() => {
        this.renameOrDuplicateOrCreateIpRef.current!.focus();
        this.renameOrDuplicateOrCreateIpRef.current!.select();
      });
    }

    if ((this.props.featurePlan !== prevProps.featurePlan || this.props.tours !== prevProps.tours)
       && this.props.tours && this.props.featurePlan) {
      this.handleFeatureAvailable();
    }

    if (this.props.allToursLoadingStatus !== prevProps.allToursLoadingStatus && this.props.allToursLoadingStatus === LoadingStatus.Done) {
      this.setState({
        // shouldShowOnboardingVideoModal: this.props.userCreatedTours.length === 0 && localStorage.getItem('fable/ovs') !== '1',
        // INFO only show this when user has clicked on the button explicitly
        shouldShowOnboardingVideoModal: false,
      });
    }
  }

  handleFeatureAvailable(): void {
    // the reason length + 1 is done: for solo plan allowed number of demo is 1 and the feature plan conditon is <= 1
    // so when there are length = 0 demos length + 1 <= 1 is true, hence the demo would be created
    // so when there are length = 1 demo length + 1 <= 1 is false, hence the demo would be created
    // Sicne the feature plan test condition is <= 1, and we are detecting if more demos can be created or not we have
    // to do lenght + 1
    const isAvailable = isFeatureAvailable(this.props.featurePlan, 'no_of_demos', this.props.tours.length + 1);
    this.setState({ createNewDemoFeatureAvailable: isAvailable });
  }

  handleShowModal = (tour: P_RespTour | null, ctxAction: CtxAction): void => {
    this.setState({ selectedTour: tour, showModal: true, ctxAction });
  };

  // eslint-disable-next-line class-methods-use-this
  traverse = (str: string): {
    str: string,
    foundUrls: string[]
  } => {
    const foundUrls: Set<string> = new Set();

    const regex = /(https?:\/\/(?:scdna\.sharefable\.com|fable-tour-app-gamma\.s3\.ap-south-1\.amazonaws\.com)\/[^\s"'(),\\\]}]+)/g;

    const newstr = str.replace(regex, (match) => {
      try {
        const url = new URL(match);
        const path = url.pathname + url.search + url.hash;
        const newUrl = this.state.baseUrl + path;
        foundUrls.add(match);
        return newUrl;
      } catch (err) {
        console.warn('Invalid URL:', match, err);
        return match;
      }
    });

    return {
      str: newstr,
      foundUrls: Array.from(foundUrls),
    };
  };

  // eslint-disable-next-line class-methods-use-this
  processFiles = async (files: Files[], zip: JSZip): Promise<void> => {
    const contentTypeMap: Record<string, string> = {};
    while (files.length > 0) {
      const file = files.shift() as Files;
      try {
        if (file.data) {
          zip.file(file.name, file.data);
        } else if (file.url) {
          const resp = await fetch(file.url);
          const contentType = resp.headers.get('Content-Type') || 'application/octet-stream';
          if (file.hasScreensData) {
            try {
              const json = await resp.clone().json();
              let screens = json.data.screens as P_RespScreen[];
              const config = json.data.cc as RespCommonConfig;

              screens = screens.map(s => processRawScreenData(s, config, json.data));

              screens.forEach(screen => {
                const screenFile = {
                  url: `${process.env.REACT_APP_API_ENDPOINT}/v1/screen?rid=${screen.rid}`,
                  name: `v1/screen/${screen.rid}`
                };

                const screenDataFileUri = {
                  url: screen!.dataFileUri.href,
                  name: `/root/srn/${screen.assetPrefixHash}/${config.dataFileName}`,
                  hasAssets: ScreenType.Img !== screen.type,
                };

                if (ScreenType.Img === screen.type) {
                  const dataFileUri = new URL(screen!.dataFileUri.href);
                  dataFileUri.pathname = dataFileUri.pathname.replace(/\.json$/, '.img');

                  files.push({
                    url: screen!.dataFileUri.href,
                    name: `/root/srn/${screen.assetPrefixHash}/index.img`,
                    isAsset: true,
                  });
                }

                files.push(screenFile);
                files.push(screenDataFileUri);

                if (screen!.parentScreenId && screen!.type === ScreenType.SerDom) {
                  const editFileUri = {
                    name: `/root/srn/${screen.assetPrefixHash}/${json.data.pubEditFileName}`,
                    url: screen!.editFileUri.href,
                    hasAssets: true
                  };
                  files.push(editFileUri);
                }
              });
            } catch (err) {
              console.error('Failed to parse screen data', err);
            }
          }

          if (file.isAsset) {
            contentTypeMap[file.name] = contentType;
            if (contentType.startsWith('image/') || contentType.startsWith('audio/') || contentType.startsWith('video/') || contentType.startsWith('application/octet-stream') || contentType.startsWith('application/x-mpegURL')) {
              const blob = await resp.blob();
              zip.file(file.name, blob);
            } else {
              const json = await resp.text();
              const { str, foundUrls } = this.traverse(json);
              foundUrls.forEach((url, index) => {
                const urlPath = new URL(url).pathname;
                files.push({
                  name: urlPath,
                  url,
                  isAsset: true,
                });
              });

              zip.file(file.name, str);
            }
            continue;
          } else if (file.hasAssets) {
            const json = await resp.json();
            let data = json;
            const { str, foundUrls } = this.traverse(JSON.stringify(data));
            try {
              data = JSON.parse(str);
            } catch (err) {
              console.error(err);
            }
            foundUrls.forEach((url, index) => {
              const urlPath = new URL(url).pathname;
              files.push({
                name: urlPath,
                url,
                isAsset: true,
              });
            });
            const jsonBlob = new Blob([str], { type: 'application/json' });
            zip.file(file.name, jsonBlob);
            continue;
          }

          const blob = await resp.blob();
          zip.file(file.name, blob);
        }
      } catch (err) {
        console.error(`Failed to process file: ${file.name}`, err);
      }
    }
    zip.file('_content-types.json', JSON.stringify(contentTypeMap, null, 2));
  };

  // eslint-disable-next-line class-methods-use-this
  handleExportDemo = async (tour: P_RespTour | null) : Promise<void> => {
    const isTourPublished = tour?.lastPublishedDate !== undefined;
    if (!isTourPublished) {
      alert('Tour not published, can\'t export');
      return;
    }

    const zip = new JSZip();
    const port = 3002;
    const ts = +new Date();
    const files = [
      {
        name: 'index.html',
        url: '/'
      },
      {
        name: 'aboutblankhtml4.html',
        url: '/aboutblankhtml4.html'
      },
      {
        name: 'aboutblankhtml5.html',
        url: '/aboutblankhtml5.html'
      },
      {
        name: 'static/js/bundle.js',
        url: '/static/js/bundle.js'
      },
      {
        name: 'manifest.json',
        url: '/manifest.json'
      },
      {
        name: 'server.js',
        data: `
        const express = require('express');
        const path = require('path');
        const fs = require('fs');
        const cors = require('cors');
        
        const app = express();
        app.use(cors());

        const port = ${port};
        
        // Load custom content type map if it exists
        const CONTENT_TYPES_PATH = path.join(__dirname, '_content-types.json');
        let contentTypeMap = {};
        
        if (fs.existsSync(CONTENT_TYPES_PATH)) {
          try {
            contentTypeMap = JSON.parse(fs.readFileSync(CONTENT_TYPES_PATH, 'utf-8'));
            console.log('✅ Loaded _content-types.json');
          } catch (err) {
            console.error('❌ Failed to parse _content-types.json:', err);
          }
        }
        
        // Custom middleware for serving assets with proper content types
        app.use('/root/proxy_asset', (req, res, next) => {
          // Get the file path relative to the proxy_asset directory
          const relativePath = req.path;
          const fullPath = path.join(__dirname, 'root', 'proxy_asset', relativePath);
          
          // Check if file exists
          fs.access(fullPath, fs.constants.F_OK, (err) => {
            if (err) {
              return res.status(404).send('File not found');
            }
            
            // Determine content type
            // First check our custom map
            const customContentType = contentTypeMap[\`/root/proxy_asset\${relativePath}\`];
            
            const contentType = customContentType || 'application/octet-stream';
            
            // Set the content type and send the file
            res.setHeader('Content-Type', contentType);
            fs.createReadStream(fullPath).pipe(res);
          });
        });
        
        // Serve other static directories
        const serveStaticDirs = (baseDir) => {
          const dirs = fs.readdirSync(baseDir).filter(file => {
            const dirPath = path.join(baseDir, file);
            return fs.lstatSync(dirPath).isDirectory() && file !== 'node_modules';
          });
          
          dirs.forEach(dir => {
            const dirPath = path.join(baseDir, dir);
            app.use(\`/\${dir}\`, express.static(dirPath));
            console.log(\`📁 Serving static files from /\${dir}\`);
          });
        };
        
        serveStaticDirs(__dirname);
        app.get('/aboutblankhtml4.html', (req, res) => {
          res.sendFile(path.resolve(__dirname, 'aboutblankhtml4.html'));
        });

        // Serve aboutblankhtml5.html
        app.get('/aboutblankhtml5.html', (req, res) => {
          res.sendFile(path.resolve(__dirname, 'aboutblankhtml5.html'));
        });

        app.get('/manifest.json', (req, res) => {
          res.sendFile(path.resolve(__dirname, 'manifest.json'));
        })
          
        // Serve index.html for embed/live routes
        app.get(/^\\/(embed|live)\\/demo\\/${tour.rid}(\\/.*)?$/, (req, res) => {
          res.sendFile(path.resolve(__dirname, 'index.html'));
        });
        
        // Start server
        app.listen(port, () => {
          console.log('\\n🚀 Server is up and running at:');
          console.log(\`→ http://localhost:\${port}/embed/demo/${tour.rid}\`);
          console.log(\`→ For Interactive demo - http://localhost:\${port}/live/demo/${tour.rid}?exportedTour=1\\n\`);
          console.log(\`→ For Interactive video - http://localhost:\${port}/live/demo/${tour.rid}?exportedTour=1&mode=video\\n\`);
        });
        `
      },
      {
        name: 's3-content-type-update.js',
        data: `
        const fs = require("fs");
        const path = require("path");
        const { S3Client, CopyObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

        const REGION = "<TODO bucket_region>";
        const BUCKET = "<TODO bucket_name>";
        const FILE = "./_content-types.json";

        const s3 = new S3Client({ region: REGION });

        async function updateContentType(key, contentType) {
          try {
            const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

            const command = new CopyObjectCommand({
              Bucket: BUCKET,
              CopySource: \`/\${BUCKET}/\${key}\`,
              Key: key,
              MetadataDirective: "REPLACE",
              ContentType: contentType,
              Metadata: head.Metadata,
            });

            await s3.send(command);
            return { success: true };
          } catch (err) {
            // console.error(err);
            return { success: false, error: err.message };
          }
        }

        async function main() {
          const contentMap = JSON.parse(fs.readFileSync(FILE, "utf8"));

          const results = {
            success: [],
            failed: [],
          };

          for (const [keyRaw, type] of Object.entries(contentMap)) {
            const key = keyRaw.startsWith("/") ? keyRaw.slice(1) : keyRaw;
            const result = await updateContentType(key, type);
            if (result.success) {
              console.log(\`✅ Updated: \${key} → \${type}\`);
              results.success.push(key);
            } else {
              console.warn(\`❌ Failed: \${key} → \${type} | \${result.error}\`);
              results.failed.push({ key, error: result.error });
            }
          }

          console.log("=== Summary ===");
          console.log(\`Success: \${results.success.length}\`);
          console.log(\`Failed: \${results.failed.length}\`);
        }

        main();
        `,
      },
      {
        name: 'package.json',
        data: `
        {
        "name": "test_folder",
        "version": "1.0.0",
        "description": "",
        "main": "index.js",
        "keywords": [],
        "author": "",
        "license": "ISC",
        "dependencies": {
          "express": "^5.1.0",
          "cors": "^2.8.5",
          "@aws-sdk/client-s3": "^3.787.0"
        }
      }
      `
      },
      {
        name: `root/ptour/${tour.rid}/${tour.pubTourEntityFileName}`,
        url: `${tour.pubDataFileUri.origin}/root/ptour/${tour.rid}/${tour.pubTourEntityFileName}?ts=${ts}`,
        hasScreensData: true,
        hasAssets: true
      },
      {
        name: `root/tour/${tour.assetPrefixHash}/${tour.pubEditFileName}`,
        url: `${tour.pubDataFileUri.origin}/root/tour/${tour.assetPrefixHash}/${tour.pubEditFileName}?ts=${ts}`,
        hasAssets: true
      },
      {
        name: `root/tour/${tour.assetPrefixHash}/${tour.pubLoaderFileName}`,
        url: `${tour.pubDataFileUri.origin}/root/tour/${tour.assetPrefixHash}/${tour.pubLoaderFileName}?ts=${ts}`,
        hasAssets: true
      },
      {
        name: `root/tour/${tour.assetPrefixHash}/${tour.pubDataFileName}`,
        url: `${tour.pubDataFileUri.origin}/root/tour/${tour.assetPrefixHash}/${tour.pubDataFileName}?ts=${ts}`,
        hasAssets: true
      }
    ];

    try {
    // get asset files
      const manifestRes = await fetch('/asset-manifest.json');
      const manifest = await manifestRes.json();

      const allFiles = Object.values(manifest.files) as string[];

      allFiles.forEach((filePath) => {
        const name = filePath.startsWith('/') ? filePath.slice(1) : filePath;
        files.push({
          name,
          url: `${filePath}`,
        });
      });
    } catch (err) {
      console.log('Asset file not found');
    }
    await this.processFiles(files, zip);
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }, (metadata) => {

    });
    const downloadUrl = window.URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${tour.displayName}.zip`;
    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  };

  handleDelete = (tour: P_RespTour | null): void => {
    confirm({
      title: 'Are you sure you want to delete this demo ?',
      okText: 'Delete',
      okType: 'danger',
      onOk: () => {
        traceEvent(AMPLITUDE_EVENTS.GENERAL_TOUR_ACTIONS, {
          tour_action_type: 'delete',
          tour_url: createIframeSrc(`/demo/${tour!.rid}`)
        }, [CmnEvtProp.EMAIL]);
        this.props.deleteTour(tour!.rid);
      },
    });
  };

  handleModalOk = (): void => {
    const newVal = this.renameOrDuplicateOrCreateIpRef.current!.value.trim().replace(/\s+/, ' ');
    const descriptionVal = this.renameOrDuplicateOrCreateDescRef.current!.value.trim();
    if (!newVal) return;
    if (this.state.ctxAction === CtxAction.Rename) {
      if (newVal.toLowerCase() === this.state.selectedTour!.displayName.toLowerCase()
       && descriptionVal.toLowerCase() === this.state.selectedTour!.description.toLowerCase()) {
        return;
      }
      traceEvent(AMPLITUDE_EVENTS.GENERAL_TOUR_ACTIONS, {
        tour_action_type: 'rename',
        tour_url: createIframeSrc(`/demo/${this.state.selectedTour!.rid}`)
      }, [CmnEvtProp.EMAIL]);
      this.props.renameTour(this.state.selectedTour!, newVal, descriptionVal);
      this.state.selectedTour!.displayName = newVal;
    } else if (this.state.ctxAction === CtxAction.Duplicate) {
      traceEvent(AMPLITUDE_EVENTS.GENERAL_TOUR_ACTIONS, {
        tour_action_type: 'duplicate',
        tour_url: createIframeSrc(`/demo/${this.state.selectedTour!.rid}`)
      }, [CmnEvtProp.EMAIL]);
      this.props.duplicateTour(this.state.selectedTour!, newVal);
    } else if (this.state.ctxAction === CtxAction.Create) {
      traceEvent(
        AMPLITUDE_EVENTS.CREATE_NEW_TOUR,
        { from: 'app', tour_name: newVal },
        [CmnEvtProp.EMAIL]
      );
      this.props.createNewTour(newVal, descriptionVal);
    }

    this.setState({ selectedTour: null, showModal: false, ctxAction: CtxAction.NA });
  };

  handleRenameOrDuplicateOrCreateTourFormSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    this.handleModalOk();
  };

  handleModalCancel = (): void => {
    this.setState({ selectedTour: null, showModal: false, ctxAction: CtxAction.NA });
  };

  getModalInputDefaultVal = (): string => {
    switch (this.state.ctxAction) {
      case CtxAction.Duplicate:
        return `Copy of ${this.state.selectedTour!.displayName}`;
      case CtxAction.Rename:
        return `${this.state.selectedTour!.displayName}`;
      case CtxAction.Create:
        return 'Untitled';
      default:
        return '';
    }
  };

  getModalTitle = (): string => {
    switch (this.state.ctxAction) {
      case CtxAction.Duplicate:
        return 'Duplicate Demo';
      case CtxAction.Rename:
        return 'Rename Demo';
      case CtxAction.Create:
        return 'Create Demo';
      default:
        return '';
    }
  };

  getModalDesc = (): string => {
    switch (this.state.ctxAction) {
      case CtxAction.Duplicate:
        return 'Choose a name for the new duplicated demo.';
      case CtxAction.Rename:
      case CtxAction.Create:
        return 'Give a new name for this demo';
      default:
        return '';
    }
  };

  getIsAtleastOneAnnPublished = () : boolean => {
    const publishedTours = this.props.tours.filter((tour) => tour.lastPublishedDate !== undefined);
    if (publishedTours.length !== 0) return true;
    return false;
  };

  getIsAtleastOneDemoCreated = (): boolean => Boolean(this.props.tours.find(tour => tour.onboarding === false));

  skipOnboadingVideo = () => {
    traceEvent(AMPLITUDE_EVENTS.ONBOARDING_DEMO_MODAL_CLOSED, {}, [CmnEvtProp.EMAIL]);
    this.setState({
      shouldShowOnboardingVideoModal: false
    }),
    localStorage.setItem('fable/ovs', '1');
  };

  render(): ReactElement {
    if (process.env.REACT_APP_SELF_HOSTED_CORE === 'true' && new URLSearchParams(window.location.search).get('restore') === '1') return <ExportImport />;
    const toursLoaded = this.props.allToursLoadingStatus === LoadingStatus.Done;

    return (
      <GTags.ColCon className="tour-con">
        {this.props.loadingState === 'loading' && <TopLoader
          duration={TOP_LOADER_DURATION}
          showLogo={false}
          showOverlay
        />}
        <SkipLink />
        <div style={{ height: '48px' }}>
          <Header
            subs={this.props.subs}
            tour={null}
            shouldShowFullLogo
            principal={this.props.principal}
            org={this.props.org}
            leftElGroups={[]}
            vanityDomains={this.props.vanityDomains}
            checkCredit={this.props.getSubscriptionOrCheckoutNew}
          />
        </div>
        <GTags.RowCon style={{ height: 'calc(100% - 48px)' }}>
          { toursLoaded && (
            <GTags.SidePanelCon>
              <SidePanel
                selected="tours"
                subs={this.props.subs}
                compact={this.props.userCreatedTours.length === 0}
              />
            </GTags.SidePanelCon>
          )}
          <GTags.MainCon>
            <GTags.BodyCon
              style={{
                height: '100%',
                overflowY: 'auto',
                flexDirection: 'row',
                gap: '3rem',
                paddingLeft: '3%',
                background: '#f5f5f5',
                transition: 'background 0.1s ease-in',
              }}
              id="main"
            >
              {toursLoaded ? (
                <>
                  {
                    this.props.userCreatedTours.length === 0 ? (
                      <EmptyTourState
                        isAtleastOneDemoCreated={this.getIsAtleastOneDemoCreated()}
                        extensionInstalled={this.state.isExtInstalled}
                        isAtleastOneTourPublished={this.getIsAtleastOneAnnPublished()}
                        openOnboardingVideo={() => {
                          traceEvent(AMPLITUDE_EVENTS.ONBOARDING_DEMO_URL_CLICKED, {}, [CmnEvtProp.EMAIL]);
                          this.setState({ shouldShowOnboardingVideoModal: true });
                        }}
                      />
                    ) : (
                      <>
                        <div style={{ width: '100%', minWidth: '43.5rem' }}>
                          {!this.getIsAtleastOneAnnPublished() && (
                          <Tags.TopPanel style={{
                            display: 'flex',
                            alignItems: 'stretch',
                            gap: ''
                          }}
                          >
                            <StepContainer
                              isAtleastOneDemoCreated={this.getIsAtleastOneDemoCreated()}
                              extensionInstalled={this.state.isExtInstalled}
                              isAtleastOneTourPublished={this.getIsAtleastOneAnnPublished()}
                            />

                          </Tags.TopPanel>
                          )}
                          <GTags.BottomPanel style={{
                            width: '100%',
                            overflow: 'auto',
                            display: 'flex',
                            gap: '4rem',
                            alignItems: 'start'
                          }}
                          >
                            <div style={{ width: '60%', overflow: 'auto', padding: '0 4px', maxWidth: '680px' }}>
                              <div
                                style={{
                                  margin: '1rem 0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between'
                                }}
                              >
                                <Tags.ToursHeading style={{ fontWeight: 400 }}>All demos in your org</Tags.ToursHeading>
                                <Button
                                  icon={<PlusOutlined />}
                                  iconPlacement="left"
                                  onClick={() => this.handleShowModal(null, CtxAction.Create)}
                                  intent={this.state.isExtInstalled ? 'primary' : 'secondary'}
                                >
                                  Create a demo
                                </Button>
                              </div>
                              {this.props.tours.map((tour, index) => (
                                <TourCard
                                  publishTour={this.props.publishTour}
                                  key={tour.rid}
                                  tour={tour}
                                  i={index}
                                  handleShowModal={this.handleShowModal}
                                  handleDelete={this.handleDelete}
                                  updateTourProp={this.props.updateTourProp}
                                  vanityDomains={this.props.vanityDomains}
                                />
                              ))}
                            </div>
                            <HomeDropDown
                              isExtInstalled={!this.state.isExtInstalled ? !this.getIsAtleastOneAnnPublished() : true}
                              firstTourId={this.props.userCreatedTours[0]?.rid}
                              atLeastOneDemoCreated={this.getIsAtleastOneDemoCreated()}
                            />
                          </GTags.BottomPanel>
                          <SelectorComponent userGuides={userGuides} />
                        </div>
                      </>
                    )
                  }
                </>
              ) : (
                <div style={{ width: '100%', position: 'relative', transform: 'translate(-3%, 0px)' }}>
                  <TopLoader duration={TOP_LOADER_DURATION} showLogo text="Loading demos for you" />
                </div>
              )}
            </GTags.BodyCon>
          </GTags.MainCon>
        </GTags.RowCon>
        {this.state.ctxAction !== CtxAction.NA && (
          <GTags.BorderedModal
            donotShowHeaderStip
            containerBg="#f5f5f5"
            style={{ height: '10px' }}
            open={this.state.showModal}
            onOk={this.handleModalOk}
            onCancel={this.handleModalCancel}
            width={this.state.ctxAction === CtxAction.Export ? '60%' : undefined}
            closeIcon={this.state.ctxAction !== CtxAction.Export}
            footer={(
              <div className="button-two-col-cont">
                <Button
                  type="button"
                  intent="secondary"
                  onClick={this.handleModalCancel}
                  style={{ flex: 1 }}
                  disabled={this.state.exportingDemo}
                >
                  Cancel
                </Button>
                {!(this.state.ctxAction === CtxAction.Create || this.state.ctxAction === CtxAction.Export) && (
                  <Button
                    style={{ flex: 1 }}
                    onClick={this.handleModalOk}
                  >
                    Save
                  </Button>
                )}
                {this.state.ctxAction === CtxAction.Export && (
                  <Button
                    style={{ flex: 1 }}
                    disabled={this.state.exportingDemo}
                    onClick={async () => {
                      this.setState({ exportingDemo: true });
                      await this.handleExportDemo(this.state.selectedTour);
                      this.setState({ selectedTour: null, showModal: false, ctxAction: CtxAction.NA, exportingDemo: false });
                    }}
                  >Export
                  </Button>
                )}
              </div>
            )}
          >
            <div className="modal-content-cont">
              {this.state.ctxAction === CtxAction.Create ? (
                <div>
                  <p className="typ-h2">Use Fable's Chrome Extension to create a new demo</p>
                  <ol className="typ-reg" style={{ padding: 0 }}>
                    <p>
                      Go to the product you want to create a demo of & click on Fable's chrome extension to record a demo.
                    </p>
                    <ProductUrlInput />
                  </ol>
                  <GTags.OurCollapse
                    shadow="none"
                    expandIconPosition="start"
                    // eslint-disable-next-line react/no-unstable-nested-components
                    expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
                    size="small"
                    bordered={false}
                    items={[{
                      key: '1',
                      label: <div className="typ-h2">Create a new demo by uploading images</div>,
                      children: (
                        this.state.createNewDemoFeatureAvailable.isAvailable ? (
                          <form
                            onSubmit={this.handleRenameOrDuplicateOrCreateTourFormSubmit}
                            style={{ paddingTop: '1rem', gap: '1rem', flexDirection: 'column', display: 'flex' }}
                          >
                            <Input
                              label={this.getModalDesc()}
                              id="renameOrDuplicateOrCreateTour"
                              innerRef={this.renameOrDuplicateOrCreateIpRef}
                              defaultValue={this.getModalInputDefaultVal()}
                            />
                            <TextArea
                              label="Enter description for this demo"
                              innerRef={this.renameOrDuplicateOrCreateDescRef}
                              defaultValue=""
                            />
                            <Button
                              style={{ flex: 1 }}
                              onClick={this.handleModalOk}
                            >
                              Save
                            </Button>
                          </form>
                        ) : (<Upgrade subs={this.props.subs} inline clickedFrom="create_demo" />)
                      )
                    }]}
                  />
                </div>
              ) : this.state.ctxAction === CtxAction.Export ? (
                <div className="typ-reg">
                  <div className="typ-h2">Export Demo</div>
                  <p>You can export this demo and host it on any static site hosting platform.</p>
                  <p>
                    Your self-hosted demo URL: &nbsp;
                    <pre style={{
                      display: 'inline',
                      fontSize: '12px',
                      background: '#7567ff',
                      padding: '0px 3px',
                      borderRadius: '4px',
                      color: 'white',
                      fontWeight: 'bold',
                    }}
                    >
                      &lt;self_hosting_url&gt;/live/demo/{this.state.selectedTour?.rid}?exportedTour=1
                    </pre>
                    <div className="typ-sm">If you need to add additional URL parameters, simply append them after exportedTour=1 using &.</div>
                  </p>
                  <GTags.OurCollapse
                    shadow="none"
                    expandIconPosition="start"
                    // eslint-disable-next-line react/no-unstable-nested-components
                    expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
                    size="small"
                    bordered={false}
                    items={[{
                      key: '1',
                      label: <div className="typ-h2">How to Export and Host the Demo</div>,
                      children: (
                        <div className="typ-reg">
                          <p>We’ve included a step-by-step guide below, along with examples for running it locally or hosting it on AWS S3. Depending on your setup, you may need help from your engineering or DevOps team.</p>
                          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', lineHeight: 1.6, color: '#333' }}>
                            <ol style={{ paddingLeft: '20px', margin: 0 }}>
                              <li style={{ marginBottom: '10px' }}>
                                Click the <strong>Export</strong> button below.
                              </li>

                              <li style={{ marginBottom: '10px' }}>
                                Once the export is complete, a ZIP file will be downloaded. Unzip it to access the demo files.
                              </li>

                              <li style={{ marginBottom: '10px' }}>
                                <strong>To run locally:</strong><br />
                                Open a terminal, navigate to the unzipped folder, and run:<br />
                                <code style={{
                                  backgroundColor: '#f4f4f4',
                                  padding: '2px 4px',
                                  borderRadius: '4px',
                                  display: 'inline-block',
                                  marginTop: '4px'
                                }}
                                >
                                  npm install &amp;&amp; node server.js
                                </code><br />
                                The demo URL will be printed in the terminal once the server starts.
                              </li>

                              <li style={{ marginBottom: '10px' }}>
                                <strong>To host on a static site provider:</strong><br />
                                Upload the demo files to your static site host (e.g., AWS S3, Netlify, Vercel).<br />
                                Make sure your host is configured for single-page applications (SPA), with all 404 or 403 requests redirected to{' '}
                                <code style={{
                                  backgroundColor: '#f4f4f4',
                                  padding: '2px 4px',
                                  borderRadius: '4px'
                                }}
                                >
                                  /index.html
                                </code>.
                              </li>

                              <li style={{ marginBottom: '10px' }}>
                                <p style={{ marginBottom: '10px' }}>
                                  <strong>Important:</strong> The demo assets require specific content types to be correctly set.
                                  You’ll find a
                                  <code style={{ backgroundColor: '#f4f4f4', padding: '2px 4px', borderRadius: '4px' }}>
                                    _content-types.json
                                  </code>{' '}
                                  file in the exported ZIP with the correct mappings.
                                </p>
                                <p style={{ marginBottom: '10px' }}>
                                  If you're using <strong>AWS S3</strong>, we've included a helper script named{' '}
                                  <code style={{ backgroundColor: '#f4f4f4', padding: '2px 4px', borderRadius: '4px' }}>
                                    s3-content-type-update.js
                                  </code>{' '}
                                  to automatically set the correct content types.
                                </p>
                                <p style={{ marginBottom: '6px' }}>To use the script:</p>
                                <ol style={{ paddingLeft: '20px', marginBottom: '10px' }}>
                                  <li style={{ marginBottom: '6px' }}>
                                    Open the script file and update it with your S3 <strong>bucket name</strong> and <strong>region</strong>.
                                  </li>
                                  <li>
                                    In your terminal, navigate to the unzipped folder and run:<br />
                                    <code style={{ backgroundColor: '#f4f4f4', padding: '2px 4px', borderRadius: '4px', display: 'inline-block', marginTop: '4px' }}>
                                      npm install &amp;&amp; node s3-content-type-update.js
                                    </code>
                                  </li>
                                </ol>

                                <p>This will automatically apply the correct content types to all demo assets in your S3 bucket.</p>
                              </li>
                            </ol>
                          </div>
                        </div>
                      )
                    }]}
                  />
                  <GTags.OurCollapse
                    shadow="none"
                    expandIconPosition="start"
                    // eslint-disable-next-line react/no-unstable-nested-components
                    expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
                    size="small"
                    bordered={false}
                    items={[{
                      key: '1',
                      label: <div className="typ-h2">Learn What’s Supported in Export</div>,
                      children: (
                        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', lineHeight: 1.6, color: '#333' }}>
                          <p style={{ marginBottom: '10px' }}>
                            The Fable demo export includes most features, but a few functionalities are not available when you self-host the demo:
                          </p>

                          <ul style={{ paddingLeft: '20px', marginBottom: '10px' }}>
                            <li style={{ marginBottom: '6px' }}>
                              <strong>Analytics</strong> – Usage analytics will not be tracked.
                            </li>
                            <li style={{ marginBottom: '6px' }}>
                              <strong>Integrations</strong> – Third-party integrations (e.g., CRMs, webhooks) will not function.
                            </li>
                            <li>
                              <strong>Lead Forms</strong> – Form submissions will not be captured, but the forms will still display and work for the end user.
                            </li>
                          </ul>

                          <p>
                            These limitations only affect backend services — the interactive experience remains fully functional for your viewers.
                          </p>
                        </div>
                      )
                    }]}
                  />
                  <p>If you have any queries, send us a mail at support@sharefable.com</p>
                  {
                    this.state.exportingDemo && (
                      <><LoadingOutlined />&nbsp;&nbsp;<>Exporting. This action might take sometime.</></>
                    )
                  }
                </div>)
                : (
                  <>
                    <div className="typ-h2">{this.getModalTitle()}</div>
                    <form
                      onSubmit={this.handleRenameOrDuplicateOrCreateTourFormSubmit}
                      style={{ marginTop: '0.5rem', paddingTop: '1rem', gap: '1rem', flexDirection: 'column', display: 'flex' }}
                    >
                      <Input
                        label={this.getModalDesc()}
                        id="renameOrDuplicateOrCreateTour"
                        innerRef={this.renameOrDuplicateOrCreateIpRef}
                        defaultValue={this.getModalInputDefaultVal()}
                      />
                      <TextArea
                        label="Enter description for this demo"
                        innerRef={this.renameOrDuplicateOrCreateDescRef}
                        defaultValue={this.state.ctxAction === CtxAction.Duplicate
                          ? '' : this.state.selectedTour?.description || ''}
                      />
                    </form>
                  </>
                )}
            </div>
          </GTags.BorderedModal>
        )}
        <GTags.BorderedModal
          donotShowHeaderStip
          containerBg="#212121"
          destroyOnClose
          style={{ height: '10px' }}
          open={this.state.shouldShowOnboardingVideoModal}
          onOk={this.skipOnboadingVideo}
          onCancel={this.skipOnboadingVideo}
          width={880}
          footer={(
            <div className="button-two-col-cont">
              <Button
                type="button"
                intent="link"
                onClick={this.skipOnboadingVideo}
                style={{ flex: 1, color: '#f5f5f5' }}
              >
                Close
              </Button>
            </div>
            )}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            <iframe
              src={`https://app.sharefable.com/embed/demo/fable-onboarding-demo-baehgzwhn5gfz1ly?email=${this.props.principal?.email}`}
              title="How to use Fable"
              style={{
                border: 'none',
                width: '850px',
                height: '600px'
              }}
              allow="fullscreen"
              allowFullScreen
            />
          </div>
        </GTags.BorderedModal>
        <UpgradeModal
          showUpgradePlanModal={this.state.showUpgradeModal}
          setShowUpgradePlanModal={(upgrade: boolean) => { this.setState({ showUpgradeModal: upgrade }); }}
          subs={this.props.subs}
          isInBeta={this.state.createNewDemoFeatureAvailable.isInBeta}
        />
      </GTags.ColCon>
    );
  }
}

export default connect<IAppStateProps, IDispatchProps, IOwnProps, TState>(
  mapStateToProps,
  mapDispatchToProps
)(withRouter(Tours));
