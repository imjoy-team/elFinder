import { hyphaWebsocketClient } from "hypha-rpc";
import { AsyncFileSystem } from "../asyncfs";
import { generateMountPath, mountFileSystem } from "./fs-utils";

/**
 * Handler for the Hypha File System driver
 * 
 * This handler will:
 * 1. Verify the URL is a valid Hypha file system service URL
 * 2. Connect to the Hypha server using websocket
 * 3. Get the file system service
 * 4. Create an AsyncFileSystem instance
 * 5. Mount the file system
 * 6. Return the volume configuration
 */
export function handleHyphaFs(opts) {
    return new Promise((resolve, reject) => {
        if(!opts || !opts.host) {
            return reject(new Error('Invalid Hypha File System URL'));
        }
        
        if(!opts.host.startsWith('http') || !opts.host.includes('/services/')) {
            return reject(new Error('Not a valid Hypha File System URL'));
        }
        
        // Extract server_url and serviceId
        const url = new URL(opts.host);
        const server_url = url.origin;
        const workspace = opts.host.replace(server_url, '').split('/services/')[0].replace(/\//g, '');
        const serviceId = workspace + "/" + url.pathname.split('/services/')[1].replace(/\//g, '');
        const token = url.searchParams.get('token');
        const userWorkspace = url.searchParams.get('workspace');
        
        console.log('Connecting to Hypha File System Service at', server_url, serviceId, token);
        
        hyphaWebsocketClient.connectToServer({
            server_url: server_url,
            workspace: userWorkspace,
            token: token
        }).then(async (server) => {
            try {
                // Get the file system service
                const fsAPI = await server.getService(serviceId);
                console.log('Got Hypha File System API:', fsAPI);

                // Create an AsyncFileSystem
                AsyncFileSystem.Create({
                    fileSystemId: serviceId,
                    fsAPI: fsAPI
                }, async (error, afs) => {
                    if (error || !afs) {
                        console.error('Failed to create AsyncFileSystem:', error);
                        reject(error);
                        return;
                    }

                    try {
                        // Generate a unique mount path
                        const mountedPath = generateMountPath(`${workspace}:${serviceId.split('/')[1]}`);
                        
                        // Mount the file system and get volume config
                        const volume = await mountFileSystem(
                            mountedPath, 
                            afs, 
                            opts.name ? opts.name : 'Hypha FS'
                        );
                        
                        resolve(volume);
                    } catch (e) {
                        console.error("Error mounting Hypha FS:", e);
                        reject(e);
                    }
                });
            } catch (e) {
                console.error("Error accessing Hypha service:", e);
                reject(e);
            }
        }).catch((e) => {
            console.error("Error connecting to Hypha server:", e);
            reject(e);
        });
    });
} 