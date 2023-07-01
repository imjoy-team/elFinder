import { ApiError, ErrorCode } from "browserfs/dist/node/core/api_error"
import { BaseFile } from "browserfs/dist/node/core/file"
import Stats, { FileType } from "browserfs/dist/node/core/node_fs_stats"
import { Buffer } from "buffer"
// import { Readable } from "stream";

/**
 * Converts a DOMException or a DOMError from an IndexedDB event into a
 * standardized BrowserFS API error.
 * @hidden
 */
function convertError(e, message = e.toString()) {
  // switch (e.name) {
  //   case "NotFoundError":
  //     return new ApiError(ErrorCode.ENOENT, message);
  //   case "QuotaExceededError":
  //     return new ApiError(ErrorCode.ENOSPC, message);
  //   default:
  // The rest do not seem to map cleanly to standard error codes.
  return new ApiError(ErrorCode.EIO, message)
  // }
}

export class S3File extends BaseFile {
  static _inMemoryStorage = new Map()

  static _sizeCache = new Map()

  _writePosition = 0
  _partNumber = 0
  _uploadParts = []

  constructor(s3, bucket, key, createIfNotExists) {
    super()
    this._s3 = s3
    this._bucket = bucket
    this._key = key
    this._createEmptyPromise = null
    if (this._key.startsWith("/")) {
      this._key = this._key.substring(1)
    }
    if (createIfNotExists) {
      this._createEmptyPromise = this.createEmpty()
    }
  }

  async createEmpty() {
    try {
      await this._s3.headObject({
        Bucket: this._bucket,
        Key: this._key
      })
    } catch (e) {
      await this._s3.putObject({
        Bucket: this._bucket,
        Key: this._key,
        Body: ""
      })
    }
  }
  getPos() {
    const data = S3File._inMemoryStorage.get(this._key)
    if (data) {
      return data.length
    } else {
      return undefined
    }
  }
  async stat(cb) {
    if (this._createEmptyPromise) {
      await this._createEmptyPromise
      this._createEmptyPromise = null
    }
    try {
      let fileSize
      if (!S3File._sizeCache.has(this._key)) {
        const { ContentLength } = await this._s3.headObject({
          Bucket: this._bucket,
          Key: this._key
        })

        if (ContentLength !== undefined) {
          fileSize = ContentLength
          S3File._sizeCache.set(this._key, fileSize)
        } else {
          throw new ApiError(
            ErrorCode.EIO,
            "Expected ContentLength in the response."
          )
        }
      } else {
        fileSize = S3File._sizeCache.get(this._key)
      }

      const now = new Date()
      const stat = new Stats(FileType.FILE, fileSize, 0o666, now, now)
      cb(null, stat)
    } catch (e) {
      cb(convertError(e))
    }
  }

  statSync() {
    throw new Error("Method not implemented.")
  }

  close(cb) {
    if (this._uploadId) {
      this.completeMultipartUpload(this._uploadId, this._uploadParts).then(
        () => {
          cb()
        }
      )
      this._uploadId = undefined
      this._partNumber = 0
      this._uploadParts = []
      this._writePosition = 0
    } else {
      cb()
    }

    // if (S3File._inMemoryStorage.has(this._key)) {
    //   this.sync(cb).then(() => {
    //     S3File._inMemoryStorage.delete(this._key);
    //   });
    // } else {
    //   cb();
    // }
  }

  closeSync() {
    // throw new Error("Method not implemented.");
  }

  async read(buffer, offset, length, position, cb) {
    try {
      // const data = S3File._inMemoryStorage.get(this._key);
      // if (data) {
      //   const bytesRead = data.copy(
      //     buffer,
      //     offset,
      //     position,
      //     position + length
      //   );
      //   cb(null, bytesRead, buffer);
      // } else {
      const range =
        length > 0 && position + length - 1 > 1
          ? `bytes=${position}-${position + length - 1}`
          : undefined
      const objectOutput = await this._s3.getObject({
        Bucket: this._bucket,
        Key: this._key,
        Range: range,
        ResponseCacheControl: "no-cache"
      })
      objectOutput.Body?.transformToByteArray()
        .then(data => {
          const bytesRead = Buffer.from(data).copy(buffer, offset, 0, length)
          cb(null, bytesRead, buffer)
        })
        .catch(e => {
          cb(convertError(e))
        })
      // }
    } catch (error) {
      cb(convertError(error))
    }
  }

  readSync(_buffer, _offset, _length, _position) {
    throw new ApiError(
      ErrorCode.EIO,
      "The S3File.readSync() method is not supported."
    )
  }

  async initiateMultipartUpload() {
    const response = await this._s3.createMultipartUpload({
      Bucket: this._bucket,
      Key: this._key
    })

    return response.UploadId
  }

  async uploadPart(partNumber, data, uploadId) {
    const response = await this._s3.uploadPart({
      Bucket: this._bucket,
      Key: this._key,
      PartNumber: partNumber,
      UploadId: uploadId,
      Body: data
    })

    return response.ETag
  }

  async completeMultipartUpload(uploadId, parts) {
    await this._s3.completeMultipartUpload({
      Bucket: this._bucket,
      Key: this._key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
      }
    })
  }

  async abortMultipartUpload(uploadId) {
    await this._s3.abortMultipartUpload({
      Bucket: this._bucket,
      Key: this._key,
      UploadId: uploadId
    })
  }

  async write(buffer, offset, length, position, cb) {
    buffer = buffer.slice(offset, offset + length)
    try {
      if (position === 0) {
        if (this._uploadId) {
          try {
            await this.abortMultipartUpload(this._uploadId)
          } catch (e) {
            console.error(e)
          }
        }
      }
      if (position === undefined || position === null) {
        position = this._writePosition
      }

      if (!this._uploadId) {
        this._partNumber = 1
        this._uploadParts = []
        this._uploadId = await this.initiateMultipartUpload()
      }

      const etag = await this.uploadPart(
        this._partNumber,
        buffer,
        this._uploadId
      )
      this._uploadParts.push({
        ETag: etag,
        PartNumber: this._partNumber
      })

      this._partNumber = this._partNumber + 1
      this._writePosition = position + length

      // if (!S3File._inMemoryStorage.has(this._key)) {
      //   S3File._inMemoryStorage.set(this._key, Buffer.alloc(0));
      // }

      // const updatedData = Buffer.concat([
      //   S3File._inMemoryStorage.get(this._key)?.slice(0, position) ||
      //     Buffer.alloc(0),
      //   buffer.slice(offset, offset + length),
      //   S3File._inMemoryStorage.get(this._key)?.slice(position + length) ||
      //     Buffer.alloc(0),
      // ]);

      // S3File._inMemoryStorage.set(this._key, updatedData);

      cb(null, length, buffer)
    } catch (e) {
      cb(convertError(e))
    }
  }

  writeSync(_buffer, _offset, _length, _position) {
    throw new ApiError(
      ErrorCode.EIO,
      "The S3File.writeSync() method is not supported."
    )
  }

  async sync(cb) {
    try {
      // const data = S3File._inMemoryStorage.get(this._key);
      // if (data) {
      //   // const readable = new Readable({
      //   //   read() {
      //   //     this.push(data);
      //   //     this.push(null);
      //   //   },
      //   // });

      //   await this._s3.putObject({
      //     Body: data,
      //     Bucket: this._bucket,
      //     Key: this._key,
      //   });

      //   cb();
      // } else {
      cb() // new ApiError(ErrorCode.ENOENT, "Cache not found")
      // }
    } catch (error) {
      cb(convertError(error))
    }
  }

  syncSync() {
    throw new ApiError(
      ErrorCode.EIO,
      "The S3File.syncSync() method is not supported."
    )
  }
  async truncate(len, cb) {
    try {
      // if (!S3File._inMemoryStorage.has(this._key)) {
      //   S3File._inMemoryStorage.set(this._key, Buffer.alloc(0));
      // }

      // const truncatedData = Buffer.alloc(len);
      // S3File._inMemoryStorage.get(this._key)?.copy(truncatedData, 0, 0, len);

      // S3File._inMemoryStorage.set(this._key, truncatedData);

      cb()
    } catch (e) {
      cb(convertError(e))
    }
  }

  truncateSync(_len) {
    throw new ApiError(
      ErrorCode.EIO,
      "The S3File.truncateSync() method is not supported."
    )
  }

  async chown(_uid, _gid, cb) {
    // S3 does not support the chown operation. Call the callback without an error.
    cb()
  }

  chownSync(_uid, _gid) {
    throw new ApiError(
      ErrorCode.EIO,
      "The S3File.chownSync() method is not supported."
    )
  }

  async chmod(_mode, cb) {
    // S3 does not support the chmod operation. Call the callback without an error.
    cb()
  }

  chmodSync(_mode) {
    throw new ApiError(
      ErrorCode.EIO,
      "The S3File.chmodSync() method is not supported."
    )
  }

  async utimes(_atime, _mtime, cb) {
    // S3 does not support the utimes operation. Call the callback without an error.
    cb()
  }

  utimesSync(_atime, _mtime) {
    throw new ApiError(
      ErrorCode.EIO,
      "The S3File.utimesSync() method is not supported."
    )
  }
}

