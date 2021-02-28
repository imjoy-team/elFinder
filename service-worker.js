/* eslint no-unused-vars: 0 */
/* global importScripts, ServiceWorkerWare */
importScripts('./js/lib/ServiceWorkerWare.js');

let getVersionPort=null;
const requestPool = {};
self.addEventListener("message", event => {
  console.log('======>message', event.data)
  if (event.data && event.data.type === 'INIT_PORT') {
    getVersionPort = event.ports[0];
  }

  if (event.data && event.data.type === 'RESPONSE') {
    // getVersionPort.postMessage({ payload: ++count });
    if(event.data.requestId && requestPool[event.data.requestId]){
      const promise = requestPool[event.data.requestId]
      delete requestPool[event.data.requestId]
      promise.resolve(event.data.response)
    }
  }
})

function makeRequest(request){
  return new Promise((resolve, reject)=>{
    if(!getVersionPort) throw new Error("API communication is not initialized.")
    const requestId = `${Date.now()}`;
    requestPool[requestId] = {resolve, reject}
    //TODO: implement timeout for requests
    getVersionPort.postMessage({ type: 'REQUEST', requestId: requestId, request });
  })
}

// List of the default quotations.
var quotations = [
  {
    text: 'Humanity is smart. Sometime in the technology world we think' +
    'we are smarter, but we are not smarter than you.',
    author: 'Mitchell Baker'
  },
  {
    text: 'A computer would deserve to be called intelligent if it could ' +
    'deceive a human into believing that it was human.',
    author: 'Alan Turing'
  },
  {
    text: 'If you optimize everything, you will always be unhappy.',
    author: 'Donald Knuth'
  },
  {
    text: 'If you don\'t fail at least 90 percent of the time' +
    'you\'re not aiming high enough',
    author: 'Alan Kay'
  },
  {
    text: 'Colorless green ideas sleep furiously.',
    author: 'Noam Chomsky'
  }
].map(function(quotation, index) {
  // Add the id and the sticky flag to make the default quotations non removable.
  quotation.id = index + 1;
  quotation.isSticky = true;

  return quotation;
});

// Determine the root for the routes. I.e, if the Service Worker URL is
// `http://example.com/path/to/sw.js`, then the root is
// `http://example.com/path/to/`
var root = (function() {
  var tokens = (self.location + '').split('/');
  tokens[tokens.length - 1] = '';
  return tokens.join('/');
})();


// By using Mozilla's ServiceWorkerWare we can quickly setup some routes
// for a _virtual server_. Compare this code with the one from the
// [server side in the API analytics recipe](/api-analytics_server_doc.html).
var worker = new ServiceWorkerWare();

worker.get(root + 'files/:filename', async function(req, res) {
  var filename = req.parameters.filename
  const response = await makeRequest(filename)
  return new Response(response, {status: 200, statusText: 'OK'});
});



// Returns an array with all quotations.
worker.get(root + 'api/quotations', function(req, res) {
  return new Response(JSON.stringify(quotations.filter(function(item) {
    return item !== null;
  })));
});

// Delete a quote specified by id. The id is the position in the collection
// of quotations (the position is 1 based instead of 0).
worker.delete(root + 'api/quotations/:id', function(req, res) {
  var id = parseInt(req.parameters.id, 10) - 1;
  if (!quotations[id].isSticky) {
    quotations[id] = null;
  }
  return new Response({ status: 204 });
});

// Add a new quote to the collection.
worker.post(root + 'api/quotations', function(req, res) {
  return req.json().then(function(quote) {
    quote.id = quotations.length + 1;
    quotations.push(quote);
    return new Response(JSON.stringify(quote), { status: 201 });
  });
});

// Start the service worker.
worker.init();

console.log("In-browser proxy server running at " + root)
