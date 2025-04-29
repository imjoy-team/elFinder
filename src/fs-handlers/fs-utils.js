import { ApiError } from "browserfs/dist/node/core/api_error";
import BrowserFS from "browserfs";

/**
 * Convert an error from the API to a BrowserFS API error
 */
export function convertError(err, message = err.toString()) {
    console.debug('convertError', { error: err, message });
    if (err.code === "ENOENT") {
        return new ApiError(ApiError.ENOENT, message);
    } else if (err.code === "EACCES") {
        return new ApiError(ApiError.EACCES, message);
    } else if (err.code === "EEXIST") {
        return new ApiError(ApiError.EEXIST, message);
    } else {
        return new ApiError(ApiError.EIO, message);
    }
}

/**
 * Generate a unique mount path for a filesystem
 */
export function generateMountPath(prefix = "") {
    const randomSuffix = Math.random().toString(36).substring(2, 15);
    return `/${prefix ? prefix + "-" : ""}${randomSuffix}`;
}

/**
 * Mount a file system and create the volume configuration
 */
export async function mountFileSystem(mountPath, fileSystem, alias) {
    try {
        const _fs = BrowserFS.BFSRequire("fs");
        
        // Create the mount point if it doesn't exist
        if (!_fs.existsSync(mountPath)) {
            _fs.mkdirSync(mountPath);
        }
        
        // Mount the file system at the mount path
        _fs.mount(mountPath, fileSystem);
        
        // Create and return the volume configuration
        return {
            driver: "fs",
            url: mountPath,
            path: mountPath,
            id: mountPath,
            alias: alias || mountPath
        };
    } catch (error) {
        console.error("Error mounting file system:", error);
        throw error;
    }
}

/**
 * Normalize a path by removing leading slashes
 */
export function normalizePath(path) {
    if (path.startsWith("/") && path.length > 1) {
        return path.substring(1);
    }
    return path;
}

/**
 * Extract host parameters from a URL
 */
export function parseUrl(url) {
    try {
        const urlObj = new URL(url);
        return {
            origin: urlObj.origin,
            hostname: urlObj.hostname,
            pathname: urlObj.pathname,
            searchParams: urlObj.searchParams,
            protocol: urlObj.protocol
        };
    } catch (error) {
        console.error("Error parsing URL:", error);
        throw new Error("Invalid URL format");
    }
}

/**
 * Parse a Hypha artifact URL to extract workspace and artifact alias
 */
export function parseArtifactUrl(url) {
    try {
        const urlParts = url.split('/');
        const artifactIndex = urlParts.indexOf('artifacts');
        
        if (artifactIndex === -1 || artifactIndex >= urlParts.length - 1) {
            throw new Error('Invalid artifact URL format');
        }
        
        const workspace = urlParts[artifactIndex - 1];
        const artifactAlias = urlParts[artifactIndex + 1];
        
        return {
            workspace,
            artifactAlias,
            artifactId: `${workspace}/${artifactAlias}`,
            apiBaseUrl: `${urlParts.slice(0, artifactIndex).join('/')}/api/v1`
        };
    } catch (error) {
        console.error("Error parsing artifact URL:", error);
        throw new Error("Invalid artifact URL format");
    }
}

/**
 * Create a kwargs object for Python API calls
 */
export function createKwargs(params = {}) {
    return {
        ...params,
        "_rkwargs": true
    };
} 