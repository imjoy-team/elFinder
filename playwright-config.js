// playwright.config.js
module.exports = {
    webServer: {
      command: 'npm run serve', // use your existing serve command
      port: 4000,
      timeout: 120 * 1000,
    },
  };
  