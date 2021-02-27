import * as BrowserFS from 'browserfs';
import * as mime from 'browser-mime';
import {intersection, each} from 'underscore';
import Jimp from 'jimp/browser/lib/jimp';
import lz from 'lzutf8';
import JSZip from 'jszip';

console.log('JSZip', JSZip)

const ArrayBufferView = Object.getPrototypeOf(
    Object.getPrototypeOf(new Uint8Array())
).constructor;

function initBrowserFS() {
	return new Promise((resolve, reject) => {
		BrowserFS.configure({
			fs: "MountableFileSystem",
				options: {
					"/tmp": { fs: "InMemory", options: { storeName: "tmp" } },
					"/home": { fs: "IndexedDB", options: { storeName: "home" } },
					// '/mnt/h5': { fs: "HTML5FS", options: {} }
				},
			},
			e => {
				if (e) {
					reject(e);
					return;
				}
				const _fs = BrowserFS.BFSRequire("fs");
				const buffer = BrowserFS.BFSRequire("buffer");

				//convert arraybuffer to Buffer
				var convert = function(name, fn) {
					return function() {
                        const args = Array.prototype.slice.call(arguments);
                        const newargs = [];
                        for (let arg of args) {
                            if (arg instanceof ArrayBuffer) {
                            newargs.push(buffer.Buffer(arg));
                            } else if (arg instanceof ArrayBufferView) {
                            newargs.push(buffer.Buffer(arg.buffer));
                            } else {
                            newargs.push(arg);
                            }
                        }
                        const lastArg = newargs[newargs.length-1]
                        // if the last argument is not a callback function
                        // then we return a promise
                        if(typeof lastArg === 'function' || name.endsWith('Sync') || name==='createWriteStream' || name ==='createReadStream'){
                            return fn.apply(_fs, newargs);
                        }
                        else{
                            return new Promise((resolve, reject)=>{
                                newargs.push((err, data)=>{
                                    if(err) reject(err)
                                    else resolve(data)
                                })
                                fn.apply(_fs, newargs);
                            })
                        }
					};
				};

				const fs = {};
				for (let k in _fs) {
					fs[k] = convert(k, _fs[k]);
				}
				const path = BrowserFS.BFSRequire("path");
				resolve({ fs, path });
		});
	});
}



let fs, path;
initBrowserFS().then((bfs)=>{
 console.log('BrowserFS initialized successfully.')
 fs = bfs.fs
 path = bfs.path
})

export const api = {};
const _private = {};
const roots = [{
    url: "/tmp/",       //Required
    path: "/tmp",   //Required
    permissions: { read:1, write: 1, lock: 0 }
},
{
    url: "/home/",       //Required
    path: "/home",   //Required
    permissions: { read:1, write: 1, lock: 0 }
}]

const config = {
    roots,
    volumes: roots.map( (r)=>r.path ),
    tmbroot: '/tmp/.tmb',
	router: '/connector',
	disabled: ['chmod', 'mkfile', 'zipdl', 'edit', 'put', 'size'],
	volumeicons: ['elfinder-navbar-root-local', 'elfinder-navbar-root-local']
}

config.acl = function(path) {
	var volume = _private.volume(path);
	return config.roots[volume].permissions || {
		read: 1,
		write: 1,
		locked: 0
	};

}


function writeFile(path, file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            fs.writeFile(path, event.target.result, (err, data) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(data)
                }
            })
        }
        reader.onerror = (err) => {
            reject(err)
        }
        reader.readAsArrayBuffer(file);
    })
}

api.archive = function(opts, res) {
	return new Promise(function(resolve, reject) {
		var target = _private.decode(opts.target);
		_private.compress(opts.targets, path.join(target.absolutePath, opts.name))
			.then(function() {
				return _private.info(path.join(target.absolutePath, opts.name));
			})
			.then(function(info) {
				debugger
				resolve({
					added: [info]
				});
			})
			.catch(function(err) {
				reject(err);
			})
	})
}

api.dim = function(opts, res) {
	return new Promise(function(resolve, reject) {
		var target = _private.decode(opts.target);
		Jimp.read(target.absolutePath)
			.then(function(img) {
				resolve({
					dim: img.bitmap.width + 'x' + img.bitmap.height
				});
			})
	})
}


async function copyFile( source, target ) {
    var targetFile = target;

    // If target is a directory, a new file with the same name will be created
    if (await fs.exists( target ) ) {
        if ( (await fs.lstat( target )).isDirectory() ) {
            targetFile = path.join( target, path.basename( source ) );
        }
    }

    await fs.writeFile(targetFile, await fs.readFile(source));
}

async function copyFolderRecursive( source, target ) {
    var files = [];

    // Check if folder needs to be created or integrated
    var targetFolder = path.join( target, path.basename( source ) );
    if ( !(await fs.exists( targetFolder )) ) {
        await fs.mkdir( targetFolder );
    }

    // Copy
    if ( (await fs.lstat( source )).isDirectory() ) {
        files = await fs.readdir( source );
        for(let file of files){
            var curSource = path.join( source, file );
            if ( (await fs.lstat( curSource )).isDirectory() ) {
                await copyFolderRecursive( curSource, targetFolder );
            } else {
                await copyFile( curSource, targetFolder );
            }
        }
    }
	else{
		throw new Error('Source is not a directory')
	}
}

api.copy = function(opts, res) {
	return new Promise(async function(resolve, reject) {
		if (await fs.exists(opts.dst)) {
			return reject('Destination exists');
		}
		if ( (await fs.lstat( opts.src )).isDirectory() ) {
			await copyFolderRecursive(opts.src, opts.dst)
		}
		else{
			await copyFile(opts.src, opts.dst)
		}
		_private.info(opts.dst)
			.then(function(info) {
				resolve({
					added: [info],
					changed: [_private.encode(path.dirname(opts.dst))]
				});
			})
			.catch(function(err) {
				reject(err);
			})
	})
}

api.duplicate = function(opt) {
	return new Promise(function(resolve, reject) {
		var tasks = [];
		each(opt.targets, function(target) {
			var _t = _private.decode(target);
			var ext = path.extname(_t.name);
			var fil = path.basename(_t.name, ext);
			var name = fil + '(copy)' + ext;
			var base = path.dirname(_t.absolutePath);
			tasks.push(api.copy({
				src: _t.absolutePath,
				dst: path.join(base, name)
			}));
		})
		Promise.all(tasks)
			.then(function(info) {
				var rtn = {
					added: []
				};
				each(info, function(i) {
					rtn.added.push(i.added[0]);
				})
				resolve(rtn);
			})
			.catch(function(e) {
				reject(e);
			})
	})
}

api.file = function(opts, res) {
	return new Promise(function(resolve, reject) {
		var target = _private.decode(opts.target);
		res.sendFile(target.absolutePath);
	})
}

api.get = function(opts, res) {
	return new Promise(function(resolve, reject) {
		var target = _private.decode(opts.target);
		fs.readFile(target.absolutePath, 'utf8', function(err, data) {
			if (err) return reject(err);
			resolve({
				content: data
			});
		})
	})
}

//TODO: Implement this
api.info = function(opts, res){

}

api.ls = function(opts, res) {
	return new Promise(function(resolve, reject) {
		if (!opts.target) return reject('errCmdParams');
		var info = _private.decode(opts.target);
		_private.readdir(info.absolutePath)
			.then(function(files) {
				var _files = files.map(function(e) {
					return e.name
				});
				if (opts.intersect) {
					_files = intersection(_files, opts.intersect);
				}
				resolve({
					list: _files
				});
			})
	})
}

//TODO check permission.
api.mkdir = function(opts, res) {
	return new Promise(function(resolve, reject) {
		var dir = _private.decode(opts.target);
		var tasks = [];
		var dirs = opts.dirs || [];
		if (opts.name) {
			dirs.push(opts.name);
		}
		each(dirs, async function(name) {
			var _dir = path.join(dir.absolutePath, name);
			if (!(await fs.exists(_dir))) {
				await fs.mkdir(_dir);
				tasks.push(_private.info(_dir));
			}
		})
		Promise.all(tasks)
			.then(function(added) {
				resolve({
					added: added
				});
			})
	})
}

api.move = function(opts, res) {
	return new Promise(async function(resolve, reject) {
		if (await fs.exists(opts.dst)) {
			return reject('Destination exists');
		}
		fs.rename(opts.src, opts.dst, function(err) {
			if (err) return reject(err);
			_private.info(opts.dst)
				.then(function(info) {
					resolve({
						added: [info],
						removed: opts.upload ? [] : [_private.encode(opts.src)]
					});
				})
				.catch(function(err) {
					reject(err);
				})
		})
	})
}

api.open = function(opts, res) {
	return new Promise(async function(resolve, reject) {
        try{
		var data = {
            init: opts.init,
            netDrivers: [],
            uplMaxFile: 1000,
            uplMaxSize: "102400.0M"
        };
		data.options = {
            disabled: config.disabled,
			uiCmdMap: [],
			tmbUrl: path.join(config.roots[0].url, '.tmb/', )
		}
		var _init = opts.init && opts.init == true;
		var _target = opts.target;

		if (_init) {
			if (config.init) config.init();
			data.api = "2.1";
            
                if (!_target) {
                    _target = _private.encode(config.volumes[0] + path.sep);
                }
           
		
		}
		if (!_target) {
			return reject('errCmdParams');
		}
		//NOTE target must always be directory
		_target = _private.decode(_target);

		_private.info(_target.absolutePath)
			.then(async function(result) {
				data.cwd = result;
				var files;
				try {
					files = await fs.readdir(_target.absolutePath);
				} catch (e) {
					//errors.
					console.log(e);
					files = [];
				}
				var tasks = [];
				each(files, function(file) {
					tasks.push(_private.info(path.join(_target.absolutePath, file)));
				})
				return Promise.all(tasks);
			})
			.then(function(files) {
				data.files = files;
				if (_init) {
					return _private.init();
				} else {
					return Promise.resolve(null);
				}
			})
			.then(function(volumes) {
				if (volumes != null) {
					data.files = volumes.concat(data.files);
				}
			})
			.then(function() {
				resolve(data);
			})
        }
        catch(e){
            reject(e)
        }
	})
}

api.parents = function(opts, res) {
	return new Promise(function(resolve, reject) {
		if (!opts.target) return reject('errCmdParams');
		var dir = _private.decode(opts.target);
		var tree;
		_private.init()
			.then(function(results) {
				tree = results;
				var read = function(t) {
					var folder = path.dirname(t);
					var isRoot = config.volumes.indexOf(t) >= 0;
					if (isRoot) {
						return resolve({
							tree: tree
						});
					} else {
						_private.readdir(folder)
							.then(function(files) {
								var tasks = [];
								each(files, function(file) {
									if (file.isdir) {
										tasks.push(_private.info(path.join(folder, file.name)));
									}
								})
								Promise.all(tasks)
									.then(function(folders) {
										tree = tree.concat(folders);
										read(folder);
									});
							})
							.catch(function(e) {
								reject(e);
							})
					}
				}
				read(dir.absolutePath);
			})
	})
}

api.paste = function(opts, res) {
	return new Promise(function(resolve, reject) {
		var tasks = [];
		var dest = _private.decode(opts.dst);
		each(opts.targets, function(target) {
			var info = _private.decode(target);
			var name = info.name;
			if (opts.renames && opts.renames.indexOf(info.name) >= 0) {
				var ext = path.extname(name);
				var fil = path.basename(name, ext);
				name = fil + opts.suffix + ext;
			}
			if (opts.cut == 1) {
				tasks.push(api.move({
					src: info.absolutePath,
					dst: path.join(dest.absolutePath, name)
				}));
			} else {
				tasks.push(api.copy({
					src: info.absolutePath,
					dst: path.join(dest.absolutePath, name)
				}));
			}
		})
		Promise.all(tasks)
			.then(function(results) {
				var rtn = {
					added: [],
					removed: [],
					changed: []
				}
				each(results, function(r) {
					rtn.added.push(r.added[0]);
					if (r.removed && r.removed[0]) {
						rtn.removed.push(r.removed[0]);
					}
					if (r.changed && r.changed[0] && rtn.changed.indexOf(r.changed[0]) < 0) {
						rtn.changed.push(r.changed[0]);
					}
				})
				resolve(rtn);
			})
			.catch(function(e) {
				reject(e);
			})
	})
}

api.rename = function(opts, res) {
	if (!opts.target) return Promise.reject('errCmdParams');
	var dir = _private.decode(opts.target);
	var dirname = path.dirname(dir.absolutePath);
	return api.move({
		src: dir.absolutePath,
		dst: path.join(dirname, opts.name)
	})
}

api.resize = function(opts, res) {
	return new Promise(function(resolve, reject) {
		var target = _private.decode(opts.target);
		Jimp.read(target.absolutePath)
			.then(function(image) {
				if (opts.mode == 'resize') {
					image = image.resize(parseInt(opts.width), parseInt(opts.height))
				} else if (opts.mode == 'crop') {
					image = image.crop(parseInt(opts.x), parseInt(opts.y), parseInt(opts.width), parseInt(opts.height));
				} else if (opts.mode == 'rotate') {
					image = image.rotate(parseInt(opts.degree));
					if (opts.bg) {
						image = image.background(parseInt(opts.bg.substr(1, 6), 16));
					}
				}
				image.quality(parseInt(opts.quality))
					.write(target.absolutePath);
				return _private.info(target.absolutePath);
			})
			.then(function(info) {
				info.tmb = 1;
				resolve({
					changed: [info]
				});
			})
			.catch(function(err) {
				reject(err);
			})
	})
}

api.rm = function(opts, res) {
	return new Promise(async function(resolve, reject) {
		var removed = [];
		for(let hash of opts.targets){
			try {
                var target = _private.decode(hash);
                if((await fs.lstat(target.absolutePath)).isDirectory())
                    await fs.rmdir(target.absolutePath, {recursive: true})
                else
				    await fs.unlink(target.absolutePath);
				removed.push(hash);
			} catch (err) {
				console.log(err);
				reject(err);
                break;
			}
		}
		resolve({
			removed: removed
		});
	})
}

//not impletemented
api.size = function(opts, res) {
	return Promise.resolve({
		size: 'unkown'
	});
}

async function walk(dir, data_callback) {
	const files = await fs.readdir(dir)
	for(let file of files){
		const filepath = path.join(dir, file);
		const stats = await fs.stat(filepath)
		if (stats.isDirectory()) {
			await walk(filepath, callback);
		} else if (stats.isFile()) {
			await data_callback(filepath, stats);
		}
	}
}

api.search = function(opts, res) {
	return new Promise(async function(resolve, reject) {
		if (!opts.q || opts.q.length < 1) reject({
			message: 'errCmdParams'
		});
		var target = _private.decode(opts.target);
		var files = [];
		try{
			await walk(target.absolutePath, async (path)=>{
				files.push(await _private.info(path));
			})
			resolve({
				files: files
			})
		}
		catch(err){
			reject(err);
		}		
	})
}

api.tmb = function(opts, res) {
	return new Promise(async function(resolve, reject) {
		var files = [];
		if (opts.current) {
			var dir = _private.decode(opts.current);
			var items = await fs.readdir(dir.absolutePath);
			each(items, function(item) {
				var _m = mime.lookup(item);
				if (_m !== false && _m.indexOf('image/') == 0) {
					files.push(path.join(dir.absolutePath, item));
				}
			})
		} else if (opts.targets) {
			each(opts.targets, function(target) {
				var _t = _private.decode(target);
				files.push(_t.absolutePath);
			})
		}
		//create.
		var tasks = [];
		each(files, function(file) {
			tasks.push(Jimp.read(file)
				.then(function(img) {
					var op = _private.encode(file);
					img.resize(48, 48)
						.write(path.join(config.tmbroot, op + ".png"));
					return Promise.resolve(op);
				}));
		})
		Promise.all(tasks)
			.then(function(hashes) {
				var rtn = {};
				each(hashes, function(hash) {
					rtn[hash] = hash + '.png';
				})
				resolve({
					images: rtn
				});
			})
			.catch(function(err) {
				console.log(err);
				reject(err);
			})
	})
}

api.tree = function(opts, res) {
	return new Promise(function(resolve, reject) {
		if (!opts.target) return reject('errCmdParams');
		var dir = _private.decode(opts.target);
		_private.readdir(dir.absolutePath)
			.then(function(files) {
				var tasks = [];
				each(files, function(file) {
					if (file.isdir) {
						tasks.push(_private.info(path.join(dir.absolutePath, file.name)));
					}
				})
				return Promise.all(tasks);
			})
			.then(function(folders) {
				resolve({
					tree: folders
				});
			})
			.catch(function(e) {
				reject(e);
			})
	})
}


api.upload = function(opts, res, files) {
	return new Promise(async function(resolve, reject) {
		var target = _private.decode(opts.target);
		var tasks = [];
		for (var i = 0; i < files.length; i++) {
            tasks.push(writeFile(path.join(target.absolutePath, files[i].name), files[i])) 
		}
        Promise.allSettled(tasks).then(async (values)=>{
            try{
                const added = []
                for(let i=0;i<values.length;i++){
                    if(values[i].status==='fulfilled'){
                        added.push(await _private.info(path.join(target.absolutePath, files[i].name)))
                    }
                }
                resolve({'added': added})
            }
            catch(e){
                reject(e)
            }
          
        }).catch((e)=>{
            reject(e)
        })
	})
}

api.zipdl = function(opts, res) {
	return new Promise(function(resolve, reject) {
		if (!opts.targets || !opts.targets[0]) return reject({
			message: 'errCmdParams'
		});
		if (opts.download && opts.download == 1) {

		} else {
			var first = opts.targets[0];
			first = _private.decode(first);
			var dir = path.dirname(first.absolutePath);
			var name = path.basename(dir);
			var file = path.join(dir, name + '.zip');
			_private.compress(opts.targets, file)
				.then(function() {
					resolve({
						zipdl: {
							file: _private.encode(file),
							name: name + '.zip',
							mime: 'application/zip'
						}
					})
				})
				.catch(function(err) {
					reject(err);
				})
		}
	})
}



//_private
_private.compress = async function(files, dest) {
	var zip = new JSZip();
	for(let file of files){
		var target = _private.decode(file);
		//check if target is file or dir
		if ((await fs.lstat(target.absolutePath))
			.isDirectory()) {
			const basePath = path.dirname(target.absolutePath);
			await walk(target.absolutePath, async (path)=>{
				const relativePath =  path.relative(basePath, path)
				zip.file(relativePath, await fs.readFile(path))
			})
		} else {
			const c = await fs.readFile(target.absolutePath);
			zip.file(target.name, c);
		}
	}
	const content = await zip.generateAsync({type:"blob"})
	await writeFile(dest, content)
	return true
}

function base64AddPadding(str) {
    return str + Array((4 - str.length % 4) % 4 + 1).join('=');
}

_private.decode = function(dir) {
	var root, code, name, volume;
	if (!dir || dir.length < 4) throw Error('Invalid Path');
	if (dir[0] != 'v' || dir[2] != '_') throw Error('Invalid Path');
	volume = parseInt(dir[1]);

	var relative = dir.substr(3, dir.length - 3)
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.replace(/\./g, '=');

	relative = lz.decompress(base64AddPadding(relative), {
		inputEncoding: "Base64"
	});
	name = path.basename(relative);
	root = config.volumes[volume];
	return {
		volume: volume,
		dir: root,
		path: relative,
		name: name,
		absolutePath: path.join(root, relative)
	}
}

//Used by _private.info, api.opne, api.tmb, api.zipdl
_private.encode = function(dir) {
	var info = _private.parse(dir);
	var relative = lz.compress(info.path, {
			outputEncoding: "Base64"
		})
		.replace(/=+$/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '.');
	return 'v' + info.volume + '_' + relative;
}

_private.filepath = function(volume, filename) {
	if (volume < 0 || volume > 2) return null;
	return path.join(config.volumes[volume], path.normalize(filename));
}

_private.info = function(p) {
	return new Promise(function(resolve, reject) {
		var info = _private.parse(p);
		if (info.volume < 0) return reject('Volume not found');

		fs.stat(p, async function(err, stat) {
			if (err) return reject(err);
			var r = {
				name: path.basename(p),
				size: stat.size,
				hash: _private.encode(p),
				mime: stat.isDirectory() ? 'directory' : mime.lookup(p),
				ts: Math.floor(stat.mtime.getTime() / 1000),
				volumeid: 'v' + info.volume + '_'
			}
			if (r.mime === false) {
				r.mime = 'application/binary';
			}
			if (r.mime.indexOf('image/') == 0) {
				var filename = _private.encode(p);
				var tmbPath = path.join(config.tmbroot, filename + ".png");
				if (await fs.exists(tmbPath)) {
					r.tmb = filename + '.png';
				} else {
					r.tmb = "1";
				}
			}

			if (!info.isRoot) {
                var parent = path.dirname(p);
                // if (parent == root) parent = parent + path.sep;
				r.phash = _private.encode(parent);
			} else {
				r.options = {
					disabled: config.disabled,
					archivers: {
						create: ['application/zip'],
						createext: {
							'application/zip': 'zip'
						}
					},
					url: config.roots[info.volume].url
				}
				if (config.volumeicons[info.volume]) {
					r.options.csscls = config.volumeicons[info.volume];
				}
			}
			var acl = config.acl(p);
			r.read = acl.read;
			r.write = acl.write;
			r.locked = acl.locked;
			//check if this folder has child.
			r.isdir = (r.mime == 'directory');
            try{
                if (r.isdir) {
                    var items = await fs.readdir(p);
                    for (var i = 0; i < items.length; i++) {
                        if ((await fs.lstat(path.join(p, items[i]))).isDirectory()) {
                            r.dirs = 1;
                            break;
                        }
                    }
                }
                resolve(r);
            }
            catch(e){
                reject(e)
            }
	
		})
	})
}

_private.init = function() {
	var tasks = [];
	each(config.volumes, function(volume) {
		tasks.push(_private.info(volume));
	})

	return Promise.all(tasks)
		.then(function(results) {
			each(results, function(result) {
				result.phash = '';
			})
			return Promise.resolve(results);
		})
}

//Used by _private.encode & _private.info
_private.parse = function(p) {
	var v = _private.volume(p);
	var root = config.volumes[v] || "";
	var relative = p.substr(root.length, p.length - root.length);
	if (!relative.indexOf(path.sep) == 0) relative = path.sep + relative;
	return {
		volume: v,
		dir: root,
		path: relative,
		isRoot: relative == path.sep
	}
}

/**
 * dir: absolute path
 */
_private.readdir = function(dir) {
	return new Promise(function(resolve, reject) {
		var current;
		fs.readdir(dir, async function(err, items) {
			if (err) return reject(err);
			var files = [];
			for(let item of items){
				var info = await fs.lstat(path.join(dir, item));
				files.push({
					name: item,
					isdir: info.isDirectory()
				});
			}
			resolve(files);
		})
	})
}

_private.suffix = function(name, suff) {
	var ext = path.extname(name);
	var fil = path.basename(name, ext);
	return fil + suff + ext;
}

_private.tmbfile = function(filename) {
	return path.join(config.tmbroot, filename);
}

//Used by _private.parse & config.acl
_private.volume = function(p) {
	for (var i = 0; i < config.volumes.length; i++) {
		if (i > 9) return -1;
		if (p.indexOf(config.volumes[i]) == 0) {
			return i;
		}
	}
	return -1;
}