/* eslint no-unused-vars: 0 */
/* global importScripts, ServiceWorkerWare */
const baseURL = (function() {
  var tokens = (self.location + '').split('/');
  tokens[tokens.length - 1] = '';
  return tokens.join('/');
})();

importScripts(baseURL + 'js/lib/ServiceWorkerWare.js');

const ports = {};
const requestPool = {};
const routeRegistry = {};
const worker = new ServiceWorkerWare();

self.addEventListener("message", event => {
  if (event.data && event.data.type === 'INIT_PORT') {
    const clientId = event.data.clientId;
    ports[clientId] = event.ports[0];
    routeRegistry[clientId] = {}
  }
  else if(event.data && event.data.type === 'REGISTER'){
    const routes = event.data.routes || []
    const clientId = event.data.clientId;
    for(let route of routes){
      worker[route.type](route.path, async function(req) {
        try{
          const body = await req.text()
          const response = await makeRequest(clientId, {route, parameters: req.parameters, body})
          if(response.error){
            return new Response(`${response.error}`, {status: response.status || 500, statusText: response.statusText || 'ERROR'})
          }
          if(response.file){
            if(response.file instanceof Blob){
              return new Response(response.file, {status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {}});
            }
            else{
              // we need `chunkSize`: chunk size, `size`: size of the file, `file`: file path
              async function* generator(){
                let offset = 0
                while(offset < response.size) {
                  const length = Math.min(response.size - offset, response.chunkSize || 10240)
                  const data = await makeRequest(clientId, {filePath: response.file, offset, length})
                  offset = offset + data.byteLength
                  yield data
                  if(offset >= response.size) {
                    break;
                  }
                }
              }
              const iterator = generator();
              const stream = new ReadableStream({
                async pull(controller){
                    const { value, done } = await iterator.next();
                    if (done) {
                      controller.close();
                    } else {
                      controller.enqueue(value);
                    }
                },
              });
              return new Response(stream, {status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {}});
            }
          }
          else
            return new Response(response.body, {status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {}});
        }
        catch(e){
          console.error(e)
        }
      }, clientId);
    }
  }
  else if(event.data && event.data.type === 'DISPOSE_PORT'){
    const clientId = event.data.clientId;
    delete ports[clientId];
    delete routeRegistry[clientId];
    worker.remove(clientId);
  }
  else if (event.data && event.data.type === 'RESPONSE') {
    if(event.data.requestId && requestPool[event.data.requestId]){
      const promise = requestPool[event.data.requestId]
      delete requestPool[event.data.requestId]
      promise.resolve(event.data.response)
    }
  }
})

function makeRequest(clientId, request){
  return new Promise((resolve, reject)=>{
    if(!ports[clientId]) throw new Error("Communication is not initialized for the client")
    const requestId = `${Date.now()}`;
    requestPool[requestId] = {resolve, reject}
    //TODO: implement timeout for requests
    ports[clientId].postMessage({ type: 'REQUEST', requestId: requestId, request, clientId });
  })
}

worker.get('/status', async function(req, res) {
  return new Response("Ready", {status: 200, statusText: 'OK'});
});


// Start the service worker.
worker.init();

console.log("In-browser proxy server is running ")
