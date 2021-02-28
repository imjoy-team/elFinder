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
import {api, getFileSystem} from './api.js';

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
			navigator.serviceWorker.register('/service-worker.js').then(function(registration) {
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

function setupCommunication(){
	const messageChannel = new MessageChannel();
	// First we initialize the channel by sending
	// the port to the Service Worker (this also
	// transfers the ownership of the port)
	navigator.serviceWorker.controller.postMessage({
		type: 'INIT_PORT',
		routes: [{path: '/home/:filename', type: 'get'}, {path: '/tmp/:filename', type: 'get'}]
	}, [messageChannel.port2]);
	// Listen to the requests
	messageChannel.port1.onmessage = (event) => {
		if(event.data.type === 'REQUEST'){
			const requestId = event.data.requestId
			const request = event.data.request
			console.log('making request: ', request)
			handleRequest(request).then((response)=>{
				navigator.serviceWorker.controller.postMessage({
					type: 'RESPONSE',
					requestId,
					response
				});
			})
			
		}
	};

}

async function handleRequest(request){
	let path;
	if(request.route.path === '/home/:filename'){
		const filename = request.parameters.filename.split('?')[0]
		path = `/home/${filename}`
	}
	if(request.route.path === '/tmp/:filename'){
		const filename = request.parameters.filename.split('?')[0]
		path = `/tmp/${filename}`
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
		// const openUrl = fm.openUrl.bind(fm);
		// fm.openUrl = (config)=>{
		// 	console.log('=======> openUrl', config, openUrl(config))
		// 	return openUrl(config)
		// }
		fm.uploadURL = 'http://127.0.0.1:8765/connector'
	};

	console.log(api)
	
	
	this.send = function(opts) {
		const cmd = opts.data.cmd;
		let xhr;
		const dfrd = $.Deferred();
		opts.url = 'http://127.0.0.1:8765/connector'
		dfrd.abort = function(e) {
			if (xhr && xhr.state() == 'pending') {
				xhr.quiet = true;
				xhr.abort();
			}
		};
	
		// xhr = $.ajax(opts)
		// 	.fail(function(error) {
		// 		dfrd.reject(error);
		// 	})
		// 	.done(function(raw) {
		// 		dfrd.resolve(raw);
		// 	});

		api[cmd](opts.data).then((result)=>{
			dfrd.resolve(result);
		}).catch((error)=>{
			console.error(error)
			dfrd.reject(error);
		})
		return dfrd;
	};
};
