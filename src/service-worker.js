/* eslint no-unused-vars: 0 */
/* global importScripts, ServiceWorkerWare */
import { ServiceWorkerWare } from "./service-worker-ware.js"
import { api as elfinder_api } from './elfinder-api.js';

const baseURL = (function () {
  var tokens = (self.location + '').split('/');
  tokens[tokens.length - 1] = '';
  return tokens.join('/');
})();


elfinder_api.initialize(baseURL)

function handleFile({ filePath, offset, length }) {
  return new Promise((resolve, reject) => {
    elfinder_api.fs.open(filePath, 'r', function (e, fd) {
      if (e) {
        reject(e)
        return
      }
      const output = new Uint8Array(length);
      elfinder_api.fs.read(fd, output, 0, length, offset, function (e, bytesRead, output) {
        if (e) {
          reject(e)
          return
        }
        resolve(output)
      });
    });
  })
}

function decodeQuery(param) {
  param = new URLSearchParams(param)
  const opts = {}
  for (let p of Array.from(param.entries())) {
    if (opts[p[0]]) {
      if (!Array.isArray(opts[p[0]]))
        opts[p[0]] = [opts[p[0]], p[1]]
      else {
        opts[p[0]].push(p[1])
      }
    }
    else {
      if (p[0].endsWith('[]'))
        opts[p[0]] = [p[1]]
      else
        opts[p[0]] = p[1]
    }
  }
  return opts
}

async function handleRequest(route, request) {
  if (route.path === `${baseURL}fs/:route`) {
    const route_path = decodeURIComponent('/' + request.parameters.route)
    if (route_path.startsWith('/connector')) {
      let opts = decodeQuery(route_path.split('?')[1])
      if (route.type === 'post') {
        const formData = await request.formData()
        for (let key of formData.keys()) {
          if (key.endsWith('[]'))
            opts[key] = formData.getAll(key)
          else
            opts[key] = formData.get(key)
        }
        opts.cmd = "upload"
      }
      else if (Object.keys(opts).length === 0) {
        const body = await request.text()
        opts = decodeQuery(body)
      }

      // convert `targets[]` to `target`
      for (let k of Object.keys(opts)) {
        if (k.endsWith('[]')) {
          opts[k.slice(0, k.length - 2)] = opts[k]
          delete opts[k]
        }
      }
      console.log(opts)
      try {
        if (opts.cmd === 'file') {
          return await elfinder_api.file(opts)
        }
        else {
          const response = await elfinder_api[opts.cmd](opts)
          console.log(response)
          return { body: JSON.stringify(response), status: 200 }
        }
      }
      catch (e) {
        console.error(`Failed to call api (${opts.cmd})`, e)
        return { error: `${e}`, status: 500 }
      }
    }
    else {
      const path = `${route_path.split('?')[0]}`
      try {
        const bytes = await elfinder_api.fs.readFile(path)
        const file = new File([bytes.buffer], elfinder_api.path.basename(path), {
          type: elfinder_api.mime.getType(path) || 'application/octet-stream',
        });
        return { body: file, status: 200 }
      }
      catch (e) {
        console.error(e)
        return { error: `${e}` }
      }
    }
  }
  return { error: 'Not found', status: 404 }
}



const worker = new ServiceWorkerWare();
const routes = [
  { path: `${baseURL}fs/:route`, type: 'get' },
  { path: `${baseURL}fs/:route`, type: 'post' }
]

for (let route of routes) {
  worker[route.type](route.path, async function (req) {
    try {

      const response = await handleRequest(route, req)
      if (response.error) {
        return new Response(`${response.error}`, { status: response.status || 500, statusText: response.statusText || 'ERROR' })
      }
      if (response.file) {
        if (response.file instanceof Blob) {
          return new Response(response.file, { status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {} });
        }
        else {
          // we need `chunkSize`: chunk size, `size`: size of the file, `file`: file path
          async function* generator() {
            let offset = 0
            while (offset < response.size) {
              const length = Math.min(response.size - offset, response.chunkSize || 10240)
              const data = await handleFile({ filePath: response.file, offset, length })
              offset = offset + data.byteLength
              yield data
              if (offset >= response.size) {
                break;
              }
            }
          }
          const iterator = generator();
          const stream = new ReadableStream({
            async pull(controller) {
              const { value, done } = await iterator.next();
              if (done) {
                controller.close();
              } else {
                controller.enqueue(value);
              }
            },
          });
          return new Response(stream, { status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {} });
        }
      }
      else
        return new Response(response.body, { status: response.status || 200, statusText: response.statusText || 'OK', headers: response.headers || {} });
    }
    catch (e) {
      console.error(e)
    }
  });
}

worker.get('/status', async function (req, res) {
  return new Response("Ready", { status: 200, statusText: 'OK' });
});


// Start the service worker.
worker.init();

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting()); // Activate worker immediately
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim()); // Become available to all pages
});

console.log("Service worker file system is running ")