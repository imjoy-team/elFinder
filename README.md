elFinder for ImJoy
========

elFinder is an open-source file manager for web, written in JavaScript using jQuery UI. See the original project [here](https://github.com/Studio-42/elFinder).

In this project, we use elFinder as a file manager for [ImJoy](https://imjoy.io) and integrated with [BrowserFS](https://github.com/jvilk/BrowserFS). By using a service worker, we can mount browserfs running inside a service worker, connect to IndexedDB, S3 backend, and provide an ImJoy interface to interact it inside a Jupyter notebook or other ImJoy supported websites.

**To try the elFinder, visit https://fm.imjoy.io/**


## Usage for ImJoy

You can go to https://jupyter.imjoy.io/, start a notebook and run the following code to open the file manager:

Show the file manager as an ImJoy plugin:
```python
from imjoy_rpc import api
async def setup():  
    fm = await api.createWindow(
        src="https://jupyter.imjoy.io/elFinder"
    )

api.export({"setup": setup})
```

With the following window open, you can drag and drop files to the file manager to upload them to the browser, download or preview files.

![Screenshot for elfinder window](./img/Screenshot-dialog-elfinder.png)

```python
from imjoy_rpc import api

async def setup():  
    fm = await api.showDialog(
        src="https://jupyter.imjoy.io/elFinder"
    )
    selections = await fm.getSelections()
    await api.alert(str(selections))
    

api.export({"setup": setup})
```

![Screenshot for elfinder dialog](./img/Screenshot-dialog-elfinder.png)

### Access elFinder files from Python

With the help of some utility functions in Python, you can also operate the files in the file manager:

```python
import io
from imjoy_rpc.utils import open_elfinder, elfinder_listdir

# import requests
# # Download a test image
# response = requests.get("https://images.proteinatlas.org/61448/1319_C10_2_blue_red_green.jpg")
# data = response.content


# Write the file to elfinder storage
with open_elfinder("/home/test-image.png", "wb") as f:
    f.write(data)

files = elfinder_listdir('/home')

print(files)
```

### Using elFinder with remote files on S3

You can use it to operate remote files on S3, by mount the S3 bucket to the browserfs. See the example below:

```python
from imjoy_rpc import api

access_key_id = ''
secret_access_key = ''
endpoint_url = ''
bucket = ''
prefix = ''

async def setup():  
    fm = await api.showDialog(
        src="https://jupyter.imjoy.io/elFinder"
    )
    # S3 URI format: s3://accessKeyID:secretAccessKey@endpointURL/bucket/prefix
    await fm.mount(f"s3://{access_key_id}:{secret_access_key}@{endpoint_url}/{bucket}/{prefix}")
  
api.export({"setup": setup})
```

### Using elFinder with Hypha Artifact Manager

#### Starting Hypha with Built-in S3 (Minio) Server

For features requiring S3 object storage (like Server Apps or Artifact Management), Hypha provides a convenient built-in Minio server. To start the Hypha server along with this built-in S3 server, use the `--start-minio-server` flag:

```bash
python3 -m hypha.server --host=0.0.0.0 --port=9527 --start-minio-server
```

This automatically:
- Starts a Minio server process.
- Enables S3 support (`--enable-s3`).
- Configures the necessary S3 connection details (`--endpoint-url`, `--access-key-id`, `--secret-access-key`).

**Note:** You cannot use `--start-minio-server` if you are also manually providing S3 connection details (e.g., `--endpoint-url`). Choose one method or the other.

You can customize the built-in Minio server using these options:
- `--minio-workdir`: Specify a directory for Minio data (defaults to a temporary directory).
- `--minio-port`: Set the port for the Minio server (defaults to 9000).
- `--minio-root-user`: Set the root user (defaults to `minioadmin`).
- `--minio-root-password`: Set the root password (defaults to `minioadmin`).
- `--minio-version`: Specify a specific version of the Minio server to use.
- `--mc-version`: Specify a specific version of the Minio client to use.
- `--minio-file-system-mode`: Enable file system mode with specific compatible versions.

Example with custom Minio settings:
```bash
fpython3 -m hypha.server --host=0.0.0.0 --port=9527 \
    --start-minio-server \
    --minio-workdir=./minio_data \
    --minio-port=9001 \
    --minio-root-user=myuser \
```

##### Minio File System Mode

For better filesystem-like behavior, you can enable file system mode with the `--minio-file-system-mode` flag:

```bash
python3 -m hypha.server --host=0.0.0.0 --port=9527 \
    --start-minio-server \
    --minio-file-system-mode
```

When file system mode is enabled, Hypha uses specific versions of Minio that are compatible with file system operations:
- Minio server: `RELEASE.2022-10-24T18-35-07Z`
- Minio client: `RELEASE.2022-10-29T10-09-23Z`

This mode optimizes Minio for use as a direct file system, which means:
1. Files are stored in their raw format, allowing direct access from the file system
2. The .minio.sys directory is automatically cleaned up to avoid version conflicts
3. The Minio server process is properly terminated when the application shuts down

File system mode is particularly useful for development environments and when you need to access the stored files directly without using S3 API calls.

**Note:** In file system mode, some advanced S3 features like versioning may not be available, but basic operations like storing and retrieving files will work consistently.

#### Creating and Accessing Artifacts

After setting up Hypha with S3 support, you can create artifacts and access them through elFinder:

```python
from imjoy_rpc import api
from hypha_rpc import connect_to_server

# Connect to Hypha server
server = await connect_to_server({"name": "test-client", "server_url": "https://hypha.aicell.io"})

token = await server.generate_token()

artifact_manager = await server.get_service("public/artifact-manager")

# Create a dataset artifact
dataset_manifest = {
    "name": "Example Dataset",
    "description": "A dataset containing example data",
}
dataset = await artifact_manager.create(
    alias="example-dataset",
    manifest=dataset_manifest,
    stage=True
)

# Access the artifact through elFinder
async def setup():  
    fm = await api.showDialog(
        src="https://fm.imjoy.io"
    )
    await fm.mount("https://hypha.aicell.io/workspace/example-dataset", {"token": token})

api.export({"setup": setup})
```

You can also access artifacts directly through the elFinder URL:
```
https://fm.imjoy.io/?mount=https://hypha.aicell.io/workspace/artifact-alias
```

For private artifacts that require authentication, append a token:
```
https://fm.imjoy.io/?mount=https://hypha.aicell.io/workspace/artifact-alias&token=your-token
```

#### Using elFinder with Artifact Manager in ImJoy

For ImJoy integration, you can use a similar interface to the S3 mounting, with additional support for authentication:

```python
from imjoy_rpc import api

async def setup():  
    fm = await api.showDialog(
        src="https://jupyter.imjoy.io/elFinder"
    )
    # Mount an artifact with optional authentication
    await fm.mount("https://hypha.aicell.io/workspace/artifact-alias", {"token": "your-token"})
    
api.export({"setup": setup})
```

As a more complete example, you can use it manage files in the [Hypha App Engine](https://ha.amun.ai/).
```python
from imjoy_rpc import api
from hypha_rpc import login, connect_to_server

SERVER_URL = "https://hypha.aicell.io"

# To login, you need to click the url printed and login with your account
token = await login({"server_url": SERVER_URL})

# Connect to the BioEngine server
server = await connect_to_server(
    {"name": "test client", "server_url": SERVER_URL, "token": token}
)

s3 = await server.get_service("s3-storage")
s3_credentials = await s3.generate_credential()

# Now mount it into the elFinder
async def setup():  
    fm = await api.createWindow(
        src="https://jupyter.imjoy.io/elFinder"
    )
    await fm.mount(f"s3://{s3_credentials['access_key_id']}:{s3_credentials['secret_access_key']}@{s3_credentials['endpoint_url']}/{s3_credentials['bucket']}/{s3_credentials['prefix']}")

api.export({"setup": setup})
```

### Service Worker Updates

elFinder uses a service worker for managing file operations and caching. Sometimes you may need to force the service worker to upgrade, especially after updates to the elFinder codebase. You can force an upgrade by adding the `upgrade=1` parameter to the URL:

```
https://fm.imjoy.io/?mount=https://hypha.aicell.io/workspace/artifact-alias&upgrade=1
```

**Note:** After adding the upgrade parameter, you may need to refresh the page a few times in your browser for the upgrade to take effect. This is because service worker updates follow a specific lifecycle and may require multiple refreshes to fully activate.

For ImJoy integration, you can include the upgrade parameter in the src URL:

```python
async def setup():  
    fm = await api.showDialog(
        src="https://jupyter.imjoy.io/elFinder?upgrade=1"
    )
    await fm.mount("https://hypha.aicell.io/workspace/artifact-alias")

api.export({"setup": setup})
```

License
-------

elFinder is issued under a 3-clauses BSD license.

 * [License terms](https://github.com/Studio-42/elFinder/blob/master/LICENSE.md)
