/**
 * @class  elFinder command "mkfile"
 * Create new empty file
 *
 * @author Dmitry (dio) Levashov
 **/
elFinder.prototype.commands.imjoyplugins = function() {
	"use strict";
	var self = this;

	this.disableOnSearch = true;
	this.updateOnSelect  = false;
	this.mime            = 'text/plain';
	this.prefix          = 'untitled file.txt';
	this.variants        = [];

	this.getTypeName = function(mime, type) {
		var fm = self.fm,
			name;
		if (name = fm.messages['kind' + fm.kinds[mime]]) {
			name = fm.i18n(['extentiontype', type.toUpperCase(), name]);
		} else {
			name = fm.i18n(['extentionfile', type.toUpperCase()]);
		}
		return name;
	};

	this.fm.bind('contextmenucreate', async function(e) {
		if (e.data.targets && self.enabled()) {
			self.variants = [];
			try{
				if(!window.imjoy) return false;
				const api = window.imjoy.api
				const loaders = await api.getServices({type: '#file-loader'})
				for(let target of e.data.targets){
					const file = self.fm.file(target);
					for(let loader of loaders){
						if(await loader.check(file)){
							self.variants.push([{loader, file}, loader.name, loader.icon])
						}
					}
				}
			}
			catch(e){
				console.error(e)
			}
			finally{
				if(e.data.done) e.data.done();
			}
		}
		else{
			self.variants = [];
			// we need to mark it done here to allow the contextmenu to be created
			if(e.data.done) e.data.done();
		}
	})

	this.getstate = function() {
		return 0;
	};

	function getFileUrl(file){
		return new Promise((resolve)=>{
			self.fm.openUrl(file.hash, false, (url)=>{
				resolve(url)
			})
		})
	}

	this.exec = async function(_dum, {loader, file}) {
		const dfd = $.Deferred();
		if(file.mime === 'directory'){
			const children = self.fm.files(file.hash);
			const urls = []
			for(let file of Object.values(children)){
				file.url = await getFileUrl(file);
				urls.push(file)
			}
			try{
				await loader.load({source: urls, type: 'directory'})
				dfd.resolve();
			}
			catch(e){
				dfd.reject(e);
			}
		}
		else{
			const url = await getFileUrl(file)
			try{
				file.url = url;
				await loader.load({source: file, type: 'file'})
				dfd.resolve();
			}
			catch(e){
				dfd.reject(e);
			}
		}
		
		return dfd
	};
};
