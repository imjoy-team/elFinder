/* eslint no-unused-vars: 0 */
/* global importScripts, ServiceWorkerWare */
const baseURL = (function() {
  var tokens = (self.location + '').split('/');
  tokens[tokens.length - 1] = '';
  return tokens.join('/');
})();

importScripts(baseURL + 'js/lib/ServiceWorkerWare.js');

let getVersionPort=null;
const requestPool = {};
const routeRegistry = {};
const worker = new ServiceWorkerWare();

self.addEventListener("message", event => {
  if (event.data && event.data.type === 'INIT_PORT') {
    getVersionPort = event.ports[0];
    const clientId = event.data.clientId;
    routeRegistry[clientId] = {}
   
  }
  else if(event.data && event.data.type === 'REGISTER'){
    const routes = event.data.routes || []
    const clientId = event.data.clientId;
    for(let route of routes){
      worker[route.type](baseURL+clientId+route.path, async function(req) {
        try{
          const response = await makeRequest(clientId, {route, parameters: req.parameters, body: req.body})
          if(response.error){
            return new Response(`${response.error}`, {status: response.status || 500, statusText: response.statusText || 'ERROR'})
          }
          return new Response(response.body, {status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {}});
        }
        catch(e){
          console.error(e)
        }
      });
    }
  }
  else if (event.data && event.data.type === 'RESPONSE') {
    // getVersionPort.postMessage({ payload: ++count });
    if(event.data.requestId && requestPool[event.data.requestId]){
      const promise = requestPool[event.data.requestId]
      delete requestPool[event.data.requestId]
      promise.resolve(event.data.response)
    }
  }
})

function makeRequest(clientId, request){
  return new Promise((resolve, reject)=>{
    if(!getVersionPort) throw new Error("API communication is not initialized.")
    const requestId = `${Date.now()}`;
    requestPool[requestId] = {resolve, reject}
    //TODO: implement timeout for requests
    getVersionPort.postMessage({ type: 'REQUEST', requestId: requestId, request, clientId });
  })
}

worker.get('/status', async function(req, res) {
  return new Response("Ready", {status: 200, statusText: 'OK'});
});


// Start the service worker.
worker.init();

console.log("In-browser proxy server is running ")
