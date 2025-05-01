import { ArtifactFileSystem } from "../artifactFs";
import { generateMountPath, mountFileSystem } from "./fs-utils";

/**
 * Handler for the Hypha Artifacts driver
 * 
 * This handler will:
 * 1. Verify the URL is a valid Hypha artifacts URL
 * 2. Create an ArtifactFileSystem instance
 * 3. Mount the file system
 * 4. Return the volume configuration
 */
export function handleHyphaArtifacts(opts) {
    return new Promise((resolve, reject) => {
        try {
            if (!opts || !opts.host) {
                throw new Error('Invalid hypha artifacts URL');
            }

            if (opts.host.startsWith('http') && opts.host.includes('/artifacts/')) {
                // This is a Hypha artifacts URL
                console.log('Connecting to Hypha Artifacts at', opts.host);
                
                // Extract workspace and artifact name from URL
                const urlParts = opts.host.split('/');
                const artifactIndex = urlParts.indexOf('artifacts');
                
                if (artifactIndex === -1 || artifactIndex >= urlParts.length - 1) {
                    throw new Error('Invalid artifact URL format');
                }
                
                const workspace = urlParts[artifactIndex - 1];
                const artifactAlias = urlParts[artifactIndex + 1];
                
                // Create a display name for the volume
                const displayName = opts.name || `${workspace}/${artifactAlias}`;

                // Create the ArtifactFileSystem
                ArtifactFileSystem.Create({
                    baseUrl: opts.host
                }, async (error, afs) => {
                    if (error || !afs) {
                        console.error('Failed to create ArtifactFileSystem:', error);
                        reject(error);
                        return;
                    }

                    try {
                        // Generate a unique mount path
                        const mountedPath = generateMountPath("hypha-artifacts");
                        
                        // Mount the artifact file system and get volume config
                        const volume = await mountFileSystem(
                            mountedPath, 
                            afs, 
                            displayName
                        );
                        
                        resolve(volume);
                    } catch (e) {
                        console.error("Error mounting hypha artifacts:", e);
                        reject(e);
                    }
                });
            } else {
                reject(new Error('Not a valid hypha artifacts URL'));
            }
        } catch (e) {
            console.error('Error in hypha_artifacts driver:', e);
            reject(e);
        }
    });
} 