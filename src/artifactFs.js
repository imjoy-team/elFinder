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

export class ArtifactFile extends BaseFile {
    constructor(fileData, parent) {
        super()
        this._fileData = fileData;
        this._parent = parent;
        this._position = 0;
        this._content = null;
        // Add write buffer and state
        this._writeBuffer = [];
        this._writeBufferSize = 0;
        this._maxBufferSize = 1024 * 1024; // 1MB buffer size before flushing
        this._isWriting = false;
        this._writeStream = null;
    }

    async _ensureContent() {
        if (this._content === null) {
            try {
                // Get file URL from the artifact manager
                const url = await this._parent.artifactManager.get_file(
                    this._parent.artifactId,
                    this._fileData.path
                );
                
                // Fetch the file content
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error('Failed to fetch file content');
                }
                
                // Convert to Buffer
                const arrayBuffer = await response.arrayBuffer();
                this._content = Buffer.from(arrayBuffer);
            } catch (error) {
                console.error(`Error loading file content for ${this._fileData.path}:`, error);
                throw error;
            }
        }
        return this._content;
    }

    async stat(cb) {
        try {
            const fileSize = this._fileData.size || 0;
            const mtime = this._fileData.mtime ? new Date(this._fileData.mtime) : new Date();
            const mode = 0o666; // Default mode for files
            const stat = new Stats(FileType.FILE, fileSize, mode, mtime, mtime);
            cb(null, stat);
        } catch (err) {
            cb(convertError(err));
        }
    }

    statSync() {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    async close(cb) {
        try {
            // Flush any remaining data
            if (this._writeBuffer.length > 0) {
                await this._flushBuffer();
            }

            // Close write stream if it exists
            if (this._writeStream) {
                this._writeStream = null;
            }

            // Clear the content to free memory
            this._content = null;
            this._position = 0;
            this._writeBuffer = [];
            this._writeBufferSize = 0;
            
            cb(null);
        } catch (err) {
            cb(convertError(err));
        }
    }

    closeSync() {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    async read(buffer, offset, length, position, cb) {
        try {
            // Ensure we have the content
            const content = await this._ensureContent();
            if (!content) {
                return cb(ApiError.ENOENT(this._fileData.path));
            }
            
            // Set position if not provided
            if (position === null || position === undefined) {
                position = this._position;
            }
            
            // Ensure position is valid
            if (position >= content.length) {
                // Reading past the end returns 0 bytes read
                return cb(null, 0, buffer);
            }
            
            // Calculate how many bytes we can actually read
            const bytesToRead = Math.min(length, content.length - position);
            
            // Copy the data to the buffer
            const bytesRead = content.copy(buffer, offset, position, position + bytesToRead);
            
            // Update position
            this._position = position + bytesRead;
            
            // Return the result
            cb(null, bytesRead, buffer);
        } catch (err) {
            console.error(`Error reading file ${this._fileData.path}:`, err);
            cb(convertError(err));
        }
    }

    readSync(_buffer, _offset, _length, _position) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    async write(buffer, offset, length, position, cb) {
        try {
            if (position !== null && position !== undefined) {
                this._position = position;
            }

            // Create a copy of the data we're writing
            const chunk = Buffer.alloc(length);
            buffer.copy(chunk, 0, offset, offset + length);
            
            // Add to write buffer
            this._writeBuffer.push({
                data: chunk,
                position: this._position
            });
            this._writeBufferSize += length;
            this._position += length;

            // If buffer is full, flush it
            if (this._writeBufferSize >= this._maxBufferSize) {
                await this._flushBuffer();
            }

            cb(null, length, buffer);
        } catch (err) {
            console.error(`Error writing to file:`, err);
            cb(convertError(err));
        }
    }

    async _flushBuffer() {
        if (this._writeBuffer.length === 0) return;

        try {
            // Sort chunks by position to ensure correct order
            this._writeBuffer.sort((a, b) => a.position - b.position);

            // Combine all chunks into one buffer
            const totalSize = this._writeBufferSize;
            const combinedBuffer = Buffer.alloc(totalSize);
            let offset = 0;

            for (const chunk of this._writeBuffer) {
                chunk.data.copy(combinedBuffer, offset);
                offset += chunk.data.length;
            }

            // Get upload URL if we don't have one
            if (!this._writeStream) {
                // First, put the artifact in staging mode
                await this._parent.artifactManager.edit({
                    artifact_id: this._parent.artifactId,
                    stage: true,
                    comment: "File upload via elFinder",
                    _rkwargs: true
                });

                const putUrl = await this._parent.artifactManager.put_file({
                    artifact_id: this._parent.artifactId,
                    file_path: this._fileData.path,
                    download_weight: this._fileData.download_weight || 0,
                    _rkwargs: true
                });
                
                // Create write stream using fetch
                this._writeStream = await fetch(putUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': ''
                    },
                    body: combinedBuffer
                });

                if (!this._writeStream.ok) {
                    throw new Error(`Failed to upload file: ${this._writeStream.statusText}`);
                }

                // After successful upload, commit the artifact
                await this._parent.artifactManager.commit({
                    artifact_id: this._parent.artifactId,
                    comment: "File upload completed via elFinder",
                    _rkwargs: true
                });
            }

            // Clear buffer
            this._writeBuffer = [];
            this._writeBufferSize = 0;
        } catch (err) {
            console.error('Error flushing write buffer:', err);
            throw err;
        }
    }

    writeSync(_buffer, _offset, _length, _position) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    async sync(cb) {
        // Nothing to sync in a read-only file system
        cb(null);
    }

    syncSync() {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    async truncate(len, cb) {
        if (this._parent.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "File truncation not supported"));
    }

    truncateSync(_len) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    // No-op implementations for unsupported operations
    
    async chown(uid, gid, cb) {
        if (this._parent.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "File ownership change not supported"));
    }

    chownSync(_uid, _gid) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    async chmod(mode, cb) {
        if (this._parent.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "File permission change not supported"));
    }

    chmodSync(_mode) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }

    async utimes(atime, mtime, cb) {
        if (this.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "File time modification not supported"));
    }

    utimesSync(_atime, _mtime) {
        throw new ApiError(ErrorCode.ENOTSUP, "Synchronous operations not supported");
    }
}

export class ArtifactFileSystem extends BaseFileSystem {
    static Name = "ArtifactFS";
    static Options = {
        baseUrl: "string"
    };

    /**
     * Creates a new ArtifactFileSystem instance.
     */
    static async Create(opts, cb) {
        console.debug('ArtifactFileSystem.Create - START', { opts });

        try {
            if (!opts || !opts.baseUrl) {
                throw new Error('Options object must contain baseUrl');
            }

            console.debug('ArtifactFileSystem.Create - creating new instance');
            const fs = new ArtifactFileSystem(opts);
            
            console.debug('ArtifactFileSystem.Create - initializing artifact manager');
            await fs._initArtifactManager();
            
            console.debug('ArtifactFileSystem.Create - SUCCESS - filesystem ready');
            cb(null, fs);
        } catch (e) {
            console.debug('ArtifactFileSystem.Create - FAILED', { 
                error: e,
                errorType: e.constructor.name,
                errorMessage: e.message,
                errorStack: e.stack
            });
            cb(convertError(e));
        }
    }

    static CreateAsync(opts) {
        return new Promise((resolve, reject) => {
            this.Create(opts, (error, fs) => {
                if (error || !fs) {
                    reject(error);
                } else {
                    resolve(fs);
                }
            });
        });
    }

    static isAvailable() {
        return true;
    }

    constructor(config) {
        super();
        
        if (!config || !config.artifactManager) {
            throw new Error('Config object must contain artifactManager');
        }

        if (!config.artifactId) {
            throw new Error('Config object must contain artifactId');
        }

        this.artifactManager = config.artifactManager;
        this.artifactId = config.artifactId;
        this._fileCache = new Map(); // Cache file stats by path
        this._directoryCache = new Map(); // Cache directory existence
        this.isCollection = false;
        this.childArtifacts = null;
        this.readOnly = config.readOnly !== undefined ? config.readOnly : true;
    }

    /**
     * Cache file stats for later use
     */
    _cacheFileStats(path, fileInfo) {
        this._fileCache.set(path, {
            name: fileInfo.name,
            type: fileInfo.type,
            size: fileInfo.size || 0,
            mtime: fileInfo.last_modified || Date.now()
        });
    }

    /**
     * Get cached file stats
     */
    _getCachedFileStats(path) {
        return this._fileCache.get(path);
    }

    async _initArtifactManager() {
        try {
            // Read the artifact to determine if it's a collection
            const artifact = await this.artifactManager.read(this.artifactId);
            console.debug('ArtifactFileSystem - artifact info fetched', { 
                artifactId: this.artifactId,
                type: artifact.type
            });
            
            this.isCollection = artifact.type === 'collection';
            
            if (this.isCollection) {
                const children = await this.artifactManager.list({artifact_id: this.artifactId, stage: "all", _rkwargs: true});
                console.debug('ArtifactFileSystem - collection children fetched', { children });
                
                this.childArtifacts = children.map(child => ({
                    name: child.alias || child.id,
                    id: child.id,
                    type: child.type
                }));
            } else {
                // Pre-fetch and cache root directory files
                const files = await this.artifactManager.list_files(this.artifactId);
                files.forEach(file => {
                    this._cacheFileStats(file.name, file);
                });
                console.debug('ArtifactFileSystem - root directory fetched', { fileCount: files.length });
            }
        } catch (error) {
            console.error('Failed to initialize artifact manager', error);
            throw error;
        }
    }

    getName() {
        return ArtifactFileSystem.Name;
    }

    isReadOnly() {
        return this.readOnly;
    }

    supportsSymlinks() {
        return false; // No symlink support
    }

    supportsProps() {
        return false; // No extended property support
    }

    supportsSynch() {
        return false; // No synchronous operations
    }

    /**
     * Normalize a path by removing leading slash
     */
    _normalizePath(p) {
        let normalized = p;
        if (p.startsWith("/") && p.length > 1) {
            normalized = p.substring(1);
        }
        return normalized;
    }

    /**
     * Check if a path is a directory by checking cache and special cases
     */
    async _isDirectory(p) {
        console.debug('ArtifactFileSystem._isDirectory', { path: p });
        try {
            const normalizedPath = this._normalizePath(p);
            
            // Special case 1: Root directory
            if (!normalizedPath || normalizedPath === '' || normalizedPath === '/') {
                return true;
            }

            // Special case 2: First level path in a collection
            if (this.isCollection) {
                const parts = normalizedPath.split('/');
                if (parts.length === 1) {
                    // Check if this matches any child artifact
                    return this.childArtifacts.some(child => child.name === parts[0]);
                }
            }

            // Check the file cache first
            const cachedStats = this._getCachedFileStats(normalizedPath);
            if (cachedStats) {
                return cachedStats.type === 'directory';
            }

            // If not in cache, we need to check the parent directory
            const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/') || 0);
            
            // Get parent directory listing (this will populate the cache)
            await this._getDirectoryListing(parentPath);
            
            // Now check the cache again
            const statsAfterListing = this._getCachedFileStats(normalizedPath);
            return statsAfterListing ? statsAfterListing.type === 'directory' : false;
        } catch (err) {
            console.debug('ArtifactFileSystem._isDirectory - error', err);
            return false;
        }
    }

    async _getDirectoryListing(p) {
        console.debug('ArtifactFileSystem._getDirectoryListing', { path: p, isCollection: this.isCollection });
        
        const normalizedPath = this._normalizePath(p);
        
        try {
            let files;
            
            if (this.isCollection) {
                if (!normalizedPath || normalizedPath === '' || normalizedPath === '/') {
                    // For root directory of a collection, return child artifacts as directories
                    return this.childArtifacts.map(child => ({
                        name: child.name,
                        type: 'directory',
                        size: 0,
                        last_modified: Date.now()
                    }));
                } else {
                    // For subdirectories, find the child artifact
                    const parts = normalizedPath.split('/');
                    const childName = parts[0];
                    const childArtifact = this.childArtifacts.find(c => c.name === childName);
                    
                    if (!childArtifact) {
                        throw new Error('Child artifact not found');
                    }
                    
                    const remainingPath = parts.slice(1).join('/');
                    files = await this.artifactManager.list_files(childArtifact.id, remainingPath);
                }
            } else {
                files = await this.artifactManager.list_files(this.artifactId, normalizedPath);
            }

            // Cache file stats
            files.forEach(file => {
                const filePath = normalizedPath ? `${normalizedPath}/${file.name}` : file.name;
                this._cacheFileStats(filePath, file);
                if (file.type === 'directory') {
                    this._directoryCache.set(filePath, true);
                }
            });
            
            return files;
        } catch (error) {
            console.error(`Error fetching directory listing for path: ${normalizedPath}`, error);
            throw error;
        }
    }

    diskSpace(p, cb) {
        // Return large values since we can't determine actual space
        cb(null, 1e15, 1e15);
    }

    async open(p, flag, mode, cb) {
        console.debug('ArtifactFileSystem.open', { path: p, flag, mode });
        
        try {
            if (flag.isWriteable() && this.readOnly) {
                return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
            }
            
            const normalizedPath = this._normalizePath(p);
            
            // Check if it's a directory
            const isDirectory = await this._isDirectory(normalizedPath);
            if (isDirectory) {
                return cb(new ApiError(ErrorCode.EISDIR, "Path is a directory"));
            }
            
            const fileName = normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1 || 0);
            
            // For write mode, create a new file regardless of cache or existence
            if (flag.isWriteable()) {
                const standardFileInfo = {
                    path: normalizedPath,
                    name: fileName,
                    size: 0,
                    mtime: Date.now(),
                };
                
                // Cache the file info
                this._fileCache.set(normalizedPath, standardFileInfo);
                
                return cb(null, new ArtifactFile(standardFileInfo, this));
            }
            
            // For read mode, check cache first
            if (this._fileCache.has(normalizedPath)) {
                return cb(null, new ArtifactFile(this._fileCache.get(normalizedPath), this));
            }
            
            // Find the file in its parent directory for read mode
            const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/') || 0);
            
            try {
                const parentListing = await this._getDirectoryListing(parentPath);
                
                // Find the file in the directory listing
                const fileInfo = parentListing.find(file => {
                    // Handle different file info formats
                    if (typeof file === 'string') {
                        return file === fileName;
                    } else {
                        // The file structure might contain full paths or just filenames
                        const filePath = file.path || file.name || '';
                        const fileBasename = filePath.includes('/') ? 
                            filePath.substring(filePath.lastIndexOf('/') + 1) : filePath;
                        return fileBasename === fileName;
                    }
                });
                
                if (!fileInfo) {
                    return cb(ApiError.ENOENT(p));
                }
                
                // Create standard file info format
                const standardFileInfo = {
                    path: normalizedPath,
                    name: fileName,
                    size: typeof fileInfo === 'string' ? 0 : (fileInfo.size || 0),
                    mtime: typeof fileInfo === 'string' ? Date.now() : (fileInfo.mtime || Date.now()),
                };
                
                // Cache the file info
                this._fileCache.set(normalizedPath, standardFileInfo);
                
                cb(null, new ArtifactFile(standardFileInfo, this));
            } catch (err) {
                console.error('Error getting parent directory listing:', err);
                cb(ApiError.ENOENT(p));
            }
        } catch (err) {
            console.error('ArtifactFileSystem.open - error', err);
            cb(convertError(err));
        }
    }

    async stat(p, isLstat, cb) {
        console.debug('ArtifactFileSystem.stat', { path: p, isLstat });
        
        try {
            const normalizedPath = this._normalizePath(p);
            
            // Special case for root
            if (normalizedPath === '' || normalizedPath === '/') {
                const stats = new Stats(FileType.DIRECTORY, 4096, 0o777, new Date(), new Date());
                return cb(null, stats);
            }
            
            // Check if it's a directory
            const isDirectory = await this._isDirectory(normalizedPath);
            
            if (isDirectory) {
                const stats = new Stats(FileType.DIRECTORY, 4096, 0o777, new Date(), new Date());
                return cb(null, stats);
            }
            
            // Check cache for file stats
            const cachedStats = this._getCachedFileStats(normalizedPath);
            if (cachedStats) {
                const stats = new Stats(
                    FileType.FILE,
                    cachedStats.size,
                    0o666,
                    new Date(),
                    new Date(cachedStats.mtime)
                );
                return cb(null, stats);
            }
            
            // If not in cache, get parent directory listing to find file
            const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/') || 0);
            const files = await this._getDirectoryListing(parentPath);
            const fileBaseName = normalizedPath.includes('/') ?
                normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1) : normalizedPath;
            const file = files.find(f => f.name === fileBaseName);
            
            if (!file) {
                return cb(ApiError.ENOENT(p));
            }
            
            const stats = new Stats(
                file.type === 'directory' ? FileType.DIRECTORY : FileType.FILE,
                file.size || 0,
                0o666,
                new Date(),
                new Date(file.last_modified)
            );
            
            cb(null, stats);
        } catch (err) {
            console.error('ArtifactFileSystem.stat - error', err);
            cb(convertError(err));
        }
    }

    async readdir(p, cb) {
        console.debug('ArtifactFileSystem.readdir', { path: p });
        
        try {
            const normalizedPath = this._normalizePath(p);
            
            // Ensure it's a directory
            const isDirectory = await this._isDirectory(normalizedPath);
            if (!isDirectory) {
                return cb(new ApiError(ErrorCode.ENOTDIR, "Path is not a directory"));
            }
            
            // Get directory listing
            const files = await this._getDirectoryListing(normalizedPath);
            const filenames = files.map(file => file.name);
            cb(null, filenames);
        } catch (err) {
            console.error('ArtifactFileSystem.readdir - error', err);
            cb(convertError(err));
        }
    }

    // These methods are required but will return errors for write operations
    
    async unlink(p, cb) {
        console.debug('ArtifactFileSystem.unlink', { path: p });
        try {
            const normalizedPath = this._normalizePath(p);
            
            // Check if it's a directory
            const isDirectory = await this._isDirectory(normalizedPath);
            if (isDirectory) {
                // For directories, we need to recursively remove all files
                const files = await this._getDirectoryListing(normalizedPath);
                for (const file of files) {
                    if (file.type === 'file') {
                        const filePath = normalizedPath ? `${normalizedPath}/${file.name}` : file.name;
                        await this.artifactManager.remove_file(this.artifactId, filePath);
                    } else if (file.type === 'directory') {
                        // Recursively remove files in subdirectories
                        const subPath = normalizedPath ? `${normalizedPath}/${file.name}` : file.name;
                        await this.unlink(subPath, (err) => {
                            if (err) throw err;
                        });
                    }
                }
                cb(null);
            } else {
                // For single files, just remove the file
                await this.artifactManager.remove_file(this.artifactId, normalizedPath);
                // Clear the file from cache
                this._fileCache.delete(normalizedPath);
                cb(null);
            }
        } catch (err) {
            console.error('ArtifactFileSystem.unlink - error', err);
            if (err.message === "Artifact must be in staging mode.") {
                cb(new ApiError(ErrorCode.EPERM, "Cannot remove file: artifact must be in staging mode"));
            } else {
                cb(convertError(err));
            }
        }
    }

    async rmdir(p, cb) {
        if (this.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "Directory removal not supported"));
    }

    async mkdir(p, mode, cb) {
        if (this.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "Directory creation not supported"));
    }

    exists(p, cb) {
        p = this._normalizePath(p);
        this.stat(p, false, (err) => {
            cb(!err);
        });
    }

    realpath(p, cache, cb) {
        p = this._normalizePath(p);
        // For a read-only remote system, the path is already the real path
        cb(null, p);
    }

    truncate(p, len, cb) {
        if (this.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "File truncation not supported"));
    }

    async readFile(fname, encoding, flag, cb) {
        console.debug('ArtifactFileSystem.readFile', { fname, encoding, flag });
        fname = this._normalizePath(fname);
        try {
            // Get the file URL from the artifact manager
            const url = await this.artifactManager.get_file(this.artifactId, fname);
            
            // Fetch the file content
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Failed to read file');
            }
            
            // Return the content based on encoding
            if (encoding) {
                const data = await response.text();
                cb(null, data);
            } else {
                const buffer = Buffer.from(await response.arrayBuffer());
                cb(null, buffer);
            }
        } catch (err) {
            console.debug('ArtifactFileSystem.readFile - error', err);
            cb(convertError(err));
        }
    }

    // Write operations will return permission errors
    
    async writeFile(fname, data, encoding, flag, mode, cb) {
        console.debug('ArtifactFileSystem.writeFile', { fname, encoding, flag });
        fname = this._normalizePath(fname);
        try {
            // Get upload URL
            const putUrl = await this.artifactManager.put_file(this.artifactId, fname);

            // Convert data to Buffer if it's a string
            const buffer = (typeof data === 'string') ? Buffer.from(data, encoding) : data;

            // Upload using fetch
            const response = await fetch(putUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/octet-stream'
                },
                body: buffer
            });

            if (!response.ok) {
                throw new Error(`Failed to upload file: ${response.statusText}`);
            }

            cb(null);
        } catch (err) {
            console.debug('ArtifactFileSystem.writeFile - error', err);
            cb(convertError(err));
        }
    }

    appendFile(fname, data, encoding, flag, mode, cb) {
        if (this.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "File append not supported"));
    }

    chmod(p, isLchmod, mode, cb) {
        cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
    }

    chown(p, isLchown, uid, gid, cb) {
        cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
    }

    utimes(p, atime, mtime, cb) {
        if (this.readOnly) {
            return cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
        }
        cb(new ApiError(ErrorCode.ENOTSUP, "File time modification not supported"));
    }

    link(srcpath, dstpath, cb) {
        cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
    }

    symlink(srcpath, dstpath, type, cb) {
        cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
    }

    readlink(p, cb) {
        cb(new ApiError(ErrorCode.EPERM, "Read-only file system"));
    }
} 