const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require("copy-webpack-plugin");
const { dirname } = require('path-browserify');
module.exports = {
  entry: {
    'elFinderSupportBrowserFS': './src/index.js',
    'service-worker': path.join(__dirname, 'src/service-worker.js'),
  },
  mode: 'development',
  devtool: "source-map",
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'elfinder_client'),
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'elfinder_client/'),
    },
    compress: false,
    port: 4000,
  },  
  module: {
    rules: [
      {
        test: /\.m?js$/,
        // Remove this line if it exists in your current config
        // exclude: /(node_modules|bower_components)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ],
  },
  resolve: {
    fallback: { 
      "fs": false,
      "assert": require.resolve("assert/"),
      "stream": require.resolve("stream-browserify"),
      "path": require.resolve("path-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "util": require.resolve("util/"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "url": require.resolve("url/"),
      "querystring": require.resolve("querystring-es3")
    }
  },  
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
  ]
};
