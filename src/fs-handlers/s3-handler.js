import S3FS from "../s3";
import { mountFileSystem } from "./fs-utils";

/**
 * Handler for the S3 driver
 * 
 * This handler will:
 * 1. Verify the URL is a valid S3 URL
 * 2. Parse the bucket name and prefix
 * 3. Create a S3FS instance
 * 4. Mount the file system
 * 5. Return the volume configuration
 */
export function handleS3(opts) {
    return new Promise((resolve, reject) => {
        try {
            if(!opts || !opts.host) {
                throw new Error('Invalid S3 URL');
            }
            
            if (!opts.host.startsWith('s3://')) {
                throw new Error('Invalid S3 URL format');
            }
            
            // Parse URL: s3://bucket-name/prefix
            const matches = opts.host.match(/^s3:\/\/([^/]+)(?:\/(.*))?$/);
            if (!matches) {
                throw new Error('Invalid S3 URL format');
            }
            
            const bucketName = matches[1];
            const prefix = matches[2] || opts.prefix || '';
            
            // Create the mount path based on bucket name
            const mountedPath = `/${bucketName}`;
            
            // Create S3FS instance
            new S3FS({
                bucket: bucketName,
                prefix: prefix
            }).then(async (s3fs) => {
                try {
                    // Mount the file system and get volume config
                    const volume = await mountFileSystem(
                        mountedPath, 
                        s3fs, 
                        opts.name ? opts.name : bucketName
                    );
                    
                    resolve(volume);
                } catch (e) {
                    console.error("Error mounting S3:", e);
                    reject(e);
                }
            }).catch((e) => {
                console.error("Error creating S3FS:", e);
                reject(e);
            });
        } catch (e) {
            console.error("Error in S3 handler:", e);
            reject(e);
        }
    });
} 