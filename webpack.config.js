const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require("copy-webpack-plugin");
const { dirname } = require('path-browserify');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const fs = require('fs');

// Build comment with version and date
function buildComment() {
  const versionContent = fs.readFileSync(path.join(__dirname, 'js', 'elFinder.version.js')).toString();
  const version = versionContent.match(/elFinder.prototype.version = '(.+)';/)[1];
  const d = new Date();
  const buildDate = d.getFullYear() + '-' +
      (d.getMonth() >= 9 ? '' : '0') + (d.getMonth() + 1) + '-' +
      (d.getDate() >= 10 ? '' : '0') + d.getDate();
  const comment =
      '/*!\n' +
      ' * elFinder - file manager for web\n' +
      ' * Version ' + version + ' (' + buildDate + ')\n' +
      ' * http://elfinder.org\n' +
      ' * \n' +
      ' * Copyright 2009-' + d.getFullYear() + ', Studio 42\n' +
      ' * Licensed under a 3-clauses BSD license\n' +
      ' */\n';
  return comment;
}

// List files in a directory with a pattern
function listFiles(dir, pattern) {
  return fs.readdirSync(dir)
    .filter(file => file.match(pattern))
    .map(file => path.join(dir, file));
}

// Get the list of JS files in a specific order
function getJsFiles(forMinimal = false) {
  const baseFiles = [
    path.join(__dirname, 'js', 'elFinder.js'),
    path.join(__dirname, 'js', 'elFinder.version.js'),
    path.join(__dirname, 'js', 'jquery.elfinder.js'),
    path.join(__dirname, 'js', 'elFinder.options.js'),
    path.join(__dirname, 'js', 'elFinder.history.js'),
    path.join(__dirname, 'js', 'elFinder.command.js'),
    path.join(__dirname, 'js', 'elFinder.resources.js'),
    path.join(__dirname, 'js', 'jquery.dialogelfinder.js'),
    path.join(__dirname, 'js', 'i18n', 'elfinder.en.js')
  ];

  if (!forMinimal) {
    baseFiles.splice(3, 0, path.join(__dirname, 'js', 'elFinder.mimetypes.js'));
    baseFiles.splice(5, 0, path.join(__dirname, 'js', 'elFinder.options.netmount.js'));
  }

  const uiFiles = forMinimal
    ? listFiles(path.join(__dirname, 'js', 'ui'), '(button|contextmenu|cwd|dialog|navbar|navdock|overlay|panel|path|searchbutton|sortbutton|stat|toast|toolbar|tree|uploadbutton|viewbutton|workzone)\\.js$')
    : listFiles(path.join(__dirname, 'js', 'ui'), '\\.js$');

  const commandFiles = forMinimal
    ? listFiles(path.join(__dirname, 'js', 'commands'), '(colwidth|copy|cut|duplicate|getfile|help|open|mkdir|paste|restore|rm|search|sort|upload|view)\\.js$')
    : listFiles(path.join(__dirname, 'js', 'commands'), '\\.js$');

  return baseFiles.concat(uiFiles).concat(commandFiles);
}

// Get the list of CSS files
function getCssFiles() {
  return listFiles(path.join(__dirname, 'css'), '\\.css$')
    .filter(file => !file.includes('theme.css'));
}

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';
  const comment = buildComment();
  
  // Generate JS concat content with UMD wrapper
  const elfinderJsContent = `${comment}
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD
    define(['jquery','jquery-ui'], factory);
  } else if (typeof exports !== 'undefined') {
    // CommonJS
    var $, ui;
    try {
      $ = require('jquery');
      ui = require('jquery-ui');
    } catch (e) {}
    module.exports = factory($, ui);
  } else {
    // Browser globals (Note: root is window)
    factory(root.jQuery, root.jQuery.ui, true);
  }
}(this, function($, _ui, toGlobal) {
toGlobal = toGlobal || false;

${getJsFiles().map(file => 
  `\n\n/*\n * File: ${path.relative(__dirname, file)}\n */\n\n${fs.readFileSync(file, 'utf8').replace(/"use strict"\;?\n?/g, '')}`
).join('')}

return elFinder;
}));`;

  // Generate JS minimal concat content with UMD wrapper
  const elfinderMinimalJsContent = `${comment}
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD
    define(['jquery','jquery-ui'], factory);
  } else if (typeof exports !== 'undefined') {
    // CommonJS
    var $, ui;
    try {
      $ = require('jquery');
      ui = require('jquery-ui');
    } catch (e) {}
    module.exports = factory($, ui);
  } else {
    // Browser globals (Note: root is window)
    factory(root.jQuery, root.jQuery.ui, true);
  }
}(this, function($, _ui, toGlobal) {
toGlobal = toGlobal || false;

${getJsFiles(true).map(file => 
  `\n\n/*\n * File: ${path.relative(__dirname, file)}\n */\n\n${fs.readFileSync(file, 'utf8').replace(/"use strict"\;?\n?/g, '')}`
).join('')}

return elFinder;
}));`;

  // Generate CSS concat content
  const elfinderCssContent = `${comment}
${getCssFiles().map(file => 
  `\n/* File: ${path.relative(__dirname, file)} */\n${fs.readFileSync(file, 'utf8')}`
).join('\n')}`;

  // Ensure directories exist
  const outputDir = path.resolve(__dirname, 'elfinder_client');
  ['css', 'js', 'js/extras', 'js/i18n', 'js/worker', 'js/proxy', 'img', 'sounds', 'php', 'files', 'files/.trash'].forEach(dir => {
    const fullDir = path.join(outputDir, dir);
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }
  });

  // Write concat files
  fs.writeFileSync(path.join(outputDir, 'js', 'elfinder.full.js'), elfinderJsContent);
  fs.writeFileSync(path.join(outputDir, 'js', 'elfinder-minimal.full.js'), elfinderMinimalJsContent);
  fs.writeFileSync(path.join(outputDir, 'css', 'elfinder.full.css'), elfinderCssContent);

  // Create elfinder contents for service worker
  fs.writeFileSync(path.join(__dirname, 'src', 'elfinder.contents.js'), 
  `/* Auto-generated elFinder contents for service worker */
  export default ${JSON.stringify({
    version: getJsFiles().length,
    netmountDrivers: {},
  })};`);

  const config = {
    entry: {
      'elFinderSupportBrowserFS': './src/index.js',
      'service-worker': path.join(__dirname, 'src/service-worker.js'),
    },
    mode: argv.mode || 'development',
    devtool: isDev ? 'source-map' : false,
    output: {
      filename: '[name].js',
      path: outputDir,
      sourceMapFilename: '[file].map',
      devtoolModuleFilenameTemplate: 'webpack://[namespace]/[resource-path]?[loaders]'
    },
    devServer: {
      static: {
        directory: outputDir,
      },
      compress: false,
      port: 3000,
      hot: true,
      watchFiles: [
        'css/**/*.css', 
        'js/**/*.js',
        'src/**/*.js',
        'img/**/*',
        'php/**/*',
        '*.html',
        '*.js'
      ],
      client: {
        overlay: {
          errors: true,
          warnings: false,
        },
        webSocketURL: {
          hostname: 'localhost',
          port: 3000,
        },
      },
      liveReload: true,
    },  
    module: {
      rules: [
        {
          test: /\.m?js$/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
              sourceMaps: true
            }
          }
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
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
        "console": require.resolve("console-browserify"),
        "querystring": require.resolve("querystring-es3")
      },
      alias: {
        elFinder$: path.resolve(__dirname, 'js/elFinder.js'),
        './elfinderImport.js': path.resolve(__dirname, 'src/elfinderImport.js'),
      }
    },  
    optimization: {
      minimize: !isDev,
      minimizer: [
        new TerserPlugin({
          extractComments: false,
          exclude: [/\.html\.js$/],  // Exclude HTML help files
          terserOptions: {
            format: {
              preamble: comment,
            },
          },
        }),
        new CssMinimizerPlugin({
          minimizerOptions: {
            preset: [
              'default',
              {
                discardComments: { removeAll: true },
              },
            ],
          },
        }),
      ],
    },
    plugins: [
      new webpack.ProvidePlugin({
        process: 'process/browser',
      }),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
      new webpack.ProvidePlugin({
        elFinder: path.resolve(__dirname, 'js/elFinder.js'),
      }),
      new MiniCssExtractPlugin({
        filename: 'css/elfinder.min.css',
      }),
      new webpack.BannerPlugin({
        banner: comment,
        raw: true,
      }),
      new CopyPlugin({
        patterns: [
          // JavaScript files and folders
          { from: "js/extras", to: "js/extras" },
          { from: "js/worker", to: "js/worker" },
          { from: "js/proxy", to: "js/proxy" },
          { from: "js/i18n", to: "js/i18n" },
          { from: "js/elFinder.js", to: "js" },
          { from: "js/elFinder.version.js", to: "js" },
          { from: "js/elFinder.options.js", to: "js" },
          { from: "js/elFinder.options.netmount.js", to: "js" },
          { from: "js/elFinder.resources.js", to: "js" },
          { from: "js/elFinder.command.js", to: "js" },
          
          // Theme CSS
          { from: "css/theme.css", to: "css" },
          
          // Assets
          { from: "img", to: "img" },
          { from: "sounds", to: "sounds" },
          
          // PHP files
          { from: "php", to: "php" },
          
          // Other files
          { from: "files/.gitignore", to: "files" },
          { from: "files/.trash/.gitignore", to: "files/.trash" },
          { from: "CNAME", to: "" },
          { from: "Changelog", to: "" },
          { from: "LICENSE.md", to: "" },
          { from: "README.md", to: "" },
          { from: "composer.json", to: "" },
          { from: "__init__.py", to: "" },
          { from: "elfinder.html", to: "" },
          { from: "elfinder.legacy.html", to: "" },
          { from: "index.html", to: "" },
          { from: "main.default.js", to: "" },
          { from: "package.json", to: "" },
        ],
      }),
      // Custom plugin to generate minified files after build
      {
        apply: (compiler) => {
          compiler.hooks.afterEmit.tap('MinifyPlugin', () => {
            // Use terser to minify JS files
            const terser = require('terser');
            const cssMinimizer = require('csso');
            
            // Minify elfinder.full.js
            const jsFullPath = path.join(outputDir, 'js', 'elfinder.full.js');
            const jsMinPath = path.join(outputDir, 'js', 'elfinder.min.js');
            const jsFullContent = fs.readFileSync(jsFullPath, 'utf8');
            terser.minify(jsFullContent).then(result => {
              fs.writeFileSync(jsMinPath, comment + result.code);
            });
            
            // Minify elfinder-minimal.full.js
            const jsMinimalFullPath = path.join(outputDir, 'js', 'elfinder-minimal.full.js');
            const jsMinimalMinPath = path.join(outputDir, 'js', 'elfinder-minimal.min.js');
            const jsMinimalFullContent = fs.readFileSync(jsMinimalFullPath, 'utf8');
            terser.minify(jsMinimalFullContent).then(result => {
              fs.writeFileSync(jsMinimalMinPath, comment + result.code);
            });
            
            // Minify extras
            const extrasDir = path.join(outputDir, 'js', 'extras');
            fs.readdirSync(extrasDir)
              .filter(file => file.match(/\.js$/) && !file.match(/\.min\.js$/))
              .forEach(file => {
                const filePath = path.join(extrasDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const minPath = path.join(extrasDir, file.replace(/\.js$/, '.min.js'));
                terser.minify(content).then(result => {
                  fs.writeFileSync(minPath, result.code);
                });
              });
            
            // Minify CSS
            const cssFullPath = path.join(outputDir, 'css', 'elfinder.full.css');
            const cssMinPath = path.join(outputDir, 'css', 'elfinder.min.css');
            const cssFullContent = fs.readFileSync(cssFullPath, 'utf8');
            const cssMinified = cssMinimizer.minify(cssFullContent);
            fs.writeFileSync(cssMinPath, comment + (cssMinified.css || cssMinified));
          });
        }
      }
    ],
  };

  return config;
};
