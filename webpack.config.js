const path = require('path');
const webpack = require('webpack');

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
    })
  ]
};