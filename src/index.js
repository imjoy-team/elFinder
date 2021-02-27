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


window.elFinderSupportBrowserFs = function(upload) {
	"use strict";
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
