const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

// Only public build settings are embedded in the capture extension.
const settings = {
  NODE_ENV: 'production',
  REACT_APP_ENVIRONMENT: 'prod',
  REACT_APP_CLIENT_ENDPOINT: 'https://demo.zrexsolutions.com',
  REACT_APP_API_ENDPOINT: 'https://api.demo.zrexsolutions.com',
  REACT_APP_LOG_ENDPOINT: 'https://api.demo.zrexsolutions.com',
  REACT_APP_JOB_ENDPOINT: '',
  REACT_APP_AMPLITUDE_KEY: '',
  REACT_APP_POSTHOG_KEY: '',
  REACT_APP_DISABLE_TELEMETRY: 'true',
  REACT_APP_CAPTURE_COOKIES: 'false',
};
Object.assign(process.env, settings);
const config = require('./webpack.config');
config.mode = 'production';
config.devtool = false;
config.output.path = path.resolve(__dirname, 'build-zrex');
config.plugins = config.plugins.filter(plugin => !(plugin instanceof webpack.DefinePlugin) && !(plugin instanceof CopyPlugin));
config.plugins.push(new webpack.DefinePlugin(Object.fromEntries(
  Object.entries(settings).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])
)));
config.plugins.push(new CopyPlugin({ patterns: [{
  from: 'public', to: './',
  transform(content, filename) {
    if (path.basename(filename) !== 'manifest.json') return content;
    const manifest = JSON.parse(content.toString());
    manifest.name = 'Z Rex Demo Capture';
    manifest.description = 'Capture interactive demos for demo.zrexsolutions.com.';
    manifest.key = fs.readFileSync(path.join(__dirname, 'zrex-public-key.txt'), 'utf8').trim();
    manifest.externally_connectable.matches = ['https://demo.zrexsolutions.com/*'];
    manifest.permissions = manifest.permissions.filter(permission => permission !== 'cookies');
    manifest.permissions.push('activeTab');
    manifest.host_permissions = ['http://*/*', 'https://*/*'];
    return JSON.stringify(manifest, null, 2);
  },
}] }));
module.exports = config;

