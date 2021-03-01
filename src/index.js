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

const baseURL = location.pathname;
const clientId = guidGenerator()
const CONNECTOR_URL = '/local/connector'
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
	{path: `${baseURL}${clientId}/local/:route`, type: 'get'}
]

api.config.roots = [{
    url: `${baseURL}${clientId}/local/tmp/`,   //Required
    path: "/tmp",   //Required
    permissions: { read:1, write: 1, lock: 0 }
},
{
    url: `${baseURL}${clientId}/local/home/`,       //Required
    path: "/home",   //Required
    permissions: { read:1, write: 1, lock: 0 }
}]

api.config.volumes = api.config.roots.map( (r)=>r.path );
api.config.tmbroot = '/tmp/.tmb';

async function handleRequest(request){
	let path;
	if(request.route.path === '/local/:route'){
		const route = '/' + request.parameters.route
		if(route.startsWith('/connector')){
			let param = decodeURIComponent(route.split('?')[1])
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

			// convert `targets[]` to `target`
			for(let k of Object.keys(opts)){
				if(k.endsWith('[]')){
					opts[k.slice(0, k.length-2)] = opts[k]
					delete opts[k]
				}
			}

			try{
				if(opts.cmd ==='file'){
					const content = await api.file(opts, {
						async sendFile(path){
							const bytes = await api.fs.readFile(path)
							const file = new File([bytes.buffer], api.path.basename(path), {
								type: api.mime.lookup(path) || 'application/octet-stream',
							});
							return file
						}
					})
					return {body: content, status: 200}
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
				type: api.mime.lookup(path) || 'application/octet-stream',
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
			console.log('making request: ', clientId, request)
			handleRequest(request).then((response)=>{
				navigator.serviceWorker.controller.postMessage({
					type: 'RESPONSE',
					clientId,
					requestId,
					response
				});
			})
			
		}
	};

	navigator.serviceWorker.controller.postMessage({
		type: 'REGISTER',
		clientId,
		routes
	});
}



window.elFinderSupportBrowserFs = function(upload) {
	"use strict";
	initializeServiceWorker();
	this.upload = function(data){
		const self = this.fm;
		const dfrd = $.Deferred();
		const files       = data.input ? data.input.files : data.files.files;
		api.upload(data, null, files).then((data)=>{
			self.uploads.xhrUploading = false;
			if (data) {
				self.currentReqCmd = 'upload';
				data.warning && triggerError(data.warning);
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
		return dfrd
	};
	
	this.init = function(fm) {
		this.fm = fm;
		this.fm.options.url = `${baseURL}${clientId}${CONNECTOR_URL}`;
	};

	console.log(api)
	
	
	this.send = function(opts) {
		const cmd = opts.data.cmd;
		let xhr;
		const dfrd = $.Deferred();
		
		dfrd.abort = function(e) {
			if (xhr && xhr.state() == 'pending') {
				xhr.quiet = true;
				xhr.abort();
			}
		};
		xhr = $.ajax(opts)
			.fail(function(error) {
				dfrd.reject(error);
			})
			.done(function(raw) {
				dfrd.resolve(raw);
			});

		// api[cmd](opts.data).then((result)=>{
		// 	dfrd.resolve(result);
		// }).catch((error)=>{
		// 	console.error(error)
		// 	dfrd.reject(error);
		// })
		return dfrd;
	};
};
