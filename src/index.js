/**
 * elFinder transport to support old protocol.
 *
 * @example
 * $('selector').elfinder({
 *   .... 
 *   transport : new elFinderSupportBrowserFs()
 * })
 *
 * @author Wei Ouyang
 **/
import {api} from './api.js';

function guidGenerator() {
    var S4 = function() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

let baseURL = location.pathname;
if(baseURL.endsWith('.html')){
	const tmp = baseURL.split('/')
	baseURL = tmp.slice(0, tmp.length-1).join('/') + '/'
}
const clientId = guidGenerator()
const CONNECTOR_URL = '/connector'
function initializeServiceWorker(){
	if ('serviceWorker' in navigator) {
		// Register the worker and show the list of quotations.
		if (!navigator.serviceWorker.controller) {
			navigator.serviceWorker.oncontrollerchange = function() {
				this.controller.onstatechange = function() {
					if (this.state === 'activated') {
						console.log('Service worker successfully activated.')
						setupCommunication();
					}
				};
			};
			navigator.serviceWorker.register(baseURL + 'service-worker.js').then(function(registration) {
				console.log('Service worker successfully registered, scope is:', registration.scope);
			})
			.catch(function(error) {
				console.log('Service worker registration failed, error:', error);
			});
		}
		else{
			console.log('Service worker was activated.')
			setupCommunication()
		}
	} else {
		console.log('Service workers are not supported.');
	}
}


const routes = [
	{path: `${baseURL}${clientId}/:route`, type: 'get'},
	{path: `${baseURL}${clientId}/:route`, type: 'post'}
]

api.config.roots = [
{
    url: `${baseURL}${clientId}/home/`,       //Required
    path: "/home",   //Required
    permissions: { read:1, write: 1, lock: 0 }
},
{
    url: `${baseURL}${clientId}/tmp/`,   //Required
    path: "/tmp",   //Required
    permissions: { read:1, write: 1, lock: 0 }
}]

api.config.volumes = api.config.roots.map( (r)=>r.path );
api.config.tmbroot = '/tmp/.tmb';
api.config.tmburl = `${baseURL}${clientId}/tmp/.tmb/`;

function decodeQuery(param){
	param = new URLSearchParams(param)
	const opts = {}
	for(let p of Array.from(param.entries())){
		if(opts[p[0]]){
			if(!Array.isArray(opts[p[0]]))
				opts[p[0]] = [opts[p[0]], p[1]]
			else{
				opts[p[0]].push(p[1])
			}
		}
		else{
			if(p[0].endsWith('[]'))
				opts[p[0]] = [p[1]]
			else
				opts[p[0]] = p[1]
		}
	}
	return opts
}

function handleFile({filePath, offset, length}){
	return new Promise((resolve, reject)=>{
		api.fs.open(filePath, 'r', function(e, fd) {
			if(e){
				reject(e)
				return
			}
			const output = new Uint8Array(length);
			api.fs.read(fd, output, 0, length, offset, function(e, bytesRead, output) {
				if(e){
					reject(e)
					return
				}
				resolve(output)
			});
		});
	})
}

async function handleRequest(request){
	let path;
	if(request.route.path === `${baseURL}${clientId}/:route`){
		const route = decodeURIComponent('/' + request.parameters.route)
		if(route.startsWith('/connector')){
			let opts;
			if(request.body){
				opts = decodeQuery(request.body)
			}
			else{
				opts = decodeQuery(route.split('?')[1])
			}
			// convert `targets[]` to `target`
			for(let k of Object.keys(opts)){
				if(k.endsWith('[]')){
					opts[k.slice(0, k.length-2)] = opts[k]
					delete opts[k]
				}
			}

			try{
				if(opts.cmd ==='file'){
					return await api.file(opts)
				}
				else if(opts.cmd ==='put'){
					const response = await api.put(opts)
					return {body: JSON.stringify(response), status: 200}
				}
				else{
					return {body: JSON.stringify(await api[opts.cmd](opts)), status: 200}
				}
			}
			catch(e){
				console.error(e)
				return {error: `${e}`}
			}
		}
		else{
			path = `${route.split('?')[0]}`
		}
	}

	if(path){
		try{
			const bytes = await api.fs.readFile(path)
			const file = new File([bytes.buffer], api.path.basename(path), {
				type: api.mime.getType(path) || 'application/octet-stream',
			});
			return {body: file, status: 200}
		}
		catch(e){
			console.error(e)
			return {error: `${e}`}
		}
	}
	return {error: 'Not found', status: 404}
}

function setupCommunication(){
	
	const messageChannel = new MessageChannel();
	// First we initialize the channel by sending
	// the port to the Service Worker (this also
	// transfers the ownership of the port)
	navigator.serviceWorker.controller.postMessage({
		type: 'INIT_PORT',
		clientId,
	}, [messageChannel.port2]);
	// Listen to the requests
	messageChannel.port1.onmessage = (event) => {
		if(event.data.type === 'REQUEST' && event.data.clientId ===clientId ){
			const requestId = event.data.requestId
			const request = event.data.request
			if(request.filePath){
				handleFile(request).then((response)=>{
					navigator.serviceWorker.controller.postMessage({
						type: 'RESPONSE',
						clientId,
						requestId,
						response
					});
				})
			}
			else{
				handleRequest(request).then((response)=>{
					navigator.serviceWorker.controller.postMessage({
						type: 'RESPONSE',
						clientId,
						requestId,
						response
					});
				})
			}
			
		}
	};

	navigator.serviceWorker.controller.postMessage({
		type: 'REGISTER',
		clientId,
		routes
	});

	window.addEventListener("beforeunload", function (e) {
		console.log('=======>DISPOSE_PORT')
		debugger
		navigator.serviceWorker.controller.postMessage({
			type: 'DISPOSE_PORT',
			clientId
		});
		return undefined;
	});
}



window.elFinderSupportBrowserFs = function(upload) {
	"use strict";
	initializeServiceWorker();

	this.parseFiles = function(fm, target, files){
		const dfrd = $.Deferred();
		files.done(function(result) { // result: [files, paths, renames, hashes, mkdirs]
			const cnt = result[0].length;
			let multiMax=-1;
			if (cnt) {
				if (result[4] && result[4].length) {
					// ensure directories
					fm.request({
						data   : {cmd : 'mkdir', target : target, dirs : result[4]},
						notify : {type : 'mkdir', cnt : result[4].length},
						preventFail: true
					})
					.fail(function(error) {
						error = error || ['errUnknown'];
						if (error[0] === 'errCmdParams') {
							multiMax = 1;
						} else {
							multiMax = 0;
							dfrd.reject(error);
						}
					})
					.done(function(data) {
						var rm = false;
						if (!data.hashes) {
							data.hashes = {};
						}
						result[1] = $.map(result[1], function(p, i) {
							result[0][i]._relativePath = p.replace(/^\//, '');
							p = p.replace(/\/[^\/]*$/, '');
							if (p === '') {
								return target;
							} else {
								if (data.hashes[p]) {
									return data.hashes[p];
								} else {
									rm = true;
									result[0][i]._remove = true;
									return null;
								}
							}
						});
						if (rm) {
							result[0] = $.grep(result[0], function(file) { return file._remove? false : true; });
						}
					})
					.always(function(data) {
						dfrd.resolve(result);
					});
					return;
				} else {
					result[1] = $.map(result[1], function() { return target; });
				}

				dfrd.resolve(result);
			} else {
				dfrd.reject(['errUploadNoFiles']);
			}
		}).fail(function(){
			dfrd.reject();
		});
		return dfrd;
	}
	this.upload = function(data){
		const self = this.fm;
		const dfrd = $.Deferred();

		
		const target = data.target || self.cwd().hash;
		const files       = data.input ? data.input.files : self.uploads.checkFile(data, self, target)
		data.progress = (progress)=>{
			self.notify({type : 'upload', cnt : 0, progress, size : 0});
		}
		function saveFiles(opts){
			api.upload(opts).then((data)=>{
				self.uploads.xhrUploading = false;
				if (data) {
					self.currentReqCmd = 'upload';
					data.warning && console.warn(data.warning);
					self.updateCache(data);
					data.removed && data.removed.length && self.remove(data);
					data.added   && data.added.length   && self.add(data);
					data.changed && data.changed.length && self.change(data);
					self.trigger('upload', data, false);
					self.trigger('uploaddone');
					if (data.toasts && Array.isArray(data.toasts)) {
						$.each(data.toasts, function() {
							this.msg && self.toast(this);
						});
					}
					data.sync && self.sync();
					if (data.debug) {
						self.responseDebug(data);
						fm.debug('backend-debug', data);
					}
				}
				dfrd.resolve(data);
			}).catch((error)=>{
				console.error(error)
				dfrd.reject(error);
			})
		}

		if(files.done){
			this.parseFiles(self, target, files).done((result)=>{
				saveFiles({files: result[0], targets: result[1], renames: result[2], hashes: result[3]})
			})
		}
		else{
			saveFiles({targets: files.map(()=>target), files: files})
		}
		return dfrd
	};
	
	this.init = function(fm) {
		this.fm = fm;
		this.fm.options.url = `${baseURL}${clientId}${CONNECTOR_URL}`;
	};

	console.log(api)
	
	
	this.send = function(opts) {
		const dfrd = $.Deferred();
		dfrd.abort = function() {};
		
		const query = decodeQuery(opts.url.split('?')[1])
		if(query) Object.assign(opts.data, query)
		const cmd = opts.data.cmd;
		if(cmd === 'get' || cmd === 'file'){
			const xhr = $.ajax(opts)
			.fail(function(error) {
				dfrd.reject(error);
			})
			.done(function(raw) {
				dfrd.resolve(raw);
			});
			dfrd.abort = function() {
				if (xhr && xhr.state() == 'pending') {
					xhr.quiet = true;
					xhr.abort();
				}
			};
		}
		else{
			api[cmd](opts.data).then((result)=>{
				dfrd.resolve(result);
			}).catch((error)=>{
				console.error(error)
				dfrd.reject(error);
			})
		}
		return dfrd;
	};
};
