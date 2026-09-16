import { IGlobalConfig } from '@fable/common/dist/types';
import { getSampleGlobalConfig } from '@fable/common/dist/utils';
import { FeaturePerPlan, Test } from './plans';

export function normalizeGlobalConfig(value: Partial<IGlobalConfig> | null | undefined): IGlobalConfig {
  const defaults = getSampleGlobalConfig();
  const supplied = Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== undefined && v !== null));
  return { ...defaults, ...supplied };
}

// Explicit defaults for the local subscription; hosted plans still use their server matrix.
export function getCoreFeatureDefaults(): FeaturePerPlan {
  const features: FeaturePerPlan = {};
  const enabled = ['no_of_demos', 'no_of_creator', 'custom_demo_loader', 'custom_lead_form',
    'no_watermark', 'multi_annontation', 'modules'];
  const disabled = ['custom_domain', 'dataset', 'demo_hub', 'aggregate_analytics'];
  for (const key of [...enabled, ...disabled]) {
    features[key] = {
      plans: [{ plan: '*', test: Test.SWITCH, value: enabled.includes(key) ? 'on' : 'off' }],
      isInBeta: false,
      requireAccess: false,
    };
  }
  return features;
}

