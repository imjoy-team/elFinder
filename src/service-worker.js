/* eslint no-unused-vars: 0 */
/* global importScripts, ServiceWorkerWare */
import { ServiceWorkerWare } from "./service-worker-ware.js"
import { api as elfinder_api, parseFile, writeFile } from './elfinder-api.js';
import packageInfo from '../package.json';

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

function normalizeRange(range, size) {
  let [start, end] = range.replace(/bytes=/, "").split("-")
  start = parseInt(start, 10);
  end = end ? parseInt(end, 10) : (size - 1);
  if (!isNaN(start) && isNaN(end)) {
    end = size - 1;
  }
  if (isNaN(start) && !isNaN(end)) {
    start = size - end;
    end = size - 1;
  }
  if (start >= size || end >= size) {
    throw new Error("Invalid range")
  }
  return { offset: start, start, end, length: end - start + 1 }
}

async function handleRequest(route, request) {
  const route_path = decodeURIComponent('/' + request.parameters.route)
  if (route.path === `${baseURL}fs/:route`) {
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
        if(!opts.cmd) opts.cmd = "upload" // it can be put or upload
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
      if(!opts.cmd) return { status: 200 }
      try {
        if (opts.cmd === 'file') {
          opts.range = request.headers.get("range")
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
      if (route.type === 'get' || route.type === 'head') {
        try {
          const contentType = elfinder_api.mime.getType(path) || 'application/octet-stream';
          const size = (await elfinder_api.fs.lstat(path)).size;
          if(route.type === 'head'){
            return {
              headers: {
                "Content-Length": size,
                "Content-Type": contentType
              }, status: 200
            }
          }
          const range = request.headers.get("range");
          if (range) {
            const normalizedRange = normalizeRange(range, size)
            const data = await handleFile({ filePath: path, offset: normalizedRange.offset, length: normalizedRange.length })
            const file = new File([data], elfinder_api.path.basename(path), {
              type: contentType,
            });
            return {
              body: file, headers: {
                "Content-Range": `bytes ${normalizedRange.start}-${normalizedRange.end}/${size}`,
                "Accept-Ranges": "bytes",
                "Content-Length": normalizedRange.length,
                "Content-Type": contentType
              }, status: 206
            }
          }
          else {
            const bytes = await elfinder_api.fs.readFile(path)
            const file = new File([bytes.buffer], elfinder_api.path.basename(path), {
              type: contentType,
            });
            return {
              body: file, headers: {
                "Content-Type": contentType,
                "Content-Length": size,
              }, status: 200
            }
          }
        }
        catch (e) {
          console.error(e)
          return { error: `${e}` }
        }
      }
      else if(route.type === 'post'){
        // A post request requires a form with the following fields in a form:
        // * file: a file for uploading
        // * append: append to the file
        // And the url should be something like: /fs/path/to/the/file
        let opts = decodeQuery(route_path.split('?')[1])
        const formData = await request.formData()
        for (let key of formData.keys()) {
            opts[key] = formData.get(key)
        }
        const exists = await elfinder_api.fs.exists(path);
        if(!opts.file){
          return {body: "File key not found", status: 400}
        }
        try{
          
          if(opts.append && exists){
            await parseFile(opts.file, (chunk, offset) => {
              return new Promise((resolve, reject) => {
                elfinder_api.fs.appendFile(path, new Uint8Array(chunk), {}, (error) => {
                  if (error) reject(error)
                  else resolve()
                })
              })
            })
          }
          else{
            await writeFile(path, opts.file, 0, 'w')
          }
          return { body: JSON.stringify({success: true}), status: 200 }
        }
        catch(e){
          return { body: `Failed to save file (${path}): ${e}`, status: 500 }
        }
      }
    }
  }
  else if (route.path === `${baseURL}ls/:route`) {
    if (route.type === 'get' || route.type === 'head') {
      const absPath = `${route_path.split('?')[0]}`
      const contentType = 'application/json';
      let absStat;
      try{
        absStat = await elfinder_api.fs.stat(absPath);
      } catch(e){
        return { error: `Not found: ${e}`, status: 404 }
      }
      
      let body = null;
      if(absStat.isDirectory()){
        const paths = await elfinder_api.fs.readdir(absPath);
        const files = [];
        for (let file of paths) {
          const childPath = `${absPath}/${file}`;
          const stat = await elfinder_api.fs.stat(childPath);
          files.push({
            'type': stat.isDirectory()?'directory': 'file',
            'name': file,
            'size': stat.size,
          });
        }
        body = JSON.stringify(
          {
            "type": "directory",
            "path": absPath,
            "name": absPath.replace(/^.*[\\\/]/, ''),
            "children": files
          }
        )
      }
      else{
        body = JSON.stringify(
          {
            "type": "file",
            "path": absPath,
            "name": absPath.replace(/^.*[\\\/]/, '')
          }
        )
      }
      if(route.type === 'head'){
        return {
          headers: {
            "Content-Length": body.length,
            "Content-Type": contentType
          }, status: 200
        }
      }
      else{
        return {
          body,
          headers: {
            "Content-Length": body.length,
            "Content-Type": contentType
          }, status: 200
        }
      }
    }
    else{
      return { error: 'Not found', status: 404 }
    }
  }

  return { error: 'Not found', status: 404 }
}



const worker = new ServiceWorkerWare();
const routes = [
  { path: `${baseURL}ls/:route`, type: 'head' },
  { path: `${baseURL}ls/:route`, type: 'get' },
  { path: `${baseURL}fs/:route`, type: 'head' },
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
          let range = response.range
          if (range) {
            range = normalizeRange(range, response.size)
          }
          async function* generator() {
            let start = 0
            let end = response.size - 1;
            if (range) {
              start = range.offset;
              end = start + range.length - 1;
            }
            while (start <= end) {
              const length = Math.min(end - start + 1, response.chunkSize || 10240)
              const data = await handleFile({ filePath: response.file, start, length })
              start = start + data.byteLength
              yield data
              if (start > end) {
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
          if (range) {
            const start = range.offset;
            const end = start + range.length - 1;
            response.headers["Content-Range"] = `bytes ${start}-${end}/${response.size}`;
            response.headers["Accept-Ranges"] = "bytes";
            response.headers["Content-Length"] = range.length;
            response.status = 206;
          }
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

console.log(`Service worker file system is running (${packageInfo.version})`)
