const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require("copy-webpack-plugin");

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
        { from: path.resolve(__dirname, 'src/service-worker.js'),
          to: path.resolve(__dirname, 'js/lib/service-worker.js')
        },
        { from: path.resolve(__dirname, 'src/ServiceWorkerWare.js'),
          to: path.resolve(__dirname, 'js/lib/ServiceWorkerWare.js')
        },
      ],
    }),
  ]
};