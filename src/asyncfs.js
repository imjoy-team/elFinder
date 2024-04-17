export class AsyncFile {
    constructor(asyncFile) {
        this.asyncFile = asyncFile;
    }

    stat(cb) {
        this.asyncFile.stat()
            .then(stats => cb(null, stats))
            .catch(err => cb(err));
    }

    close(cb) {
        this.asyncFile.close()
            .then(() => cb(null))
            .catch(err => cb(err));
    }

    truncate(len, cb) {
        this.asyncFile.truncate(len)
            .then(() => cb(null))
            .catch(err => cb(err));
    }

    sync(cb) {
        this.asyncFile.sync()
            .then(() => cb(null))
            .catch(err => cb(err));
    }

    write(buffer, offset, length, position, cb) {
        this.asyncFile.write(buffer, offset, length, position)
            .then(bytesWritten => cb(null, bytesWritten, buffer))
            .catch(err => cb(err));
    }

    read(buffer, offset, length, position, cb) {
        this.asyncFile.read(buffer, offset, length, position)
            .then(bytesRead => cb(null, bytesRead, buffer))
            .catch(err => cb(err));
    }

    datasync(cb) {
        this.asyncFile.datasync()
            .then(() => cb(null))
            .catch(err => cb(err));
    }

    chown(uid, gid, cb) {
        this.asyncFile.chown(uid, gid)
            .then(() => cb(null))
            .catch(err => cb(err));
    }

    chmod(mode, cb) {
        this.asyncFile.chmod(mode)
            .then(() => cb(null))
            .catch(err => cb(err));
    }

    utimes(atime, mtime, cb) {
        this.asyncFile.utimes(atime, mtime)
            .then(() => cb(null))
            .catch(err => cb(err));
    }
}

export class AsyncFileSystem {
    constructor(fsAPI) {
        this.fsAPI = fsAPI
    }
    getName() {
        return this.fsAPI.name
    }
    isReadOnly() {
        return this.fsAPI.isReadOnly
    }
    supportsLinks() {
        return this.fsAPI.supportsLinks
    }
    supportsProps() {
        return this.fsAPI.supportsProps
    }
    supportsSynch() {
        // synchroneous operations are not supported
        return false;
    }

    diskSpace(p, cb) {
        this.fsAPI
            .diskSpace(p)
            .then(({ total, free }) => cb(null, total, free))
            .catch(err => cb(err))
    }

    openFile(p, flag, cb) {
        this.fsAPI
            .openFile(p, flag)
            .then(file => cb(null, new AsyncFile(file)))
            .catch(err => cb(err))
    }

    createFile(p, flag, mode, cb) {
        this.fsAPI
            .createFile(p, flag, mode)
            .then(file => cb(null, new AsyncFile(file)))
            .catch(err => cb(err))
    }

    open(p, flag, mode, cb) {
        this.fsAPI
            .open(p, flag, mode)
            .then(file => cb(null, new AsyncFile(file)))
            .catch(err => cb(err))
    }

    rename(oldPath, newPath, cb) {
        this.fsAPI
            .rename(oldPath, newPath)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    stat(p, isLstat, cb) {
        this.fsAPI
            .stat(p, isLstat)
            .then(stats => cb(null, stats))
            .catch(err => cb(err))
    }

    unlink(p, cb) {
        this.fsAPI
            .unlink(p)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    rmdir(p, cb) {
        this.fsAPI
            .rmdir(p)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    mkdir(p, mode, cb) {
        this.fsAPI
            .mkdir(p, mode)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    readdir(p, cb) {
        this.fsAPI
            .readdir(p)
            .then(files => cb(null, files))
            .catch(err => cb(err))
    }

    exists(p, cb) {
        this.fsAPI
            .exists(p)
            .then(exists => cb(exists))
            .catch(() => cb(false))
    }

    realpath(p, cache, cb) {
        this.fsAPI
            .realpath(p, cache)
            .then(path => cb(null, path))
            .catch(err => cb(err))
    }

    truncate(p, len, cb) {
        this.fsAPI
            .truncate(p, len)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    readFile(fname, encoding, flag, cb) {
        this.fsAPI
            .readFile(fname, encoding, flag)
            .then(data => cb(null, data))
            .catch(err => cb(err))
    }

    writeFile(fname, data, encoding, flag, mode, cb) {
        this.fsAPI
            .writeFile(fname, data, encoding, flag, mode)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    appendFile(fname, data, encoding, flag, mode, cb) {
        this.fsAPI
            .appendFile(fname, data, encoding, flag, mode)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    chmod(p, isLchmod, mode, cb) {
        this.fsAPI
            .chmod(p, isLchmod, mode)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    chown(p, isLchown, uid, gid, cb) {
        this.fsAPI
            .chown(p, isLchown, uid, gid)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    utimes(p, atime, mtime, cb) {
        this.fsAPI
            .utimes(p, atime, mtime)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    link(srcpath, dstpath, cb) {
        this.fsAPI
            .link(srcpath, dstpath)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    symlink(srcpath, dstpath, type, cb) {
        this.fsAPI
            .symlink(srcpath, dstpath, type)
            .then(() => cb(null))
            .catch(err => cb(err))
    }

    readlink(p, cb) {
        this.fsAPI
            .readlink(p)
            .then(link => cb(null, link))
            .catch(err => cb(err))
    }
}
