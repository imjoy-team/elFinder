import {
    FileType,
    default as Stats
} from "browserfs/dist/node/core/node_fs_stats"
import { BaseFileSystem } from "browserfs/dist/node/core/file_system"
import { ApiError, ErrorCode } from "browserfs/dist/node/core/api_error"
import { BaseFile } from "browserfs/dist/node/core/file"
import { join } from "path"
import { Buffer } from "buffer"

function convertError(err, message = err.toString()) {
    console.debug('convertError', { error: err, message });
    if (err.code === "ENOENT") {
        return new ApiError(ErrorCode.ENOENT, message)
    } else if (err.code === "EACCES") {
        return new ApiError(ErrorCode.EACCES, message)
    } else if (err.code === "EEXIST") {
        return new ApiError(ErrorCode.EEXIST, message)
    } else {
        return new ApiError(ErrorCode.EIO, message)
    }
}

export class AsyncFile extends BaseFile {
    static _inMemoryStorage = new Map()
    constructor(asyncFile) {
        super()
        console.debug('AsyncFile.constructor', { asyncFile });
        this._asyncFile = asyncFile
        this._writePosition = 0
        this._pendingWrites = []
        this._writeInProgress = false
    }

    getPos() {
        console.debug('AsyncFile.getPos');
        const data = AsyncFile._inMemoryStorage.get(this._asyncFile.path)
        if (data) {
            return data.length
        }
        return undefined
    }

    async stat(cb) {
        console.debug('AsyncFile.stat');
        try {
            const stats = await this._asyncFile.stat()
            console.debug('AsyncFile.stat - got stats', stats);
            const fileSize = stats.size || 0
            const now = new Date()
            const stat = new Stats(FileType.FILE, fileSize, stats.mode || 0o666, now, now)
            cb(null, stat)
        } catch (err) {
            console.debug('AsyncFile.stat - error', err);
            if (err.code === 'ENOENT') {
                cb(ApiError.ENOENT(this._asyncFile.path));
            } else {
                cb(convertError(err));
            }
        }
    }

    statSync() {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async close(cb) {
        try {
            // Wait for any pending writes to complete
            if (this._pendingWrites.length > 0) {
                await this.sync()
            }
            await this._asyncFile.close()
            AsyncFile._inMemoryStorage.delete(this._asyncFile.path)
            cb(null)
        } catch (err) {
            cb(convertError(err))
        }
    }

    closeSync() {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async read(buffer, offset, length, position, cb) {
        try {
            // Check if we have data in memory first
            const inMemoryData = AsyncFile._inMemoryStorage.get(this._asyncFile.path)
            if (inMemoryData) {
                const bytesRead = inMemoryData.copy(buffer, offset, position, position + length)
                cb(null, bytesRead, buffer)
                return
            }

            // Otherwise read from the file
            const bytesRead = await this._asyncFile.read(buffer, offset, length, position)
            cb(null, bytesRead, buffer)
        } catch (err) {
            cb(convertError(err))
        }
    }

    readSync(_buffer, _offset, _length, _position) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async write(buffer, offset, length, position, cb) {
        console.debug('AsyncFile.write', { offset, length, position });
        try {
            if (position === undefined || position === null) {
                position = this._writePosition
            }

            const writeBuffer = Buffer.from(buffer.slice(offset, offset + length))
            console.debug('AsyncFile.write - buffer prepared', { writeBufferLength: writeBuffer.length });

            this._pendingWrites.push({
                buffer: writeBuffer,
                position: position
            })

            this._writePosition = position + length

            if (!this._writeInProgress) {
                await this._processWrites()
            }

            cb(null, length, buffer)
        } catch (err) {
            console.debug('AsyncFile.write - error', err);
            cb(convertError(err))
        }
    }

    writeSync(_buffer, _offset, _length, _position) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async _processWrites() {
        console.debug('AsyncFile._processWrites', { pendingWrites: this._pendingWrites.length });
        if (this._writeInProgress || this._pendingWrites.length === 0) {
            return
        }

        this._writeInProgress = true

        try {
            while (this._pendingWrites.length > 0) {
                const write = this._pendingWrites.shift()
                console.debug('AsyncFile._processWrites - processing write', { position: write.position, bufferLength: write.buffer.length });
                await this._asyncFile.write(write.buffer, 0, write.buffer.length, write.position)
            }
            console.debug('AsyncFile._processWrites - completed all writes');
        } catch (err) {
            console.debug('AsyncFile._processWrites - error', err);
            throw err;
        } finally {
            this._writeInProgress = false
        }
    }

    async sync(cb) {
        try {
            await this._processWrites()
            if (this._asyncFile.sync) {
                await this._asyncFile.sync()
            }
            cb(null)
        } catch (err) {
            cb(convertError(err))
        }
    }

    syncSync() {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async truncate(len, cb) {
        try {
            await this._asyncFile.truncate(len)
            this._writePosition = len
            cb(null)
        } catch (err) {
            cb(convertError(err))
        }
    }

    truncateSync(_len) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async chown(uid, gid, cb) {
        try {
            if (this._asyncFile.chown) {
                await this._asyncFile.chown(uid, gid)
            }
            cb(null)
        } catch (err) {
            cb(convertError(err))
        }
    }

    chownSync(_uid, _gid) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async chmod(mode, cb) {
        try {
            if (this._asyncFile.chmod) {
                await this._asyncFile.chmod(mode)
            }
            cb(null)
        } catch (err) {
            cb(convertError(err))
        }
    }

    chmodSync(_mode) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }

    async utimes(atime, mtime, cb) {
        try {
            if (this._asyncFile.utimes) {
                await this._asyncFile.utimes(atime, mtime)
            }
            cb(null)
        } catch (err) {
            cb(convertError(err))
        }
    }

    utimesSync(_atime, _mtime) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported")
    }
}

export class AsyncFileSystem extends BaseFileSystem {
    static Name = "AsyncFS"
    static Options = {
        fileSystemId: "string"
    }

    /**
     * Creates a new AsyncFileSystem instance.
     */
    static async Create(opts, cb) {
        console.debug('AsyncFileSystem.Create - START', { 
            hasOpts: !!opts,
            optsType: opts ? typeof opts : 'undefined',
            optsKeys: opts ? Object.keys(opts) : []
        });

        try {
            if (!opts) {
                throw new Error('Options object is required');
            }

            console.debug('AsyncFileSystem.Create - checking options', {
                hasFsAPI: !!opts.fsAPI,
                fsAPIType: opts.fsAPI ? typeof opts.fsAPI : 'undefined',
                fsAPIMethods: opts.fsAPI ? Object.keys(opts.fsAPI) : []
            });

            if (!opts.fsAPI) {
                throw new Error('Options object must contain fsAPI');
            }

            console.debug('AsyncFileSystem.Create - creating new instance');
            const fs = new AsyncFileSystem(opts);
            
            console.debug('AsyncFileSystem.Create - instance created', { 
                fsAPIMethods: Object.keys(fs.fsAPI),
                hasWriteFile: typeof fs.fsAPI.writeFile === 'function'
            });
            
            // Test connection with timeout
            const timeout = new Promise((_, reject) => {
                setTimeout(() => {
                    console.debug('AsyncFileSystem.Create - connection test timeout');
                    reject(new Error('Connection test timed out after 10 seconds'));
                }, 10000);
            });

            const connectionTest = new Promise((resolve, reject) => {
                console.debug('AsyncFileSystem.Create - starting connection test');
                fs.writeFile("/__connection_test__", "", "utf8", "w", 0o666, (err) => {
                    if (err) {
                        console.debug('AsyncFileSystem.Create - connection test failed', { 
                            error: err,
                            errorType: err.constructor.name,
                            errorMessage: err.message,
                            errorStack: err.stack,
                            fsAPIMethods: Object.keys(fs.fsAPI)
                        });
                        reject(err);
                        return;
                    }
                    console.debug('AsyncFileSystem.Create - connection test write successful');
                    resolve();
                });
            });

            console.debug('AsyncFileSystem.Create - waiting for connection test');
            await Promise.race([connectionTest, timeout]);

            console.debug('AsyncFileSystem.Create - connection test passed, starting cleanup');
            const cleanup = new Promise((resolve) => {
                fs.unlink("/__connection_test__", (err) => {
                    if (err) {
                        console.debug('AsyncFileSystem.Create - cleanup warning', { 
                            error: err,
                            errorType: err.constructor.name,
                            errorMessage: err.message,
                            errorStack: err.stack
                        });
                    }
                    console.debug('AsyncFileSystem.Create - cleanup complete');
                    resolve();
                });
            });

            await cleanup;
            console.debug('AsyncFileSystem.Create - SUCCESS - filesystem ready');
            cb(null, fs);
        } catch (e) {
            console.debug('AsyncFileSystem.Create - FAILED', { 
                error: e,
                errorType: e.constructor.name,
                errorMessage: e.message,
                errorStack: e.stack,
                hasOpts: !!opts,
                hasFsAPI: opts && !!opts.fsAPI,
                fsAPIMethods: opts && opts.fsAPI ? Object.keys(opts.fsAPI) : []
            });
            cb(convertError(e));
        }
    }

    static CreateAsync(opts) {
        return new Promise((resolve, reject) => {
            this.Create(opts, (error, fs) => {
                if (error || !fs) {
                    reject(error)
                } else {
                    resolve(fs)
                }
            })
        })
    }

    static isAvailable() {
        return true
    }

    constructor(config) {
        super();
        
        console.debug('AsyncFileSystem.constructor - START', { 
            hasConfig: !!config,
            configType: config ? typeof config : 'undefined',
            configKeys: config ? Object.keys(config) : []
        });

        if (!config) {
            throw new Error('Config object is required');
        }

        console.debug('AsyncFileSystem.constructor - checking fsAPI', {
            hasFsAPI: !!config.fsAPI,
            fsAPIType: config.fsAPI ? typeof config.fsAPI : 'undefined'
        });

        if (!config.fsAPI) {
            throw new Error('Config object must contain fsAPI');
        }

        const fsAPI = config.fsAPI;
        
        console.debug('AsyncFileSystem.constructor - analyzing fsAPI', { 
            availableMethods: Object.keys(fsAPI).sort(),
            fsAPIPrototype: Object.getPrototypeOf(fsAPI),
            fsAPIConstructor: fsAPI.constructor ? fsAPI.constructor.name : 'unknown'
        });

        // Check for required methods
        const requiredMethods = [
            'writeFile',
            'readFile',
            'stat',
            'unlink',
            'mkdir',
            'readdir'
        ];

        console.debug('AsyncFileSystem.constructor - checking required methods', {
            required: requiredMethods,
            available: Object.keys(fsAPI)
        });

        const missingMethods = requiredMethods.filter(method => {
            const hasMethod = typeof fsAPI[method] === 'function';
            console.debug('AsyncFileSystem.constructor - checking method', {
                method,
                exists: method in fsAPI,
                type: typeof fsAPI[method],
                isFunction: hasMethod
            });
            return !hasMethod;
        });

        if (missingMethods.length > 0) {
            console.debug('AsyncFileSystem.constructor - missing required methods', { 
                missingMethods,
                fsAPIMethods: Object.keys(fsAPI)
            });
            throw new Error(`Required methods not available in fsAPI: ${missingMethods.join(', ')}`);
        }

        console.debug('AsyncFileSystem.constructor - initialization successful', {
            methodsAvailable: Object.keys(fsAPI)
        });

        this.fsAPI = fsAPI;
        
        // Stats cache for improved performance
        this._statsCache = new Map();
        this._statsCacheExpiration = 5000; // 5 seconds expiration
        this._hasReaddirWithStats = typeof fsAPI.readdirwithstats === 'function';
        
        console.debug('AsyncFileSystem.constructor - cache initialized', {
            hasReaddirWithStats: this._hasReaddirWithStats
        });
    }

    getName() {
        return AsyncFileSystem.Name
    }

    isReadOnly() {
        return this.fsAPI.isReadOnly || false
    }

    supportsSymlinks() {
        return this.fsAPI.supportsLinks || false
    }

    supportsProps() {
        return this.fsAPI.supportsProps || false
    }

    supportsSynch() {
        return false
    }

    /**
     * Normalize a path by removing leading slash and ensuring proper directory markers
     */
    _normalizePath(p) {
        let normalized = p;
        if (p.startsWith("/") && p.length > 1) {
            normalized = p.substring(1);
        }
        return normalized;
    }

    /**
     * Check if a path exists and is a directory
     */
    async _isDirectory(p) {
        console.debug('AsyncFileSystem._isDirectory', { path: p });
        try {
            // Check cache first
            const normalizedPath = this._normalizePath(p);
            const cachedStats = this._getCachedStats(normalizedPath);
            if (cachedStats) {
                console.debug('AsyncFileSystem._isDirectory - using cached stats', { isDirectory: cachedStats.isDirectory });
                return cachedStats.isDirectory === true;
            }
            
            // Not in cache, fetch from remote
            const stats = await new Promise((resolve, reject) => {
                this.fsAPI.stat(p).then(resolve).catch(reject);
            });
            
            // Cache the stats
            this._cacheStats(normalizedPath, stats);
            
            // Now isDirectory is a direct value, not a function
            console.debug('AsyncFileSystem._isDirectory - result', { isDirectory: stats.isDirectory });
            return stats.isDirectory === true;
        } catch (err) {
            console.debug('AsyncFileSystem._isDirectory - error', err);
            return false;
        }
    }

    diskSpace(p, cb) {
        if (this.fsAPI.diskSpace) {
            this.fsAPI.diskSpace(p)
                .then(({ total, free }) => cb(null, total, free))
                .catch(err => cb(convertError(err)))
        } else {
            // Return large values if not supported
            cb(null, 1e15, 1e15)
        }
    }

    openFile(p, flag, cb) {
        p = this._normalizePath(p)
        this.fsAPI.openFile(p, flag)
            .then(file => cb(null, new AsyncFile(file)))
            .catch(err => cb(convertError(err)))
    }

    createFile(p, flag, mode, cb) {
        p = this._normalizePath(p)
        this.fsAPI.createFile(p, flag, mode)
            .then(file => cb(null, new AsyncFile(file)))
            .catch(err => cb(convertError(err)))
    }

    async open(p, flag, mode, cb) {
        console.debug('AsyncFileSystem.open', { path: p, flag, mode });
        p = this._normalizePath(p)
        this.stat(p, false, (err, stats) => {
            if (err) {
                if (err.errno === ErrorCode.ENOENT) {
                    console.debug('AsyncFileSystem.open - file not found, creating');
                    this.createFile(p, flag, mode, cb)
                } else {
                    console.debug('AsyncFileSystem.open - error', err);
                    cb(err)
                }
            } else {
                console.debug('AsyncFileSystem.open - file exists, opening');
                this.openFile(p, flag, cb)
            }
        })
    }

    rename(oldPath, newPath, cb) {
        oldPath = this._normalizePath(oldPath);
        newPath = this._normalizePath(newPath);
        this.fsAPI.rename(oldPath, newPath)
            .then(() => {
                // Invalidate cache for both paths
                this._invalidateCache(oldPath);
                this._invalidateCache(newPath);
                cb(null);
            })
            .catch(err => cb(convertError(err)));
    }

    async stat(p, isLstat, cb) {
        console.debug('AsyncFileSystem.stat', { path: p, isLstat });
        p = this._normalizePath(p);
        
        // Check cache first
        const cachedStats = this._getCachedStats(p);
        if (cachedStats) {
            console.debug('AsyncFileSystem.stat - using cached stats');
            // Convert to BrowserFS Stats object
            const isDir = cachedStats.isDirectory === true;
            const fileType = isDir ? FileType.DIRECTORY : FileType.FILE;
            const finalStats = new Stats(
                fileType,
                cachedStats.size || 0,
                cachedStats.mode || 0o666,
                cachedStats.atime ? new Date(cachedStats.atime * 1000) : new Date(),
                cachedStats.mtime ? new Date(cachedStats.mtime) : new Date()
            );
            cb(null, finalStats);
            return;
        }
        
        // Not in cache, fetch from remote
        this.fsAPI.stat(p).then((stats) => {
            console.debug('AsyncFileSystem.stat - got stats', { stats });
            
            // Cache the stats
            this._cacheStats(p, stats);
            
            // Now isDirectory is a direct value, not a function
            const isDir = stats.isDirectory === true;
            const fileType = isDir ? FileType.DIRECTORY : FileType.FILE;
            const finalStats = new Stats(
                fileType,
                stats.size || 0,
                stats.mode || 0o666,
                stats.atime ? new Date(stats.atime * 1000) : new Date(),
                // mtime is already a timestamp in milliseconds from Python
                stats.mtime ? new Date(stats.mtime) : new Date()
            );
            cb(null, finalStats);
        }).catch(err => {
            console.debug('AsyncFileSystem.stat - error', err);
            if (`${err}`.includes('FileNotFoundError')) {
                cb(ApiError.ENOENT(p));
            } else {
                cb(convertError(err));
            }
        });
    }

    async unlink(p, cb) {
        try {
            p = this._normalizePath(p);
            // Check if it's a directory first
            const isDir = await this._isDirectory(p);
            if (isDir) {
                cb(new ApiError(ErrorCode.EISDIR, "Path is a directory"));
                return;
            }
            await this.fsAPI.unlink(p);
            // Invalidate cache for this path
            this._invalidateCache(p);
            cb(null);
        } catch (err) {
            cb(convertError(err));
        }
    }

    async rmdir(p, cb) {
        try {
            p = this._normalizePath(p);
            // Ensure it's a directory
            const isDir = await this._isDirectory(p);
            if (!isDir) {
                cb(new ApiError(ErrorCode.ENOTDIR, "Path is not a directory"));
                return;
            }
            await this.fsAPI.rmdir(p);
            // Invalidate cache for this path
            this._invalidateCache(p);
            cb(null);
        } catch (err) {
            cb(convertError(err));
        }
    }

    async mkdir(p, mode, cb) {
        try {
            p = this._normalizePath(p);
            await this.fsAPI.mkdir(p, mode);
            // Invalidate cache for this path and parent
            this._invalidateCache(p);
            cb(null);
        } catch (err) {
            cb(convertError(err));
        }
    }

    async _readdirwithstats(p, cb) {
        p = this._normalizePath(p);
        
        try {
            // If we have the readdirwithstats API available, use it
            if (this._hasReaddirWithStats) {
                const filesWithStats = await this.fsAPI.readdirwithstats(p);
                
                // Process and cache the stats
                const processedFiles = filesWithStats.map((fileInfo) => {
                    console.debug('AsyncFileSystem._readdirwithstats - got stats', { stats: fileInfo });
                    
                    // Cache each file's stats - use proper path joining
                    const filePath = join(p, fileInfo.name);
                    const normalizedPath = this._normalizePath(filePath);
                    console.debug('AsyncFileSystem._readdirwithstats - caching stats', {
                        dirPath: p,
                        fileName: fileInfo.name,
                        joinedPath: filePath,
                        normalizedPath: normalizedPath
                    });
                    this._cacheStats(normalizedPath, fileInfo);
                    
                    // Now isDirectory is a direct value, not a function
                    const isDir = fileInfo.isDirectory === true;
                    const fileType = isDir ? FileType.DIRECTORY : FileType.FILE;
                    const finalStats = new Stats(
                        fileType,
                        fileInfo.size || 0,
                        fileInfo.mode || 0o666,
                        fileInfo.atime ? new Date(fileInfo.atime * 1000) : new Date(),
                        // mtime is already a timestamp in milliseconds from Python
                        fileInfo.mtime ? new Date(fileInfo.mtime) : new Date()
                    );
                    return {"name": fileInfo.name, "stats": finalStats, "isdir": isDir};
                });
                
                cb(null, processedFiles);
                return;
            }
            
            // If the API doesn't directly support it, we'll have to fetch stats individually
            // First get the directory listing
            const files = await this.fsAPI.readdir(p);
            
            // Create an array to store the results
            const filesWithStats = [];
            
            // Process each file
            for (const filename of files) {
                try {
                    // Use proper path joining
                    const filePath = join(p, filename);
                    const normalizedPath = this._normalizePath(filePath);
                    
                    // Check if we have stats in cache
                    let stats;
                    const cachedStats = this._getCachedStats(normalizedPath);
                    
                    if (cachedStats) {
                        stats = cachedStats;
                    } else {
                        // Fetch stats if not cached
                        stats = await this.fsAPI.stat(normalizedPath);
                        // Cache for future use
                        this._cacheStats(normalizedPath, stats);
                    }
                    
                    // Now isDirectory is a direct value, not a function
                    const isDir = stats.isDirectory === true;
                    const fileType = isDir ? FileType.DIRECTORY : FileType.FILE;
                    const finalStats = new Stats(
                        fileType,
                        stats.size || 0,
                        stats.mode || 0o666,
                        stats.atime ? new Date(stats.atime * 1000) : new Date(),
                        // mtime is already a timestamp in milliseconds from Python
                        stats.mtime ? new Date(stats.mtime) : new Date()
                    );
                    
                    filesWithStats.push({
                        "name": filename,
                        "stats": finalStats,
                        "isdir": isDir
                    });
                } catch (err) {
                    console.debug('AsyncFileSystem._readdirwithstats - error getting stats for file', { 
                        filename, 
                        error: err 
                    });
                    // Skip this file if we can't get stats
                }
            }
            
            cb(null, filesWithStats);
        } catch (err) {
            cb(convertError(err));
        }
    }

    async readdir(p, cb) {
        try {
            p = this._normalizePath(p);
            // Ensure path ends with a '/' if it's not empty
            if (p !== "" && !p.endsWith("/")) {
                p += "/";
            }

            console.debug('AsyncFileSystem.readdir - calling fsAPI', { 
                path: p,
                hasReaddirWithStats: this._hasReaddirWithStats
            });
            
            // If the backend supports readdirwithstats, use it and cache the results
            if (this._hasReaddirWithStats) {
                const filesWithStats = await this.fsAPI.readdirwithstats(p);
                console.debug('AsyncFileSystem.readdir - got readdirwithstats response', { 
                    filesLength: filesWithStats.length, 
                    firstItem: filesWithStats.length > 0 ? filesWithStats[0] : null
                });
                
                // Extract the filenames for the callback
                const fileNames = filesWithStats.map(item => item.name);
                
                // Cache each file's stats
                for (const fileInfo of filesWithStats) {
                    // Join the directory path and filename properly to prevent duplicated paths
                    const filePath = join(p, fileInfo.name);
                    const normalizedPath = this._normalizePath(filePath);
                    console.debug('AsyncFileSystem.readdir - caching stats', {
                        dirPath: p,
                        fileName: fileInfo.name,
                        joinedPath: filePath,
                        normalizedPath: normalizedPath
                    });
                    this._cacheStats(normalizedPath, fileInfo);
                }
                
                cb(null, fileNames);
                return;
            }
            
            // Fall back to regular readdir if readdirwithstats is not available
            const files = await this.fsAPI.readdir(p);
            console.debug('AsyncFileSystem.readdir - got response', { 
                filesLength: files.length, 
                firstItem: files.length > 0 ? files[0] : null,
                isArray: Array.isArray(files),
                responseType: typeof files
            });
            cb(null, files);
        } catch (err) {
            console.debug('AsyncFileSystem.readdir - error', err);
            cb(convertError(err));
        }
    }

    exists(p, cb) {
        p = this._normalizePath(p)
        this.fsAPI.exists(p)
            .then(exists => cb(exists))
            .catch(() => cb(false))
    }

    realpath(p, cache, cb) {
        p = this._normalizePath(p)
        this.fsAPI.realpath(p, cache)
            .then(path => cb(null, path))
            .catch(err => cb(convertError(err)))
    }

    truncate(p, len, cb) {
        p = this._normalizePath(p);
        this.fsAPI.truncate(p, len)
            .then(() => {
                // Invalidate cache for this path
                this._invalidateCache(p);
                cb(null);
            })
            .catch(err => cb(convertError(err)));
    }

    async readFile(fname, encoding, flag, cb) {
        console.debug('AsyncFileSystem.readFile', { fname, encoding, flag });
        fname = this._normalizePath(fname)
        try {
            const data = await this.fsAPI.readFile(fname, encoding, flag)
            console.debug('AsyncFileSystem.readFile - success', { dataLength: data.length });
            cb(null, data)
        } catch (err) {
            console.debug('AsyncFileSystem.readFile - error', err);
            cb(convertError(err))
        }
    }

    async writeFile(fname, data, encoding, flag, mode, cb) {
        console.debug('AsyncFileSystem.writeFile - START', { 
            fname, 
            encoding, 
            flag, 
            mode: mode ? mode.toString(8) : null,
            dataLength: data ? data.length : 0,
            hasCallback: !!cb,
            fsAPIMethods: Object.keys(this.fsAPI)
        });
        
        try {
            fname = this._normalizePath(fname);
            console.debug('AsyncFileSystem.writeFile - normalized path', { 
                originalPath: fname,
                normalizedPath: fname
            });
            
            console.debug('AsyncFileSystem.writeFile - checking writeFile method', {
                hasMethod: 'writeFile' in this.fsAPI,
                methodType: typeof this.fsAPI.writeFile
            });

            if (typeof this.fsAPI.writeFile !== 'function') {
                throw new Error('writeFile method not available or not a function in fsAPI');
            }

            // Pass mode directly without conversion - let the fsAPI handle it
            console.debug('AsyncFileSystem.writeFile - calling fsAPI.writeFile');
            const result = await this.fsAPI.writeFile(fname, data, encoding, flag, mode);
            
            console.debug('AsyncFileSystem.writeFile - fsAPI response', { 
                result,
                resultType: typeof result,
                isError: result && typeof result === 'object' && 'error' in result
            });

            if (result && typeof result === 'object' && 'error' in result) {
                throw new Error(result.error);
            }
            
            // Invalidate cache for this file
            this._invalidateCache(fname);
            
            console.debug('AsyncFileSystem.writeFile - SUCCESS');
            if (cb) cb(null);
        } catch (err) {
            console.debug('AsyncFileSystem.writeFile - FAILED', { 
                error: err,
                errorType: err.constructor.name,
                errorMessage: err.message,
                errorStack: err.stack,
                fsAPIMethods: Object.keys(this.fsAPI)
            });
            if (cb) cb(convertError(err));
        }
    }

    appendFile(fname, data, encoding, flag, mode, cb) {
        fname = this._normalizePath(fname);
        this.fsAPI.appendFile(fname, data, encoding, flag, mode)
            .then(() => {
                // Invalidate cache for this path
                this._invalidateCache(fname);
                cb(null);
            })
            .catch(err => cb(convertError(err)));
    }

    chmod(p, isLchmod, mode, cb) {
        p = this._normalizePath(p);
        this.fsAPI.chmod(p, isLchmod, mode)
            .then(() => {
                // Invalidate cache for this path
                this._invalidateCache(p);
                cb(null);
            })
            .catch(err => cb(convertError(err)));
    }

    chown(p, isLchown, uid, gid, cb) {
        p = this._normalizePath(p)
        this.fsAPI.chown(p, isLchown, uid, gid)
            .then(() => cb(null))
            .catch(err => cb(convertError(err)))
    }

    utimes(p, atime, mtime, cb) {
        p = this._normalizePath(p);
        this.fsAPI.utimes(p, atime, mtime)
            .then(() => {
                // Invalidate cache for this path
                this._invalidateCache(p);
                cb(null);
            })
            .catch(err => cb(convertError(err)));
    }

    link(srcpath, dstpath, cb) {
        srcpath = this._normalizePath(srcpath)
        dstpath = this._normalizePath(dstpath)
        this.fsAPI.link(srcpath, dstpath)
            .then(() => cb(null))
            .catch(err => cb(convertError(err)))
    }

    symlink(srcpath, dstpath, type, cb) {
        srcpath = this._normalizePath(srcpath)
        dstpath = this._normalizePath(dstpath)
        this.fsAPI.symlink(srcpath, dstpath, type)
            .then(() => cb(null))
            .catch(err => cb(convertError(err)))
    }

    readlink(p, cb) {
        p = this._normalizePath(p)
        this.fsAPI.readlink(p)
            .then(link => cb(null, link))
            .catch(err => cb(convertError(err)))
    }

    // Add cache management methods
    
    /**
     * Cache stats for a file path
     * @param {string} path Normalized path
     * @param {Object} stats Stats object to cache
     */
    _cacheStats(path, stats) {
        const now = Date.now();
        this._statsCache.set(path, {
            stats,
            timestamp: now,
            expires: now + this._statsCacheExpiration
        });
    }

    /**
     * Get cached stats for a path if available and not expired
     * @param {string} path Normalized path
     * @returns {Object|null} Stats object or null if not cached or expired
     */
    _getCachedStats(path) {
        const cached = this._statsCache.get(path);
        if (cached && cached.expires > Date.now()) {
            console.debug('AsyncFileSystem - returning cached stats', { path });
            return cached.stats;
        }
        
        // Expired or not found
        if (cached) {
            console.debug('AsyncFileSystem - cached stats expired', { path });
            this._statsCache.delete(path);
        }
        
        return null;
    }

    /**
     * Invalidate stats cache for a specific path
     * @param {string} path Path to invalidate
     */
    _invalidateCache(path) {
        console.debug('AsyncFileSystem - invalidating cache', { path });
        
        // Normalize the path first
        path = this._normalizePath(path);
        
        // Remove the specific path
        this._statsCache.delete(path);
        
        // Also invalidate parent directory to reflect changes in listings
        const parentDir = path.substring(0, path.lastIndexOf('/'));
        if (parentDir) {
            this._statsCache.delete(parentDir);
        }
    }

    /**
     * Clear the entire stats cache
     */
    _clearCache() {
        console.debug('AsyncFileSystem - clearing entire cache');
        this._statsCache.clear();
    }
}
