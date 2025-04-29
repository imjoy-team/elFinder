/**
 * This file simply exports the elFinder object for use in imports
 */

// Define window if not exists (for service worker context)
if (typeof window === 'undefined') {
  global.window = {};
  global.jQuery = {
    fn: {},
    extend: function() {},
    proxy: function() {},
    trim: function(str) { return str ? str.trim() : ''; },
    isFunction: function(obj) { return typeof obj === 'function'; },
    isPlainObject: function(obj) {
      return obj !== null && typeof obj === 'object' && obj.constructor === Object;
    }
  };
  global.$ = global.jQuery;
}

// Create a dummy elFinder object with the needed structure for initialize
const elFinder = function() {};
elFinder.prototype = {
  version: '2.1.62',
  commands: {
    netmount: {
      drivers: {}
    }
  }
};

// Export elFinder
export default elFinder; 