import os
import asyncio
from hypha_rpc import connect_to_server
import aiofiles
import logging
import argparse
import posixpath
from typing import Optional
import stat as stat_module
import mimetypes

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger('AsyncFileService')

# Define alternative path separators for different OS
_os_alt_seps: list[str] = list(
    sep for sep in [os.path.sep, os.path.altsep] if sep is not None and sep != "/"
)

def safe_join(directory: str, *pathnames: str) -> Optional[str]:
    """Safely join zero or more untrusted path components to a base directory.

    This avoids escaping the base directory.
    :param directory: The trusted base directory.
    :param pathnames: The untrusted path components relative to the
        base directory.
    :return: A safe path, otherwise ``None``.

    This function is copied from:
    https://github.com/pallets/werkzeug/blob/fb7ddd89ae3072e4f4002701a643eb247a402b64/src/werkzeug/security.py#L222
    """
    parts = [directory]

    for filename in pathnames:
        if filename != "":
            filename = posixpath.normpath(filename)

        if (
            any(sep in filename for sep in _os_alt_seps)
            or os.path.isabs(filename)
            or filename == ".."
            or filename.startswith("../")
        ):
            raise Exception(
                f"Illegal file path: `{filename}`, "
                "you can only operate within the work directory."
            )

        parts.append(filename)

    return posixpath.join(*parts)



def parse_args():
    parser = argparse.ArgumentParser(description='Async File Service with configurable root directory')
    parser.add_argument('--root', '-r', 
                       type=str,
                       default=os.path.abspath("./"),
                       help='Root directory for the file service (default: current directory)')
    return parser.parse_args()

# Get arguments
args = parse_args()
DEFAULT_WORKDIR = os.path.abspath(args.root)
logger.info(f"Using root directory: {DEFAULT_WORKDIR}")

def js_flag_to_python_mode(flag):
    """Convert Node.js file flags to Python file modes"""
    # Convert ObjectProxy to string if needed
    if hasattr(flag, 'toString'):
        flag = flag.toString()
    elif not isinstance(flag, str):
        flag = str(flag)

    flag_map = {
        'r': 'r',      # read
        'r+': 'r+',    # read and write
        'w': 'w',      # write (truncate)
        'w+': 'w+',    # read and write (truncate)
        'a': 'a',      # append
        'a+': 'a+',    # read and append
    }
    return flag_map.get(flag, 'r')  # default to read mode if unknown

def js_encoding_to_python(encoding):
    """Convert Node.js encodings to Python encodings"""
    if not encoding or encoding == 'utf8' or encoding == 'utf-8':
        return 'utf-8'
    if encoding == 'binary' or encoding == 'raw':
        return None  # Use binary mode in Python
    return encoding

async def main():
    logger.info("Starting AsyncFileService")
    
    # Ensure root directory exists
    try:
        os.makedirs(DEFAULT_WORKDIR, exist_ok=True)
        logger.info(f"Root directory ensured at: {DEFAULT_WORKDIR}")
    except Exception as e:
        logger.error(f"Failed to create root directory {DEFAULT_WORKDIR}: {str(e)}")
        return
    
    server = await connect_to_server(
        {"name": "anonymous client", "server_url": "https://hypha.aicell.io"}
    )
    logger.info(f"Connected to server: {server.config.workspace}")

    workdir = DEFAULT_WORKDIR
    logger.debug(f"Working directory set to: {workdir}")

    def create_async_file(file):
        return {
            "_rintf": True,
            "stat": lambda: file_stat(file),
            "close": lambda: file_close(file),
            "truncate": lambda length: file_truncate(file, length),
            "sync": lambda: file_sync(file),
            "write": lambda buffer, offset, length, position: file_write(file, buffer, offset, length, position),
            "read": lambda buffer, offset, length, position: file_read(file, buffer, offset, length, position),
            "datasync": lambda: file_datasync(file),
            "chown": lambda uid, gid: file_chown(file, uid, gid),
            "chmod": lambda mode: file_chmod(file, mode),
            "utimes": lambda atime, mtime: file_utimes(file, atime, mtime),
        }

    def convert_stat_to_dict(stats):
        mtime = int(stats.st_mtime)
        return {
            "_rintf": True,
            "st_mode": stats.st_mode,
            "st_ino": stats.st_ino,
            "st_dev": stats.st_dev,
            "st_nlink": stats.st_nlink,
            "st_uid": stats.st_uid,
            "st_gid": stats.st_gid,
            "st_size": stats.st_size,
            "st_atime": stats.st_atime,
            "st_mtime": stats.st_mtime,
            "st_ctime": stats.st_ctime,
            "mtime": mtime * 1000,
            "size": stats.st_size,
            "isDirectory": stat_module.S_ISDIR(stats.st_mode),
            "isFile": stat_module.S_ISREG(stats.st_mode),
        }

    def resolve_path(p):
        """Safely resolve a path relative to the workdir.
        
        This function ensures that:
        1. All paths are safely joined using safe_join
        2. Paths cannot escape the workdir
        3. Root paths (/) are mapped to workdir
        4. Special prefixes like /async-file-service/ are handled
        
        Args:
            p: The path to resolve
            
        Returns:
            str: The safely resolved absolute path
            
        Raises:
            Exception: If the path is illegal or tries to escape workdir
        """
        logger.debug(f"Resolving path: {p}")
        
        # Handle empty or None paths
        if not p:
            return workdir
            
        # Detect and prevent path duplication issue
        if workdir in p:
            # If the workdir is already in the path, extract just the relative part
            rel_path = p.replace(workdir, '')
            # Remove any leading slashes from the relative path
            rel_path = rel_path.lstrip('/')
            logger.debug(f"Path contains workdir already, extracted relative part: {rel_path}")
            p = rel_path
        # Handle absolute paths by making them relative to workdir
        elif p.startswith("/"):
            p = p[1:]  # Remove leading slash to make relative
            
        # Use safe_join to ensure path cannot escape workdir
        try:
            resolved = safe_join(workdir, p)
            if resolved is None:
                raise Exception(f"Invalid path: {p}")
            logger.debug(f"Resolved path: {resolved}")
            return resolved
        except Exception as e:
            logger.error(f"Failed to resolve path {p}: {str(e)}")
            raise Exception(f"Failed to resolve path {p}: {str(e)}")

    async def file_stat(file):
        stats = await file.stat()
        return convert_stat_to_dict(stats)

    async def file_close(file):
        await file.close()

    async def file_truncate(file, length):
        await file.truncate(length)

    async def file_sync(file):
        await file.flush()
        os.fsync(file.fileno())

    async def file_write(file, buffer, offset, length, position):
        await file.seek(position)
        await file.write(buffer[offset:offset+length])
        return length

    async def file_read(file, buffer, offset, length, position):
        await file.seek(position)
        data = await file.read(length)
        buffer[offset:offset+len(data)] = data
        return len(data)

    async def file_datasync(file):
        os.fdatasync(file.fileno())

    async def file_chown(file, uid, gid):
        os.chown(file.name, uid, gid)

    async def file_chmod(file, mode):
        os.chmod(file.name, mode)

    async def file_utimes(file, atime, mtime):
        os.utime(file.name, (atime, mtime))

    async def diskSpace(p):
        p = resolve_path(p)
        statvfs = os.statvfs(p)
        total = statvfs.f_frsize * statvfs.f_blocks
        free = statvfs.f_frsize * statvfs.f_bavail
        return {"total": total, "free": free}

    async def openFile(p, flag):
        p = resolve_path(p)
        try:
            mode = js_flag_to_python_mode(flag)
            file = await aiofiles.open(p, mode=mode)
            return create_async_file(file)
        except Exception as e:
            return {"error": str(e)}

    async def createFile(p, flag, mode):
        p = resolve_path(p)
        try:
            py_mode = js_flag_to_python_mode(flag)
            file = await aiofiles.open(p, mode=py_mode)
            if mode is not None:
                os.chmod(p, mode)
            return create_async_file(file)
        except Exception as e:
            return {"error": str(e)}

    async def rename(oldPath, newPath):
        oldPath = resolve_path(oldPath)
        newPath = resolve_path(newPath)
        try:
            os.rename(oldPath, newPath)
        except Exception as e:
            return {"error": str(e)}

    async def stat(p, isLstat=False):
        p = resolve_path(p)
        try:
            logger.debug(f"Getting stat for: {p} (isLstat: {isLstat})")
            stats = os.lstat(p) if isLstat else os.stat(p)
            
            # Manually construct the result in a format compatible with BrowserFS
            mtime = int(stats.st_mtime)
            is_dir = stat_module.S_ISDIR(stats.st_mode)
            is_file = stat_module.S_ISREG(stats.st_mode)
            
            result = {
                "_rintf": True,
                "st_mode": stats.st_mode,
                "st_ino": stats.st_ino,
                "st_dev": stats.st_dev,
                "st_nlink": stats.st_nlink,
                "st_uid": stats.st_uid,
                "st_gid": stats.st_gid,
                "st_size": stats.st_size,
                "st_atime": stats.st_atime,
                "st_mtime": stats.st_mtime,
                "st_ctime": stats.st_ctime,
                "mtime": mtime * 1000,
                "size": stats.st_size,
                "isDirectory": is_dir,
                "isFile": is_file,
            }
            
            # Explicitly add mime property that elFinder expects
            if is_dir:
                result["mime"] = "directory"
            else:
                # For files, try to get a mime type based on extension
                mime_type, _ = mimetypes.guess_type(p)
                result["mime"] = mime_type or "application/octet-stream"
            
            logger.debug(f"Stat result for {p}: isDir={is_dir}, isFile={is_file}, mime={result.get('mime')}")
            return result
        except Exception as e:
            logger.error(f"Error in stat for {p}: {str(e)}", exc_info=True)
            # Raise the error so it can be properly handled by the JavaScript client
            raise e

    async def unlink(p):
        p = resolve_path(p)
        try:
            os.unlink(p)
        except Exception as e:
            return {"error": str(e)}

    async def rmdir(p):
        p = resolve_path(p)
        try:
            os.rmdir(p)
        except Exception as e:
            return {"error": str(e)}

    async def mkdir(p, mode):
        try:
            p = resolve_path(p)
            logger.debug(f"Creating directory: {p}, mode: {mode}")
            os.makedirs(p, mode=mode, exist_ok=True)
            return {"success": True}
        except Exception as e:
            error_msg = f"Error creating directory {p}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return {"error": error_msg}

    async def readdir(p):
        try:
            p = resolve_path(p)
            logger.debug(f"Reading directory: {p}")

            # Ensure directory exists
            if not os.path.exists(p):
                os.makedirs(p, exist_ok=True)
            
            # Get directory listing
            files = os.listdir(p)
            
            # Process the files with simplified info
            
            logger.debug(f"Directory contents: {len(files)} items")
            return files
        except Exception as e:
            error_msg = f"Error reading directory {p}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            raise e
    
    async def readdirwithstats(p):
        p = resolve_path(p)
        try:
            logger.debug(f"Reading directory with stats: {p}")
            files = os.listdir(p)
            
            # Create a list to hold stats for each file
            result = []
            
            # Process each file and get its stats
            for f in files:
                # Safely join paths to prevent duplication
                file_path = os.path.join(p, f)
                logger.debug(f"Getting stats for file: {file_path}")
                file_stats = await stat(file_path)
                # Add the name to the stats object for easier processing on the client
                file_stats["name"] = f
                result.append(file_stats)
                
            return result
        except Exception as e:
            logger.error(f"Error in readdirwithstats for {p}: {str(e)}", exc_info=True)
            return {"error": str(e)}

    async def exists(p):
        try:
            p = resolve_path(p)
            logger.debug(f"Checking if path exists: {p}")
            exists = os.path.exists(p)
            logger.debug(f"Path {p} exists: {exists}")
            return exists
        except Exception as e:
            logger.error(f"Error checking if path exists {p}: {str(e)}", exc_info=True)
            # Return False instead of raising to match expected behavior
            return False

    async def realpath(p, cache):
        p = resolve_path(p)
        try:
            return os.path.realpath(p)
        except Exception as e:
            return {"error": str(e)}

    async def readFile(fname, encoding, flag):
        try:
            fname = resolve_path(fname)
            logger.debug(f"Reading file: {fname}, encoding: {encoding}, flag: {flag}")
            
            py_mode = js_flag_to_python_mode(flag)
            py_encoding = js_encoding_to_python(encoding)
            
            # If binary mode requested, read in binary mode
            if py_encoding is None:
                async with aiofiles.open(fname, mode=f"{py_mode}b") as f:
                    data = await f.read()
            else:
                async with aiofiles.open(fname, mode=py_mode, encoding=py_encoding) as f:
                    data = await f.read()
                    
            logger.debug(f"Successfully read file: {fname}")
            return data
        except Exception as e:
            logger.error(f"Error reading file {fname}: {str(e)}", exc_info=True)
            return {"error": str(e)}

    async def writeFile(fname, data, encoding, flag, mode):
        try:
            fname = resolve_path(fname)
            logger.debug(f"Writing file: {fname}, encoding: {encoding}, flag: {flag}, mode: {mode}")
            
            # Convert mode from decimal to octal if it's a number
            if isinstance(mode, int):
                mode = oct(mode)[2:]  # Convert to octal string without '0o' prefix
                mode = int(mode, 8)  # Convert back to int in octal
                logger.debug(f"Converted mode to octal: {oct(mode)}")

            # Create parent directory if it doesn't exist
            dirname = os.path.dirname(fname)
            if dirname:
                try:
                    os.makedirs(dirname, exist_ok=True)
                except Exception as e:
                    logger.error(f"Failed to create directory {dirname}: {str(e)}")
            
            py_encoding = js_encoding_to_python(encoding)
            py_mode = js_flag_to_python_mode(flag)
            
            logger.debug(f"Python mode: {py_mode}, encoding: {py_encoding}")
            
            # Handle binary vs text mode
            try:
                if py_encoding is None:
                    if isinstance(data, str):
                        data = data.encode()
                    async with aiofiles.open(fname, mode=f"{py_mode}b") as f:
                        await f.write(data)
                else:
                    async with aiofiles.open(fname, mode=py_mode, encoding=py_encoding) as f:
                        await f.write(data)
                
                # Set mode after file is created
                if mode is not None:
                    os.chmod(fname, mode)
                    
                logger.debug(f"Successfully wrote file: {fname}")
                return {"success": True}
            except Exception as e:
                error_msg = f"Failed to write file {fname}: {str(e)}"
                logger.error(error_msg, exc_info=True)
                return {"error": error_msg}
        except Exception as e:
            error_msg = f"Error in writeFile {fname}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return {"error": error_msg}

    async def appendFile(fname, data, encoding, flag, mode):
        try:
            fname = resolve_path(fname)
            py_encoding = js_encoding_to_python(encoding)
            py_mode = js_flag_to_python_mode(flag) if flag else 'a'
            
            if py_encoding is None:
                if isinstance(data, str):
                    data = data.encode()
                async with aiofiles.open(fname, mode=f"{py_mode}b") as f:
                    await f.write(data)
            else:
                async with aiofiles.open(fname, mode=py_mode, encoding=py_encoding) as f:
                    await f.write(data)
            
            if mode is not None:
                os.chmod(fname, mode)
                
            return {"success": True}
        except Exception as e:
            return {"error": str(e)}

    async def symlink(srcpath, dstpath, type):
        srcpath = resolve_path(srcpath)
        dstpath = resolve_path(dstpath)
        try:
            os.symlink(srcpath, dstpath, target_is_directory=(type == 'dir'))
        except Exception as e:
            return {"error": str(e)}

    async def readlink(p):
        p = resolve_path(p)
        try:
            return os.readlink(p)
        except Exception as e:
            return {"error": str(e)}


    svc = await server.register_service({
        "name": "AsyncFileService",
        "id": "async-file-service",
        "config": {
            "visibility": "public",
            "run_in_executor": True,
            "convert_objects": True  # Enable automatic object conversion
        },
        "diskSpace": diskSpace,
        "openFile": openFile,
        "createFile": createFile,
        "rename": rename,
        "stat": stat,
        "unlink": unlink,
        "rmdir": rmdir,
        "mkdir": mkdir,
        "readdir": readdir,
        "readdirwithstats": readdirwithstats,
        "exists": exists,
        "realpath": realpath,
        "readFile": readFile,
        "writeFile": writeFile,
        "appendFile": appendFile,
        "symlink": symlink,
        "readlink": readlink,
    })

    print("AsyncFileService is ready: " + svc.id)
    print(f"Test the service at https://hypha.aicell.io/{server.config.workspace}/services/{svc.id.split('/')[1]}")

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(main())
    loop.run_forever()
