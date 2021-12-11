const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require("copy-webpack-plugin");
const ServiceWorkerWebpackPlugin = require('serviceworker-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  mode: 'development',
  output: {
    filename: 'elFinderSupportBrowserFS.js',
    path: path.resolve(__dirname, 'js/proxy'),
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.browser': 'true'
    }),
    new CopyPlugin({
      patterns: [
        { from: path.resolve(__dirname, 'src/ServiceWorkerWare.js'),
          to: path.resolve(__dirname, 'js/proxy/ServiceWorkerWare.js')
        },
      ],
    }),
    new ServiceWorkerWebpackPlugin({
      entry: path.join(__dirname, 'src/service-worker.js'),
      filename: 'service-worker.js'
    })
  ]
};
