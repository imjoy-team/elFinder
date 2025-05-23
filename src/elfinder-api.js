import * as BrowserFS from 'browserfs';
import mime from 'mime';
import { intersection, each } from 'underscore';
import Jimp from 'jimp';
import JSZip from 'jszip';
import contentDisposition from 'content-disposition';
import S3FS from "./s3";
import { AsyncFileSystem } from  './asyncfs';
import { ArtifactFileSystem } from "./artifactFs";
import { handleHyphaArtifacts } from "./fs-handlers/hypha-artifacts-handler";
import { handleHyphaFs } from "./fs-handlers/hypha-fs-handler";
import { handleS3 } from "./fs-handlers/s3-handler";
globalThis.window = globalThis;
import { hyphaWebsocketClient } from "hypha-rpc";
import elFinderContents from './elfinder.contents.js';

// Create a local elFinder object for the api with the necessary structure
const elFinder = function() {};
elFinder.prototype = {
	version: elFinderContents.version,
	commands: {
		netmount: {
			drivers: elFinderContents.netmountDrivers
		}
	}
};

const ArrayBufferView = Object.getPrototypeOf(
	Object.getPrototypeOf(new Uint8Array())
).constructor;

function encodeBase64(data) {
	return btoa(data)
		.replace(/=+$/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '.');
}

function base64AddPadding(str) {
	return str + Array((4 - str.length % 4) % 4 + 1).join('=');
}

function decodeBase64(base64Url) {
	const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=');
	return atob(base64AddPadding(base64));
}

async function jimpRead(data) {
	const buffer = BrowserFS.BFSRequire("buffer");
	if (data instanceof ArrayBuffer) {
		data = new Uint8Array(data);
	}
	if (data instanceof ArrayBufferView) {
		data = data.buffer;
	}
	data = buffer.Buffer(data);
	return await Jimp.read(data);
}

function patchFs() {
	const _fs = BrowserFS.BFSRequire("fs");
	const buffer = BrowserFS.BFSRequire("buffer");
	//convert arraybuffer to Buffer
	var convert = function (name, fn) {
		return function () {
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
			const lastArg = newargs[newargs.length - 1]
			// if the last argument is not a callback function
			// then we return a promise
			if (typeof lastArg === 'function' || name.endsWith('Sync') || name === 'createWriteStream' || name === 'createReadStream') {
				return fn.apply(_fs, newargs);
			}
			else {
				//  fs.exists has no error passed to the callback
				if (name === 'exists') {
					return new Promise((resolve, reject) => {
						newargs.push((data) => {
							resolve(data)
						})
						fn.apply(_fs, newargs);
					})
				}
				return new Promise((resolve, reject) => {
					newargs.push((err, data) => {
						if (err) reject(err)
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
	return fs;
}
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
					console.error(e);
					reject(e);
					return;
				}
				const fs = patchFs();
				const path = BrowserFS.BFSRequire("path");
				resolve({ fs, path });
			});
	});
}


const removeInvalidFilenameCharacters = (name) =>
	name.replace(/["*/:<>?\\|]/g, "");

const _private = {};

const config = {
	chunkSize: 102400000,
	roots: [],
	volumes: [],
	tmbroot: '/tmp/.tmb',
	tmburl: `/tmp/.tmb/`,
	disabled: ['chmod', 'size'],
	volumeicons: ['elfinder-navbar-root-local', 'elfinder-navbar-root-local'],
	async init() {
		if (!(await fs.exists(config.tmbroot))) {
			fs.mkdir(config.tmbroot);
		}
	}
}

function addNetworkVolume(mountPath, permissions, driver) {
	// Check if path already exists
	let finalPath = mountPath;
	let counter = 1;
	while (config.roots.some((root) => root.path === finalPath)) {
		// If path exists, append a counter
		finalPath = `${mountPath}-${counter}`;
		counter++;
	}
	
	// Generate a unique netkey
	const netkey = `${driver}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	
	// Add to config.volumes first to ensure path decoding works
	config.volumes.push(finalPath);
	config.roots.push({
		url: `${rootURL}fs${finalPath}/`,
		path: finalPath,
		permissions,
		driver,
		netkey
	});
	config.volumeicons.push('elfinder-navbar-root-network')
	return netkey;
}

let fs, path;
let rootURL = '/'
async function initialize(baseURL) {
	const roots = [
		{
			url: `${baseURL}fs/home/`,       //Required
			path: "/home",   //Required
			permissions: { read: 1, write: 1, lock: 0 }
		},
		{
			url: `${baseURL}fs/tmp/`,   //Required
			path: "/tmp",   //Required
			permissions: { read: 1, write: 1, lock: 0 }
		}]
	rootURL = baseURL;
	config.roots = roots;
	config.volumes = config.roots.map((r) => r.path)
	config.tmburl = `${baseURL}fs/tmp/.tmb/`;
	config.acl = function (path) {
		var volume = _private.volume(path);
		return config.roots[volume].permissions || {
			read: 1,
			write: 1,
			locked: 0
		};
	}
	await initBrowserFS().then((bfs) => {
		console.log('BrowserFS initialized successfully.')
		fs = bfs.fs
		path = bfs.path
		api.fs = fs
		api.path = path
	})

	// Register netmount protocol handlers
	elFinder.prototype.commands.netmount.drivers.hypha_artifacts = handleHyphaArtifacts;
	elFinder.prototype.commands.netmount.drivers.hyphafs = handleHyphaFs;
	elFinder.prototype.commands.netmount.drivers.s3 = handleS3;
}

export function parseFile(file, chunk_callback) {
	return new Promise((resolve, reject) => {
		var fileSize = file.size;
		var chunkSize = config.chunkSize; // bytes
		var offset = 0;
		var chunkReaderBlock = null;

		var readEventHandler = async function (evt) {
			try {
				if (evt.target.error == null) {
					await chunk_callback(evt.target.result, offset); // callback for handling read chunk
					offset += evt.target.result.byteLength;
				} else {
					console.error(evt.target.error)
					reject(evt.target.error)
					return;
				}
				if (offset >= fileSize) {
					resolve();
					return;
				}

				// of to the next chunk
				chunkReaderBlock(offset, chunkSize, file);
			}
			catch (e) {
				reject(e)
			}
		}

		chunkReaderBlock = function (_offset, length, _file) {
			var r = new FileReader();
			var blob = _file.slice(_offset, length + _offset);
			r.onload = readEventHandler;
			r.readAsArrayBuffer(blob);
		}

		// now let's start the read with the first block
		chunkReaderBlock(offset, chunkSize, file);
	})
}

export async function writeFile(path, file, writeOffset, mode, progressCallback) {
	let handle
	writeOffset = writeOffset || 0;
	mode = mode || 'w';
	try {
		handle = await fs.open(path, mode);
		await parseFile(file, (chunk, offset) => {
			return new Promise((resolve, reject) => {
				fs.write(handle, new Uint8Array(chunk), 0, chunk.byteLength, writeOffset + offset, (error) => {
					if (progressCallback) progressCallback(offset + chunk.byteLength)
					if (error) reject(error)
					else resolve()
				})
			})
		})
		await fs.close(handle)
	}
	catch (e) {
		if (handle) {
			await fs.close(handle)
			await fs.unlink(path);
		}
		throw e
	}
}

export const api = { mime, config, initialize };

api.archive = function (opts, res) {
	return new Promise(function (resolve, reject) {
		var target = _private.decode(opts.target);
		_private.compress(opts.targets, path.join(target.absolutePath, opts.name))
			.then(function () {
				return _private.info(path.join(target.absolutePath, opts.name));
			})
			.then(function (info) {
				resolve({
					added: [info]
				});
			})
			.catch(function (err) {
				reject(err);
			})
	})
}

api.dim = function (opts, res) {
	return new Promise(async function (resolve, reject) {
		var target = _private.decode(opts.target);
		jimpRead(await fs.readFile(target.absolutePath))
			.then(function (img) {
				resolve({
					dim: img.bitmap.width + 'x' + img.bitmap.height
				});
			})
	})
}


async function copyFile(source, target) {
	var targetFile = target;

	// If target is a directory, a new file with the same name will be created
	if (await fs.exists(target)) {
		if ((await fs.lstat(target)).isDirectory()) {
			targetFile = path.join(target, path.basename(source));
		}
	}

	await fs.writeFile(targetFile, await fs.readFile(source));
}

async function copyFolderRecursive(source, target) {
	var files = [];

	// Check if folder needs to be created or integrated
	var targetFolder = target;
	if (!(await fs.exists(targetFolder))) {
		await fs.mkdir(targetFolder);
	}

	// Copy
	if ((await fs.lstat(source)).isDirectory()) {
		files = await fs.readdir(source);
		for (let file of files) {
			var curSource = path.join(source, file);
			if ((await fs.lstat(curSource)).isDirectory()) {
				await copyFolderRecursive(curSource, targetFolder);
			} else {
				await copyFile(curSource, targetFolder);
			}
		}
	}
	else {
		throw new Error('Source is not a directory')
	}
}

api.copy = function (opts, res) {
	return new Promise(async function (resolve, reject) {
		if (await fs.exists(opts.dst)) {
			return reject('Destination exists');
		}
		if ((await fs.lstat(opts.src)).isDirectory()) {
			await copyFolderRecursive(opts.src, opts.dst)
		}
		else {
			await copyFile(opts.src, opts.dst)
		}
		_private.info(opts.dst)
			.then(function (info) {
				resolve({
					added: [info],
					changed: [_private.encode(path.dirname(opts.dst))]
				});
			})
			.catch(function (err) {
				reject(err);
			})
	})
}

function urlToFile(url, filename, mimeType) {
	return (fetch(url)
		.then(function (res) { return res.arrayBuffer(); })
		.then(function (buf) { return new File([buf], filename, { type: mimeType }); })
	);
}

api.put = async function (opts, res) {
	try {
		var target = _private.decode(opts.target);
		if (opts.encoding === 'scheme') {
			await writeFile(target.absolutePath, await urlToFile(opts.content, target.name, _private.getMime(target.absolutePath)))
		}
		else {
			await fs.writeFile(target.absolutePath, opts.content, { encoding: opts.encoding || 'utf8' });
		}
		if (_private.getMime(target.absolutePath).startsWith('image/')) {
			await generateThumbnail(target.absolutePath)
		}
		return { changed: [await _private.info(target.absolutePath)] }
	}
	catch (e) {
		console.error(e)
		return { error: ['errSave', opts.target] }
	}
}


api.duplicate = function (opt) {
	return new Promise(function (resolve, reject) {
		var tasks = [];
		each(opt.targets, function (target) {
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
			.then(function (info) {
				var rtn = {
					added: []
				};
				each(info, function (i) {
					rtn.added.push(i.added[0]);
				})
				resolve(rtn);
			})
			.catch(function (e) {
				reject(e);
			})
	})
}

api.file = async function (opts, res) {
	const target = _private.decode(opts.target);
	const volumeInfo = config.roots[target.volume];
	const filePath = target.absolutePath;
	const size = (await api.fs.lstat(filePath)).size
	const mime = _private.getMime(filePath);
	const headers = { 'Content-Type': mime }
	if (opts.download) {
		headers['Content-Disposition'] = contentDisposition(target.name);
	}
	else {
		headers['Content-Disposition'] = 'inline'
	}
	if (!opts.range) headers["Content-Length"] = `${size}`

	// For both Hypha and S3, read the file and return blob data directly
	const content = await fs.readFile(filePath);
	return { file: new Blob([content], { type: mime }), headers: headers };
}

api.get = function (opts, res) {
	return new Promise(function (resolve, reject) {
		var target = _private.decode(opts.target);
		fs.readFile(target.absolutePath, 'utf8', function (err, data) {
			if (err) return reject(err);
			resolve({
				content: data
			});
		})
	})
}

api.info = async function (opts, res) {
	const files = []
	for (let target of opts.targets) {
		target = _private.decode(target);
		const info = await _private.info(target.absolutePath)
		files.push(info)
	}
	return {
		files
	}
}

api.ls = function (opts, res) {
	return new Promise(function (resolve, reject) {
		if (!opts.target) return reject('errCmdParams');
		var info = _private.decode(opts.target);
		if (!info) {
			return reject('Invalid target path or volume not mounted');
		}
		_private.readdir(info.absolutePath)
			.then(function (files) {
				var _files = files.map(function (e) {
					return e.name
				});
				if (opts.intersect) {
					_files = intersection(_files, opts.intersect);
				}
				resolve({
					list: _files
				});
			})
			.catch(reject)
	})
}


//TODO check permission.
api.mkfile = async function (opts, res) {
	var dir = _private.decode(opts.target);
	if (!dir) {
		throw new Error('Invalid target path or volume not mounted');
	}
	var _file = path.join(dir.absolutePath, opts.name);
	const handle = await fs.open(_file, 'w');
	await fs.close(handle)
	return {
		added: [await _private.info(_file)]
	}
}

//TODO check permission.
api.mkdir = async function (opts, res) {
	var dir = _private.decode(opts.target);
	if (!dir) {
		throw new Error('Invalid target path or volume not mounted');
	}
	var dirs = opts.dirs || [];
	if (opts.name) {
		dirs.push(opts.name);
	}
	const added = []
	const hashes = {}
	for (let name of dirs) {
		var _dir = path.join(dir.absolutePath, name);
		if (!(await fs.exists(_dir))) {
			await fs.mkdir(_dir);
			added.push(await _private.info(_dir));
			hashes[name] = _private.encode(_dir)
		}
	}
	return {
		added,
		hashes
	}
}

api.netmount = function (opts, res) {
	return new Promise(function (resolve, reject) {
		// Handle unmount request
		if (opts.protocol === "netunmount") {
			try {
				const volumeInfo = _private.decode(opts.user);
				if (!volumeInfo) {
					reject('Invalid volume');
					return;
				}
				
				const _fs = BrowserFS.BFSRequire("fs");
				const rootFs = _fs.getRootFS();
				
				// Unmount the filesystem
				if (rootFs.mntMap[volumeInfo.dir]) {
					rootFs.umount(volumeInfo.dir);
					
					// Remove from config
					const mountIndex = config.roots.findIndex(r => r.path === volumeInfo.dir);
					if (mountIndex !== -1) {
						// Store the removed volume hash for response
						const removedHash = _private.encode(volumeInfo.dir);
						
						// Remove from all config arrays
						config.roots.splice(mountIndex, 1);
						config.volumes.splice(mountIndex, 1);
						config.volumeicons.splice(mountIndex, 1);
						
						// Update fs reference
						fs = patchFs();
						
						resolve({
							removed: [removedHash]
						});
						return;
					}
				}
				reject('Volume not mounted');
				return;
			} catch (error) {
				console.error('Failed to unmount volume:', error);
				reject(error);
				return;
			}
		}

		// S3 URI Example: s3://accessKey:secretKey@endpoint/bucket/prefix
		// Extract access key, secret key, endpoint, bucket, and object from S3 URI
		const matchResult = opts.host.match(
			/^s3:\/\/([^:@]+):([^:@]+)@((?:http|https):\/\/[^/]+)\/([^\/]+)\/(.*)$/
		);

		if (matchResult) {
			const [, accessKey, secretKey, endpoint, bucket, ...objectParts] =
				matchResult;

			let prefix = objectParts.join("/");
			if (opts.prefix) prefix = prefix + "/" + opts.prefix;
			// replace double // with single /
			prefix = prefix.replace(/\/\//g, "/");
			if (!prefix.endsWith('/')) prefix += '/';
			let parts = prefix ? prefix.split("/") : [];
			parts = parts.filter((part) => part.length > 0);
			const topLevelFolder =
				parts.length > 0
					? parts.pop()
					: bucket;
			console.log(`Mounting S3 bucket ${bucket} at ${topLevelFolder}...(prefix: ${prefix}, endpoint: ${endpoint}`);
			const mappedName =
				removeInvalidFilenameCharacters(topLevelFolder).trim();
			const mountedPath = path.join("/", mappedName);

			// Add to volumes first
			addNetworkVolume(mountedPath, { read: 1, write: 1, locked: 0 }, 's3');

			S3FS.Create(
				{
					accessKeyId: accessKey,
					endpoint: endpoint,
					prefix: prefix,
					region: "eu-west-2",
					secretAccessKey: secretKey,
					bucket: bucket,
				},
				(error, newFs) => {
					if (error || !newFs) {
						reject(error);
						return;
					}
					console.log(newFs);
					const _fs = BrowserFS.BFSRequire("fs");
					const rootFs = _fs.getRootFS();
					
					if (rootFs.mntMap[mountedPath]) {
						// already mounted
						rootFs.umount(mountedPath);
						console.warn(`Already mounted: ${mountedPath}, umounting...`);
					}
					try {
						rootFs.mount(mountedPath, newFs)
						// update fs
						fs = patchFs();
						console.log('Mounted S3 bucket at', mountedPath);
						// Add to volumes first
						const netkey = addNetworkVolume(mountedPath, { read: 1, write: 1, locked: 0 }, 's3');
						setTimeout(() => {
							_private.info(mountedPath).then((info) => {
								// Ensure the info has the netkey
								info.netkey = netkey;
								resolve({
									added: [info],
								});
							}).catch((e) => {
								reject(e);
							});
						}, 10);


					}
					catch (e) {
						reject(e);
						return;
					}
				}
			);
		}
		else if(opts.host.startsWith('http') && opts.host.includes('/services/')) {
			// extract server_url and serviceId
			const url = new URL(opts.host);
			const server_url = url.origin;
			const workspace = opts.host.replace(server_url, '').split('/services/')[0].replace(/\//g, '');
			const serviceId = workspace + "/" + url.pathname.split('/services/')[1].replace(/\//g, '');
			console.log('Connecting to Hypha File System Service at', server_url, serviceId, token)
			
			hyphaWebsocketClient.connectToServer({
				server_url: server_url,
				workspace: opts.workspace,
				token: opts.token
			}).then(async (server)=>{
				try {
					const mountedPath = `/${workspace}:${serviceId.split('/')[1]}`
					const fsAPI = await server.getService(serviceId)
					console.log('Got Hypha File System API:', fsAPI)

					
					AsyncFileSystem.Create({
						fileSystemId: serviceId,
						fsAPI: fsAPI
					}, async (error, afs) => {
						if (error || !afs) {
							console.error('Failed to create AsyncFileSystem:', error)
							reject(error)
							return
						}

						try {
							const _fs = BrowserFS.BFSRequire("fs");
							const rootFs = _fs.getRootFS();
							
							if (rootFs.mntMap[mountedPath]) {
								// already mounted
								rootFs.umount(mountedPath);
								console.warn(`Already mounted: ${mountedPath}, umounting...`);
							}
							rootFs.mount(mountedPath, afs)
							// update fs
							fs = patchFs();
							console.log('Mounted Hypha File System Service at', mountedPath);
						
							// Add to volumes first
							const netkey = addNetworkVolume(mountedPath, { read: 1, write: 1, locked: 0 }, 'hyphafs');

							setTimeout(() => {
								_private.info(mountedPath).then((info) => {
									info.netkey = netkey;
									resolve({
										added: [info],
									});
								}).catch((e) => {
									reject(e);
								});
							}, 100);
						}
						catch (e) {
							console.error('Failed to mount Hypha File System:', e)
							reject(e);
						}
					});
				}
				catch (e) {
					console.error('Failed to get Hypha File System service:', e)
					reject(e);
				}
			}).catch((e)=>{
				console.error('Failed to connect to Hypha server:', e)
				reject(e);
			})
		}
		else if (opts.host.startsWith('http') && opts.host.includes('/artifacts/')) {
			// This is a Hypha artifacts URL
			console.log('Connecting to Hypha Artifacts at', opts.host);
			
			// Extract server URL, workspace and artifact alias from URL
			const url = new URL(opts.host);
			const serverUrl = url.origin;
			const parts = url.pathname.split('/artifacts/');
			if (parts.length !== 2) {
				reject(new Error('Invalid artifact URL format'));
				return;
			}
			
			const workspace = decodeURIComponent(parts[0].replace(/^\//, ''));
			const artifactAlias = decodeURIComponent(parts[1].replace(/\/$/, ''));
			const fullArtifactId = `${workspace}/${artifactAlias}`;
			const token = opts.token;
			console.log('Extracted artifact info:', { serverUrl, workspace, artifactAlias, fullArtifactId, token });
			
			// Connect to Hypha server
			hyphaWebsocketClient.connectToServer({
				server_url: serverUrl,
				workspace:  opts.workspace,
				token
			}).then(async (server) => {
				try {
					const mountedPath = `/${workspace}:${artifactAlias}`
					
					// Get the artifact manager service
					const artifactManager = await server.getService("public/artifact-manager");
					console.log('Got artifact manager service');
					// Create the ArtifactFileSystem with the artifact manager
					ArtifactFileSystem.Create({
						baseUrl: opts.host,
						artifactManager: artifactManager,
						artifactId: fullArtifactId,
						readOnly: token ? false : true,
						_rkwargs: true // Enable Python kwargs simulation
					}, async (error, afs) => {
						if (error || !afs) {
							console.error('Failed to create ArtifactFileSystem:', error);
							reject(error);
							return;
						}

						try {
							const _fs = BrowserFS.BFSRequire("fs");
							const rootFs = _fs.getRootFS();
							
							// Check if already mounted and handle remounting
							if (rootFs.mntMap[mountedPath]) {
								try {
									console.log(`Unmounting existing path: ${mountedPath}`);
									rootFs.umount(mountedPath);
									// Remove from config.roots and config.volumes
									const mountIndex = config.roots.findIndex(r => r.path === mountedPath);
									if (mountIndex !== -1) {
										config.roots.splice(mountIndex, 1);
										config.volumes.splice(mountIndex, 1);
										config.volumeicons.splice(mountIndex, 1);
									}
								} catch (unmountError) {
									console.error('Failed to unmount existing path:', unmountError);
									// Continue with mounting even if unmount fails
								}
							}

							rootFs.mount(mountedPath, afs);
							// update fs
							fs = patchFs();
							console.log('Mounted Hypha Artifacts at', mountedPath);
							// Add to volumes first - permissions based on token availability
							const permissions = token ? { read: 1, write: 1, locked: 0 } : { read: 1, write: 0, locked: 1 };
							const netkey = addNetworkVolume(mountedPath, permissions, 'hypha_artifacts');

							setTimeout(() => {
								_private.info(mountedPath).then((info) => {
									info.netkey = netkey;
									resolve({
										added: [info],
									});
								}).catch((e) => {
									reject(e);
								});
							}, 100);
						} catch (e) {
							console.error('Failed to mount Hypha Artifacts:', e);
							reject(e);
						}
					});
				} catch (e) {
					console.error('Failed to get artifact manager service:', e);
					reject(e);
				}
			}).catch((e) => {
				console.error('Failed to connect to Hypha server:', e);
				reject(e);
			});
		}
		else {
			reject(`Invalid File System URI: ${opts.host}`);
		}

	})
}
api.open = async function (opts, res) {
	const data = {
		init: opts.init,
		netDrivers: ["s3", "hyphafs", "hypha_artifacts"],
		uplMaxFile: 1000,
		uplMaxSize: "102400.0M"
	};
	data.options = {
		disabled: config.disabled,
		uiCmdMap: [],
		tmbUrl: config.tmburl
	}
	const _init = opts.init === "1" || opts.reload === "1";
	let _target = opts.target;

	if (_init) {
		if (config.init) await config.init();
		data.api = "2.1";
		if (!_target) {
			_target = _private.encode(config.volumes[0] + path.sep);
		}
	}
	if (!_target) {
		throw new Error('errCmdParams');
	}
	//NOTE target must always be directory
	_target = _private.decode(_target);
	if(!_target) {
		_target = _private.decode("v0_Lw");
	}
	const result = await _private.info(_target.absolutePath)
	data.cwd = result;
	data.files = []
	const paths = await fs.readdir(_target.absolutePath);
	for (let file of paths) {
		data.files.push(await _private.info(path.join(_target.absolutePath, file)));
	}
	if (_init) {
		const volumes = await _private.init();
		data.files = volumes.concat(data.files);
	}
	return data;
}

api.parents = function (opts, res) {
	return new Promise(function (resolve, reject) {
		if (!opts.target) return reject('errCmdParams');
		var dir = _private.decode(opts.target);
		if (!dir) {
			return reject('Invalid target path or volume not mounted');
		}
		var tree;
		_private.init()
			.then(function (results) {
				tree = results;
				function read(t) {
					var folder = path.dirname(t);
					var isRoot = config.volumes.indexOf(t) >= 0;
					if (isRoot) {
						return resolve({
							tree: tree
						});
					} else {
						_private.readdir(folder)
							.then(function (files) {
								var tasks = [];
								each(files, function (file) {
									if (file.isdir) {
										tasks.push(_private.info(path.join(folder, file.name)));
									}
								})
								Promise.all(tasks)
									.then(function (folders) {
										tree = tree.concat(folders);
										read(folder);
									});
							})
							.catch(function (e) {
								reject(e);
							})
					}
				}
				read(dir.absolutePath);
			})
	})
}

api.paste = function (opts, res) {
	return new Promise(function (resolve, reject) {
		var tasks = [];
		var dest = _private.decode(opts.dst);
		each(opts.targets, function (target) {
			var info = _private.decode(target);
			var name = info.name;
			if (opts.renames && opts.renames.indexOf(info.name) >= 0) {
				var ext = path.extname(name);
				var fil = path.basename(name, ext);
				name = fil + opts.suffix + ext;
			}
			if (opts.cut == 1) {
				tasks.push(_private.move({
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
			.then(function (results) {
				var rtn = {
					added: [],
					removed: [],
					changed: []
				}
				each(results, function (r) {
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
			.catch(function (e) {
				reject(e);
			})
	})
}

api.rename = function (opts, res) {
	if (!opts.target) return Promise.reject('errCmdParams');
	var dir = _private.decode(opts.target);
	if (!dir) {
		return Promise.reject('Invalid target path or volume not mounted');
	}
	var dirname = path.dirname(dir.absolutePath);
	return _private.move({
		src: dir.absolutePath,
		dst: path.join(dirname, opts.name)
	})
}

api.resize = async function (opts, res) {
	const target = _private.decode(opts.target);
	if (!target) {
		throw new Error('Invalid target path or volume not mounted');
	}
	let image = await jimpRead(await fs.readFile(target.absolutePath))

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
	await saveImage(image.quality(parseInt(opts.quality)), target.absolutePath)
	const info = await _private.info(target.absolutePath);
	info.tmb = 1;
	return {
		changed: [info]
	}
}


async function removeDir(filePath) {
	if (await fs.exists(filePath)) {
		const files = await fs.readdir(filePath)
		if (files.length > 0) {
			for (let filename of files) {
				if ((await fs.stat(path.join(filePath, filename))).isDirectory()) {
					await removeDir(path.join(filePath, filename))
				} else {
					await fs.unlink(path.join(filePath, filename))
				}
			}
		}
		await fs.rmdir(filePath)
	}
}

api.rm = function (opts, res) {
	return new Promise(async function (resolve, reject) {
		var removed = [];
		for (let hash of opts.targets) {
			try {
				var target = _private.decode(hash);
				if (!target) {
					console.log('Invalid target path or volume not mounted:', hash);
					continue; // Skip this target and continue with others
				}
				if ((await fs.lstat(target.absolutePath)).isDirectory())
					await removeDir(target.absolutePath)
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
api.size = function (opts, res) {
	return Promise.resolve({
		size: 'unkown'
	});
}

async function walk(dir, data_callback) {
	const files = await fs.readdir(dir)
	for (let file of files) {
		const filepath = path.join(dir, file);
		const stats = await fs.stat(filepath)
		if (stats.isDirectory()) {
			await walk(filepath, callback);
		} else if (stats.isFile()) {
			await data_callback(filepath, stats);
		}
	}
}

api.search = function (opts, res) {
	return new Promise(async function (resolve, reject) {
		if (!opts.q || opts.q.length < 1) reject({
			message: 'errCmdParams'
		});
		var target = _private.decode(opts.target);
		var files = [];
		try {
			await walk(target.absolutePath, async (path) => {
				files.push(await _private.info(path));
			})
			resolve({
				files: files
			})
		}
		catch (err) {
			reject(err);
		}
	})
}

async function saveImage(img, path) {
	return new Promise((resolve, reject) => {
		img.getBase64(_private.getMime(path), async (err, res) => {
			try {
				if (err) {
					reject(err)
					return
				}
				const base64Response = await fetch(res);
				const blob = await base64Response.blob();
				await writeFile(path, blob);
				resolve()
			}
			catch (e) {
				reject(e)
			}
		})
	});
}

async function generateThumbnail(file) {
	try {
		// const stat = await fs.lstat(target.absolutePath);
		// if (stat.size > 1024 * 1024 * 100) return false;
		const buffer = await fs.readFile(file);
		const img = await jimpRead(buffer)
		const op = _private.encode(file);
		await saveImage(img.resize(48, 48), path.join(config.tmbroot, op + ".png"))
		return op
	}
	catch (e) {
		console.error(e)
		return false;
	}
}

api.tmb = function (opts, res) {
	return new Promise(async function (resolve, reject) {
		var files = [];
		if (opts.current) {
			var dir = _private.decode(opts.current);
			var items = await fs.readdir(dir.absolutePath);
			each(items, function (item) {
				var _m = _private.getMime(item);
				if (_m !== false && _m.indexOf('image/') == 0) {
					files.push(path.join(dir.absolutePath, item));
				}
			})
		} else if (opts.targets) {
			each(opts.targets, function (target) {
				var _t = _private.decode(target);
				files.push(_t.absolutePath);
			})
		}
		//create.
		var tasks = [];
		for (let file of files) {
			if (!file.startsWith(config.tmbroot)) {
				tasks.push(generateThumbnail(file));
			}
		}
		Promise.all(tasks)
			.then(function (hashes) {
				var rtn = {};
				each(hashes, function (hash) {
					if (hash)
						rtn[hash] = hash + '.png';
				})
				resolve({
					images: rtn
				});
			})
			.catch(function (err) {
				console.error(err);
				// reject(err);
				resolve({});
			})
	})
}

api.tree = function (opts, res) {
	return new Promise(function (resolve, reject) {
		if (!opts.target) return reject('errCmdParams');
		var dir = _private.decode(opts.target);
		_private.readdir(dir.absolutePath)
			.then(function (files) {
				var tasks = [];
				each(files, function (file) {
					if (file.isdir) {
						tasks.push(_private.info(path.join(dir.absolutePath, file.name)));
					}
				})
				return Promise.all(tasks);
			})
			.then(function (folders) {
				resolve({
					tree: folders
				});
			})
			.catch(function (e) {
				reject(e);
			})
	})
}


api.upload = function (opts, res) {
	return new Promise(async function (resolve, reject) {
		const target = opts.target || _private.encode(opts.target_path)
		const files = opts.upload
		const paths = opts.upload_path
		opts.targets = (paths && paths.length === files.length && paths) || files.map(() => target)
		const tasks = [];
		const targets = []
		let _chunkmerged = false;
		let _name;
		for (let i = 0; i < files.length; i++) {
			const target = _private.decode(opts.targets[i]);
			targets.push(target)
			console.log('uploading file', target, files[i])
			if (opts.chunk && opts.range) {
				const tmp = opts.chunk.split(".")
				const name = tmp.slice(0, tmp.length - 2).join(".")
				const tmp2 = opts.range.split(",").map(parseFloat)
				const offset = tmp2[0]
				if (tmp2[0] + tmp2[1] === tmp2[2]) {
					_chunkmerged = name;
					_name = name;
				}
				target.fileName = name;
				tasks.push(writeFile(path.join(target.absolutePath, name), files[i], offset, 'a', opts.progress))
			}
			else if (opts.chunk && !opts.range) {
				target.fileName = opts.chunk;
				tasks.push(fs.exists(path.join(target.absolutePath, target.fileName)))
			}
			else {
				target.fileName = path.basename(files[i].name);
				tasks.push(writeFile(path.join(target.absolutePath, target.fileName), files[i], 0, 'w', opts.progress))
			}
		}
		Promise.allSettled(tasks).then(async (values) => {
			try {
				// chunk merge request
				if (!opts.range && opts.chunk) {
					if (values[0]) {
						resolve({
							added: [await _private.info(path.join(targets[0].absolutePath, targets[0].fileName))]
						})
					}
					else {
						resolve({
							added: [],
							warning: "Failed to upload"
						})
					}
				}
				// chunking
				else if (!_chunkmerged && opts.chunk) {
					resolve({
						added: []
					})
				}
				// last chunk
				else if (_chunkmerged) {
					resolve({
						_chunkmerged,
						_name,
						added: [],
					})
				}
				// no chunking, for small files
				else {
					const added = []
					for (let i = 0; i < values.length; i++) {
						if (values[i].status === 'fulfilled') {
							added.push(await _private.info(path.join(targets[i].absolutePath, targets[i].fileName)))
						}
					}
					resolve({ 'added': added })

				}
			}
			catch (e) {
				reject(e)
			}

		}).catch((e) => {
			reject(e)
		})
	})
}

api.zipdl = function (opts, res) {
	return new Promise(function (resolve, reject) {
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
				.then(function () {
					resolve({
						zipdl: {
							file: _private.encode(file),
							name: name + '.zip',
							mime: 'application/zip'
						}
					})
				})
				.catch(function (err) {
					reject(err);
				})
		}
	})
}

_private.getMime = function (path) {
	return mime.getType(path) || "application/octet-stream";
}

_private.move = function (opts, res) {
	return new Promise(async function (resolve, reject) {
		// if (await fs.exists(opts.dst)) {
		// 	return reject('Destination exists');
		// }
		fs.rename(opts.src, opts.dst, function (err) {
			if (err) return reject(err);
			_private.info(opts.dst)
				.then(function (info) {
					resolve({
						added: [info],
						removed: opts.upload ? [] : [_private.encode(opts.src)]
					});
				})
				.catch(function (err) {
					reject(err);
				})
		})
	})
}

//_private
_private.compress = async function (files, dest) {
	var zip = new JSZip();
	for (let file of files) {
		var target = _private.decode(file);
		//check if target is file or dir
		if ((await fs.lstat(target.absolutePath))
			.isDirectory()) {
			const basePath = path.dirname(target.absolutePath);
			await walk(target.absolutePath, async (path) => {
				const relativePath = path.relative(basePath, path)
				zip.file(relativePath, await fs.readFile(path))
			})
		} else {
			const c = await fs.readFile(target.absolutePath);
			zip.file(target.name, c);
		}
	}
	const content = await zip.generateAsync({ type: "blob" })
	await writeFile(dest, content)
	return true
}

_private.decode = function (dir) {
	var root, code, name, volume;
	if (!dir || dir.length < 4) throw Error('Invalid Path');
	if (dir[0] != 'v' || dir[2] != '_') throw Error('Invalid Path');
	volume = parseInt(dir[1]);

	var relative = dir.substr(3, dir.length - 3)
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.replace(/\./g, '=');

	relative = decodeBase64(relative);
	name = path.basename(relative);
	// root might be undefined when volume is not mounted
	root = config.volumes[volume];
	return root && {
		volume: volume,
		dir: root,
		path: relative,
		name: name,
		absolutePath: path.join(root, relative)
	}
}

//Used by _private.info, api.opne, api.tmb, api.zipdl
_private.encode = function (dir) {
	var info = _private.parse(dir);
	var relative = encodeBase64(info.path);
	return 'v' + info.volume + '_' + relative;
}

_private.filepath = function (volume, filename) {
	if (volume < 0 || volume > 2) return null;
	return path.join(config.volumes[volume], path.normalize(filename));
}

_private.info = function (p) {
	return new Promise(function (resolve, reject) {
		var info = _private.parse(p);
		if (info.volume < 0) return reject('Volume not found');

		fs.stat(p, async function (err, stat) {
			if (err) return reject(err);
			var r = {
				name: path.basename(p),
				size: stat.size,
				hash: _private.encode(p),
				mime: stat.isDirectory() ? 'directory' : _private.getMime(p),
				ts: Math.floor(stat.mtime.getTime() / 1000),
				volumeid: 'v' + info.volume + '_',
				path: p, // expose real path
			}

			if (r.mime && r.mime.indexOf('image/') == 0) {
				var filename = _private.encode(p);
				var tmbPath = path.join(config.tmbroot, filename + ".png");
				try {
					if (await fs.exists(tmbPath)) {
						r.tmb = filename + '.png';
					} else {
						r.tmb = "1";
					}
				}
				catch (e) {
					console.error(e)
				}
			}

			if (!info.isRoot) {
				var parent = path.dirname(p);
				r.phash = _private.encode(parent);
			} else {
				const rootConfig = config.roots[info.volume];
				r.options = {
					disabled: config.disabled,
					archivers: {
						create: ['application/zip'],
						createext: {
							'application/zip': 'zip'
						}
					},
					// Use root path for hyphafs, otherwise use the default connector URL
					url: rootConfig.driver === 'hyphafs' ? rootConfig.path : rootConfig.url
				}
				if (config.volumeicons[info.volume]) {
					r.options.csscls = config.volumeicons[info.volume];
				}
				// Add netkey if this is a network volume
				if (rootConfig && rootConfig.netkey) {
					r.netkey = rootConfig.netkey;
				}
			}
			var acl = config.acl(p);
			r.read = acl.read;
			r.write = acl.write;
			r.locked = acl.locked;
			//check if this folder has child.
			r.isdir = (r.mime == 'directory');
			try {
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
			catch (e) {
				reject(e)
			}

		})
	})
}

_private.init = function () {
	var tasks = [];
	each(config.volumes, function (volume) {
		tasks.push(_private.info(volume));
	})

	return Promise.all(tasks)
		.then(function (results) {
			each(results, function (result) {
				result.phash = '';
			})
			return Promise.resolve(results);
		})
}

//Used by _private.encode & _private.info
_private.parse = function (p) {
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
_private.readdir = function (dir) {
	return new Promise(function (resolve, reject) {
		fs.readdir(dir, async function (err, items) {
			if (err) return reject(err);
			var files = [];
			for (let item of items) {
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

_private.suffix = function (name, suff) {
	var ext = path.extname(name);
	var fil = path.basename(name, ext);
	return fil + suff + ext;
}

_private.tmbfile = function (filename) {
	return path.join(config.tmbroot, filename);
}

//Used by _private.parse & config.acl
_private.volume = function (p) {
	for (var i = 0; i < config.volumes.length; i++) {
		if (p.indexOf(config.volumes[i]) == 0) {
			return i;
		}
	}
	return -1;
}
