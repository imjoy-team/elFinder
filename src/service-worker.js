/* eslint no-unused-vars: 0 */
/* global importScripts, ServiceWorkerWare */
importScripts('./js/lib/ServiceWorkerWare.js');

let getVersionPort=null;
const requestPool = {};
const worker = new ServiceWorkerWare();

self.addEventListener("message", event => {
  if (event.data && event.data.type === 'INIT_PORT') {
    getVersionPort = event.ports[0];
    const routes = event.data.routes || []
    for(let route of routes){
      worker[route.type](route.path, async function(req) {
        try{
          const response = await makeRequest({route, parameters: req.parameters, body: req.body})
          return new Response(response.body, {status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {}});
        }
        catch(e){
          return new Response(`${e}`, {status: response.status || 500, statusText: response.statusText || 'ERROR'})
        }
      });
    }
  }
  else if (event.data && event.data.type === 'RESPONSE') {
    // getVersionPort.postMessage({ payload: ++count });
    if(event.data.requestId && requestPool[event.data.requestId]){
      const promise = requestPool[event.data.requestId]
      delete requestPool[event.data.requestId]
      if(event.data.response.error)
        promise.reject(event.data.response.error)
      else
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

worker.get('/status', async function(req, res) {
  return new Response("Ready", {status: 200, statusText: 'OK'});
});


// Start the service worker.
worker.init();

console.log("In-browser proxy server is running ")
