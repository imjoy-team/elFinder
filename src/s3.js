import {
    DeleteObjectsCommand,
    HeadObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    ListObjectsV2Command,
    S3
  } from "@aws-sdk/client-s3"
  import { ApiError, ErrorCode } from "browserfs/dist/node/core/api_error"
  import { BaseFileSystem } from "browserfs/dist/node/core/file_system"
  // import { arrayBuffer2Buffer } from "browserfs/dist/node/core/util";

  import {
    FileType,
    default as Stats
  } from "browserfs/dist/node/core/node_fs_stats"
  // import { dirname } from 'path';
  import { join } from "path"
  import { S3File } from "./s3file"
  
  /**
  
   * Configuration options for the IndexedDB file system.
  
   */
  
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
  
  function onErrorHandler(cb, code = ErrorCode.EIO, message = null) {
    cb(new ApiError(code, message !== null ? message : undefined))
  }
  
  export default class S3FileSystem extends BaseFileSystem {
    static Name = "S3"
  
    /**
     * Creates a new S3FileSystem instance with the given options.
     * Must be given a configured S3 client and the bucket name.
     */
    static Create(opts, cb) {
      new S3FileSystem(opts, cb)
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
      return typeof S3 !== "undefined"
    }
  
    constructor(opts, cb) {
      super()
  
      const s3 = new S3({
        apiVersion: '2006-03-01',
        signatureVersion: 'v4',
        credentials: {
          accessKeyId: opts.accessKeyId,
          secretAccessKey: opts.secretAccessKey
        },
        region: opts.region,
        endpoint: opts.endpoint,
        forcePathStyle: true,
        logger: {
          log: console.log
        }
      })
      this._s3 = s3
      this._bucket = opts.bucket
      this._prefix = opts.prefix.startsWith("/")
        ? opts.prefix.slice(1)
        : opts.prefix
      // Preflight test
      s3.putObject(
        {
          Bucket: opts.bucket,
          Key: join(this._prefix, ".__dir__"),
          Body: "_"
        },
        (err, data) => {
          if (err) {
            console.error(err, data)
            onErrorHandler(cb, ErrorCode.EACCES, err.toString())
          } else {
            cb(null, this)
          }
        }
      )
    }
  
    getName() {
      return S3FileSystem.Name
    }
  
    isReadOnly() {
      return false
    }
  
    supportsSymlinks() {
      return false
    }
  
    supportsProps() {
      return false
    }
  
    supportsSynch() {
      return false
    }
  
    async empty(mainCb) {
      // Not implemented for this file system
      mainCb(new ApiError(ErrorCode.ENOTSUP))
    }
  
    async getS3Object(path) {
      try {
        if (path === "/") {
          return null
        }
        if (path.startsWith("/")) {
          path = path.substring(1)
        }
        const response = await this._s3.send(
          new GetObjectCommand({
            Bucket: this._bucket,
            Key: join(this._prefix, path),
            ResponseCacheControl: "no-cache"
          })
        )
        const stat = new Stats(FileType.FILE, response.ContentLength)
        return {
          stat,
          content: response.Body
        }
      } catch (err) {
        if (err.name === "NoSuchKey") {
          return null
        }
        throw err
      }
    }
    async stat(path, isLstat, cb) {
      try {
        if (path.startsWith("/") && path.length > 1) {
          path = path.substring(1)
        }
        if(!path.endsWith("/")){
          try{
            const { ContentLength } = await this._s3.send(
              new HeadObjectCommand({
                Bucket: this._bucket,
                Key: join(this._prefix, path)
              })
            )
            if (ContentLength !== undefined && ContentLength !== null) {
              const stat = new Stats(FileType.FILE, ContentLength)
              cb(null, stat)
              return
            }
            else{
              throw new Error("Not a file")
            }
          } catch(err){
            // skip if not a file, try as a directory
          }
        }

        const response = await this._s3.send(
          new ListObjectsV2Command({
            Bucket: this._bucket,
            Prefix: join(this._prefix, path.endsWith("/") ? path : `${path}/`),
            MaxKeys: 1
          })
        )

        if (
          (response.Contents && response.Contents.length > 0) ||
          (response.CommonPrefixes && response.CommonPrefixes.length > 0)
        ) {
          cb(null, new Stats(FileType.DIRECTORY, 4096))
        } else {
          cb(ApiError.ENOENT(path))
        }
      
      } catch (err) {
        cb(convertError(err))
      }
    }
  
    async openFile(p, flag, cb) {
      try {
        if (p === "/") {
          cb(ApiError.ENOENT(p))
        }
        if (p.startsWith("/")) {
          p = p.substring(1)
        }
        const { ContentLength } = await this._s3.send(
          new HeadObjectCommand({
            Bucket: this._bucket,
            Key: join(this._prefix, p)
          })
        )
        if (ContentLength !== undefined && ContentLength !== null) {
          cb(
            null,
            new S3File(this._s3, this._bucket, join(this._prefix, p), false)
          )
        } else {
          cb(ApiError.ENOENT(p))
        }
      } catch (err) {
        cb(convertError(err))
      }
    }
  
    async createFile(p, flag, mode, cb) {
      const newFile = new S3File(
        this._s3,
        this._bucket,
        join(this._prefix, p),
        true
      )
      newFile.sync(err => {
        if (err) {
          cb(err)
        } else {
          cb(null, newFile)
        }
      })
    }
  
    async unlink(p, cb) {
      try {
        await this.deleteObjectsWithPrefix(p)
        cb()
      } catch (err) {
        cb(convertError(err))
      }
    }
  
    async deleteObjectsWithPrefix(prefix) {
      let isTruncated = false
      let continuationToken = undefined
      do {
        const response = await this._s3.send(
          new ListObjectsV2Command({
            Bucket: this._bucket,
            Prefix: join(this._prefix, prefix),
            ContinuationToken: continuationToken
          })
        )
  
        if (response.Contents && response.Contents.length > 0) {
          await this._s3.send(
            new DeleteObjectsCommand({
              Bucket: this._bucket,
              Delete: {
                Objects: response.Contents.map(item => ({
                  Key: item.Key
                }))
              }
            })
          )
        }
  
        isTruncated = response.IsTruncated || false
        continuationToken = response.NextContinuationToken
      } while (isTruncated)
    }
  
    async rmdir(path, cb) {
      try {
        await this.deleteObjectsWithPrefix(path.endsWith("/") ? path : `${path}/`)
        try {
          await this._s3.send(
            new DeleteObjectCommand({
              Bucket: this._bucket,
              Key: join(this._prefix, `${path}/.__dir__`)
            })
          )
        } finally {
          cb()
        }
      } catch (err) {
        cb(this.convertError(err))
      }
    }
  
    async mkdir(p, mode, cb) {
      try {
        const dirKey = p.endsWith("/") ? `${p}.__dir__` : `${p}/.__dir__`
        await this._s3.send(
          new PutObjectCommand({
            Bucket: this._bucket,
            Key: join(this._prefix, dirKey),
            Body: ""
          })
        )
        cb()
      } catch (err) {
        cb(this.convertError(err))
      }
    }
  
    async readdir(path, cb) {
      try {
        // Ensure path ends with a '/' if it's not the root directory
        if (path !== "" && !path.endsWith("/")) {
          path += "/"
        }
        if (path !== "/" && path.startsWith("/")) {
          path = path.slice(1)
        }
  
        path = join(this._prefix, path)
        const results = []
  
        // Helper function to get the directory's content
        const listDirectoryContent = async continuationToken => {
          const response = await this._s3.send(
            new ListObjectsV2Command({
              Bucket: this._bucket,
              Prefix: path,
              Delimiter: "/",
              ContinuationToken: continuationToken
            })
          )
  
          for (const prefix of response.CommonPrefixes || []) {
            const dirName =
              path === "/" ? prefix.Prefix : prefix.Prefix.slice(path.length)
            // Remove the prefix from the directory name
            const relativeDirName = dirName.startsWith(this._prefix)
              ? dirName.slice(this._prefix.length)
              : dirName
            if (relativeDirName !== ".__dir__") {
              results.push(relativeDirName)
            }
          }
  
          for (const content of response.Contents || []) {
            const fileName =
              path === "/" ? content.Key : content.Key.slice(path.length)
            // Remove the prefix from the file name
            const relativeFileName = fileName.startsWith(this._prefix)
              ? fileName.slice(this._prefix.length)
              : fileName
            if (relativeFileName !== "" && relativeFileName !== ".__dir__") {
              results.push(relativeFileName)
            }
          }
  
          if (response.IsTruncated) {
            await listDirectoryContent(response.NextContinuationToken)
          }
        }
  
        await listDirectoryContent()
  
        cb(null, results)
      } catch (err) {
        cb(this.convertError(err))
      }
    }
  
    convertError(err) {
      console.error(err);
      if (err.code === "NoSuchKey") {
        return ApiError.FileError(ErrorCode.ENOENT, err)
      } else {
        return ApiError.FileError(ErrorCode.EIO, err)
      }
    }
  }
  