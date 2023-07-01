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

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.initializeServiceWorker = async function(){
	if ('serviceWorker' in navigator) {
		const controller = navigator.serviceWorker.controller;
		// Register the worker and show the list of quotations.
		if (!controller || !controller.scriptURL.endsWith('/service-worker.js') ) {
			navigator.serviceWorker.oncontrollerchange = function() {
				this.controller.onstatechange = function() {
					if (this.state === 'activated') {
						console.log('Service worker successfully activated.')
					}
				};
			};
			const registration = await navigator.serviceWorker.register('/service-worker.js')
			console.log('Service worker successfully registered, scope is:', registration.scope);
			// Wait for the service worker to become active
			await navigator.serviceWorker.ready;
			// Reload the page to allow the service worker to intercept requests
			if (!navigator.serviceWorker.controller) {
			  // Service worker has just been installed, reload the page
			  window.location.reload();
			  throw new Error('Reload the page to allow the service worker to intercept requests.')
			}
			let ready = false;
			while (!ready){
				const response = await fetch('/fs/connector')
				if(response.status === 200){
					ready = true;
					break;
				}
				await timeout(500);
			}
		}
		else{
			console.log('Service worker was activated.')
		}
	} else {
		console.log('Service workers are not supported.');
	}
}

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

window.setupImJoyApp = function(){
	// const mainContainer = document.createElement('div');
	// document.getElementById('window-manager').appendChild(mainContainer)
	// we need a hack here for some umd modules in the imjoy loader to load
	const _define = window.define;
	window.define = undefined
	loadImJoyBasicApp({
		version: '0.13.70',
		process_url_query: true,
		show_window_title: false,
		show_progress_bar: true,
		show_empty_window: true,
		// window_manager_container: 'window-manager',
		menu_style: { position: "absolute", right: 0, top: "2px" },
		window_style: {width: '100%', height: '100%'},
		// main_container: mainContainer,
		imjoy_api: { } // override some imjoy API functions here
	}).then(async app => {
		const api = app.imjoy.api
		// const w = {
		// 	id: 'elfinder-window',
		// 	window_id: 'elfinder-window-container',
		// 	name: 'elFinder',
		// 	fullscreen: true
		// }
		// app.allWindows.push(w);
		// app.addWindow(w);
		// app.$forceUpdate();
		// setTimeout(()=>{
		// 	const elfinderContainer = document.getElementById(w.window_id)
		// 	elfinderContainer.appendChild(document.getElementById('elfinder'))
		// }, 0)

		function urlToBase64(url){
			return new Promise(async (resolve, reject)=>{
				const response = await fetch(url)
				const blob = await response.blob()
				const reader = new FileReader() ;
				reader.onload = function(){ resolve(this.result) } ;
				reader.onerror = reject
				reader.readAsDataURL(blob) ;
			})
		}
		await api.registerService({
			type: '#file-loader',
			name: 'ITK/VTK Viewer',
			async check(fileObj){
				if(fileObj.mime.startsWith('image/tiff')){
					return true
				}
			},
			async load({url, window_id}){
				console.log('https://kitware.github.io/itk-vtk-viewer/app/?fileToLoad='+url)
				await api.createWindow({src: 'https://kitware.github.io/itk-vtk-viewer/app/?fileToLoad='+url, window_id})
			}
		})
		await api.registerService({
			type: '#file-loader',
			name: 'Kaibu',
			icon: 'https://kaibu.org/static/img/kaibu-icon.svg',
			async check(fileObj){
				if(fileObj.mime.startsWith('image/') || fileObj.mime === 'directory'){
					return true
				}
			},
			async load({source, type, window_id}){
				if(type === 'file'){
					const base64 = await urlToBase64(source.url)
					const viewer = await api.createWindow({src: 'https://kaibu.org/', window_id, w: 10, h: 10})
					await viewer.view_image(base64, {name: source.name});
					await viewer.add_shapes([], {name: 'annotation'})
				}
				else if(type === 'directory'){
					const viewer = await api.createWindow({src: 'https://kaibu.org/', window_id, w: 10, h: 10})
					source = source.filter(file => file.mime.startsWith('image/'))
					const nodes = source.map(file => {return {"title": file.name, "data": file, "isLeaf": true}})
					await viewer.add_widget({
						"_rintf": true,
						"type": "tree",
						"name": "Files",
						"node_dbclick_callback": async (node)=>{
							await viewer.clear_layers()
							const file = node.data
							const base64 = await urlToBase64(file.url)
							await viewer.view_image(base64, {name: file.name})
						},
						"nodes": nodes,
					})
					await viewer.add_shapes([], {name: 'annotation'})
				}

			}
		})
		
		// a demo content provider following the Jupyter Content Manager standard
		// https://jupyter-notebook.readthedocs.io/en/stable/extending/contents.html#required-methods
		await api.registerService({
			type: '#content-provider',
			name: 'MyData',
			get(path){
				return {
					name: 'My Folder',
					path: '/user',
					type: 'directory',
					created: '2021-01-23T18:25:43.511Z',
					last_modified: '2021-01-23T18:25:43.511Z',
					mimetype: null,
					format: 'json',
					content: [
						{
							name: 'My SubFolder',
							path: '/user/me',
							type: 'directory',
							created: '2021-01-23T18:25:43.511Z',
							last_modified: '2021-01-23T18:25:43.511Z',
							mimetype: null,
						}
					]
				}
			},
			save(model, path){

			},
			delete_file(path){

			},
			rename_file(old_path, new_path){

			},
			file_exists(path){

			},
			dir_exists(path){

			},
			is_hidden(path){

			}
		})
		window.imjoy = app.imjoy;
	}).finally(()=>{
		// restore define
		window.define = _define;
	})
}


const CONNECTOR_URL = '/fs/connector';

window.elFinderSupportBrowserFs = function(upload) {
	"use strict";
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
			elfinder_api.upload(opts).then((data)=>{
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
		this.fm.options.url = `${baseURL}${CONNECTOR_URL}`;
	};

	
	this.send = function(opts) {
		const dfrd = $.Deferred();
		dfrd.abort = function() {};
		
		const query = decodeQuery(opts.url.split('?')[1])
		if(query) Object.assign(opts.data, query)
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

		return dfrd;
	};
};
